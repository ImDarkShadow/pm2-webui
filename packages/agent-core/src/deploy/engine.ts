import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  GitAppConfig,
  DeploymentRecord,
  DeploymentTriggerType,
  Result,
  ok,
  err,
  createAppError,
} from '@pm2-webui/shared';
import { Pm2Manager } from '../pm2/index.js';
import { syncGitRepo, exportGitRelease, runShellCommand, CommitInfo } from './git.js';

export interface DeployEngineDeps {
  readonly appsRootPath: string;
  readonly pm2Manager: Pm2Manager;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface DeployOptions {
  readonly branch?: string;
  readonly commitHash?: string;
  readonly triggerType?: DeploymentTriggerType;
  readonly triggeredByUsername?: string;
  readonly onLog?: (chunk: string) => void;
}

export interface DeployEngine {
  readonly deployApp: (
    app: GitAppConfig,
    options?: DeployOptions,
  ) => Promise<Result<DeploymentRecord>>;
  readonly rollbackApp: (
    app: GitAppConfig,
    targetReleaseId: string,
    options?: { triggeredByUsername?: string; onLog?: (chunk: string) => void },
  ) => Promise<Result<DeploymentRecord>>;
  readonly listReleases: (appId: string) => Result<readonly string[]>;
  readonly deleteApp: (appId: string, processName?: string) => Promise<Result<void>>;
}

export const createDeployEngine = (deps: DeployEngineDeps): DeployEngine => {
  const { appsRootPath, pm2Manager, logger } = deps;

  if (!fs.existsSync(appsRootPath)) {
    fs.mkdirSync(appsRootPath, { recursive: true });
  }

  const getAppPaths = (appId: string) => {
    const appDir = path.join(appsRootPath, appId);
    const repoDir = path.join(appDir, 'repo');
    const releasesDir = path.join(appDir, 'releases');
    const currentSymlink = path.join(appDir, 'current');
    return { appDir, repoDir, releasesDir, currentSymlink };
  };

  const pruneOldReleases = (releasesDir: string, keepCount = 5) => {
    try {
      if (!fs.existsSync(releasesDir)) return;
      const releases = fs
        .readdirSync(releasesDir)
        .filter((r) => r.startsWith('rel_'))
        .sort()
        .reverse();

      const toDelete = releases.slice(keepCount);
      for (const rel of toDelete) {
        const p = path.join(releasesDir, rel);
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch (error) {
      logger?.error('Failed to prune old releases', error);
    }
  };

  const deployApp = async (
    app: GitAppConfig,
    options: DeployOptions = {},
  ): Promise<Result<DeploymentRecord>> => {
    const deploymentId = crypto.randomUUID();
    const releaseTimestamp = Date.now();
    const releaseId = `rel_${releaseTimestamp}`;
    const startedAt = Date.now();
    let logsAccumulator = '';

    const log = (msg: string) => {
      logsAccumulator += msg;
      options.onLog?.(msg);
    };

    const { appDir, repoDir, releasesDir, currentSymlink } = getAppPaths(app.id);
    const targetReleaseDir = path.join(releasesDir, releaseId);
    const branchToDeploy = options.branch || app.branch || 'main';

    log(`🚀 Starting deployment for [${app.name}] (Release: ${releaseId})\n`);
    log(
      `⏰ Trigger: ${options.triggerType || 'manual'} | User: ${options.triggeredByUsername || 'System'}\n`,
    );

    try {
      // 1. Ensure directory structure
      fs.mkdirSync(releasesDir, { recursive: true });

      // 2. Sync Repository
      log(`\n📦 [Step 1/5] Syncing Git repository...\n`);
      const syncRes = await syncGitRepo(app.repoUrl, repoDir, branchToDeploy, log);
      if (!syncRes.ok) {
        log(`❌ Git sync failed: ${syncRes.error.message}\n`);
        return ok({
          id: deploymentId,
          appId: app.id,
          appName: app.name,
          nodeId: app.nodeId,
          releaseId,
          commitHash: 'unknown',
          branch: branchToDeploy,
          status: 'failed',
          triggerType: options.triggerType || 'manual',
          triggeredByUsername: options.triggeredByUsername,
          logs: logsAccumulator,
          durationMs: Date.now() - startedAt,
          startedAt,
          finishedAt: Date.now(),
          errorMessage: syncRes.error.message,
        });
      }

      // 3. Export Release Files
      log(`\n📂 [Step 2/5] Exporting release workspace...\n`);
      const targetCommit = options.commitHash || branchToDeploy;
      const exportRes = await exportGitRelease(repoDir, targetReleaseDir, targetCommit, log);
      if (!exportRes.ok) {
        log(`❌ Git export failed: ${exportRes.error.message}\n`);
        return ok({
          id: deploymentId,
          appId: app.id,
          appName: app.name,
          nodeId: app.nodeId,
          releaseId,
          commitHash: 'unknown',
          branch: branchToDeploy,
          status: 'failed',
          triggerType: options.triggerType || 'manual',
          triggeredByUsername: options.triggeredByUsername,
          logs: logsAccumulator,
          durationMs: Date.now() - startedAt,
          startedAt,
          finishedAt: Date.now(),
          errorMessage: exportRes.error.message,
        });
      }

      const commitInfo: CommitInfo = exportRes.value;
      log(
        `📝 Commit: ${commitInfo.shortHash} - "${commitInfo.message}" (by ${commitInfo.author})\n`,
      );

      // 4. Install Dependencies
      const installCmd =
        app.installCommand ||
        (fs.existsSync(path.join(targetReleaseDir, 'package.json'))
          ? 'npm ci || npm install'
          : undefined);
      if (installCmd) {
        log(`\n📥 [Step 3/5] Installing dependencies (${installCmd})...\n`);
        const installRes = await runShellCommand(
          installCmd,
          targetReleaseDir,
          app.env,
          300000,
          log,
        );
        if (!installRes.ok) {
          log(`❌ Dependencies installation failed.\n`);
          return ok({
            id: deploymentId,
            appId: app.id,
            appName: app.name,
            nodeId: app.nodeId,
            releaseId,
            commitHash: commitInfo.hash,
            commitMessage: commitInfo.message,
            commitAuthor: commitInfo.author,
            branch: branchToDeploy,
            status: 'failed',
            triggerType: options.triggerType || 'manual',
            triggeredByUsername: options.triggeredByUsername,
            logs: logsAccumulator,
            durationMs: Date.now() - startedAt,
            startedAt,
            finishedAt: Date.now(),
            errorMessage: 'Dependency installation failed',
          });
        }
      }

      // 5. Build Project
      if (app.buildCommand) {
        log(`\n🔨 [Step 4/5] Running build command (${app.buildCommand})...\n`);
        const buildRes = await runShellCommand(
          app.buildCommand,
          targetReleaseDir,
          app.env,
          300000,
          log,
        );
        if (!buildRes.ok) {
          log(`❌ Build step failed.\n`);
          return ok({
            id: deploymentId,
            appId: app.id,
            appName: app.name,
            nodeId: app.nodeId,
            releaseId,
            commitHash: commitInfo.hash,
            commitMessage: commitInfo.message,
            commitAuthor: commitInfo.author,
            branch: branchToDeploy,
            status: 'failed',
            triggerType: options.triggerType || 'manual',
            triggeredByUsername: options.triggeredByUsername,
            logs: logsAccumulator,
            durationMs: Date.now() - startedAt,
            startedAt,
            finishedAt: Date.now(),
            errorMessage: 'Build command failed',
          });
        }
      }

      // 6. Atomic Symlink Switch
      log(`\n🔗 [Step 5/5] Atomically switching active release symlink...\n`);
      const tempSymlink = path.join(appDir, `temp_symlink_${Date.now()}`);
      try {
        fs.symlinkSync(targetReleaseDir, tempSymlink, 'dir');
        fs.renameSync(tempSymlink, currentSymlink);
      } catch {
        // Fallback for direct link
        if (fs.existsSync(currentSymlink)) fs.unlinkSync(currentSymlink);
        fs.symlinkSync(targetReleaseDir, currentSymlink, 'dir');
      }

      // 7. PM2 Start / Reload
      log(`⚡ Reloading PM2 process [${app.name}] with zero-downtime...\n`);
      const scriptFullPath = path.join(currentSymlink, app.startScript);

      const runningProcsRes = await pm2Manager.listProcesses();
      const existing = runningProcsRes.ok
        ? runningProcsRes.value.find((p) => p.name === app.name)
        : undefined;

      if (existing) {
        // Reload or restart existing
        const reloadRes = await pm2Manager.executeAction({ action: 'reload', target: app.name });
        if (!reloadRes.ok) {
          log(`⚠️ PM2 reload returned notice, attempting restart...\n`);
          await pm2Manager.executeAction({ action: 'restart', target: app.name });
        }
      } else {
        // Fresh start
        const startRes = await pm2Manager.executeAction({
          action: 'start',
          target: scriptFullPath,
          options: {
            instances: app.instances || 1,
            env: app.env,
          },
        });
        if (!startRes.ok) {
          log(`❌ PM2 start failed: ${startRes.error.message}\n`);
          return ok({
            id: deploymentId,
            appId: app.id,
            appName: app.name,
            nodeId: app.nodeId,
            releaseId,
            commitHash: commitInfo.hash,
            commitMessage: commitInfo.message,
            commitAuthor: commitInfo.author,
            branch: branchToDeploy,
            status: 'failed',
            triggerType: options.triggerType || 'manual',
            triggeredByUsername: options.triggeredByUsername,
            logs: logsAccumulator,
            durationMs: Date.now() - startedAt,
            startedAt,
            finishedAt: Date.now(),
            errorMessage: startRes.error.message,
          });
        }
      }

      // 8. Clean up old releases
      pruneOldReleases(releasesDir, 5);

      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;
      log(
        `\n✅ Deployment SUCCESS in ${(durationMs / 1000).toFixed(1)}s! Process [${app.name}] is online.\n`,
      );

      return ok({
        id: deploymentId,
        appId: app.id,
        appName: app.name,
        nodeId: app.nodeId,
        releaseId,
        commitHash: commitInfo.hash,
        commitMessage: commitInfo.message,
        commitAuthor: commitInfo.author,
        branch: branchToDeploy,
        status: 'success',
        triggerType: options.triggerType || 'manual',
        triggeredByUsername: options.triggeredByUsername,
        logs: logsAccumulator,
        durationMs,
        startedAt,
        finishedAt,
      });
    } catch (error: any) {
      log(`\n💥 Fatal deployment error: ${error?.message || error}\n`);
      return ok({
        id: deploymentId,
        appId: app.id,
        appName: app.name,
        nodeId: app.nodeId,
        releaseId,
        commitHash: 'unknown',
        branch: branchToDeploy,
        status: 'failed',
        triggerType: options.triggerType || 'manual',
        triggeredByUsername: options.triggeredByUsername,
        logs: logsAccumulator,
        durationMs: Date.now() - startedAt,
        startedAt,
        finishedAt: Date.now(),
        errorMessage: error?.message || 'Unexpected deployment error',
      });
    }
  };

  const rollbackApp = async (
    app: GitAppConfig,
    targetReleaseId: string,
    options: { triggeredByUsername?: string; onLog?: (chunk: string) => void } = {},
  ): Promise<Result<DeploymentRecord>> => {
    const deploymentId = crypto.randomUUID();
    const startedAt = Date.now();
    let logsAccumulator = '';

    const log = (msg: string) => {
      logsAccumulator += msg;
      options.onLog?.(msg);
    };

    const { releasesDir, currentSymlink } = getAppPaths(app.id);
    const targetReleaseDir = path.join(releasesDir, targetReleaseId);

    log(`⏪ Initiating 1-Click Rollback for [${app.name}] -> Release [${targetReleaseId}]\n`);

    if (!fs.existsSync(targetReleaseDir)) {
      log(`❌ Target release directory not found: ${targetReleaseId}\n`);
      return err(
        createAppError('NOT_FOUND', `Target release ${targetReleaseId} does not exist on disk`),
      );
    }

    try {
      // 1. Switch Symlink
      log(`🔗 Switching active symlink to [${targetReleaseId}]...\n`);
      if (fs.existsSync(currentSymlink)) fs.unlinkSync(currentSymlink);
      fs.symlinkSync(targetReleaseDir, currentSymlink, 'dir');

      // 2. Reload PM2
      log(`⚡ Reloading PM2 process [${app.name}]...\n`);
      await pm2Manager.executeAction({ action: 'restart', target: app.name });

      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;
      log(
        `\n✅ Rollback SUCCESS in ${(durationMs / 1000).toFixed(1)}s! Process [${app.name}] is active.\n`,
      );

      return ok({
        id: deploymentId,
        appId: app.id,
        appName: app.name,
        nodeId: app.nodeId,
        releaseId: targetReleaseId,
        commitHash: 'rollback',
        commitMessage: `Rolled back to ${targetReleaseId}`,
        branch: app.branch,
        status: 'rolled_back',
        triggerType: 'rollback',
        triggeredByUsername: options.triggeredByUsername,
        logs: logsAccumulator,
        durationMs,
        startedAt,
        finishedAt,
      });
    } catch (error: any) {
      log(`❌ Rollback failed: ${error?.message || error}\n`);
      return err(createAppError('INTERNAL_ERROR', 'Rollback failed', undefined, error));
    }
  };

  const listReleases = (appId: string): Result<readonly string[]> => {
    try {
      const { releasesDir } = getAppPaths(appId);
      if (!fs.existsSync(releasesDir)) return ok([]);
      const releases = fs
        .readdirSync(releasesDir)
        .filter((r) => r.startsWith('rel_'))
        .sort()
        .reverse();
      return ok(releases);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to list releases', undefined, error));
    }
  };

  const deleteApp = async (appId: string, processName?: string): Promise<Result<void>> => {
    try {
      if (processName) {
        await pm2Manager.executeAction({ action: 'delete', target: processName }).catch(() => {});
      }
      const { appDir } = getAppPaths(appId);
      if (fs.existsSync(appDir)) {
        fs.rmSync(appDir, { recursive: true, force: true });
      }
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to delete app directory', undefined, error),
      );
    }
  };

  return {
    deployApp,
    rollbackApp,
    listReleases,
    deleteApp,
  };
};
