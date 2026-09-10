-- Observability & Error Traces Migration

CREATE TABLE IF NOT EXISTS error_traces (
  id TEXT PRIMARY KEY,
  process_name TEXT NOT NULL,
  pm_id INTEGER NOT NULL,
  error_name TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unresolved',
  context_logs_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_error_traces_proc 
  ON error_traces(process_name, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_error_traces_status 
  ON error_traces(status, last_seen_at);

CREATE TABLE IF NOT EXISTS process_metrics_hourly (
  process_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  pm_id INTEGER NOT NULL,
  cpu REAL NOT NULL,
  memory_bytes INTEGER NOT NULL,
  heap_used_mb REAL DEFAULT 0,
  heap_total_mb REAL DEFAULT 0,
  event_loop_delay_ms REAL DEFAULT 0,
  rps REAL DEFAULT 0,
  latency_ms REAL DEFAULT 0,
  restarts INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'online',
  PRIMARY KEY (process_name, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_proc_metrics_ts 
  ON process_metrics_hourly(process_name, timestamp);
