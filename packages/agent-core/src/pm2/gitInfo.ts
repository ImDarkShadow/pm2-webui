import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ProcessGitInfo } from '@pm2-webui/shared';

interface GitCacheEntry {
  readonly timestamp: number;
  readonly info?: ProcessGitInfo;
}

const gitCache = new Map<string, GitCacheEntry>();
const CACHE_TTL_MS = 10000; // 10s cache TTL

export const extractProcessGitInfo = (cwd?: string): ProcessGitInfo | undefined => {
  if (!cwd || typeof cwd !== 'string') return undefined;

  const now = Date.now();
  const cached = gitCache.get(cwd);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.info;
  }

  try {
    if (!fs.existsSync(cwd)) {
      gitCache.set(cwd, { timestamp: now, info: undefined });
      return undefined;
    }

    // Check if directory or parent has a git repo
    let currentDir = cwd;
    let hasGit = false;
    for (let i = 0; i < 4; i++) {
      if (fs.existsSync(path.join(currentDir, '.git'))) {
        hasGit = true;
        break;
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }

    if (!hasGit) {
      gitCache.set(cwd, { timestamp: now, info: undefined });
      return undefined;
    }

    // Fast batch extraction via git CLI
    const rawOutput = execSync(
      'git log -1 --format="%H%n%h%n%an%n%B%n%ct" 2>/dev/null && echo "---GIT_SPLIT---" && git rev-parse --abbrev-ref HEAD 2>/dev/null && echo "---GIT_SPLIT---" && (git config --get remote.origin.url 2>/dev/null || echo "") && echo "---GIT_SPLIT---" && (git status --porcelain 2>/dev/null || echo "")',
      {
        cwd,
        encoding: 'utf8',
        timeout: 1000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
    );

    const sections = rawOutput.split('---GIT_SPLIT---').map((s) => s.trim());
    const logLines = (sections[0] || '').split('\n');
    const branch = sections[1] || 'main';
    const remoteUrl = sections[2] || undefined;
    const dirtyStatus = sections[3] || '';

    const commitHash = logLines[0] || undefined;
    const shortCommit = logLines[1] || (commitHash ? commitHash.slice(0, 7) : undefined);
    const commitAuthor = logLines[2] || undefined;
    const commitMessage = logLines.slice(3, -1).join('\n').trim() || undefined;
    const commitDateSec = parseInt(logLines[logLines.length - 1] || '0', 10);
    const commitDate = commitDateSec ? commitDateSec * 1000 : undefined;
    const isDirty = dirtyStatus.length > 0;

    const gitInfo: ProcessGitInfo = {
      branch,
      commitHash,
      shortCommit,
      commitMessage,
      commitAuthor,
      commitDate,
      remoteUrl,
      isDirty,
    };

    gitCache.set(cwd, { timestamp: now, info: gitInfo });
    return gitInfo;
  } catch {
    gitCache.set(cwd, { timestamp: now, info: undefined });
    return undefined;
  }
};
