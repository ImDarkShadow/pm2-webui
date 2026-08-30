import WebSocket from 'ws';
import {
  WSMessage,
  WSMessageType,
  HandshakeInitPayload,
  HandshakeChallengePayload,
  HandshakeResponsePayload,
  HandshakeAckPayload,
  ProcessActionRequest,
  signData,
  MetricFrame,
} from '@pm2-webui/shared';
import { AgentMetaRepo } from '../db/repos/agentMetaRepo.js';
import { Pm2Manager } from '../pm2/index.js';
import { LogEngine } from '../logging/index.js';

export interface MasterWsClientDeps {
  readonly masterWsUrl: string;
  readonly agentId: string;
  readonly hostname: string;
  readonly port: number;
  readonly joinToken?: string;
  readonly agentMetaRepo: AgentMetaRepo;
  readonly pm2Manager: Pm2Manager;
  readonly logEngine: LogEngine;
  readonly onStatusChange?: (
    status: 'connected' | 'handshaking' | 'enrolled' | 'disconnected',
  ) => void;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly warn: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface MasterWsClient {
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly sendMetrics: (frame: MetricFrame) => void;
  readonly isConnected: () => boolean;
}

export const createMasterWsClient = (deps: MasterWsClientDeps): MasterWsClient => {
  const {
    masterWsUrl,
    agentId,
    hostname,
    port,
    joinToken,
    agentMetaRepo,
    pm2Manager,
    logEngine,
    onStatusChange,
    logger,
  } = deps;

  let ws: WebSocket | null = null;
  let isClosedExplicitly = false;
  let reconnectAttempts = 0;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let enrolled = false;

  const send = (msg: WSMessage) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const handleMessage = async (raw: string) => {
    try {
      const msg = JSON.parse(raw) as WSMessage<any>;

      switch (msg.type) {
        case WSMessageType.AGENT_HANDSHAKE_CHALLENGE: {
          const payload = msg.payload as HandshakeChallengePayload;
          logger?.info('Received handshake challenge from Master');

          // Save Master public key
          agentMetaRepo.saveMasterPublicKey(payload.masterPublicKey);

          // Sign challenge + timestamp with agent private key
          const keyPairRes = agentMetaRepo.getKeyPair();
          if (!keyPairRes.ok || !keyPairRes.value) {
            logger?.error('Cannot respond to challenge: missing Agent keypair');
            return;
          }

          const timestamp = Date.now();
          const payloadToSign = `${payload.challenge}:${timestamp}`;
          const sigRes = signData(payloadToSign, keyPairRes.value.privateKey);

          if (sigRes.ok) {
            const respPayload: HandshakeResponsePayload = {
              signature: sigRes.value,
              timestamp,
            };
            send({
              id: msg.id,
              type: WSMessageType.AGENT_HANDSHAKE_RESPONSE,
              payload: respPayload,
              timestamp: Date.now(),
            });
          }
          break;
        }

        case WSMessageType.AGENT_HANDSHAKE_ACK: {
          const ack = msg.payload as HandshakeAckPayload;
          logger?.info(`Handshake ACK received. Agent status on Master: ${ack.status}`);
          enrolled = ack.status === 'online';
          onStatusChange?.(enrolled ? 'enrolled' : 'connected');

          // Start Heartbeat
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            send({
              id: Math.random().toString(36).substring(2, 9),
              type: WSMessageType.HEARTBEAT_PING,
              payload: { agentId, timestamp: Date.now() },
              timestamp: Date.now(),
            });
          }, 10_000);
          break;
        }

        case WSMessageType.HEARTBEAT_PONG: {
          // Keepalive OK
          break;
        }

        case WSMessageType.PROCESS_ACTION_REQ: {
          const req = msg.payload as ProcessActionRequest;
          logger?.info(
            `Received process action command from Master: ${req.action} on ${req.target}`,
          );

          const execRes = await pm2Manager.executeAction(req, 'high');
          send({
            id: msg.id,
            type: WSMessageType.PROCESS_ACTION_RES,
            payload: {
              success: execRes.ok,
              error: execRes.ok ? undefined : execRes.error.message,
            },
            timestamp: Date.now(),
          });
          break;
        }

        case WSMessageType.RELAY_TUNNEL_OPEN: {
          // Handle multiplexed relay tunnel for NAT'd node
          const openPayload = msg.payload as {
            tunnelId: string;
            path: string;
            method: string;
            body?: any;
          };

          if (openPayload.path.includes('/logs')) {
            const linesRes = logEngine.queryRawLogs({
              processName: openPayload.body?.processName || '',
              limit: 100,
            });
            send({
              id: msg.id,
              type: WSMessageType.RELAY_TUNNEL_DATA,
              payload: {
                tunnelId: openPayload.tunnelId,
                chunk: JSON.stringify(linesRes.ok ? linesRes.value : { lines: [] }),
                isFinal: true,
              },
              timestamp: Date.now(),
            });
          } else if (openPayload.path.includes('/processes')) {
            const listRes = await pm2Manager.listProcesses('normal');
            send({
              id: msg.id,
              type: WSMessageType.RELAY_TUNNEL_DATA,
              payload: {
                tunnelId: openPayload.tunnelId,
                chunk: JSON.stringify(listRes.ok ? listRes.value : []),
                isFinal: true,
              },
              timestamp: Date.now(),
            });
          }
          break;
        }
      }
    } catch (error) {
      logger?.error('Failed to handle Master WS message', error);
    }
  };

  const connect = () => {
    isClosedExplicitly = false;
    onStatusChange?.('handshaking');

    try {
      const url = `${masterWsUrl.replace(/^http/, 'ws')}/api/v1/agent/connect`;
      logger?.info(`Connecting to Master WS at ${url}`);
      ws = new WebSocket(url);

      ws.on('open', () => {
        logger?.info('Connected to Master WebSocket endpoint');
        reconnectAttempts = 0;
        onStatusChange?.('connected');

        // Send Handshake Init
        const keyPairRes = agentMetaRepo.getKeyPair();
        if (keyPairRes.ok && keyPairRes.value) {
          const initPayload: HandshakeInitPayload = {
            agentId,
            publicKey: keyPairRes.value.publicKey,
            hostname,
            version: '1.0.0',
            port,
            joinToken,
          };
          send({
            id: Math.random().toString(36).substring(2, 9),
            type: WSMessageType.AGENT_HANDSHAKE_INIT,
            payload: initPayload,
            timestamp: Date.now(),
          });
        }
      });

      ws.on('message', (data) => {
        handleMessage(data.toString());
      });

      ws.on('close', () => {
        onStatusChange?.('disconnected');
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (!isClosedExplicitly) {
          const delay = Math.min(30_000, 1000 * Math.pow(1.5, reconnectAttempts++));
          logger?.warn(`Disconnected from Master. Reconnecting in ${Math.round(delay / 1000)}s...`);
          setTimeout(connect, delay);
        }
      });

      ws.on('error', (err) => {
        logger?.error('Master WebSocket error', err);
      });
    } catch (error) {
      logger?.error('Error creating WebSocket connection to Master', error);
    }
  };

  const disconnect = () => {
    isClosedExplicitly = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  };

  const sendMetrics = (frame: MetricFrame) => {
    if (enrolled) {
      send({
        id: Math.random().toString(36).substring(2, 9),
        type: WSMessageType.METRICS_FRAME,
        payload: frame,
        timestamp: Date.now(),
      });
    }
  };

  const isConnected = () => ws !== null && ws.readyState === WebSocket.OPEN;

  return {
    connect,
    disconnect,
    sendMetrics,
    isConnected,
  };
};
