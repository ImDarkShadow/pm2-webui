import { Database as SQLiteDatabase } from 'better-sqlite3';
import { AuditLog, Result, ok, err, createAppError } from '@pm2-cluster/shared';

export interface AuditRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface InsertAuditEntry {
  readonly timestamp?: number;
  readonly userId: string;
  readonly username?: string;
  readonly nodeId?: string;
  readonly processName?: string;
  readonly action: string;
  readonly status: 'success' | 'failure';
  readonly ipAddress: string;
  readonly detailsJson?: string;
}

export interface AuditListFilter {
  readonly page?: number;
  readonly limit?: number;
  readonly userId?: string;
  readonly nodeId?: string;
  readonly status?: 'success' | 'failure';
  readonly action?: string;
}

export interface AuditRepo {
  readonly insert: (entry: InsertAuditEntry) => Result<AuditLog>;
  readonly list: (filter?: AuditListFilter) => Result<{ logs: readonly AuditLog[]; total: number }>;
}

export const createAuditRepo = (deps: AuditRepoDeps): AuditRepo => {
  const { db } = deps;

  const insertStmt = db.prepare(`
    INSERT INTO audit_logs (timestamp, user_id, username, node_id, process_name, action, status, ip_address, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insert = (entry: InsertAuditEntry): Result<AuditLog> => {
    try {
      const timestamp = entry.timestamp ?? Date.now();
      const info = insertStmt.run(
        timestamp,
        entry.userId,
        entry.username ?? null,
        entry.nodeId ?? null,
        entry.processName ?? null,
        entry.action,
        entry.status,
        entry.ipAddress,
        entry.detailsJson ?? null,
      );

      const log: AuditLog = {
        id: Number(info.lastInsertRowid),
        timestamp,
        userId: entry.userId,
        username: entry.username,
        nodeId: entry.nodeId,
        processName: entry.processName,
        action: entry.action,
        status: entry.status,
        ipAddress: entry.ipAddress,
        detailsJson: entry.detailsJson,
      };

      return ok(log);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to insert audit log', undefined, error));
    }
  };

  const list = (filter?: AuditListFilter): Result<{ logs: readonly AuditLog[]; total: number }> => {
    try {
      const page = Math.max(1, filter?.page ?? 1);
      const limit = Math.min(500, Math.max(1, filter?.limit ?? 50));
      const offset = (page - 1) * limit;

      const whereClauses: string[] = [];
      const params: unknown[] = [];

      if (filter?.userId) {
        whereClauses.push('user_id = ?');
        params.push(filter.userId);
      }
      if (filter?.nodeId) {
        whereClauses.push('node_id = ?');
        params.push(filter.nodeId);
      }
      if (filter?.status) {
        whereClauses.push('status = ?');
        params.push(filter.status);
      }
      if (filter?.action) {
        whereClauses.push('action = ?');
        params.push(filter.action);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countStmt = db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${whereSql}`);
      const countRow = countStmt.get(...params) as { count: number };
      const total = countRow.count;

      const selectStmt = db.prepare(`
        SELECT id, timestamp, user_id as userId, username, node_id as nodeId,
               process_name as processName, action, status, ip_address as ipAddress, details_json as detailsJson
        FROM audit_logs
        ${whereSql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `);

      const rows = selectStmt.all(...params, limit, offset) as AuditLog[];

      return ok({
        logs: rows,
        total,
      });
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to query audit logs', undefined, error));
    }
  };

  return {
    insert,
    list,
  };
};
