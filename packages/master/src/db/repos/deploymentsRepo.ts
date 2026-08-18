import { Database as SQLiteDatabase } from 'better-sqlite3';
import {
  DeploymentRecord,
  DeploymentStatus,
  DeploymentTriggerType,
  Result,
  ok,
  err,
  createAppError,
} from '@pm2-cluster/shared';

export interface DeploymentsRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface DeploymentsRepo {
  readonly findById: (id: string) => Result<DeploymentRecord | null>;
  readonly listByApp: (appId: string, limit?: number) => Result<readonly DeploymentRecord[]>;
  readonly listRecent: (limit?: number) => Result<readonly DeploymentRecord[]>;
  readonly create: (record: DeploymentRecord) => Result<DeploymentRecord>;
  readonly updateStatus: (
    id: string,
    status: DeploymentStatus,
    extra?: { logs?: string; finishedAt?: number; durationMs?: number; errorMessage?: string },
  ) => Result<void>;
  readonly appendLogs: (id: string, chunk: string) => Result<void>;
}

export const createDeploymentsRepo = (deps: DeploymentsRepoDeps): DeploymentsRepo => {
  const { db } = deps;

  const findByIdStmt = db.prepare(`
    SELECT id, app_id as appId, app_name as appName, node_id as nodeId,
           release_id as releaseId, commit_hash as commitHash, commit_message as commitMessage,
           commit_author as commitAuthor, branch, status, trigger_type as triggerType,
           triggered_by_username as triggeredByUsername, logs, duration_ms as durationMs,
           started_at as startedAt, finished_at as finishedAt, error_message as errorMessage
    FROM deployments
    WHERE id = ?
  `);

  const listByAppStmt = db.prepare(`
    SELECT id, app_id as appId, app_name as appName, node_id as nodeId,
           release_id as releaseId, commit_hash as commitHash, commit_message as commitMessage,
           commit_author as commitAuthor, branch, status, trigger_type as triggerType,
           triggered_by_username as triggeredByUsername, logs, duration_ms as durationMs,
           started_at as startedAt, finished_at as finishedAt, error_message as errorMessage
    FROM deployments
    WHERE app_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `);

  const listRecentStmt = db.prepare(`
    SELECT id, app_id as appId, app_name as appName, node_id as nodeId,
           release_id as releaseId, commit_hash as commitHash, commit_message as commitMessage,
           commit_author as commitAuthor, branch, status, trigger_type as triggerType,
           triggered_by_username as triggeredByUsername, logs, duration_ms as durationMs,
           started_at as startedAt, finished_at as finishedAt, error_message as errorMessage
    FROM deployments
    ORDER BY started_at DESC
    LIMIT ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO deployments (
      id, app_id, app_name, node_id, release_id, commit_hash, commit_message,
      commit_author, branch, status, trigger_type, triggered_by_username, logs,
      duration_ms, started_at, finished_at, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const mapRow = (row: any): DeploymentRecord | null => {
    if (!row) return null;
    return {
      id: row.id,
      appId: row.appId,
      appName: row.appName,
      nodeId: row.nodeId,
      releaseId: row.releaseId,
      commitHash: row.commitHash,
      commitMessage: row.commitMessage ?? undefined,
      commitAuthor: row.commitAuthor ?? undefined,
      branch: row.branch,
      status: row.status as DeploymentStatus,
      triggerType: row.triggerType as DeploymentTriggerType,
      triggeredByUsername: row.triggeredByUsername ?? undefined,
      logs: row.logs || '',
      durationMs: row.durationMs ?? undefined,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
    };
  };

  const findById = (id: string): Result<DeploymentRecord | null> => {
    try {
      const row = findByIdStmt.get(id);
      return ok(mapRow(row));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to find deployment by ID', undefined, error),
      );
    }
  };

  const listByApp = (appId: string, limit = 50): Result<readonly DeploymentRecord[]> => {
    try {
      const rows = listByAppStmt.all(appId, limit);
      return ok(rows.map(mapRow).filter((d): d is DeploymentRecord => d !== null));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to list deployments by app', undefined, error),
      );
    }
  };

  const listRecent = (limit = 20): Result<readonly DeploymentRecord[]> => {
    try {
      const rows = listRecentStmt.all(limit);
      return ok(rows.map(mapRow).filter((d): d is DeploymentRecord => d !== null));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to list recent deployments', undefined, error),
      );
    }
  };

  const create = (record: DeploymentRecord): Result<DeploymentRecord> => {
    try {
      insertStmt.run(
        record.id,
        record.appId,
        record.appName,
        record.nodeId,
        record.releaseId,
        record.commitHash,
        record.commitMessage || null,
        record.commitAuthor || null,
        record.branch,
        record.status,
        record.triggerType,
        record.triggeredByUsername || null,
        record.logs,
        record.durationMs || null,
        record.startedAt,
        record.finishedAt || null,
        record.errorMessage || null,
      );
      return ok(record);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to create deployment record', undefined, error),
      );
    }
  };

  const updateStatus = (
    id: string,
    status: DeploymentStatus,
    extra: { logs?: string; finishedAt?: number; durationMs?: number; errorMessage?: string } = {},
  ): Result<void> => {
    try {
      const stmt = db.prepare(`
        UPDATE deployments SET
          status = ?,
          logs = COALESCE(?, logs),
          finished_at = COALESCE(?, finished_at),
          duration_ms = COALESCE(?, duration_ms),
          error_message = COALESCE(?, error_message)
        WHERE id = ?
      `);

      stmt.run(
        status,
        extra.logs ?? null,
        extra.finishedAt ?? null,
        extra.durationMs ?? null,
        extra.errorMessage ?? null,
        id,
      );

      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to update deployment status', undefined, error),
      );
    }
  };

  const appendLogs = (id: string, chunk: string): Result<void> => {
    try {
      const stmt = db.prepare(`
        UPDATE deployments SET logs = logs || ? WHERE id = ?
      `);
      stmt.run(chunk, id);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to append deployment logs', undefined, error),
      );
    }
  };

  return {
    findById,
    listByApp,
    listRecent,
    create,
    updateStatus,
    appendLogs,
  };
};
