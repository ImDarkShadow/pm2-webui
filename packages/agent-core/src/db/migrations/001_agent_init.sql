-- Initial Agent Database Schema Migration

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
  load_1m REAL NOT NULL
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

-- Indices for rapid querying
CREATE INDEX IF NOT EXISTS idx_log_summaries_lookup 
  ON log_summaries(process_name, granularity, bucket_timestamp);

CREATE INDEX IF NOT EXISTS idx_metrics_hourly_ts 
  ON metrics_hourly(timestamp);

CREATE INDEX IF NOT EXISTS idx_log_segments_lookup 
  ON log_segments(process_name, start_timestamp, end_timestamp);
