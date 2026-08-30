import Database, { Database as SQLiteDatabase } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Result, ok, err, createAppError } from '@pm2-webui/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MasterDbDeps {
  readonly dbPath: string;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
    readonly debug?: (msg: string, ...args: unknown[]) => void;
  };
}

export interface MasterDatabase {
  readonly db: SQLiteDatabase;
  readonly close: () => void;
  readonly runMigrations: () => Result<number>;
}

export const MASTER_INIT_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource_scope TEXT NOT NULL DEFAULT 'global'
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id),
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  two_factor_secret_enc TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  preferences_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS two_factor_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_user ON two_factor_recovery_codes(user_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  hostname TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 4321,
  connectivity_mode TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'pending',
  version TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  enrolled_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS node_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS node_group_members (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES node_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, group_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT,
  node_id TEXT,
  process_name TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS global_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL DEFAULT 'legacy',
  refresh_token_hash TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  last_active_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id);

CREATE TABLE IF NOT EXISTS git_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  node_id TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  commit_hash TEXT,
  commit_message TEXT,
  commit_author TEXT,
  install_command TEXT,
  build_command TEXT,
  start_script TEXT NOT NULL DEFAULT 'index.js',
  exec_mode TEXT NOT NULL DEFAULT 'fork_mode',
  instances INTEGER NOT NULL DEFAULT 1,
  env_json TEXT,
  auto_deploy INTEGER NOT NULL DEFAULT 0,
  webhook_secret TEXT NOT NULL,
  deploy_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES git_apps(id) ON DELETE CASCADE,
  app_name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  commit_message TEXT,
  commit_author TEXT,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  triggered_by_username TEXT,
  logs TEXT,
  duration_ms INTEGER,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_deployments_app_ts ON deployments(app_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_recent ON deployments(started_at DESC);

-- Seed Default System Roles
INSERT OR IGNORE INTO roles (id, name, description, is_system) VALUES
  ('role-admin', 'admin', 'Full platform administrator with unrestricted cluster access', 1),
  ('role-operator', 'operator', 'Operator with permissions to restart, manage processes and inspect logs', 1),
  ('role-viewer', 'viewer', 'Read-only viewer with dashboard, node and process metrics visibility', 1);

-- Seed Default Global Settings
INSERT OR IGNORE INTO global_settings (key, value_json, updated_at) VALUES
  ('cluster_config', '{"logRetentionDays":7,"metricsRetentionDays":30,"logCompressionThresholdMb":10,"alertWebhooks":[]}', unixepoch() * 1000);
`;

export const createMasterDatabase = (deps: MasterDbDeps): MasterDatabase => {
  const { dbPath, logger } = deps;

  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  const runMigrations = (): Result<number> => {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          applied_at INTEGER NOT NULL
        );
      `);

      const getMigrationStmt = db.prepare('SELECT name FROM schema_migrations WHERE name = ?');
      const insertMigrationStmt = db.prepare(
        'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
      );

      let appliedCount = 0;

      // Baseline 001_master_init
      const baselineRow = getMigrationStmt.get('001_master_init.sql');
      if (!baselineRow) {
        db.transaction(() => {
          db.exec(MASTER_INIT_SQL);
          insertMigrationStmt.run('001_master_init.sql', Date.now());
        })();
        appliedCount++;
      } else {
        // First perform auto-migration column checks for existing tables BEFORE creating new indexes
        const tables = (
          db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
            name: string;
          }[]
        ).map((t) => t.name);
        const tableSet = new Set(tables);

        if (tableSet.has('users')) {
          const userCols = db.pragma('table_info(users)') as { name: string }[];
          const userColNames = new Set(userCols.map((c) => c.name));
          if (!userColNames.has('two_factor_enabled')) {
            db.exec('ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0;');
          }
          if (!userColNames.has('two_factor_secret_enc')) {
            db.exec('ALTER TABLE users ADD COLUMN two_factor_secret_enc TEXT;');
          }
          if (!userColNames.has('failed_attempts')) {
            db.exec('ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;');
          }
          if (!userColNames.has('locked_until')) {
            db.exec('ALTER TABLE users ADD COLUMN locked_until INTEGER;');
          }
          if (!userColNames.has('preferences_json')) {
            db.exec('ALTER TABLE users ADD COLUMN preferences_json TEXT;');
          }
        }

        if (tableSet.has('sessions')) {
          const sessionCols = db.pragma('table_info(sessions)') as { name: string }[];
          const sessionColNames = new Set(sessionCols.map((c) => c.name));
          if (!sessionColNames.has('family_id')) {
            db.exec("ALTER TABLE sessions ADD COLUMN family_id TEXT NOT NULL DEFAULT 'legacy';");
          }
          if (!sessionColNames.has('ip_address')) {
            db.exec('ALTER TABLE sessions ADD COLUMN ip_address TEXT;');
          }
          if (!sessionColNames.has('user_agent')) {
            db.exec('ALTER TABLE sessions ADD COLUMN user_agent TEXT;');
          }
          if (!sessionColNames.has('created_at')) {
            db.exec('ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;');
          }
          if (!sessionColNames.has('last_active_at')) {
            db.exec('ALTER TABLE sessions ADD COLUMN last_active_at INTEGER NOT NULL DEFAULT 0;');
          }
          if (!sessionColNames.has('revoked_at')) {
            db.exec('ALTER TABLE sessions ADD COLUMN revoked_at INTEGER;');
          }
        }

        // Now execute MASTER_INIT_SQL to create any missing tables, indexes, and initial seeds
        db.exec(MASTER_INIT_SQL);
      }

      return ok(appliedCount);
    } catch (error) {
      logger?.error?.('Migration failed', error);
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to run database migrations', undefined, error),
      );
    }
  };

  // Run migrations immediately upon database creation
  runMigrations();

  const close = (): void => {
    try {
      db.close();
    } catch (error) {
      logger?.error?.('Failed to close master database', error);
    }
  };

  return {
    db,
    close,
    runMigrations,
  };
};

export * from './repos/usersRepo.js';
export * from './repos/nodesRepo.js';
export * from './repos/auditRepo.js';
export * from './repos/settingsRepo.js';
export * from './repos/sessionsRepo.js';
export * from './repos/gitAppsRepo.js';
export * from './repos/deploymentsRepo.js';
export * from './repos/recoveryCodesRepo.js';
export * from './repos/apiTokensRepo.js';
