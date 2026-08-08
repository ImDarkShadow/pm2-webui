import { z } from 'zod';
import { Result, ok, err, createAppError } from '../errors/index.js';
import { NodeStatus } from '../types/index.js';

// Protocol Message Types
export const WSMessageType = {
  // Handshake & Auth
  AGENT_HANDSHAKE_INIT: 'agent:handshake:init',
  AGENT_HANDSHAKE_CHALLENGE: 'agent:handshake:challenge',
  AGENT_HANDSHAKE_RESPONSE: 'agent:handshake:response',
  AGENT_HANDSHAKE_ACK: 'agent:handshake:ack',
  AGENT_HANDSHAKE_REJECT: 'agent:handshake:reject',

  // Heartbeat & Telemetry
  HEARTBEAT_PING: 'telemetry:ping',
  HEARTBEAT_PONG: 'telemetry:pong',
  METRICS_FRAME: 'telemetry:metrics',
  PROCESS_STATE_CHANGE: 'telemetry:process_state',

  // Command Execution (Master -> Agent / Agent -> Master)
  PROCESS_ACTION_REQ: 'cmd:process:action:req',
  PROCESS_ACTION_RES: 'cmd:process:action:res',

  // Logs
  LOG_STREAM_SUBSCRIBE: 'logs:subscribe',
  LOG_STREAM_UNSUBSCRIBE: 'logs:unsubscribe',
  LOG_STREAM_CHUNK: 'logs:chunk',

  // Relay Tunneling (Multiplexed stream over WS)
  RELAY_TUNNEL_OPEN: 'relay:tunnel:open',
  RELAY_TUNNEL_DATA: 'relay:tunnel:data',
  RELAY_TUNNEL_CLOSE: 'relay:tunnel:close',
} as const;

export type WSMessageType = (typeof WSMessageType)[keyof typeof WSMessageType];

export interface WSMessage<T = unknown> {
  readonly id: string; // Correlation ID
  readonly type: WSMessageType;
  readonly payload: T;
  readonly timestamp: number;
}

export const WSMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.unknown(),
  timestamp: z.number(),
});

// Handshake Payloads
export interface HandshakeInitPayload {
  readonly agentId: string;
  readonly publicKey: string;
  readonly hostname: string;
  readonly version: string;
  readonly ipAddress?: string;
  readonly port: number;
  readonly joinToken?: string;
}

export interface HandshakeChallengePayload {
  readonly challenge: string;
  readonly masterPublicKey: string;
}

export interface HandshakeResponsePayload {
  readonly signature: string;
  readonly timestamp: number;
}

export interface HandshakeAckPayload {
  readonly status: NodeStatus;
  readonly masterVersion: string;
  readonly serverTime: number;
  readonly sessionToken?: string;
}

// Relay Tunnel Payloads
export interface RelayTunnelOpenPayload {
  readonly tunnelId: string;
  readonly path: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'WS';
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

export interface RelayTunnelDataPayload {
  readonly tunnelId: string;
  readonly chunk: string; // Base64 chunk for binary or utf8
  readonly isFinal?: boolean;
}

export interface RelayTunnelClosePayload {
  readonly tunnelId: string;
  readonly statusCode?: number;
  readonly error?: string;
}

// Pure Enrollment State Machine
export type EnrollmentState =
  'unregistered' | 'pending' | 'online' | 'offline' | 'rejected' | 'revoked';

export type EnrollmentEvent =
  | { readonly type: 'SUBMIT_HANDSHAKE'; readonly agentId: string }
  | { readonly type: 'ADMIN_APPROVE'; readonly userId: string }
  | { readonly type: 'ADMIN_REJECT'; readonly userId: string; readonly reason?: string }
  | { readonly type: 'ADMIN_REVOKE'; readonly userId: string; readonly reason?: string }
  | { readonly type: 'AGENT_CONNECTED' }
  | { readonly type: 'AGENT_DISCONNECTED' }
  | { readonly type: 'AGENT_RECONNECT' };

export const transitionEnrollmentState = (
  currentState: EnrollmentState,
  event: EnrollmentEvent,
): Result<EnrollmentState> => {
  switch (currentState) {
    case 'unregistered': {
      if (event.type === 'SUBMIT_HANDSHAKE') {
        return ok('pending');
      }
      return err(
        createAppError('VALIDATION_ERROR', `Invalid transition from unregistered on ${event.type}`),
      );
    }

    case 'pending': {
      if (event.type === 'ADMIN_APPROVE') {
        return ok('online');
      }
      if (event.type === 'ADMIN_REJECT') {
        return ok('rejected');
      }
      if (event.type === 'AGENT_DISCONNECTED') {
        return ok('pending');
      }
      return err(
        createAppError('VALIDATION_ERROR', `Invalid transition from pending on ${event.type}`),
      );
    }

    case 'online': {
      if (event.type === 'AGENT_DISCONNECTED') {
        return ok('offline');
      }
      if (event.type === 'ADMIN_REVOKE') {
        return ok('revoked');
      }
      return ok('online');
    }

    case 'offline': {
      if (event.type === 'AGENT_CONNECTED' || event.type === 'AGENT_RECONNECT') {
        return ok('online');
      }
      if (event.type === 'ADMIN_REVOKE') {
        return ok('revoked');
      }
      return ok('offline');
    }

    case 'rejected': {
      if (event.type === 'ADMIN_APPROVE') {
        return ok('online');
      }
      return err(createAppError('FORBIDDEN', 'Node registration is rejected'));
    }

    case 'revoked': {
      return err(createAppError('FORBIDDEN', 'Node registration has been permanently revoked'));
    }

    default: {
      const _exhaustiveCheck: never = currentState;
      return err(createAppError('VALIDATION_ERROR', `Unknown state ${_exhaustiveCheck}`));
    }
  }
};
