import { Database as SQLiteDatabase } from 'better-sqlite3';
import crypto from 'node:crypto';
import { GitAppConfig, Result, ok, err, createAppError } from '@pm2-webui/shared';

export interface GitAppsRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface GitAppsRepo {
  readonly findById: (id: string) => Result<GitAppConfig | null>;
  readonly findByName: (name: string) => Result<GitAppConfig | null>;
  readonly list: () => Result<readonly GitAppConfig[]>;
  readonly create: (
    app: Omit<GitAppConfig, 'id' | 'createdAt' | 'updatedAt' | 'webhookSecret'> & {
      id?: string;
      webhookSecret?: string;
    },
  ) => Result<GitAppConfig>;
  readonly update: (
    id: string,
    updates: Partial<Omit<GitAppConfig, 'id' | 'createdAt'>>,
  ) => Result<GitAppConfig>;
  readonly deleteApp: (id: string) => Result<void>;
}

export const createGitAppsRepo = (deps: GitAppsRepoDeps): GitAppsRepo => {
  const { db } = deps;

  const findByIdStmt = db.prepare(`
    SELECT id, name, node_id as nodeId, repo_url as repoUrl, branch,
           commit_hash as commitHash, commit_message as commitMessage, commit_author as commitAuthor,
           install_command as installCommand, build_command as buildCommand, start_script as startScript,
           exec_mode as execMode, instances, env_json as envJson,
           auto_deploy as autoDeploy, webhook_secret as webhookSecret, deploy_path as deployPath,
           created_at as createdAt, updated_at as updatedAt
    FROM git_apps
    WHERE id = ?
  `);

  const findByNameStmt = db.prepare(`
    SELECT id, name, node_id as nodeId, repo_url as repoUrl, branch,
           commit_hash as commitHash, commit_message as commitMessage, commit_author as commitAuthor,
           install_command as installCommand, build_command as buildCommand, start_script as startScript,
           exec_mode as execMode, instances, env_json as envJson,
           auto_deploy as autoDeploy, webhook_secret as webhookSecret, deploy_path as deployPath,
           created_at as createdAt, updated_at as updatedAt
    FROM git_apps
    WHERE name = ?
  `);

  const listStmt = db.prepare(`
    SELECT id, name, node_id as nodeId, repo_url as repoUrl, branch,
           commit_hash as commitHash, commit_message as commitMessage, commit_author as commitAuthor,
           install_command as installCommand, build_command as buildCommand, start_script as startScript,
           exec_mode as execMode, instances, env_json as envJson,
           auto_deploy as autoDeploy, webhook_secret as webhookSecret, deploy_path as deployPath,
           created_at as createdAt, updated_at as updatedAt
    FROM git_apps
    ORDER BY created_at DESC
  `);

  const insertStmt = db.prepare(`
    INSERT INTO git_apps (
      id, name, node_id, repo_url, branch, commit_hash, commit_message, commit_author,
      install_command, build_command, start_script, exec_mode, instances, env_json,
      auto_deploy, webhook_secret, deploy_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteStmt = db.prepare('DELETE FROM git_apps WHERE id = ?');

  const mapRow = (row: any): GitAppConfig | null => {
    if (!row) return null;
    let env: Record<string, string> | undefined;
    if (row.envJson) {
      try {
        env = JSON.parse(row.envJson);
      } catch {}
    }

    return {
      id: row.id,
      name: row.name,
      nodeId: row.nodeId,
      repoUrl: row.repoUrl,
      branch: row.branch,
      commitHash: row.commitHash ?? undefined,
      commitMessage: row.commitMessage ?? undefined,
      commitAuthor: row.commitAuthor ?? undefined,
      installCommand: row.installCommand ?? undefined,
      buildCommand: row.buildCommand ?? undefined,
      startScript: row.startScript || 'index.js',
      execMode: row.execMode || 'fork_mode',
      instances: row.instances ?? 1,
      env,
      autoDeploy: Boolean(row.autoDeploy),
      webhookSecret: row.webhookSecret,
      deployPath: row.deployPath ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  };

  const findById = (id: string): Result<GitAppConfig | null> => {
    try {
      const row = findByIdStmt.get(id);
      return ok(mapRow(row));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to find git app by ID', undefined, error),
      );
    }
  };

  const findByName = (name: string): Result<GitAppConfig | null> => {
    try {
      const row = findByNameStmt.get(name);
      return ok(mapRow(row));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to find git app by name', undefined, error),
      );
    }
  };

  const list = (): Result<readonly GitAppConfig[]> => {
    try {
      const rows = listStmt.all();
      return ok(rows.map(mapRow).filter((a): a is GitAppConfig => a !== null));
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to list git apps', undefined, error));
    }
  };

  const create = (
    app: Omit<GitAppConfig, 'id' | 'createdAt' | 'updatedAt' | 'webhookSecret'> & {
      id?: string;
      webhookSecret?: string;
    },
  ): Result<GitAppConfig> => {
    try {
      const id = app.id || crypto.randomUUID();
      const webhookSecret = app.webhookSecret || crypto.randomBytes(24).toString('hex');
      const now = Date.now();
      const envJson = app.env ? JSON.stringify(app.env) : null;

      insertStmt.run(
        id,
        app.name,
        app.nodeId,
        app.repoUrl,
        app.branch || 'main',
        app.commitHash || null,
        app.commitMessage || null,
        app.commitAuthor || null,
        app.installCommand || null,
        app.buildCommand || null,
        app.startScript || 'index.js',
        app.execMode || 'fork_mode',
        app.instances || 1,
        envJson,
        app.autoDeploy ? 1 : 0,
        webhookSecret,
        app.deployPath || null,
        now,
        now,
      );

      const created = findById(id);
      if (!created.ok || !created.value) {
        return err(createAppError('INTERNAL_ERROR', 'Failed to retrieve created git app'));
      }
      return ok(created.value);
    } catch (error) {
      return err(
        createAppError(
          'CONFLICT',
          'Failed to create git app. Name may already exist.',
          undefined,
          error,
        ),
      );
    }
  };

  const update = (
    id: string,
    updates: Partial<Omit<GitAppConfig, 'id' | 'createdAt'>>,
  ): Result<GitAppConfig> => {
    try {
      const existing = findById(id);
      if (!existing.ok || !existing.value) {
        return err(createAppError('NOT_FOUND', 'Git app not found'));
      }

      const merged = { ...existing.value, ...updates, updatedAt: Date.now() };
      const envJson = merged.env ? JSON.stringify(merged.env) : null;

      const updateStmt = db.prepare(`
        UPDATE git_apps SET
          name = ?, node_id = ?, repo_url = ?, branch = ?,
          commit_hash = ?, commit_message = ?, commit_author = ?,
          install_command = ?, build_command = ?, start_script = ?,
          exec_mode = ?, instances = ?, env_json = ?,
          auto_deploy = ?, deploy_path = ?, updated_at = ?
        WHERE id = ?
      `);

      updateStmt.run(
        merged.name,
        merged.nodeId,
        merged.repoUrl,
        merged.branch,
        merged.commitHash || null,
        merged.commitMessage || null,
        merged.commitAuthor || null,
        merged.installCommand || null,
        merged.buildCommand || null,
        merged.startScript,
        merged.execMode || 'fork_mode',
        merged.instances || 1,
        envJson,
        merged.autoDeploy ? 1 : 0,
        merged.deployPath || null,
        merged.updatedAt,
        id,
      );

      const updated = findById(id);
      if (!updated.ok || !updated.value) {
        return err(createAppError('INTERNAL_ERROR', 'Failed to retrieve updated git app'));
      }
      return ok(updated.value);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to update git app', undefined, error));
    }
  };

  const deleteApp = (id: string): Result<void> => {
    try {
      deleteStmt.run(id);
      return ok(undefined);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to delete git app', undefined, error));
    }
  };

  return {
    findById,
    findByName,
    list,
    create,
    update,
    deleteApp,
  };
};
