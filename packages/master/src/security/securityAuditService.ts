import { AuditRepo } from '../db/repos/auditRepo.js';

export interface SecurityAuditServiceDeps {
  readonly auditRepo: AuditRepo;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly warn?: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export type SecurityAuditEvent =
  | 'auth:login'
  | 'auth:login_failed'
  | 'auth:lockout'
  | 'auth:logout'
  | 'auth:refresh'
  | 'auth:2fa_setup'
  | 'auth:2fa_enabled'
  | 'auth:2fa_disabled'
  | 'auth:recovery_used'
  | 'auth:session_revoked'
  | 'auth:session_family_revoked'
  | 'token:created'
  | 'token:revoked'
  | 'token:used'
  | 'user:created'
  | 'user:password_changed'
  | 'user:password_change_failed'
  | 'security:alert';

export interface LogSecurityEventOptions {
  readonly event: SecurityAuditEvent;
  readonly userId?: string;
  readonly username?: string;
  readonly status?: 'success' | 'failure';
  readonly ipAddress: string;
  readonly details?: Record<string, unknown>;
  readonly nodeId?: string;
  readonly processName?: string;
}

export interface SecurityAuditService {
  readonly logEvent: (options: LogSecurityEventOptions) => void;
}

export const createSecurityAuditService = (
  deps: SecurityAuditServiceDeps,
): SecurityAuditService => {
  const { auditRepo, logger } = deps;

  const logEvent = (options: LogSecurityEventOptions): void => {
    const {
      event,
      userId = 'anonymous',
      username,
      status = 'success',
      ipAddress,
      details,
      nodeId,
      processName,
    } = options;

    const detailsJson = details ? JSON.stringify(details) : undefined;

    try {
      auditRepo.insert({
        timestamp: Date.now(),
        userId,
        username,
        nodeId,
        processName,
        action: event,
        status,
        ipAddress,
        detailsJson,
      });

      if (status === 'failure' || event.includes('lockout') || event.includes('alert')) {
        logger?.warn?.(`[SECURITY AUDIT] ${event} - user: ${username || userId}, ip: ${ipAddress}`);
      } else {
        logger?.info?.(`[SECURITY AUDIT] ${event} - user: ${username || userId}, ip: ${ipAddress}`);
      }
    } catch (err) {
      logger?.error?.('Failed to write security audit log', err);
    }
  };

  return {
    logEvent,
  };
};
