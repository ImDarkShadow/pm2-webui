import WebSocket from 'ws';
import os from 'node:os';
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
  CrashEvent,
  ErrorTraceItem,
  APP_VERSION,
} from '@pm2-webui/shared';
import { AgentMetaRepo } from '../db/repos/agentMetaRepo.js';
import { Pm2Manager } from '../pm2/index.js';
import { LogEngine } from '../logging/index.js';
import { MetricsCollector } from '../metrics/index.js';
import { AgentMetricsRepo } from '../db/repos/agentMetricsRepo.js';
import { AgentErrorTraceRepo } from '../db/repos/agentErrorTraceRepo.js';
import { AgentCrashRepo } from '../db/repos/agentCrashRepo.js';
import {
  getProcessCommitHistory,
  executeProcessGitPull,
  executeProcessGitRollback,
} from '../pm2/gitOps.js';

export interface MasterWsClientDeps {
  readonly masterWsUrl: string;
  readonly agentId: string;
  readonly hostname: string;
  readonly ipAddress?: string;
  readonly port: number;
  readonly joinToken?: string;
  readonly agentMetaRepo: AgentMetaRepo;
  readonly pm2Manager: Pm2Manager;
  readonly logEngine: LogEngine;
  readonly metricsCollector?: MetricsCollector;
  readonly metricsRepo?: AgentMetricsRepo;
  readonly errorTraceRepo?: AgentErrorTraceRepo;
  readonly crashRepo?: AgentCrashRepo;
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
  readonly sendCrashEvent: (crash: CrashEvent) => void;
  readonly sendErrorTrace: (trace: ErrorTraceItem) => void;
  readonly isConnected: () => boolean;
}

