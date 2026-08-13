import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  verifyDelegationToken,
  MetricFrame,
  LogLine,
  WSMessageType,
  WSMessage,
} from '@pm2-cluster/shared';
import { AgentMetaRepo } from '../db/repos/agentMetaRepo.js';

export interface AgentWsServerDeps {
  readonly server: http.Server;
  readonly agentMetaRepo: AgentMetaRepo;
  readonly agentId: string;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly warn: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface AgentWsServer {
  readonly broadcastMetrics: (frame: MetricFrame) => void;
  readonly broadcastLogLine: (line: LogLine) => void;
  readonly close: () => void;
}

export const createAgentWsServer = (deps: AgentWsServerDeps): AgentWsServer => {
  const { server, agentMetaRepo, agentId, logger } = deps;

  const wss = new WebSocketServer({ server, path: '/ws' });
  const authenticatedSockets = new Set<WebSocket>();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      logger?.warn('WebSocket connection rejected: Missing delegation token');
      ws.close(4001, 'Unauthorized: Missing token');
      return;
    }

    const masterPubRes = agentMetaRepo.getMasterPublicKey();
    if (!masterPubRes.ok || !masterPubRes.value) {
      logger?.warn('WebSocket connection rejected: Master public key not configured');
      ws.close(4003, 'Forbidden: Master public key not configured');
      return;
    }

    const verifyRes = verifyDelegationToken({
      token,
      masterPublicKey: masterPubRes.value,
      expectedNodeId: agentId,
    });

    if (!verifyRes.ok) {
      logger?.warn(`WebSocket connection rejected: ${verifyRes.error.message}`);
      ws.close(4001, verifyRes.error.message);
      return;
    }

    authenticatedSockets.add(ws);
    logger?.info(`Browser direct WebSocket connected for user ${verifyRes.value.sub}`);

    ws.on('close', () => {
      authenticatedSockets.delete(ws);
    });

    ws.on('error', () => {
      authenticatedSockets.delete(ws);
    });
  });

  const broadcast = (msg: WSMessage) => {
    const serialized = JSON.stringify(msg);
    for (const ws of authenticatedSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
      }
    }
  };

  const broadcastMetrics = (frame: MetricFrame) => {
    broadcast({
      id: Math.random().toString(36).substring(2, 9),
      type: WSMessageType.METRICS_FRAME,
      payload: frame,
      timestamp: Date.now(),
    });
  };

  const broadcastLogLine = (line: LogLine) => {
    broadcast({
      id: Math.random().toString(36).substring(2, 9),
      type: WSMessageType.LOG_STREAM_CHUNK,
      payload: line,
      timestamp: Date.now(),
    });
  };

  const close = () => {
    for (const ws of authenticatedSockets) {
      ws.close();
    }
    authenticatedSockets.clear();
    wss.close();
  };

  return {
    broadcastMetrics,
    broadcastLogLine,
    close,
  };
};
