import { Database as SQLiteDatabase } from 'better-sqlite3';
import crypto from 'node:crypto';
import { Result, ok, err, createAppError } from '@pm2-webui/shared';

export interface RecoveryCodesRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface RecoveryCodeRow {
  readonly id: string;
  readonly userId: string;
  readonly codeHash: string;
  readonly usedAt?: number;
  readonly createdAt: number;
}

export interface RecoveryCodesRepo {
  readonly createBatch: (userId: string, codeHashes: readonly string[]) => Result<void>;
  readonly consumeCode: (userId: string, codeHash: string) => Result<boolean>;
  readonly countUnused: (userId: string) => Result<number>;
  readonly deleteAllForUser: (userId: string) => Result<void>;
}

export const createRecoveryCodesRepo = (deps: RecoveryCodesRepoDeps): RecoveryCodesRepo => {
  const { db } = deps;

  const insertStmt = db.prepare(`
    INSERT INTO two_factor_recovery_codes (id, user_id, code_hash, used_at, created_at)
    VALUES (?, ?, ?, NULL, ?)
  `);

  const findUnusedStmt = db.prepare(`
    SELECT id, user_id as userId, code_hash as codeHash, used_at as usedAt, created_at as createdAt
    FROM two_factor_recovery_codes
    WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
  `);

  const markUsedStmt = db.prepare(`
    UPDATE two_factor_recovery_codes SET used_at = ? WHERE id = ?
  `);

  const countUnusedStmt = db.prepare(`
    SELECT COUNT(*) as count FROM two_factor_recovery_codes
    WHERE user_id = ? AND used_at IS NULL
  `);

  const deleteForUserStmt = db.prepare(`
    DELETE FROM two_factor_recovery_codes WHERE user_id = ?
  `);

  const createBatch = (userId: string, codeHashes: readonly string[]): Result<void> => {
    try {
      const now = Date.now();
      const insertMany = db.transaction((hashes: readonly string[]) => {
        // Clear existing codes first
        deleteForUserStmt.run(userId);
        for (const hash of hashes) {
          insertStmt.run(crypto.randomUUID(), userId, hash, now);
        }
      });

      insertMany(codeHashes);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to store recovery codes', undefined, error),
      );
    }
  };

  const consumeCode = (userId: string, codeHash: string): Result<boolean> => {
    try {
      const row = findUnusedStmt.get(userId, codeHash) as RecoveryCodeRow | undefined;
      if (!row) {
        return ok(false);
      }

      markUsedStmt.run(Date.now(), row.id);
      return ok(true);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to verify recovery code', undefined, error),
      );
    }
  };

  const countUnused = (userId: string): Result<number> => {
    try {
      const row = countUnusedStmt.get(userId) as { count: number } | undefined;
      return ok(row?.count ?? 0);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to count recovery codes', undefined, error),
      );
    }
  };

  const deleteAllForUser = (userId: string): Result<void> => {
    try {
      deleteForUserStmt.run(userId);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to delete recovery codes', undefined, error),
      );
    }
  };

  return {
    createBatch,
    consumeCode,
    countUnused,
    deleteAllForUser,
  };
};
