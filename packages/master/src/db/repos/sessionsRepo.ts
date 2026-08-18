import { Database as SQLiteDatabase } from 'better-sqlite3';
import { Session, SessionInfo, Result, ok, err, createAppError } from '@pm2-cluster/shared';

export interface SessionsRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface SessionsRepo {
  readonly create: (session: Session) => Result<Session>;
  readonly findById: (id: string) => Result<Session | null>;
  readonly findByRefreshTokenHash: (hash: string) => Result<Session | null>;
  readonly listByUser: (userId: string) => Result<readonly SessionInfo[]>;
  readonly touchActivity: (id: string) => Result<void>;
  readonly revoke: (id: string) => Result<void>;
  readonly revokeFamily: (familyId: string) => Result<void>;
  readonly revokeAllForUserExcept: (userId: string, exceptSessionId?: string) => Result<void>;
  readonly cleanExpired: () => Result<number>;
}

export const createSessionsRepo = (deps: SessionsRepoDeps): SessionsRepo => {
  const { db } = deps;

  const insertStmt = db.prepare(`
    INSERT INTO sessions (
      id, user_id, family_id, refresh_token_hash,
      ip_address, user_agent, created_at, last_active_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findByIdStmt = db.prepare(`
    SELECT id, user_id as userId, family_id as familyId, refresh_token_hash as refreshTokenHash,
           ip_address as ipAddress, user_agent as userAgent, created_at as createdAt,
           last_active_at as lastActiveAt, expires_at as expiresAt, revoked_at as revokedAt
    FROM sessions
    WHERE id = ?
  `);

  const findByHashStmt = db.prepare(`
    SELECT id, user_id as userId, family_id as familyId, refresh_token_hash as refreshTokenHash,
           ip_address as ipAddress, user_agent as userAgent, created_at as createdAt,
           last_active_at as lastActiveAt, expires_at as expiresAt, revoked_at as revokedAt
    FROM sessions
    WHERE refresh_token_hash = ?
  `);

  const listByUserStmt = db.prepare(`
    SELECT id, user_id as userId, ip_address as ipAddress, user_agent as userAgent,
           created_at as createdAt, last_active_at as lastActiveAt, expires_at as expiresAt
    FROM sessions
    WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
    ORDER BY last_active_at DESC
  `);

  const touchActivityStmt = db.prepare(`
    UPDATE sessions SET last_active_at = ? WHERE id = ?
  `);

  const revokeStmt = db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?');
  const revokeFamilyStmt = db.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL',
  );
  const revokeAllExceptStmt = db.prepare(`
    UPDATE sessions SET revoked_at = ?
    WHERE user_id = ? AND id != COALESCE(?, '') AND revoked_at IS NULL
  `);

  const cleanExpiredStmt = db.prepare(
    'DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL',
  );

  const mapRow = (row: any): Session | null => {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      familyId: row.familyId || 'legacy',
      refreshTokenHash: row.refreshTokenHash,
      ipAddress: row.ipAddress ?? undefined,
      userAgent: row.userAgent ?? undefined,
      createdAt: row.createdAt || Date.now(),
      lastActiveAt: row.lastActiveAt || Date.now(),
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ? Number(row.revokedAt) : undefined,
    };
  };

  const create = (session: Session): Result<Session> => {
    try {
      insertStmt.run(
        session.id,
        session.userId,
        session.familyId || 'legacy',
        session.refreshTokenHash,
        session.ipAddress ?? null,
        session.userAgent ?? null,
        session.createdAt || Date.now(),
        session.lastActiveAt || Date.now(),
        session.expiresAt,
        session.revokedAt ?? null,
      );
      return ok(session);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to create session', undefined, error));
    }
  };

  const findById = (id: string): Result<Session | null> => {
    try {
      const row = findByIdStmt.get(id);
      return ok(mapRow(row));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to find session by id', undefined, error),
      );
    }
  };

  const findByRefreshTokenHash = (hash: string): Result<Session | null> => {
    try {
      const row = findByHashStmt.get(hash);
      return ok(mapRow(row));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to find session by hash', undefined, error),
      );
    }
  };

  const listByUser = (userId: string): Result<readonly SessionInfo[]> => {
    try {
      const rows = listByUserStmt.all(userId, Date.now()) as any[];
      return ok(
        rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          ipAddress: r.ipAddress ?? undefined,
          userAgent: r.userAgent ?? undefined,
          createdAt: r.createdAt || Date.now(),
          lastActiveAt: r.lastActiveAt || Date.now(),
          expiresAt: r.expiresAt,
        })),
      );
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to list user sessions', undefined, error),
      );
    }
  };

  const touchActivity = (id: string): Result<void> => {
    try {
      touchActivityStmt.run(Date.now(), id);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to touch session activity', undefined, error),
      );
    }
  };

  const revoke = (id: string): Result<void> => {
    try {
      revokeStmt.run(Date.now(), id);
      return ok(undefined);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to revoke session', undefined, error));
    }
  };

  const revokeFamily = (familyId: string): Result<void> => {
    try {
      revokeFamilyStmt.run(Date.now(), familyId);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to revoke session family', undefined, error),
      );
    }
  };

  const revokeAllForUserExcept = (userId: string, exceptSessionId?: string): Result<void> => {
    try {
      revokeAllExceptStmt.run(Date.now(), userId, exceptSessionId ?? null);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to revoke other user sessions', undefined, error),
      );
    }
  };

  const cleanExpired = (): Result<number> => {
    try {
      const info = cleanExpiredStmt.run(Date.now());
      return ok(info.changes);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to clean expired sessions', undefined, error),
      );
    }
  };

  return {
    create,
    findById,
    findByRefreshTokenHash,
    listByUser,
    touchActivity,
    revoke,
    revokeFamily,
    revokeAllForUserExcept,
    cleanExpired,
  };
};
