import fs from 'node:fs';
import { Result, ok, err, createAppError, ProcessGitInfo } from '@pm2-webui/shared';
import { runShellCommand, CommitInfo } from '../deploy/git.js';
import { extractProcessGitInfo } from './gitInfo.js';

export const getProcessCommitHistory = async (
  cwd: string,
  limit = 15,
): Promise<Result<readonly CommitInfo[]>> => {
  try {
    if (!cwd || !fs.existsSync(cwd)) {
      return err(createAppError('NOT_FOUND', `Process working directory not found: ${cwd}`));
    }

    const safeLimit = Math.min(Math.max(1, limit), 50);
    const command = `git log -n ${safeLimit} --format="%H%n%h%n%an%n%B%n%ct%n---GIT_COMMIT_SPLIT---"`;
    const res = await runShellCommand(command, cwd, { GIT_TERMINAL_PROMPT: '0' }, 15000);

    if (!res.ok) {
      return err(res.error);
    }

    const raw = res.value.stdout.trim();
    if (!raw) {
      return ok([]);
    }

    const rawCommits = raw.split('---GIT_COMMIT_SPLIT---').map((c) => c.trim()).filter(Boolean);
    const commits: CommitInfo[] = [];

    for (const chunk of rawCommits) {
      const lines = chunk.split('\n');
      if (lines.length < 4) continue;

      const hash = lines[0]?.trim() || '';
      const shortHash = lines[1]?.trim() || hash.slice(0, 7);
      const author = lines[2]?.trim() || 'Unknown';
      const dateSec = parseInt(lines[lines.length - 1]?.trim() || '0', 10);
      const message = lines.slice(3, -1).join('\n').trim();

      if (hash) {
        commits.push({
          hash,
          shortHash,
          author,
          message,
          date: (dateSec || Math.floor(Date.now() / 1000)) * 1000,
        });
      }
    }

    return ok(commits);
  } catch (error) {
    return err(
      createAppError('INTERNAL_ERROR', 'Failed to retrieve git commit history', undefined, error),
    );
  }
};

export const executeProcessGitPull = async (
  cwd: string,
  rebase = true,
): Promise<Result<{ stdout: string; newCommit?: ProcessGitInfo }>> => {
  try {
    if (!cwd || !fs.existsSync(cwd)) {
      return err(createAppError('NOT_FOUND', `Process working directory not found: ${cwd}`));
    }

    const cmd = rebase ? 'git pull --rebase' : 'git pull';
    const res = await runShellCommand(cmd, cwd, { GIT_TERMINAL_PROMPT: '0' }, 60000);

    if (!res.ok) {
      return err(res.error);
    }

    const newCommit = extractProcessGitInfo(cwd);
    return ok({
      stdout: res.value.stdout || res.value.stderr || 'Pull completed successfully',
      newCommit,
    });
  } catch (error) {
    return err(
      createAppError('INTERNAL_ERROR', 'Git pull execution failed', undefined, error),
    );
  }
};

export const executeProcessGitRollback = async (
  cwd: string,
  commitHash: string,
): Promise<Result<{ stdout: string; newCommit?: ProcessGitInfo }>> => {
  try {
    if (!cwd || !fs.existsSync(cwd)) {
      return err(createAppError('NOT_FOUND', `Process working directory not found: ${cwd}`));
    }

    const trimmedHash = (commitHash || '').trim();
    if (!/^[a-fA-F0-9]{4,40}$/.test(trimmedHash)) {
      return err(
        createAppError('VALIDATION_ERROR', `Invalid commit hash format: "${commitHash}"`),
      );
    }

    const cmd = `git reset --hard ${trimmedHash}`;
    const res = await runShellCommand(cmd, cwd, { GIT_TERMINAL_PROMPT: '0' }, 30000);

    if (!res.ok) {
      return err(res.error);
    }

    const newCommit = extractProcessGitInfo(cwd);
    return ok({
      stdout: res.value.stdout || `HEAD reset to ${trimmedHash}`,
      newCommit,
    });
  } catch (error) {
    return err(
      createAppError('INTERNAL_ERROR', 'Git rollback execution failed', undefined, error),
    );
  }
};
