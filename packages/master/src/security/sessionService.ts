import crypto from 'node:crypto';
import { SessionsRepo } from '../db/repos/sessionsRepo.js';
import { Session, SessionInfo, Result, ok, err, createAppError } from '@pm2-webui/shared';

export interface SessionServiceDeps {
  readonly sessionsRepo: SessionsRepo;
  readonly jwtSecret: string;
  readonly sessionTtlMs?: number; // default 30 days
}

export interface RotatedTokens {
  readonly sessionId: string;
  readonly userId: string;
  readonly fullRefreshToken: string;
}

export interface SessionService {
  readonly createSession: (
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ) => Result<{ sessionId: string; fullRefreshToken: string }>;
  readonly rotateRefreshToken: (
    fullRefreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ) => Result<RotatedTokens>;
  readonly listUserSessions: (
    userId: string,
    currentSessionId?: string,
  ) => Result<readonly SessionInfo[]>;
  readonly revokeSession: (sessionId: string) => Result<void>;
  readonly revokeAllOtherSessions: (userId: string, currentSessionId?: string) => Result<void>;
  readonly cleanExpiredSessions: () => Result<number>;
}

export const createSessionService = (deps: SessionServiceDeps): SessionService => {
  const {
    sessionsRepo,
    jwtSecret,
    sessionTtlMs = 30 * 24 * 60 * 60 * 1000, // 30 days
  } = deps;

  const hashToken = (token: string): string => {
    return crypto.createHmac('sha256', jwtSecret).update(token).digest('hex');
  };

  const createSession = (
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Result<{ sessionId: string; fullRefreshToken: string }> => {
    const sessionId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const rawToken = crypto.randomBytes(40).toString('hex');
    const refreshTokenHash = hashToken(rawToken);
    const now = Date.now();
    const expiresAt = now + sessionTtlMs;

    const session: Session = {
      id: sessionId,
      userId,
      familyId,
      refreshTokenHash,
      ipAddress,
      userAgent,
      createdAt: now,
      lastActiveAt: now,
      expiresAt,
    };

    const createRes = sessionsRepo.create(session);
    if (!createRes.ok) {
      return createRes;
    }

    return ok({
      sessionId,
      fullRefreshToken: `${sessionId}:${rawToken}`,
    });
  };

  const rotateRefreshToken = (
    fullRefreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Result<RotatedTokens> => {
    const parts = fullRefreshToken.split(':');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return err(createAppError('UNAUTHORIZED', 'Invalid refresh token format'));
    }

    const [sessionId, rawToken] = parts;
    const sessionRes = sessionsRepo.findById(sessionId);
    if (!sessionRes.ok || !sessionRes.value) {
      return err(createAppError('UNAUTHORIZED', 'Session not found'));
    }

    const session = sessionRes.value;

    // 1. REPLAY ATTACK DETECTION: If session is already revoked or expired, revoke the whole family!
    if (session.revokedAt || session.expiresAt < Date.now()) {
      if (session.familyId) {
        sessionsRepo.revokeFamily(session.familyId);
      }
      return err(
        createAppError(
          'UNAUTHORIZED',
          'Security Alert: Revoked or expired refresh token reused. All sessions in this family have been terminated.',
        ),
      );
    }

    // 2. Validate token hash
    const expectedHash = hashToken(rawToken);
    if (session.refreshTokenHash !== expectedHash) {
      // Possible token theft / forgery -> revoke family
      if (session.familyId) {
        sessionsRepo.revokeFamily(session.familyId);
      }
      return err(createAppError('UNAUTHORIZED', 'Invalid refresh token. Session family revoked.'));
    }

    // 3. Revoke current session (it was used)
    sessionsRepo.revoke(session.id);

    // 4. Issue a new session within the SAME family (Family Rotation)
    const newSessionId = crypto.randomUUID();
    const newRawToken = crypto.randomBytes(40).toString('hex');
    const newHash = hashToken(newRawToken);
    const now = Date.now();

    const newSession: Session = {
      id: newSessionId,
      userId: session.userId,
      familyId: session.familyId,
      refreshTokenHash: newHash,
      ipAddress: ipAddress || session.ipAddress,
      userAgent: userAgent || session.userAgent,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + sessionTtlMs,
    };

    const newSessionRes = sessionsRepo.create(newSession);
    if (!newSessionRes.ok) {
      return newSessionRes;
    }

    return ok({
      sessionId: newSessionId,
      userId: session.userId,
      fullRefreshToken: `${newSessionId}:${newRawToken}`,
    });
  };

  const listUserSessions = (
    userId: string,
    currentSessionId?: string,
  ): Result<readonly SessionInfo[]> => {
    const listRes = sessionsRepo.listByUser(userId);
    if (!listRes.ok) return listRes;

    const mapped = listRes.value.map((s) => ({
      ...s,
      isCurrent: currentSessionId ? s.id === currentSessionId : false,
    }));

    return ok(mapped);
  };

  const revokeSession = (sessionId: string): Result<void> => {
    return sessionsRepo.revoke(sessionId);
  };

  const revokeAllOtherSessions = (userId: string, currentSessionId?: string): Result<void> => {
    return sessionsRepo.revokeAllForUserExcept(userId, currentSessionId);
  };

  const cleanExpiredSessions = (): Result<number> => {
    return sessionsRepo.cleanExpired();
  };

  return {
    createSession,
    rotateRefreshToken,
    listUserSessions,
    revokeSession,
    revokeAllOtherSessions,
    cleanExpiredSessions,
  };
};
