import { Database as SQLiteDatabase } from 'better-sqlite3';
import crypto from 'node:crypto';
import { Result, ok, err, createAppError, ErrorTraceItem, LogLine } from '@pm2-webui/shared';

export interface AgentErrorTraceRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface IngestErrorTraceInput {
  readonly processName: string;
  readonly pmId: number;
  readonly errorName: string;
  readonly message: string;
  readonly stackTrace: string;
  readonly timestamp?: number;
  readonly contextLogs?: readonly LogLine[];
}

export interface ListErrorTracesFilter {
  readonly processName?: string;
  readonly status?: 'unresolved' | 'resolved' | 'ignored' | 'all';
  readonly limit?: number;
}

export interface AgentErrorTraceRepo {
  readonly ingest: (input: IngestErrorTraceInput) => Result<ErrorTraceItem>;
  readonly list: (filter?: ListErrorTracesFilter) => Result<readonly ErrorTraceItem[]>;
  readonly findById: (id: string) => Result<ErrorTraceItem | null>;
  readonly resolve: (id: string) => Result<void>;
  readonly purgeOlderThan: (timestamp: number) => Result<number>;
}

export const createAgentErrorTraceRepo = (deps: AgentErrorTraceRepoDeps): AgentErrorTraceRepo => {
  const { db } = deps;

  const findByIdStmt = db.prepare(`
    SELECT id, process_name as processName, pm_id as pmId, error_name as errorName,
           message, stack_trace as stackTrace, first_seen_at as firstSeenAt,
           last_seen_at as lastSeenAt, occurrence_count as occurrenceCount,
           status, context_logs_json as contextLogsJson
    FROM error_traces
    WHERE id = ?
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO error_traces (
      id, process_name, pm_id, error_name, message, stack_trace,
      first_seen_at, last_seen_at, occurrence_count, status, context_logs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'unresolved', ?)
    ON CONFLICT(id) DO UPDATE SET
      pm_id = excluded.pm_id,
      last_seen_at = excluded.last_seen_at,
      occurrence_count = error_traces.occurrence_count + 1,
      status = 'unresolved',
      context_logs_json = excluded.context_logs_json
  `);

  const resolveStmt = db.prepare(`
    UPDATE error_traces
    SET status = 'resolved'
    WHERE id = ?
  `);

  const purgeStmt = db.prepare('DELETE FROM error_traces WHERE last_seen_at < ?');

  const parseRow = (row: any): ErrorTraceItem => ({
    id: row.id,
    processName: row.processName,
    pmId: row.pmId,
    errorName: row.errorName,
    message: row.message,
    stackTrace: row.stackTrace,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    occurrenceCount: row.occurrenceCount,
    status: row.status,
    contextLogs: row.contextLogsJson ? JSON.parse(row.contextLogsJson) : undefined,
  });

  const generateErrorFingerprint = (processName: string, errorName: string, stackTrace: string): string => {
    // Extract top 2 caller lines to avoid line number churn while grouping the same root-cause site
    const lines = stackTrace.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at '));
    const topFrames = lines.slice(0, 2).map((l) => l.replace(/:\d+:\d+/g, '')).join('|');
    const signature = `${processName}:${errorName}:${topFrames || stackTrace.slice(0, 100)}`;
    return crypto.createHash('sha256').update(signature).digest('hex').slice(0, 16);
  };

  const ingest = (input: IngestErrorTraceInput): Result<ErrorTraceItem> => {
    try {
      const now = input.timestamp || Date.now();
      const id = generateErrorFingerprint(input.processName, input.errorName, input.stackTrace);
      const contextJson = input.contextLogs && input.contextLogs.length > 0 ? JSON.stringify(input.contextLogs) : null;

      upsertStmt.run(
        id,
        input.processName,
        input.pmId,
        input.errorName,
        input.message,
        input.stackTrace,
        now,
        now,
        contextJson,
      );

      const fresh = findByIdStmt.get(id);
      return ok(parseRow(fresh));
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to ingest error trace', undefined, error));
    }
  };

  const list = (filter: ListErrorTracesFilter = {}): Result<readonly ErrorTraceItem[]> => {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filter.processName) {
        conditions.push('process_name = ?');
        params.push(filter.processName);
      }

      if (filter.status && filter.status !== 'all') {
        conditions.push('status = ?');
        params.push(filter.status);
      }

      let query = `
        SELECT id, process_name as processName, pm_id as pmId, error_name as errorName,
               message, stack_trace as stackTrace, first_seen_at as firstSeenAt,
               last_seen_at as lastSeenAt, occurrence_count as occurrenceCount,
               status, context_logs_json as contextLogsJson
        FROM error_traces
      `;

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY last_seen_at DESC LIMIT ?`;
      params.push(filter.limit || 50);

      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return ok(rows.map(parseRow));
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to list error traces', undefined, error));
    }
  };

  const findById = (id: string): Result<ErrorTraceItem | null> => {
    try {
      const row = findByIdStmt.get(id);
      if (!row) return ok(null);
      return ok(parseRow(row));
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to find error trace', undefined, error));
    }
  };

  const resolve = (id: string): Result<void> => {
    try {
      resolveStmt.run(id);
      return ok(undefined);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to resolve error trace', undefined, error));
    }
  };

  const purgeOlderThan = (timestamp: number): Result<number> => {
    try {
      const info = purgeStmt.run(timestamp);
      return ok(info.changes);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to purge error traces', undefined, error));
    }
  };

  return {
    ingest,
    list,
    findById,
    resolve,
    purgeOlderThan,
  };
};
