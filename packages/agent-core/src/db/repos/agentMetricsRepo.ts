import { Database as SQLiteDatabase } from 'better-sqlite3';
import { Result, ok, err, createAppError, ProcessMetricSample } from '@pm2-webui/shared';

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
  readonly queryRange: (
    from: number,
    to: number,
    bucketMs?: number,
  ) => Result<readonly StoredMetricRecord[]>;
  readonly insertProcessMetrics: (samples: readonly ProcessMetricSample[]) => Result<void>;
  readonly queryProcessMetricsRange: (
    processName: string,
    from: number,
    to: number,
    bucketMs?: number,
  ) => Result<readonly ProcessMetricSample[]>;
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

  const queryRangeRawStmt = db.prepare(`
    SELECT timestamp, cpu_usage as cpuUsage, memory_used as memoryUsed, memory_free as memoryFree,
           swap_used as swapUsed, disk_used as diskUsed, network_rx as networkRx, network_tx as networkTx,
           load_1m as load1m, cluster_rps as clusterRps, avg_latency_ms as avgLatencyMs,
           avg_event_loop_delay_ms as avgEventLoopDelayMs
    FROM metrics_hourly
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `);

  const insertProcStmt = db.prepare(`
    INSERT INTO process_metrics_hourly (
      process_name, timestamp, pm_id, cpu, memory_bytes, heap_used_mb, heap_total_mb,
      event_loop_delay_ms, rps, latency_ms, restarts, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(process_name, timestamp) DO UPDATE SET
      pm_id = excluded.pm_id,
      cpu = excluded.cpu,
      memory_bytes = excluded.memory_bytes,
      heap_used_mb = excluded.heap_used_mb,
      heap_total_mb = excluded.heap_total_mb,
      event_loop_delay_ms = excluded.event_loop_delay_ms,
      rps = excluded.rps,
      latency_ms = excluded.latency_ms,
      restarts = excluded.restarts,
      status = excluded.status
  `);

  const queryProcRawStmt = db.prepare(`
    SELECT process_name as processName, timestamp, pm_id as pmId, cpu,
           memory_bytes as memoryBytes, heap_used_mb as heapUsedMb, heap_total_mb as heapTotalMb,
           event_loop_delay_ms as eventLoopDelayMs, rps, latency_ms as latencyMs, restarts, status
    FROM process_metrics_hourly
    WHERE process_name = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `);

  const purgeStmt = db.prepare('DELETE FROM metrics_hourly WHERE timestamp < ?');
  const purgeProcStmt = db.prepare('DELETE FROM process_metrics_hourly WHERE timestamp < ?');

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

  const queryRange = (
    from: number,
    to: number,
    bucketMs?: number,
  ): Result<readonly StoredMetricRecord[]> => {
    try {
      if (bucketMs && Number(bucketMs) > 60_000) {
        const safeBucketMs = Math.max(60_000, Math.floor(Number(bucketMs)));
        const bucketQuery = db.prepare(`
          SELECT 
            (timestamp / ${safeBucketMs}) * ${safeBucketMs} as timestamp,
            ROUND(AVG(cpu_usage), 1) as cpuUsage,
            CAST(AVG(memory_used) AS INT) as memoryUsed,
            CAST(AVG(memory_free) AS INT) as memoryFree,
            CAST(AVG(swap_used) AS INT) as swapUsed,
            CAST(AVG(disk_used) AS INT) as diskUsed,
            CAST(AVG(network_rx) AS INT) as networkRx,
            CAST(AVG(network_tx) AS INT) as networkTx,
            ROUND(AVG(load_1m), 2) as load1m,
            ROUND(AVG(cluster_rps), 2) as clusterRps,
            ROUND(AVG(avg_latency_ms), 1) as avgLatencyMs,
            ROUND(AVG(avg_event_loop_delay_ms), 2) as avgEventLoopDelayMs
          FROM metrics_hourly
          WHERE timestamp >= ? AND timestamp <= ?
          GROUP BY (timestamp / ${safeBucketMs})
          ORDER BY timestamp ASC
        `);
        const rows = bucketQuery.all(from, to) as StoredMetricRecord[];
        return ok(rows);
      }

      const rows = queryRangeRawStmt.all(from, to) as StoredMetricRecord[];
      return ok(rows);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to query metric records', undefined, error),
      );
    }
  };

  const insertProcessMetrics = (samples: readonly ProcessMetricSample[]): Result<void> => {
    try {
      const transaction = db.transaction((items: readonly ProcessMetricSample[]) => {
        for (const s of items) {
          insertProcStmt.run(
            s.processName,
            s.timestamp,
            s.pmId,
            s.cpu,
            s.memoryBytes,
            s.heapUsedMb || 0,
            s.heapTotalMb || 0,
            s.eventLoopDelayMs || 0,
            s.rps || 0,
            s.latencyMs || 0,
            s.restarts || 0,
            s.status || 'online',
          );
        }
      });
      transaction(samples);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to insert process metrics', undefined, error),
      );
    }
  };

  const queryProcessMetricsRange = (
    processName: string,
    from: number,
    to: number,
    bucketMs?: number,
  ): Result<readonly ProcessMetricSample[]> => {
    try {
      if (bucketMs && Number(bucketMs) > 60_000) {
        const safeBucketMs = Math.max(60_000, Math.floor(Number(bucketMs)));
        const bucketQuery = db.prepare(`
          SELECT 
            process_name as processName,
            (timestamp / ${safeBucketMs}) * ${safeBucketMs} as timestamp,
            MAX(pm_id) as pmId,
            ROUND(AVG(cpu), 1) as cpu,
            CAST(AVG(memory_bytes) AS INT) as memoryBytes,
            ROUND(AVG(heap_used_mb), 1) as heapUsedMb,
            ROUND(AVG(heap_total_mb), 1) as heapTotalMb,
            ROUND(AVG(event_loop_delay_ms), 2) as eventLoopDelayMs,
            ROUND(AVG(rps), 2) as rps,
            ROUND(AVG(latency_ms), 1) as latencyMs,
            MAX(restarts) as restarts,
            MAX(status) as status
          FROM process_metrics_hourly
          WHERE process_name = ? AND timestamp >= ? AND timestamp <= ?
          GROUP BY (timestamp / ${safeBucketMs})
          ORDER BY timestamp ASC
        `);
        const rows = bucketQuery.all(processName, from, to) as ProcessMetricSample[];
        return ok(rows);
      }

      const rows = queryProcRawStmt.all(processName, from, to) as ProcessMetricSample[];
      return ok(rows);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to query process metrics', undefined, error),
      );
    }
  };

  const purgeOlderThan = (timestamp: number): Result<number> => {
    try {
      const info = purgeStmt.run(timestamp);
      const procInfo = purgeProcStmt.run(timestamp);
      return ok(info.changes + procInfo.changes);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to purge metric records', undefined, error),
      );
    }
  };

  return {
    insert,
    queryRange,
    insertProcessMetrics,
    queryProcessMetricsRange,
    purgeOlderThan,
  };
};
