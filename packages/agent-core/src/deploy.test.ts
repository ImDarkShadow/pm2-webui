import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDeployEngine } from './deploy/engine.js';
import { GitAppConfig } from '@pm2-webui/shared';

describe('DeployEngine', () => {
  let tmpDir: string;
  let mockPm2: any;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `pm2-deploy-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });

    mockPm2 = {
      listProcesses: async () => ({ ok: true, value: [] }),
      executeAction: async () => ({ ok: true, value: undefined }),
      describeProcess: async () => ({ ok: true, value: null }),
      scaleProcess: async () => ({ ok: true, value: undefined }),
      triggerAction: async () => ({ ok: true, value: undefined }),
    };
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should initialize and list empty releases for new app', () => {
    const engine = createDeployEngine({ appsRootPath: tmpDir, pm2Manager: mockPm2 });
    const releasesRes = engine.listReleases('app-1');
    expect(releasesRes.ok).toBe(true);
    if (releasesRes.ok) {
      expect(releasesRes.value).toEqual([]);
    }
  });

  it('should rollback to target release when release directory exists', async () => {
    const engine = createDeployEngine({ appsRootPath: tmpDir, pm2Manager: mockPm2 });
    const appDir = path.join(tmpDir, 'app-1');
    const releasesDir = path.join(appDir, 'releases');
    const rel1 = path.join(releasesDir, 'rel_1000');
    const rel2 = path.join(releasesDir, 'rel_2000');

    fs.mkdirSync(rel1, { recursive: true });
    fs.mkdirSync(rel2, { recursive: true });
    fs.writeFileSync(path.join(rel1, 'index.js'), 'console.log("v1");');
    fs.writeFileSync(path.join(rel2, 'index.js'), 'console.log("v2");');

    const appConfig: GitAppConfig = {
      id: 'app-1',
      name: 'test-app',
      nodeId: 'node-1',
      repoUrl: 'https://github.com/example/repo.git',
      branch: 'main',
      startScript: 'index.js',
      autoDeploy: false,
      webhookSecret: 'secret',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const rollbackRes = await engine.rollbackApp(appConfig, 'rel_1000', {
      triggeredByUsername: 'admin',
    });

    expect(rollbackRes.ok).toBe(true);
    if (rollbackRes.ok) {
      expect(rollbackRes.value.status).toBe('rolled_back');
      expect(rollbackRes.value.releaseId).toBe('rel_1000');
    }

    // Verify current symlink points to rel_1000
    const currentSymlink = path.join(appDir, 'current');
    expect(fs.existsSync(currentSymlink)).toBe(true);
    const linkTarget = fs.readlinkSync(currentSymlink);
    expect(linkTarget).toBe(rel1);
  });

  it('retrieves commit history and executes git rollback on local repository', async () => {
    const { getProcessCommitHistory, executeProcessGitRollback } = await import(
      './pm2/gitOps.js'
    );
    const { execSync } = await import('node:child_process');

    const gitDir = path.join(tmpDir, 'git-repo');
    fs.mkdirSync(gitDir, { recursive: true });

    // Initialize real git repo
    execSync('git init -b main', { cwd: gitDir });
    execSync('git config user.name "Tester"', { cwd: gitDir });
    execSync('git config user.email "test@example.com"', { cwd: gitDir });

    // Commit 1
    fs.writeFileSync(path.join(gitDir, 'file1.txt'), 'hello');
    execSync('git add . && git commit -m "First commit"', { cwd: gitDir });
    const c1Hash = execSync('git rev-parse HEAD', { cwd: gitDir, encoding: 'utf8' }).trim();

    // Commit 2
    fs.writeFileSync(path.join(gitDir, 'file2.txt'), 'world');
    execSync('git add . && git commit -m "Second commit"', { cwd: gitDir });
    const c2Hash = execSync('git rev-parse HEAD', { cwd: gitDir, encoding: 'utf8' }).trim();

    // Verify commit history retrieval
    const historyRes = await getProcessCommitHistory(gitDir, 10);
    expect(historyRes.ok).toBe(true);
    if (historyRes.ok) {
      expect(historyRes.value.length).toBe(2);
      expect(historyRes.value[0]?.hash).toBe(c2Hash);
      expect(historyRes.value[0]?.message).toBe('Second commit');
      expect(historyRes.value[1]?.hash).toBe(c1Hash);
      expect(historyRes.value[1]?.message).toBe('First commit');
    }

    // Verify rollback
    const rollbackRes = await executeProcessGitRollback(gitDir, c1Hash);
    expect(rollbackRes.ok).toBe(true);
    const headAfterRollback = execSync('git rev-parse HEAD', {
      cwd: gitDir,
      encoding: 'utf8',
    }).trim();
    expect(headAfterRollback).toBe(c1Hash);

    // Verify injection protection
    const injectionRes = await executeProcessGitRollback(gitDir, 'invalid-hash; rm -rf /');
    expect(injectionRes.ok).toBe(false);
  });
});
