import { Database as SQLiteDatabase } from 'better-sqlite3';
import { Result, ok, err, createAppError } from '@pm2-cluster/shared';

export interface AgentMetricsRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface StoredMetricRecord {
  readonly timestamp: number;
  readonly cpuUsage: number;
  readonly memoryUsed: number;
  readonly memoryFree: number;
  readonly swapUsed: number;
  readonly diskUsed: number;
  readonly networkRx: number;
  readonly networkTx: number;
  readonly load1m: number;
  readonly clusterRps?: number;
  readonly avgLatencyMs?: number;
  readonly avgEventLoopDelayMs?: number;
}

export interface AgentMetricsRepo {
  readonly insert: (metric: StoredMetricRecord) => Result<void>;
  readonly queryRange: (from: number, to: number) => Result<readonly StoredMetricRecord[]>;
  readonly purgeOlderThan: (timestamp: number) => Result<number>;
}

export const createAgentMetricsRepo = (deps: AgentMetricsRepoDeps): AgentMetricsRepo => {
  const { db } = deps;

  const insertStmt = db.prepare(`
    INSERT INTO metrics_hourly (timestamp, cpu_usage, memory_used, memory_free, swap_used, disk_used, network_rx, network_tx, load_1m, cluster_rps, avg_latency_ms, avg_event_loop_delay_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(timestamp) DO UPDATE SET
      cpu_usage = excluded.cpu_usage,
      memory_used = excluded.memory_used,
      memory_free = excluded.memory_free,
      swap_used = excluded.swap_used,
      disk_used = excluded.disk_used,
      network_rx = excluded.network_rx,
      network_tx = excluded.network_tx,
      load_1m = excluded.load_1m,
      cluster_rps = excluded.cluster_rps,
      avg_latency_ms = excluded.avg_latency_ms,
      avg_event_loop_delay_ms = excluded.avg_event_loop_delay_ms
  `);

  const queryRangeStmt = db.prepare(`
    SELECT timestamp, cpu_usage as cpuUsage, memory_used as memoryUsed, memory_free as memoryFree,
           swap_used as swapUsed, disk_used as diskUsed, network_rx as networkRx, network_tx as networkTx,
           load_1m as load1m, cluster_rps as clusterRps, avg_latency_ms as avgLatencyMs,
           avg_event_loop_delay_ms as avgEventLoopDelayMs
    FROM metrics_hourly
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `);

  const purgeStmt = db.prepare('DELETE FROM metrics_hourly WHERE timestamp < ?');

  const insert = (metric: StoredMetricRecord): Result<void> => {
    try {
      insertStmt.run(
        metric.timestamp,
        metric.cpuUsage,
        metric.memoryUsed,
        metric.memoryFree,
        metric.swapUsed,
        metric.diskUsed,
        metric.networkRx,
        metric.networkTx,
        metric.load1m,
        metric.clusterRps || 0,
        metric.avgLatencyMs || 0,
        metric.avgEventLoopDelayMs || 0,
      );
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to insert metric record', undefined, error),
      );
    }
  };

  const queryRange = (from: number, to: number): Result<readonly StoredMetricRecord[]> => {
    try {
      const rows = queryRangeStmt.all(from, to) as StoredMetricRecord[];
      return ok(rows);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to query metric records', undefined, error),
      );
    }
  };

  const purgeOlderThan = (timestamp: number): Result<number> => {
    try {
      const info = purgeStmt.run(timestamp);
      return ok(info.changes);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to purge metric records', undefined, error),
      );
    }
  };

  return {
    insert,
    queryRange,
    purgeOlderThan,
  };
};
