import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateEd25519KeyPair } from '@pm2-webui/shared';
import { createAgentCore } from '@pm2-webui/agent-core';
import {
  createMasterDatabase,
  createUsersRepo,
  createNodesRepo,
  createAuditRepo,
  createSettingsRepo,
  createSessionsRepo,
  createGitAppsRepo,
  createDeploymentsRepo,
  createRecoveryCodesRepo,
  createApiTokensRepo,
} from './db/index.js';
import {
  createAuthService,
  createTwoFactorService,
  createSessionService,
  createApiTokenService,
  createLockoutService,
  createSecurityAuditService,
} from './security/index.js';
import { createNodeRegistry } from './registry/index.js';
import { createRelayProxyEngine } from './relay/index.js';
import { createMasterServer, MasterServer } from './server.js';

describe('Master REST API & Server Integration', () => {
  let tempDir: string;
  let masterDb: ReturnType<typeof createMasterDatabase>;
  let server: MasterServer;
  let localAgentCore: ReturnType<typeof createAgentCore>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-server-test-'));
    const dbPath = path.join(tempDir, 'master.db');
    masterDb = createMasterDatabase({ dbPath });
    masterDb.runMigrations();

    const usersRepo = createUsersRepo({ db: masterDb.db });
    const nodesRepo = createNodesRepo({ db: masterDb.db });
    const auditRepo = createAuditRepo({ db: masterDb.db });
    const settingsRepo = createSettingsRepo({ db: masterDb.db });
    const sessionsRepo = createSessionsRepo({ db: masterDb.db });
    const gitAppsRepo = createGitAppsRepo({ db: masterDb.db });
    const deploymentsRepo = createDeploymentsRepo({ db: masterDb.db });
    const recoveryCodesRepo = createRecoveryCodesRepo({ db: masterDb.db });
    const apiTokensRepo = createApiTokensRepo({ db: masterDb.db });
    const masterKeyPair = generateEd25519KeyPair();
    const jwtSecret = 'test-jwt-secret-key-12345678901234';

    const securityAuditService = createSecurityAuditService({ auditRepo });
    const lockoutService = createLockoutService({ usersRepo });
    const twoFactorService = createTwoFactorService({
      usersRepo,
      recoveryCodesRepo,
      encryptionKey: jwtSecret,
    });
    const sessionService = createSessionService({ sessionsRepo, jwtSecret });
    const apiTokenService = createApiTokenService({
      apiTokensRepo,
      usersRepo,
      tokenSecret: jwtSecret,
    });

    const authService = createAuthService({
      usersRepo,
      lockoutService,
      twoFactorService,
      sessionService,
      securityAuditService,
      masterKeyPair,
      jwtSecret,
    });

    await authService.ensureInitialAdmin({
      username: 'admin',
      email: 'admin@test.local',
      password: 'adminpassword123',
    });

    const nodeRegistry = createNodeRegistry({
      nodesRepo,
      auditRepo,
      masterKeyPair,
    });

    const relayProxy = createRelayProxyEngine({
      nodeRegistry,
    });

    localAgentCore = createAgentCore({
      config: {
        dbPath: path.join(tempDir, 'agent.db'),
        logDir: path.join(tempDir, 'logs'),
      },
    });

    nodesRepo.create({
      id: localAgentCore.agentId,
      hostname: 'master-test-node',
      ipAddress: '127.0.0.1',
      port: 3005,
      publicKey: masterKeyPair.publicKey,
      connectivityMode: 'direct',
      status: 'online',
      version: '1.0.0',
      enrolledAt: Date.now(),
      lastSeenAt: Date.now(),
    });

    server = await createMasterServer({
      port: 0,
      authService,
      twoFactorService,
      sessionService,
      apiTokenService,
      lockoutService,
      securityAuditService,
      usersRepo,
      nodeRegistry,
      relayProxy,
      auditRepo,
      settingsRepo,
      gitAppsRepo,
      deploymentsRepo,
      localAgentCore,
    });
  });

  afterEach(async () => {
    await server.stop();
    localAgentCore.stop();
    masterDb.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('authenticates admin and allows querying protected endpoints', async () => {
    // 1. Login
    const loginRes = await server.fastify.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'admin',
        password: 'adminpassword123',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const loginBody = JSON.parse(loginRes.body);
    expect(loginBody.accessToken).toBeDefined();
    const token = loginBody.accessToken;

    // 2. Fetch /api/v1/nodes
    const nodesRes = await server.fastify.inject({
      method: 'GET',
      url: '/api/v1/nodes',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(nodesRes.statusCode).toBe(200);
    const nodes = JSON.parse(nodesRes.body);
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBe(1);
    expect(nodes[0].hostname).toBe('master-test-node');

    // 3. Create a Git App
    const createAppRes = await server.fastify.inject({
      method: 'POST',
      url: '/api/v1/deploy/apps',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: {
        name: 'web-service',
        nodeId: localAgentCore.agentId,
        repoUrl: 'https://github.com/org/web-service.git',
        branch: 'main',
        startScript: 'dist/index.js',
        instances: 2,
        autoDeploy: true,
      },
    });

    expect(createAppRes.statusCode).toBe(201);
    const appBody = JSON.parse(createAppRes.body);
    expect(appBody.id).toBeDefined();
    expect(appBody.name).toBe('web-service');
    expect(appBody.webhookSecret).toBeDefined();

    // 4. Query /api/v1/deploy/apps
    const listAppsRes = await server.fastify.inject({
      method: 'GET',
      url: '/api/v1/deploy/apps',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(listAppsRes.statusCode).toBe(200);
    const apps = JSON.parse(listAppsRes.body);
    expect(apps.length).toBe(1);
    expect(apps[0].name).toBe('web-service');

    // 5. Query Audit Logs
    const auditRes = await server.fastify.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(auditRes.statusCode).toBe(200);
    const auditBody = JSON.parse(auditRes.body);
    expect(auditBody.total).toBeGreaterThan(0);
  });

  it('handles 2FA setup, enable, status, and empty JSON payload without error', async () => {
    // 1. Login to get JWT access token
    const loginRes = await server.fastify.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'admin',
        password: 'adminpassword123',
      },
    });
    const token = JSON.parse(loginRes.body).accessToken;

    // 2. Setup 2FA (verifying empty body with application/json header succeeds)
    const setupRes = await server.fastify.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/setup',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    expect(setupRes.statusCode).toBe(200);
    const setupBody = JSON.parse(setupRes.body);
    expect(setupBody.secret).toBeDefined();
    expect(setupBody.otpauthUri).toContain('otpauth://totp/');
    expect(setupBody.recoveryCodes).toHaveLength(8);

    // 3. Enable 2FA with generated TOTP code
    const { generateTotpCode } = await import('@pm2-webui/shared');
    const validCode = generateTotpCode(setupBody.secret);

    const enableRes = await server.fastify.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/enable',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: {
        secret: setupBody.secret,
        code: `${validCode.slice(0, 3)} ${validCode.slice(3)}`, // formatted with space
        recoveryCodes: setupBody.recoveryCodes,
      },
    });

    expect(enableRes.statusCode).toBe(200);

    // 4. Query 2FA status
    const statusRes = await server.fastify.inject({
      method: 'GET',
      url: '/api/v1/auth/2fa/status',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(statusRes.statusCode).toBe(200);
    const statusBody = JSON.parse(statusRes.body);
    expect(statusBody.enabled).toBe(true);
    expect(statusBody.hasRecoveryCodes).toBe(true);
  });

  it('rejects unauthorized requests on protected endpoints', async () => {
    const res = await server.fastify.inject({
      method: 'GET',
      url: '/api/v1/nodes',
    });
    expect(res.statusCode).toBe(401);
  });
});
