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
});
