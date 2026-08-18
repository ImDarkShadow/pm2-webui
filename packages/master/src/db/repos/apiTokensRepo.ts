import { Database as SQLiteDatabase } from 'better-sqlite3';
import {
  ApiTokenInfo,
  PermissionAction,
  Result,
  ok,
  err,
  createAppError,
} from '@pm2-cluster/shared';

export interface ApiTokensRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface ApiTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
  readonly permissionsJson: string;
  readonly expiresAt?: number;
  readonly lastUsedAt?: number;
  readonly createdAt: number;
}

export interface CreateApiTokenData {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
  readonly permissions: readonly PermissionAction[];
  readonly expiresAt?: number;
}

export interface ApiTokensRepo {
  readonly create: (data: CreateApiTokenData) => Result<ApiTokenInfo>;
  readonly findByHash: (tokenHash: string) => Result<ApiTokenRow | null>;
  readonly findById: (id: string) => Result<ApiTokenInfo | null>;
  readonly listByUser: (userId: string) => Result<readonly ApiTokenInfo[]>;
  readonly updateLastUsed: (id: string) => Result<void>;
  readonly deleteToken: (id: string, userId?: string) => Result<void>;
}

export const createApiTokensRepo = (deps: ApiTokensRepoDeps): ApiTokensRepo => {
  const { db } = deps;

  const insertStmt = db.prepare(`
    INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, permissions_json, expires_at, last_used_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `);

  const findByHashStmt = db.prepare(`
    SELECT id, user_id as userId, name, token_hash as tokenHash, token_prefix as tokenPrefix,
           permissions_json as permissionsJson, expires_at as expiresAt, last_used_at as lastUsedAt,
           created_at as createdAt
    FROM api_tokens
    WHERE token_hash = ?
  `);

  const findByIdStmt = db.prepare(`
    SELECT id, user_id as userId, name, token_hash as tokenHash, token_prefix as tokenPrefix,
           permissions_json as permissionsJson, expires_at as expiresAt, last_used_at as lastUsedAt,
           created_at as createdAt
    FROM api_tokens
    WHERE id = ?
  `);

  const listByUserStmt = db.prepare(`
    SELECT id, user_id as userId, name, token_prefix as tokenPrefix,
           permissions_json as permissionsJson, expires_at as expiresAt, last_used_at as lastUsedAt,
           created_at as createdAt
    FROM api_tokens
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);

  const updateLastUsedStmt = db.prepare(`
    UPDATE api_tokens SET last_used_at = ? WHERE id = ?
  `);

  const deleteByIdStmt = db.prepare(`
    DELETE FROM api_tokens WHERE id = ?
  `);

  const deleteByIdAndUserStmt = db.prepare(`
    DELETE FROM api_tokens WHERE id = ? AND user_id = ?
  `);

  const mapRowToInfo = (row: any): ApiTokenInfo | null => {
    if (!row) return null;
    let permissions: PermissionAction[] = [];
    try {
      permissions = JSON.parse(row.permissionsJson || '[]');
    } catch {}

    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      permissions,
      expiresAt: row.expiresAt ?? undefined,
      lastUsedAt: row.lastUsedAt ?? undefined,
      createdAt: row.createdAt,
    };
  };

  const create = (data: CreateApiTokenData): Result<ApiTokenInfo> => {
    try {
      const now = Date.now();
      const permissionsJson = JSON.stringify(data.permissions);

      insertStmt.run(
        data.id,
        data.userId,
        data.name,
        data.tokenHash,
        data.tokenPrefix,
        permissionsJson,
        data.expiresAt ?? null,
        now,
      );

      return ok({
        id: data.id,
        userId: data.userId,
        name: data.name,
        tokenPrefix: data.tokenPrefix,
        permissions: data.permissions,
        expiresAt: data.expiresAt,
        createdAt: now,
      });
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to create API token', undefined, error));
    }
  };

  const findByHash = (tokenHash: string): Result<ApiTokenRow | null> => {
    try {
      const row = findByHashStmt.get(tokenHash) as ApiTokenRow | undefined;
      return ok(row ?? null);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to query API token by hash', undefined, error),
      );
    }
  };

  const findById = (id: string): Result<ApiTokenInfo | null> => {
    try {
      const row = findByIdStmt.get(id);
      return ok(mapRowToInfo(row));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to query API token by id', undefined, error),
      );
    }
  };

  const listByUser = (userId: string): Result<readonly ApiTokenInfo[]> => {
    try {
      const rows = listByUserStmt.all(userId);
      return ok(rows.map(mapRowToInfo).filter((t): t is ApiTokenInfo => t !== null));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to list user API tokens', undefined, error),
      );
    }
  };

  const updateLastUsed = (id: string): Result<void> => {
    try {
      updateLastUsedStmt.run(Date.now(), id);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError(
          'INTERNAL_ERROR',
          'Failed to update token last used timestamp',
          undefined,
          error,
        ),
      );
    }
  };

  const deleteToken = (id: string, userId?: string): Result<void> => {
    try {
      if (userId) {
        deleteByIdAndUserStmt.run(id, userId);
      } else {
        deleteByIdStmt.run(id);
      }
      return ok(undefined);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to delete API token', undefined, error));
    }
  };

  return {
    create,
    findByHash,
    findById,
    listByUser,
    updateLastUsed,
    deleteToken,
  };
};
