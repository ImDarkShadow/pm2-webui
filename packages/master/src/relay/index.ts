import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import {
  WSMessage,
  WSMessageType,
  MetricFrame,
  Result,
  ok,
  err,
  createAppError,
} from '@pm2-cluster/shared';
import { NodeRegistry } from '../registry/index.js';

export interface RelayProxyDeps {
  readonly nodeRegistry: NodeRegistry;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly warn: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

interface ActiveAgentConnection {
  readonly agentId: string;
  readonly socket: WebSocket;
  readonly lastHeartbeat: number;
}

interface PendingCommand<T> {
  readonly id: string;
  readonly resolve: (res: Result<T>) => void;
  readonly timeoutTimer: NodeJS.Timeout;
}

export interface RelayProxyEngine {
  readonly registerAgentSocket: (agentId: string, socket: WebSocket) => void;
  readonly removeAgentSocket: (agentId: string) => void;
  readonly handleAgentMessage: (agentId: string, rawMessage: string) => void;
  readonly sendCommandToAgent: <T = unknown>(
    agentId: string,
    type: WSMessageType,
    payload: unknown,
    timeoutMs?: number,
  ) => Promise<Result<T>>;
  readonly executeTunnelRequest: (
    agentId: string,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
  ) => Promise<Result<any>>;
  readonly getLatestMetricsForNode: (nodeId: string) => MetricFrame | null;
  readonly isAgentConnected: (nodeId: string) => boolean;
}

export const createRelayProxyEngine = (deps: RelayProxyDeps): RelayProxyEngine => {
  const { nodeRegistry, logger } = deps;

  const agentSockets = new Map<string, ActiveAgentConnection>();
  const pendingCommands = new Map<string, PendingCommand<any>>();
  const latestMetrics = new Map<string, MetricFrame>();

  const registerAgentSocket = (agentId: string, socket: WebSocket): void => {
    agentSockets.set(agentId, {
      agentId,
      socket,
      lastHeartbeat: Date.now(),
    });
    logger?.info(`Agent ${agentId} control socket registered in Relay Proxy`);
  };

  const removeAgentSocket = (agentId: string): void => {
    agentSockets.delete(agentId);
    nodeRegistry.handleNodeDisconnect(agentId);
    logger?.info(`Agent ${agentId} control socket removed from Relay Proxy`);
  };

  const isAgentConnected = (nodeId: string): boolean => {
    const conn = agentSockets.get(nodeId);
    return conn !== undefined && conn.socket.readyState === WebSocket.OPEN;
  };

  const handleAgentMessage = (agentId: string, rawMessage: string): void => {
    try {
      const msg = JSON.parse(rawMessage) as WSMessage<any>;

      switch (msg.type) {
        case WSMessageType.HEARTBEAT_PING: {
          nodeRegistry.recordHeartbeat(agentId);
          const conn = agentSockets.get(agentId);
          if (conn && conn.socket.readyState === WebSocket.OPEN) {
            conn.socket.send(
              JSON.stringify({
                id: msg.id,
                type: WSMessageType.HEARTBEAT_PONG,
                payload: { timestamp: Date.now() },
                timestamp: Date.now(),
              }),
            );
          }
          break;
        }

        case WSMessageType.METRICS_FRAME: {
          const frame = msg.payload as MetricFrame;
          latestMetrics.set(agentId, frame);
          nodeRegistry.recordHeartbeat(agentId);
          break;
        }

        case WSMessageType.PROCESS_ACTION_RES:
        case WSMessageType.RELAY_TUNNEL_DATA: {
          const pending = pendingCommands.get(msg.id);
          if (pending) {
            clearTimeout(pending.timeoutTimer);
            pendingCommands.delete(msg.id);

            if (msg.type === WSMessageType.PROCESS_ACTION_RES) {
              const resPayload = msg.payload as { success: boolean; error?: string };
              if (resPayload.success) {
                pending.resolve(ok(undefined));
              } else {
                pending.resolve(
                  err(createAppError('PM2_ERROR', resPayload.error || 'Process action failed')),
                );
              }
            } else if (msg.type === WSMessageType.RELAY_TUNNEL_DATA) {
              const dataPayload = msg.payload as { chunk: string };
              try {
                const parsed = JSON.parse(dataPayload.chunk);
                pending.resolve(ok(parsed));
              } catch {
                pending.resolve(ok(dataPayload.chunk));
              }
            }
          }
          break;
        }
      }
    } catch (error) {
      logger?.error(`Failed to parse message from agent ${agentId}`, error);
    }
  };

  const sendCommandToAgent = <T = unknown>(
    agentId: string,
    type: WSMessageType,
    payload: unknown,
    timeoutMs = 15_000,
  ): Promise<Result<T>> => {
    const conn = agentSockets.get(agentId);
    if (!conn || conn.socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve(
        err(createAppError('NETWORK_ERROR', `Agent ${agentId} is offline or unreachable`)),
      );
    }

    const correlationId = crypto.randomUUID();

    return new Promise((resolve) => {
      const timeoutTimer = setTimeout(() => {
        pendingCommands.delete(correlationId);
        resolve(err(createAppError('TIMEOUT', `Command ${type} timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      pendingCommands.set(correlationId, {
        id: correlationId,
        resolve,
        timeoutTimer,
      });

      const message: WSMessage = {
        id: correlationId,
        type,
        payload,
        timestamp: Date.now(),
      };

      conn.socket.send(JSON.stringify(message));
    });
  };

  const executeTunnelRequest = async (
    agentId: string,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
  ): Promise<Result<any>> => {
    return sendCommandToAgent(
      agentId,
      WSMessageType.RELAY_TUNNEL_OPEN,
      {
        tunnelId: crypto.randomUUID(),
        path,
        method,
        body,
      },
      15_000,
    );
  };

  const getLatestMetricsForNode = (nodeId: string): MetricFrame | null => {
    return latestMetrics.get(nodeId) || null;
  };

  return {
    registerAgentSocket,
    removeAgentSocket,
    handleAgentMessage,
    sendCommandToAgent,
    executeTunnelRequest,
    getLatestMetricsForNode,
    isAgentConnected,
  };
};
