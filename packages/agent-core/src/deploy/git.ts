import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import { Result, ok, err, createAppError } from '@pm2-cluster/shared';

export interface CommitInfo {
  readonly hash: string;
  readonly shortHash: string;
  readonly author: string;
  readonly message: string;
  readonly date: number;
}

export const runShellCommand = (
  command: string,
  cwd: string,
  env: Record<string, string> = {},
  timeoutMs = 300000, // 5 min default
  onLog?: (chunk: string) => void,
): Promise<Result<{ stdout: string; stderr: string; exitCode: number }>> => {
  return new Promise((resolve) => {
    let stdoutAcc = '';
    let stderrAcc = '';
    let isTimedOut = false;

    const child = spawn(command, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        ...env,
        CI: 'true',
        DEBIAN_FRONTEND: 'noninteractive',
      },
    });

    const timer = setTimeout(() => {
      isTimedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (data) => {
      const str = data.toString();
      stdoutAcc += str;
      onLog?.(str);
    });

    child.stderr?.on('data', (data) => {
      const str = data.toString();
      stderrAcc += str;
      onLog?.(str);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (isTimedOut) {
        return resolve(
          err(
            createAppError(
              'TIMEOUT',
              `Command execution timed out after ${timeoutMs / 1000}s: ${command}`,
            ),
          ),
        );
      }

      if (code !== 0) {
        return resolve(
          err(
            createAppError(
              'INTERNAL_ERROR',
              `Command failed with exit code ${code}: ${command}`,
              undefined,
              { stdout: stdoutAcc, stderr: stderrAcc },
            ),
          ),
        );
      }

      resolve(ok({ stdout: stdoutAcc, stderr: stderrAcc, exitCode: code ?? 0 }));
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve(
        err(
          createAppError('INTERNAL_ERROR', `Failed to spawn process: ${command}`, undefined, error),
        ),
      );
    });
  });
};

export const syncGitRepo = async (
  repoUrl: string,
  repoDir: string,
  branch: string,
  onLog?: (chunk: string) => void,
): Promise<Result<void>> => {
  try {
    if (!fs.existsSync(repoDir)) {
      fs.mkdirSync(repoDir, { recursive: true });
      onLog?.(`[Git] Cloning ${repoUrl} (branch: ${branch})...\n`);
      const cloneRes = await runShellCommand(
        `git clone --branch ${branch} --single-branch ${repoUrl} .`,
        repoDir,
        {},
        120000,
        onLog,
      );
      if (!cloneRes.ok) return err(cloneRes.error);
    } else {
      onLog?.(`[Git] Fetching latest changes from origin (branch: ${branch})...\n`);
      const fetchRes = await runShellCommand(
        `git fetch origin ${branch} && git checkout ${branch} && git reset --hard origin/${branch}`,
        repoDir,
        {},
        60000,
        onLog,
      );
      if (!fetchRes.ok) return err(fetchRes.error);
    }

    return ok(undefined);
  } catch (error) {
    return err(createAppError('INTERNAL_ERROR', 'Git sync failed', undefined, error));
  }
};

export const exportGitRelease = async (
  repoDir: string,
  targetReleaseDir: string,
  commitOrBranch: string,
  onLog?: (chunk: string) => void,
): Promise<Result<CommitInfo>> => {
  try {
    if (!fs.existsSync(targetReleaseDir)) {
      fs.mkdirSync(targetReleaseDir, { recursive: true });
    }

    onLog?.(`[Git] Checking out ${commitOrBranch} to release directory...\n`);
    const archiveRes = await runShellCommand(
      `git archive ${commitOrBranch} | tar -x -C "${targetReleaseDir}"`,
      repoDir,
      {},
      60000,
      onLog,
    );
    if (!archiveRes.ok) {
      // Fallback copy if git archive fails on submodules
      onLog?.(`[Git Archive fallback] Copying files...\n`);
      const copyRes = await runShellCommand(
        `rsync -a --exclude='.git' "${repoDir}/" "${targetReleaseDir}/"`,
        repoDir,
        {},
        60000,
        onLog,
      );
      if (!copyRes.ok) return err(archiveRes.error);
    }

    // Extract commit info
    const commitInfoRaw = execSync(`git log -1 --format="%H%n%h%n%an%n%B%n%ct" ${commitOrBranch}`, {
      cwd: repoDir,
      encoding: 'utf8',
    })
      .trim()
      .split('\n');

    const commitInfo: CommitInfo = {
      hash: commitInfoRaw[0] || 'unknown',
      shortHash: commitInfoRaw[1] || 'unknown',
      author: commitInfoRaw[2] || 'System',
      message: commitInfoRaw.slice(3, -1).join('\n').trim() || 'Manual Deploy',
      date:
        (parseInt(commitInfoRaw[commitInfoRaw.length - 1] || '0', 10) ||
          Math.floor(Date.now() / 1000)) * 1000,
    };

    return ok(commitInfo);
  } catch (error) {
    return err(createAppError('INTERNAL_ERROR', 'Failed to export git release', undefined, error));
  }
};
