import {
  NodeState,
  NodeStatus,
  ConnectivityMode,
  Result,
  ok,
  err,
  createAppError,
  generateChallenge,
  verifyData,
  Ed25519KeyPair,
  HandshakeInitPayload,
  HandshakeChallengePayload,
  HandshakeAckPayload,
  APP_VERSION,
} from '@pm2-webui/shared';
import { NodesRepo } from '../db/repos/nodesRepo.js';
import { AuditRepo } from '../db/repos/auditRepo.js';

export interface NodeRegistryDeps {
  readonly nodesRepo: NodesRepo;
  readonly auditRepo: AuditRepo;
  readonly masterKeyPair: Ed25519KeyPair;
  readonly joinToken?: string;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly warn: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

interface PendingChallenge {
  readonly agentId: string;
  readonly publicKey: string;
  readonly challenge: string;
  readonly expiresAt: number;
}

export interface NodeRegistry {
  readonly initiateHandshake: (init: HandshakeInitPayload) => Result<HandshakeChallengePayload>;
  readonly verifyHandshakeResponse: (options: {
    readonly agentId: string;
    readonly signature: string;
    readonly timestamp: number;
  }) => Result<HandshakeAckPayload>;
  readonly approveNode: (nodeId: string, adminUserId: string, ipAddress: string) => Result<void>;
  readonly rejectNode: (
    nodeId: string,
    adminUserId: string,
    reason: string,
    ipAddress: string,
  ) => Result<void>;
  readonly revokeNode: (
    nodeId: string,
    adminUserId: string,
    reason: string,
    ipAddress: string,
  ) => Result<void>;
  readonly handleNodeDisconnect: (nodeId: string) => Result<void>;
  readonly recordHeartbeat: (nodeId: string) => Result<void>;
  readonly listNodes: (filters?: {
    status?: NodeStatus;
    groupId?: string;
  }) => Result<readonly NodeState[]>;
  readonly getNode: (nodeId: string) => Result<NodeState | null>;
}

export const createNodeRegistry = (deps: NodeRegistryDeps): NodeRegistry => {
  const { nodesRepo, auditRepo, masterKeyPair, logger } = deps;
  const clusterJoinToken =
    deps.joinToken || process.env.CLUSTER_JOIN_TOKEN || process.env.JOIN_TOKEN;

  // In-memory challenge store for active handshakes (60s TTL)
  const activeChallenges = new Map<string, PendingChallenge>();

  const initiateHandshake = (init: HandshakeInitPayload): Result<HandshakeChallengePayload> => {
    const challenge = generateChallenge(32);
    const expiresAt = Date.now() + 60_000;

    activeChallenges.set(init.agentId, {
      agentId: init.agentId,
      publicKey: init.publicKey,
      challenge,
      expiresAt,
    });

    const isValidJoinToken = Boolean(
      clusterJoinToken &&
      typeof clusterJoinToken === 'string' &&
      clusterJoinToken.length > 0 &&
      init.joinToken &&
      init.joinToken === clusterJoinToken,
    );

    const initialStatus: NodeStatus = isValidJoinToken ? 'online' : 'pending';
    const isLoopback =
      init.ipAddress === '127.0.0.1' ||
      init.ipAddress === '::1' ||
      init.ipAddress === 'localhost';
    const connectivityMode: ConnectivityMode = isLoopback ? 'direct' : 'relay';

    // Check if node exists
    const existingRes = nodesRepo.findById(init.agentId);
    if (existingRes.ok && !existingRes.value) {
      // Register node (auto-enroll as online if valid join token is provided, else pending)
      const newNode: NodeState = {
        id: init.agentId,
        hostname: init.hostname,
        ipAddress: init.ipAddress ?? '127.0.0.1',
        port: init.port,
        publicKey: init.publicKey,
        connectivityMode,
        status: initialStatus,
        version: init.version || APP_VERSION,
        enrolledAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      nodesRepo.create(newNode);

      if (isValidJoinToken) {
        logger?.info?.(
          `Node ${init.agentId} (${init.hostname}) auto-enrolled via valid cluster join token`,
        );
        auditRepo.insert({
          userId: 'system:join-token',
          nodeId: init.agentId,
          action: 'node:auto_enroll',
          status: 'success',
          ipAddress: init.ipAddress ?? '127.0.0.1',
          detailsJson: JSON.stringify({
            hostname: init.hostname,
            reason: 'Valid cluster join token presented',
          }),
        });
      }
    } else if (existingRes.ok && existingRes.value) {
      const existingNode = existingRes.value;
      const targetStatus =
        existingNode.status === 'pending' && isValidJoinToken ? 'online' : existingNode.status;

      // Update existing node's latest IP, version, connectivity mode, and last seen
      nodesRepo.create({
        id: init.agentId,
        hostname: init.hostname,
        ipAddress: init.ipAddress ?? existingNode.ipAddress,
        port: init.port,
        publicKey: init.publicKey,
        connectivityMode,
        status: targetStatus,
        version: init.version || existingNode.version || APP_VERSION,
        enrolledAt: existingNode.enrolledAt,
        lastSeenAt: Date.now(),
      });

      if (existingNode.status === 'pending' && isValidJoinToken) {
        logger?.info?.(
          `Pending node ${init.agentId} (${init.hostname}) auto-approved via valid cluster join token`,
        );
        auditRepo.insert({
          userId: 'system:join-token',
          nodeId: init.agentId,
          action: 'node:auto_enroll',
          status: 'success',
          ipAddress: init.ipAddress ?? '127.0.0.1',
          detailsJson: JSON.stringify({
            hostname: init.hostname,
            reason: 'Pending node authenticated with valid cluster join token',
          }),
        });
      }
    }

    return ok({
      challenge,
      masterPublicKey: masterKeyPair.publicKey,
    });
  };

  const verifyHandshakeResponse = (options: {
    readonly agentId: string;
    readonly signature: string;
    readonly timestamp: number;
  }): Result<HandshakeAckPayload> => {
    const { agentId, signature, timestamp } = options;

    const pending = activeChallenges.get(agentId);
    if (!pending) {
      return err(createAppError('UNAUTHORIZED', 'No active handshake challenge for agent'));
    }

    if (Date.now() > pending.expiresAt) {
      activeChallenges.delete(agentId);
      return err(createAppError('UNAUTHORIZED', 'Handshake challenge expired'));
    }

    // Replay attack protection: timestamp must be within 60s
    if (Math.abs(Date.now() - timestamp) > 60_000) {
      activeChallenges.delete(agentId);
      return err(createAppError('UNAUTHORIZED', 'Handshake timestamp drift exceeds 60s'));
    }

    const payloadToVerify = `${pending.challenge}:${timestamp}`;
    const isValid = verifyData(payloadToVerify, signature, pending.publicKey);
    activeChallenges.delete(agentId);

    if (!isValid) {
      logger?.warn?.(`Invalid handshake signature for agent ${agentId}`);
      return err(createAppError('UNAUTHORIZED', 'Invalid cryptographic signature'));
    }

    const nodeRes = nodesRepo.findById(agentId);
    if (!nodeRes.ok || !nodeRes.value) {
      return err(createAppError('NOT_FOUND', 'Node not registered'));
    }

    const node = nodeRes.value;
    if (node.status === 'revoked' || node.status === 'rejected') {
      return err(createAppError('FORBIDDEN', `Node is ${node.status}`));
    }

    let finalStatus = node.status;
    if (node.status === 'online' || node.status === 'offline') {
      nodesRepo.updateStatus(agentId, 'online');
      finalStatus = 'online';
    }

    return ok({
      status: finalStatus,
      masterVersion: '1.0.0',
      serverTime: Date.now(),
    });
  };

  const approveNode = (nodeId: string, adminUserId: string, ipAddress: string): Result<void> => {
    const nodeRes = nodesRepo.findById(nodeId);
    if (!nodeRes.ok || !nodeRes.value) {
      return err(createAppError('NOT_FOUND', 'Node not found'));
    }

    nodesRepo.updateStatus(nodeId, 'online');

    auditRepo.insert({
      userId: adminUserId,
      nodeId,
      action: 'node:approve',
      status: 'success',
      ipAddress,
      detailsJson: JSON.stringify({ nodeId }),
    });

    return ok(undefined);
  };

  const rejectNode = (
    nodeId: string,
    adminUserId: string,
    reason: string,
    ipAddress: string,
  ): Result<void> => {
    nodesRepo.updateStatus(nodeId, 'rejected');

    auditRepo.insert({
      userId: adminUserId,
      nodeId,
      action: 'node:reject',
      status: 'success',
      ipAddress,
      detailsJson: JSON.stringify({ nodeId, reason }),
    });

    return ok(undefined);
  };

  const revokeNode = (
    nodeId: string,
    adminUserId: string,
    reason: string,
    ipAddress: string,
  ): Result<void> => {
    nodesRepo.updateStatus(nodeId, 'revoked');

    auditRepo.insert({
      userId: adminUserId,
      nodeId,
      action: 'node:revoke',
      status: 'success',
      ipAddress,
      detailsJson: JSON.stringify({ nodeId, reason }),
    });

    return ok(undefined);
  };

  const handleNodeDisconnect = (nodeId: string): Result<void> => {
    const nodeRes = nodesRepo.findById(nodeId);
    if (nodeRes.ok && nodeRes.value && nodeRes.value.status === 'online') {
      nodesRepo.updateStatus(nodeId, 'offline');
    }
    return ok(undefined);
  };

  const recordHeartbeat = (nodeId: string): Result<void> => {
    return nodesRepo.updateLastSeen(nodeId, Date.now());
  };

  const listNodes = (filters?: {
    status?: NodeStatus;
    groupId?: string;
  }): Result<readonly NodeState[]> => {
    return nodesRepo.list(filters);
  };

  const getNode = (nodeId: string): Result<NodeState | null> => {
    return nodesRepo.findById(nodeId);
  };

  return {
    initiateHandshake,
    verifyHandshakeResponse,
    approveNode,
    rejectNode,
    revokeNode,
    handleNodeDisconnect,
    recordHeartbeat,
    listNodes,
    getNode,
  };
};
