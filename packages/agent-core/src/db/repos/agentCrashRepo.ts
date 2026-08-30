import { Database as SQLiteDatabase } from 'better-sqlite3';
import { CrashEvent, Result, ok, err, createAppError } from '@pm2-webui/shared';

export interface AgentCrashRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface AgentCrashRepo {
  readonly insert: (event: CrashEvent) => Result<void>;
  readonly list: (processName?: string, limit?: number) => Result<readonly CrashEvent[]>;
  readonly findById: (id: string) => Result<CrashEvent | null>;
  readonly purgeOlderThan: (timestamp: number) => Result<number>;
}

export const createAgentCrashRepo = (deps: AgentCrashRepoDeps): AgentCrashRepo => {
  const { db } = deps;

  const insertStmt = db.prepare(`
    INSERT INTO crash_events (id, process_name, pm_id, exit_code, signal, crashed_at, logs_before_json, logs_after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findByIdStmt = db.prepare(`
    SELECT id, process_name as processName, pm_id as pmId, exit_code as exitCode,
           signal, crashed_at as crashedAt, logs_before_json as logsBeforeJson, logs_after_json as logsAfterJson
    FROM crash_events
    WHERE id = ?
  `);

  const purgeStmt = db.prepare('DELETE FROM crash_events WHERE crashed_at < ?');

  const parseRow = (row: any): CrashEvent => ({
    id: row.id,
    processName: row.processName,
    pmId: row.pmId,
    exitCode: row.exitCode ?? undefined,
    signal: row.signal ?? undefined,
    crashedAt: row.crashedAt,
    logsBefore: JSON.parse(row.logsBeforeJson || '[]'),
    logsAfter: JSON.parse(row.logsAfterJson || '[]'),
  });

  const insert = (event: CrashEvent): Result<void> => {
    try {
      insertStmt.run(
        event.id,
        event.processName,
        event.pmId,
        event.exitCode ?? null,
        event.signal ?? null,
        event.crashedAt,
        JSON.stringify(event.logsBefore),
        JSON.stringify(event.logsAfter),
      );
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to insert crash event', undefined, error),
      );
    }
  };

  const list = (processName?: string, limit = 50): Result<readonly CrashEvent[]> => {
    try {
      let query = `
        SELECT id, process_name as processName, pm_id as pmId, exit_code as exitCode,
               signal, crashed_at as crashedAt, logs_before_json as logsBeforeJson, logs_after_json as logsAfterJson
        FROM crash_events
      `;
      const params: unknown[] = [];
      if (processName) {
        query += ` WHERE process_name = ?`;
        params.push(processName);
      }
      query += ` ORDER BY crashed_at DESC LIMIT ?`;
      params.push(limit);

      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return ok(rows.map(parseRow));
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to list crash events', undefined, error));
    }
  };

  const findById = (id: string): Result<CrashEvent | null> => {
    try {
      const row = findByIdStmt.get(id);
      if (!row) return ok(null);
      return ok(parseRow(row));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to find crash event by id', undefined, error),
      );
    }
  };

  const purgeOlderThan = (timestamp: number): Result<number> => {
    try {
      const info = purgeStmt.run(timestamp);
      return ok(info.changes);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to purge crash events', undefined, error),
      );
    }
  };

  return {
    insert,
    list,
    findById,
    purgeOlderThan,
  };
};