export const createMasterWsClient = (deps: MasterWsClientDeps): MasterWsClient => {
  const {
    masterWsUrl,
    agentId,
    hostname,
    ipAddress,
    port,
    joinToken,
    agentMetaRepo,
    pm2Manager,
    logEngine,
    metricsCollector,
    metricsRepo,
    errorTraceRepo,
    crashRepo,
    onStatusChange,
    logger,
  } = deps;

  let ws: WebSocket | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  let isClosedExplicitly = false;
  let enrolled = false;

  const send = (msg: WSMessage) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const handleMessage = async (dataStr: string) => {
    try {
      const msg = JSON.parse(dataStr) as WSMessage<any>;

      switch (msg.type) {
        case WSMessageType.AGENT_HANDSHAKE_CHALLENGE: {
          const challengePayload = msg.payload as HandshakeChallengePayload;
          agentMetaRepo.saveMasterPublicKey(challengePayload.masterPublicKey);

          const keyPairRes = agentMetaRepo.getKeyPair();
          if (!keyPairRes.ok || !keyPairRes.value) return;

          const timestamp = Date.now();
          const dataToSign = `${challengePayload.challenge}:${timestamp}`;
          const sigRes = signData(dataToSign, keyPairRes.value.privateKey);

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
            onStatusChange?.('handshaking');
          }
          break;
        }

        case WSMessageType.AGENT_HANDSHAKE_ACK: {
          const ackPayload = msg.payload as HandshakeAckPayload;
          logger?.info(`Master handshake ACK received. Enrolled status: ${ackPayload.status}`);
          if (ackPayload.status === 'online' || ackPayload.status === 'pending') {
            enrolled = true;
            onStatusChange?.('enrolled');
          }
          break;
        }

        case WSMessageType.AGENT_HANDSHAKE_REJECT: {
          logger?.warn('Agent handshake rejected by Master');
          onStatusChange?.('disconnected');
          disconnect();
          break;
        }

        case WSMessageType.HEARTBEAT_PONG: {
          break;
        }

        case WSMessageType.PROCESS_ACTION_REQ: {
          const actionReq = msg.payload as ProcessActionRequest;
          const result = await pm2Manager.executeAction(actionReq);
          send({
            id: msg.id,
            type: WSMessageType.PROCESS_ACTION_RES,
            payload: result,
            timestamp: Date.now(),
          });
          break;
        }

        case WSMessageType.RELAY_TUNNEL_OPEN: {
          const openPayload = msg.payload as {
            tunnelId: string;
            path: string;
            method: string;
            body?: any;
          };

          if (openPayload.path.includes('/logs')) {
            const queryRes = logEngine.queryRawLogs({
              processName: openPayload.body?.processName || 'all',
              stream: openPayload.body?.stream || 'both',
              search: openPayload.body?.search,
              limit: openPayload.body?.limit || 100,
            });
            send({
              id: msg.id,
              type: WSMessageType.RELAY_TUNNEL_DATA,
              payload: {
                tunnelId: openPayload.tunnelId,
                chunk: JSON.stringify(queryRes.ok ? queryRes.value.lines : []),
                isFinal: true,
              },
              timestamp: Date.now(),
            });
          } else if (openPayload.path.includes('/crashes')) {
            const crashRes = crashRepo ? crashRepo.list(openPayload.body?.processName, openPayload.body?.limit || 50) : { ok: true, value: [] };
            send({
              id: msg.id,
              type: WSMessageType.RELAY_TUNNEL_DATA,
              payload: {
                tunnelId: openPayload.tunnelId,
                chunk: JSON.stringify(crashRes.ok ? crashRes.value : []),
                isFinal: true,
              },
              timestamp: Date.now(),
            });
          } else if (openPayload.path.includes('/errors')) {
            if (openPayload.method === 'POST' && openPayload.path.includes('/resolve')) {
              const match = openPayload.path.match(/\/errors\/([^/]+)\/resolve/);
              if (match && match[1] && errorTraceRepo) {
                errorTraceRepo.resolve(decodeURIComponent(match[1]));
              }
              send({
                id: msg.id,
                type: WSMessageType.RELAY_TUNNEL_DATA,
                payload: {
                  tunnelId: openPayload.tunnelId,
                  chunk: JSON.stringify({ success: true }),
                  isFinal: true,
                },
                timestamp: Date.now(),
              });
            } else {
              const filter = openPayload.body || {};
              const tracesRes = errorTraceRepo ? errorTraceRepo.list(filter) : { ok: true, value: [] };
              send({
                id: msg.id,
                type: WSMessageType.RELAY_TUNNEL_DATA,
                payload: {
                  tunnelId: openPayload.tunnelId,
                  chunk: JSON.stringify(tracesRes.ok ? tracesRes.value : []),
                  isFinal: true,
                },
                timestamp: Date.now(),
              });
            }
          } else if (openPayload.path.includes('/processes/') && openPayload.path.includes('/metrics')) {
            const match = openPayload.path.match(/\/processes\/([^/]+)\/metrics/);
            const procName = match && match[1] ? decodeURIComponent(match[1]) : '';
            const fromTs = openPayload.body?.from || Date.now() - 24 * 60 * 60 * 1000;
            const toTs = openPayload.body?.to || Date.now();
            const bucketMs = openPayload.body?.bucketMs;

            let history: any[] = [];
            if (metricsRepo && procName) {
              const res = metricsRepo.queryProcessMetricsRange(procName, fromTs, toTs, bucketMs);
              if (res.ok) history = [...res.value];
            }

            const recentProc = metricsCollector?.getRecentProcessSamples(procName) || [];
            if (toTs >= Date.now() - 15 * 60 * 1000 && !bucketMs) {
              const map = new Map<number, any>();
              for (const item of history) map.set(item.timestamp, item);
              for (const item of recentProc) map.set(item.timestamp, item);
              history = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
            }

            send({
              id: msg.id,
              type: WSMessageType.RELAY_TUNNEL_DATA,
              payload: {
                tunnelId: openPayload.tunnelId,
                chunk: JSON.stringify(history),
                isFinal: true,
              },
              timestamp: Date.now(),
            });
          } else if (openPayload.path.includes('/processes/') && openPayload.path.includes('/git/commits')) {
            const match = openPayload.path.match(/\/processes\/([^/]+)\/git\/commits/);
            const procName = match && match[1] ? decodeURIComponent(match[1]) : '';
            const listRes = await pm2Manager.listProcesses('high');
            const proc = listRes.ok
              ? listRes.value.find((p) => p.name === procName || String(p.pmId) === procName)
              : null;
            if (!proc || !proc.cwd) {
              send({
                id: msg.id,
                type: WSMessageType.RELAY_TUNNEL_DATA,
                payload: {
                  tunnelId: openPayload.tunnelId,
                  chunk: JSON.stringify({ error: `Process "${procName}" or working directory not found` }),
                  isFinal: true,
                },
                timestamp: Date.now(),
              });
              break;
            }
            const limit = openPayload.body?.limit || 20;
            const commitsRes = await getProcessCommitHistory(proc.cwd, limit);
            send({
              id: msg.id,
              type: WSMessageType.RELAY_TUNNEL_DATA,
              payload: {
                tunnelId: openPayload.tunnelId,
                chunk: JSON.stringify(commitsRes.ok ? commitsRes.value : { error: commitsRes.error.message }),
                isFinal: true,
              },
              timestamp: Date.now(),
            });
          } else if (openPayload.path.includes('/processes/') && openPayload.path.includes('/git/pull')) {
            const match = openPayload.path.match(/\/processes\/([^/]+)\/git\/pull/);
            const procName = match && match[1] ? decodeURIComponent(match[1]) : '';
            const listRes = await pm2Manager.listProcesses('high');
            const proc = listRes.ok
              ? listRes.value.find((p) => p.name === procName || String(p.pmId) === procName)
              : null;
            if (!proc || !proc.cwd) {
              send({
                id: msg.id,
                type: WSMessageType.RELAY_TUNNEL_DATA,
                payload: {
                  tunnelId: openPayload.tunnelId,
                  chunk: JSON.stringify({ error: `Process "${procName}" or working directory not found` }),
                  isFinal: true,
                },
                timestamp: Date.now(),
              });
              break;
            }
            const rebase = openPayload.body?.rebase !== false;
            const pullRes = await executeProcessGitPull(proc.cwd, rebase);
            if (!pullRes.ok) {
              send({
                id: msg.id,
                type: WSMessageType.RELAY_TUNNEL_DATA,
                payload: {
                  tunnelId: openPayload.tunnelId,
                  chunk: JSON.stringify({ error: pullRes.error.message }),
                  isFinal: true,
                },
                timestamp: Date.now(),
              });
              break;
            }
            await pm2Manager.executeAction({ action: 'restart', target: proc.pmId }, 'high');
            send({
              id: msg.id,
              type: WSMessageType.RELAY_TUNNEL_DATA,
              payload: {
                tunnelId: openPayload.tunnelId,
                chunk: JSON.stringify({ success: true, ...pullRes.value }),
                isFinal: true,
              },
              timestamp: Date.now(),
            });
          } else if (openPayload.path.includes('/processes/') && openPayload.path.includes('/git/rollback')) {
            const match = openPayload.path.match(/\/processes\/([^/]+)\/git\/rollback/);
            const procName = match && match[1] ? decodeURIComponent(match[1]) : '';
            const listRes = await pm2Manager.listProcesses('high');
            const proc = listRes.ok
              ? listRes.value.find((p) => p.name === procName || String(p.pmId) === procName)
              : null;
            if (!proc || !proc.cwd) {
              send({
                id: msg.id,
                type: WSMessageType.RELAY_TUNNEL_DATA,
                payload: {
                  tunnelId: openPayload.tunnelId,
                  chunk: JSON.stringify({ error: `Process "${procName}" or working directory not found` }),
                  isFinal: true,
                },
                timestamp: Date.now(),
              });
              break;
            }
            const commitHash = openPayload.body?.commitHash;
            if (!commitHash) {
              send({
                id: msg.id,
                type: WSMessageType.RELAY_TUNNEL_DATA,
                payload: {
                  tunnelId: openPayload.tunnelId,
                  chunk: JSON.stringify({ error: 'Commit hash is required for rollback' }),
                  isFinal: true,
                },
                timestamp: Date.now(),
              });
              break;
            }
            const rollbackRes = await executeProcessGitRollback(proc.cwd, commitHash);
            if (!rollbackRes.ok) {
              send({
                id: msg.id,
                type: WSMessageType.RELAY_TUNNEL_DATA,
                payload: {
                  tunnelId: openPayload.tunnelId,
                  chunk: JSON.stringify({ error: rollbackRes.error.message }),
                  isFinal: true,
                },
                timestamp: Date.now(),
              });
              break;
            }
            await pm2Manager.executeAction({ action: 'restart', target: proc.pmId }, 'high');
            send({
              id: msg.id,
              type: WSMessageType.RELAY_TUNNEL_DATA,
              payload: {
                tunnelId: openPayload.tunnelId,
                chunk: JSON.stringify({ success: true, ...rollbackRes.value }),
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
          } else if (openPayload.path.includes('/metrics')) {
            let currentMetric: any = null;
            let historyList: any[] = [];

            if (metricsCollector) {
              const curRes = await metricsCollector.collectCurrentMetrics();
              if (curRes.ok) {
                currentMetric = curRes.value;
              }
              const recent = metricsCollector.getRecentSamples();
              const fromTs = openPayload.body?.from || Date.now() - 24 * 60 * 60 * 1000;
              const toTs = openPayload.body?.to || Date.now();
              const bucketMs = openPayload.body?.bucketMs;
              const limit = openPayload.body?.limit || 1000;

              let dbHistory: readonly any[] = [];
              if (metricsRepo) {
                const histRes = metricsRepo.queryRange(fromTs, toTs, bucketMs);
                if (histRes.ok) dbHistory = histRes.value;
              }

              const map = new Map<number, any>();
              for (const item of dbHistory) {
                map.set(item.timestamp, item);
              }
              if (toTs >= Date.now() - 15 * 60 * 1000 && !bucketMs) {
                for (const item of recent) {
                  map.set(item.timestamp, item);
                }
              }
              historyList = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);

              // Only slice if not explicitly downsampled with bucketMs
              if (!bucketMs && historyList.length > limit) {
                historyList = historyList.slice(-limit);
              }
            }

            send({
              id: msg.id,
              type: WSMessageType.RELAY_TUNNEL_DATA,
              payload: {
                tunnelId: openPayload.tunnelId,
                chunk: JSON.stringify({
                  current: currentMetric,
                  history: historyList,
                }),
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

  const startHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      send({
        id: Math.random().toString(36).substring(2, 9),
        type: WSMessageType.HEARTBEAT_PING,
        payload: { timestamp: Date.now() },
        timestamp: Date.now(),
      });
    }, 15000);
  };

  const connect = () => {
    if (isClosedExplicitly) return;

    try {
      const url = `${masterWsUrl.replace(/^http/, 'ws')}/api/v1/agent/connect`;
      logger?.info(`Attempting connection to Master WS: ${url}`);
      ws = new WebSocket(url);

      ws.on('open', () => {
        logger?.info('Connected to Master WebSocket endpoint');
        reconnectAttempts = 0;
        onStatusChange?.('connected');

        // Send Handshake Init
        const keyPairRes = agentMetaRepo.getKeyPair();
        if (keyPairRes.ok && keyPairRes.value) {
          let detectedIp = ipAddress;
          if (!detectedIp || detectedIp === '127.0.0.1' || detectedIp === 'localhost') {
            try {
              const ifaces = os.networkInterfaces();
              for (const name of Object.keys(ifaces)) {
                for (const iface of ifaces[name] || []) {
                  if (iface.family === 'IPv4' && !iface.internal) {
                    detectedIp = iface.address;
                    break;
                  }
                }
                if (detectedIp && detectedIp !== '127.0.0.1') break;
              }
            } catch {
              // fallback
            }
          }

          const initPayload: HandshakeInitPayload = {
            agentId,
            publicKey: keyPairRes.value.publicKey,
            hostname,
            ipAddress: detectedIp || '127.0.0.1',
            version: APP_VERSION,
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
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          logger?.warn(
            `Disconnected from Master. Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`,
          );
          setTimeout(connect, delay);
        }
      });

      ws.on('error', (err) => {
        logger?.error('Master WebSocket client error', err);
      });

      startHeartbeat();
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
    if (enrolled || isConnected()) {
      send({
        id: Math.random().toString(36).substring(2, 9),
        type: WSMessageType.METRICS_FRAME,
        payload: frame,
        timestamp: Date.now(),
      });
    }
  };

  const sendCrashEvent = (crash: CrashEvent) => {
    send({
      id: Math.random().toString(36).substring(2, 9),
      type: WSMessageType.PROCESS_CRASH_EVENT,
      payload: crash,
      timestamp: Date.now(),
    });
  };

  const sendErrorTrace = (trace: ErrorTraceItem) => {
    send({
      id: Math.random().toString(36).substring(2, 9),
      type: WSMessageType.ERROR_TRACE_EVENT,
      payload: trace,
      timestamp: Date.now(),
    });
  };

  const isConnected = () => ws !== null && ws.readyState === WebSocket.OPEN;

  return {
    connect,
    disconnect,
    sendMetrics,
    sendCrashEvent,
    sendErrorTrace,
    isConnected,
  };
};
