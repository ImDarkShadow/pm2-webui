import Database, { Database as SQLiteDatabase } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Result, ok, err, createAppError } from '@pm2-webui/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AgentDbDeps {
  readonly dbPath: string;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface AgentDatabase {
  readonly db: SQLiteDatabase;
  readonly close: () => void;
  readonly runMigrations: () => Result<number>;
}

export const AGENT_INIT_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics_hourly (
  timestamp INTEGER PRIMARY KEY,
  cpu_usage REAL NOT NULL,
  memory_used INTEGER NOT NULL,
  memory_free INTEGER NOT NULL,
  swap_used INTEGER NOT NULL,
  disk_used INTEGER NOT NULL,
  network_rx INTEGER NOT NULL,
  network_tx INTEGER NOT NULL,
  load_1m REAL NOT NULL,
  cluster_rps REAL DEFAULT 0,
  avg_latency_ms REAL DEFAULT 0,
  avg_event_loop_delay_ms REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS log_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_name TEXT NOT NULL,
  stream TEXT NOT NULL,
  start_timestamp INTEGER NOT NULL,
  end_timestamp INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL,
  compressed_file_path TEXT
);

CREATE TABLE IF NOT EXISTS log_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_name TEXT NOT NULL,
  granularity TEXT NOT NULL,
  bucket_timestamp INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  warn_count INTEGER NOT NULL,
  sample_text TEXT
);

CREATE TABLE IF NOT EXISTS crash_events (
  id TEXT PRIMARY KEY,
  process_name TEXT NOT NULL,
  pm_id INTEGER NOT NULL,
  exit_code INTEGER,
  signal TEXT,
  crashed_at INTEGER NOT NULL,
  logs_before_json TEXT NOT NULL,
  logs_after_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_log_summaries_lookup 
  ON log_summaries(process_name, granularity, bucket_timestamp);

CREATE INDEX IF NOT EXISTS idx_metrics_hourly_ts 
  ON metrics_hourly(timestamp);

CREATE INDEX IF NOT EXISTS idx_log_segments_lookup 
  ON log_segments(process_name, start_timestamp, end_timestamp);
`;

export const createAgentDatabase = (deps: AgentDbDeps): AgentDatabase => {
  const { dbPath, logger } = deps;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

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

      // Always apply baseline 001_agent_init
      const baselineRow = getMigrationStmt.get('001_agent_init.sql');
      if (!baselineRow) {
        db.transaction(() => {
          db.exec(AGENT_INIT_SQL);
          insertMigrationStmt.run('001_agent_init.sql', Date.now());
        })();
        appliedCount++;
      } else {
        // Ensure baseline tables exist
        db.exec(AGENT_INIT_SQL);
      }

      // Safe Auto-migration for existing metrics_hourly tables from earlier versions
      const columns = db.pragma('table_info(metrics_hourly)') as { name: string }[];
      if (Array.isArray(columns) && columns.length > 0) {
        const colNames = new Set(columns.map((c) => c.name));

        if (!colNames.has('cluster_rps')) {
          logger?.info?.('Migrating metrics_hourly: adding cluster_rps');
          db.exec('ALTER TABLE metrics_hourly ADD COLUMN cluster_rps REAL DEFAULT 0;');
        }
        if (!colNames.has('avg_latency_ms')) {
          logger?.info?.('Migrating metrics_hourly: adding avg_latency_ms');
          db.exec('ALTER TABLE metrics_hourly ADD COLUMN avg_latency_ms REAL DEFAULT 0;');
        }
        if (!colNames.has('avg_event_loop_delay_ms')) {
          logger?.info?.('Migrating metrics_hourly: adding avg_event_loop_delay_ms');
          db.exec('ALTER TABLE metrics_hourly ADD COLUMN avg_event_loop_delay_ms REAL DEFAULT 0;');
        }
      }

      // Check for additional filesystem migrations if directory exists
      const migrationsDir = path.join(__dirname, 'migrations');
      if (fs.existsSync(migrationsDir)) {
        const files = fs
          .readdirSync(migrationsDir)
          .filter((file) => file.endsWith('.sql') && file !== '001_agent_init.sql')
          .sort();

        for (const file of files) {
          const row = getMigrationStmt.get(file);
          if (!row) {
            logger?.info?.(`Applying agent migration: ${file}`);
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            db.transaction(() => {
              db.exec(sql);
              insertMigrationStmt.run(file, Date.now());
            })();
            appliedCount++;
          }
        }
      }

      return ok(appliedCount);
    } catch (error) {
      logger?.error?.('Agent migration failed', error);
      return err(
        createAppError(
          'INTERNAL_ERROR',
          'Failed to run agent database migrations',
          undefined,
          error,
        ),
      );
    }
  };

  // Run migrations immediately on database connection initialization
  runMigrations();

  const close = (): void => {
    try {
      db.close();
    } catch (error) {
      logger?.error?.('Failed to close agent database', error);
    }
  };

  return {
    db,
    close,
    runMigrations,
  };
};

export * from './repos/agentMetaRepo.js';
export * from './repos/agentMetricsRepo.js';
export * from './repos/agentLogsRepo.js';
export * from './repos/agentCrashRepo.js';
export * from './cleanup.js';
