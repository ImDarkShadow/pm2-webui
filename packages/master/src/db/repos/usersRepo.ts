import { Database as SQLiteDatabase } from 'better-sqlite3';
import { User, Result, ok, err, createAppError } from '@pm2-webui/shared';

export interface UsersRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface CreateUserData {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly roleId: string;
  readonly twoFactorEnabled?: boolean;
  readonly twoFactorSecretEnc?: string;
}

export interface UserWithPasswordHash extends User {
  readonly passwordHash: string;
  readonly twoFactorSecretEnc?: string;
  readonly failedAttempts: number;
  readonly lockedUntil?: number;
}

export interface UsersRepo {
  readonly findById: (id: string) => Result<UserWithPasswordHash | null>;
  readonly findByUsername: (username: string) => Result<UserWithPasswordHash | null>;
  readonly findByEmail: (email: string) => Result<UserWithPasswordHash | null>;
  readonly create: (data: CreateUserData) => Result<User>;
  readonly list: () => Result<readonly User[]>;
  readonly count: () => Result<number>;
  readonly set2FA: (userId: string, enabled: boolean, secretEnc?: string) => Result<void>;
  readonly recordFailedAttempt: (userId: string, lockUntil?: number) => Result<void>;
  readonly resetFailedAttempts: (userId: string) => Result<void>;
  readonly getPreferences: (userId: string) => Result<Record<string, any>>;
  readonly updatePreferences: (
    userId: string,
    preferences: Record<string, any>,
  ) => Result<Record<string, any>>;
}

export const createUsersRepo = (deps: UsersRepoDeps): UsersRepo => {
  const { db } = deps;

  const findByIdStmt = db.prepare(`
    SELECT u.id, u.username, u.email, u.password_hash as passwordHash, u.role_id as roleId,
           r.name as roleName, u.two_factor_enabled as twoFactorEnabled,
           u.two_factor_secret_enc as twoFactorSecretEnc,
           u.failed_attempts as failedAttempts, u.locked_until as lockedUntil,
           u.created_at as createdAt, u.updated_at as updatedAt
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.id = ?
  `);

  const findByUsernameStmt = db.prepare(`
    SELECT u.id, u.username, u.email, u.password_hash as passwordHash, u.role_id as roleId,
           r.name as roleName, u.two_factor_enabled as twoFactorEnabled,
           u.two_factor_secret_enc as twoFactorSecretEnc,
           u.failed_attempts as failedAttempts, u.locked_until as lockedUntil,
           u.created_at as createdAt, u.updated_at as updatedAt
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.username = ?
  `);

  const findByEmailStmt = db.prepare(`
    SELECT u.id, u.username, u.email, u.password_hash as passwordHash, u.role_id as roleId,
           r.name as roleName, u.two_factor_enabled as twoFactorEnabled,
           u.two_factor_secret_enc as twoFactorSecretEnc,
           u.failed_attempts as failedAttempts, u.locked_until as lockedUntil,
           u.created_at as createdAt, u.updated_at as updatedAt
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.email = ?
  `);

  const insertUserStmt = db.prepare(`
    INSERT INTO users (
      id, username, email, password_hash, role_id,
      two_factor_enabled, two_factor_secret_enc, failed_attempts, locked_until,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
  `);

  const listUsersStmt = db.prepare(`
    SELECT u.id, u.username, u.email, u.role_id as roleId,
           r.name as roleName, u.two_factor_enabled as twoFactorEnabled,
           u.created_at as createdAt, u.updated_at as updatedAt
    FROM users u
    JOIN roles r ON u.role_id = r.id
    ORDER BY u.created_at ASC
  `);

  const countUsersStmt = db.prepare('SELECT COUNT(*) as count FROM users');

  const set2FAStmt = db.prepare(`
    UPDATE users SET
      two_factor_enabled = ?,
      two_factor_secret_enc = ?,
      updated_at = ?
    WHERE id = ?
  `);

  const recordFailedAttemptStmt = db.prepare(`
    UPDATE users SET
      failed_attempts = failed_attempts + 1,
      locked_until = COALESCE(?, locked_until),
      updated_at = ?
    WHERE id = ?
  `);

  const resetFailedAttemptsStmt = db.prepare(`
    UPDATE users SET
      failed_attempts = 0,
      locked_until = NULL,
      updated_at = ?
    WHERE id = ?
  `);

  const mapRow = (row: any): UserWithPasswordHash | null => {
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.passwordHash,
      roleId: row.roleId,
      roleName: row.roleName,
      twoFactorEnabled: Boolean(row.twoFactorEnabled),
      twoFactorSecretEnc: row.twoFactorSecretEnc ?? undefined,
      failedAttempts: Number(row.failedAttempts || 0),
      lockedUntil: row.lockedUntil ? Number(row.lockedUntil) : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  };

  const mapToUser = (row: any): User | null => {
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      roleId: row.roleId,
      roleName: row.roleName,
      twoFactorEnabled: Boolean(row.twoFactorEnabled),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  };

  const findById = (id: string): Result<UserWithPasswordHash | null> => {
    try {
      const row = findByIdStmt.get(id);
      return ok(mapRow(row));
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to query user by id', undefined, error));
    }
  };

  const findByUsername = (username: string): Result<UserWithPasswordHash | null> => {
    try {
      const row = findByUsernameStmt.get(username);
      return ok(mapRow(row));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to query user by username', undefined, error),
      );
    }
  };

  const findByEmail = (email: string): Result<UserWithPasswordHash | null> => {
    try {
      const row = findByEmailStmt.get(email);
      return ok(mapRow(row));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to query user by email', undefined, error),
      );
    }
  };

  const create = (data: CreateUserData): Result<User> => {
    try {
      const now = Date.now();
      insertUserStmt.run(
        data.id,
        data.username,
        data.email,
        data.passwordHash,
        data.roleId,
        data.twoFactorEnabled ? 1 : 0,
        data.twoFactorSecretEnc || null,
        now,
        now,
      );

      const userRes = findById(data.id);
      if (!userRes.ok || !userRes.value) {
        return err(createAppError('INTERNAL_ERROR', 'User created but failed to load'));
      }

      const {
        passwordHash: _,
        twoFactorSecretEnc: __,
        failedAttempts: ___,
        lockedUntil: ____,
        ...user
      } = userRes.value;
      return ok(user);
    } catch (error) {
      return err(
        createAppError(
          'CONFLICT',
          'Failed to create user (possible duplicate username/email)',
          undefined,
          error,
        ),
      );
    }
  };

  const list = (): Result<readonly User[]> => {
    try {
      const rows = listUsersStmt.all();
      return ok(rows.map(mapToUser).filter((u): u is User => u !== null));
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to list users', undefined, error));
    }
  };

  const count = (): Result<number> => {
    try {
      const row = countUsersStmt.get() as { count: number };
      return ok(row.count);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to count users', undefined, error));
    }
  };

  const set2FA = (userId: string, enabled: boolean, secretEnc?: string): Result<void> => {
    try {
      set2FAStmt.run(enabled ? 1 : 0, secretEnc || null, Date.now(), userId);
      return ok(undefined);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to update 2FA status', undefined, error));
    }
  };

  const recordFailedAttempt = (userId: string, lockUntil?: number): Result<void> => {
    try {
      recordFailedAttemptStmt.run(lockUntil ?? null, Date.now(), userId);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to record failed login attempt', undefined, error),
      );
    }
  };

  const resetFailedAttempts = (userId: string): Result<void> => {
    try {
      resetFailedAttemptsStmt.run(Date.now(), userId);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to reset failed login attempts', undefined, error),
      );
    }
  };

  const getPreferencesStmt = db.prepare(
    'SELECT preferences_json as preferencesJson FROM users WHERE id = ?',
  );
  const updatePreferencesStmt = db.prepare(
    'UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?',
  );

  const getPreferences = (userId: string): Result<Record<string, any>> => {
    try {
      const row = getPreferencesStmt.get(userId) as { preferencesJson: string | null } | undefined;
      if (!row || !row.preferencesJson) {
        return ok({});
      }
      return ok(JSON.parse(row.preferencesJson));
    } catch {
      return ok({});
    }
  };

  const updatePreferences = (
    userId: string,
    preferences: Record<string, any>,
  ): Result<Record<string, any>> => {
    try {
      const current = getPreferences(userId);
      const merged = current.ok ? { ...current.value, ...preferences } : preferences;
      const json = JSON.stringify(merged);
      updatePreferencesStmt.run(json, Date.now(), userId);
      return ok(merged);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to update user preferences', undefined, error),
      );
    }
  };

  return {
    findById,
    findByUsername,
    findByEmail,
    create,
    list,
    count,
    set2FA,
    recordFailedAttempt,
    resetFailedAttempts,
    getPreferences,
    updatePreferences,
  };
};
