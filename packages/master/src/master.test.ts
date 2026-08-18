import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateEd25519KeyPair, signData } from '@pm2-cluster/shared';
import {
  createMasterDatabase,
  createUsersRepo,
  createNodesRepo,
  createAuditRepo,
  createSessionsRepo,
  createSettingsRepo,
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

describe('Master Backend & Persistent Storage Integration', () => {
  let tempDir: string;
  let dbPath: string;
  let masterDb: ReturnType<typeof createMasterDatabase>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-master-test-'));
    dbPath = path.join(tempDir, 'master.db');
    masterDb = createMasterDatabase({ dbPath });
  });

  afterEach(() => {
    masterDb.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs migrations and sets up tables and default roles', () => {
    const migrationRes = masterDb.runMigrations();
    expect(migrationRes.ok).toBe(true);
    if (migrationRes.ok) {
      expect(migrationRes.value).toBeGreaterThanOrEqual(0);
    }

    const countRoles = masterDb.db.prepare('SELECT COUNT(*) as count FROM roles').get() as {
      count: number;
    };
    expect(countRoles.count).toBe(3); // admin, operator, viewer
  });

  it('creates and authenticates users with Argon2id and JWT', async () => {
    masterDb.runMigrations();
    const usersRepo = createUsersRepo({ db: masterDb.db });
    const sessionsRepo = createSessionsRepo({ db: masterDb.db });
    const auditRepo = createAuditRepo({ db: masterDb.db });
    const recoveryCodesRepo = createRecoveryCodesRepo({ db: masterDb.db });
    const apiTokensRepo = createApiTokensRepo({ db: masterDb.db });
    const masterKeyPair = generateEd25519KeyPair();
    const jwtSecret = 'super-secret-jwt-key-for-test-123456789';

    const securityAuditService = createSecurityAuditService({ auditRepo });
    const lockoutService = createLockoutService({ usersRepo });
    const twoFactorService = createTwoFactorService({
      usersRepo,
      recoveryCodesRepo,
      encryptionKey: jwtSecret,
    });
    const sessionService = createSessionService({ sessionsRepo, jwtSecret });
    const _apiTokenService = createApiTokenService({
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

    const adminRes = await authService.ensureInitialAdmin({
      username: 'admin',
      email: 'admin@test.local',
      password: 'mypassword123',
    });
    expect(adminRes.ok).toBe(true);

    // Login with valid credentials
    const loginRes = await authService.login('admin', 'mypassword123', '127.0.0.1');
    expect(loginRes.ok).toBe(true);
    if (loginRes.ok && !loginRes.value.requires2FA) {
      expect(loginRes.value.user.username).toBe('admin');
      expect(loginRes.value.accessToken).toBeDefined();
      expect(loginRes.value.refreshToken).toBeDefined();

      // Verify token
      const verifyRes = authService.verifyAccessToken(loginRes.value.accessToken);
      expect(verifyRes.ok).toBe(true);
      if (verifyRes.ok) {
        expect(verifyRes.value.username).toBe('admin');
        expect(verifyRes.value.roleName).toBe('admin');
      }

      // Test refresh
      const refreshRes = await authService.refresh(loginRes.value.refreshToken, '127.0.0.1');
      expect(refreshRes.ok).toBe(true);
    }

    // Login with invalid credentials
    const invalidLogin = await authService.login('admin', 'wrongpass', '127.0.0.1');
    expect(invalidLogin.ok).toBe(false);
  });

  it('handles cryptographic agent enrollment challenge-response and admin approval', async () => {
    masterDb.runMigrations();
    const nodesRepo = createNodesRepo({ db: masterDb.db });
    const auditRepo = createAuditRepo({ db: masterDb.db });
    const masterKeyPair = generateEd25519KeyPair();

    const registry = createNodeRegistry({
      nodesRepo,
      auditRepo,
      masterKeyPair,
    });

    const agentKeyPair = generateEd25519KeyPair();
    const agentId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

    // 1. Agent initiates handshake
    const handshakeInitRes = registry.initiateHandshake({
      agentId,
      publicKey: agentKeyPair.publicKey,
      hostname: 'remote-worker-1',
      version: '1.0.0',
      port: 4321,
    });
    expect(handshakeInitRes.ok).toBe(true);

    if (handshakeInitRes.ok) {
      const { challenge } = handshakeInitRes.value;
      const timestamp = Date.now();
      const payloadToSign = `${challenge}:${timestamp}`;
      const signRes = signData(payloadToSign, agentKeyPair.privateKey);
      expect(signRes.ok).toBe(true);

      if (signRes.ok) {
        // 2. Agent responds with challenge signature
        const verifyAckRes = registry.verifyHandshakeResponse({
          agentId,
          signature: signRes.value,
          timestamp,
        });

        expect(verifyAckRes.ok).toBe(true);
        if (verifyAckRes.ok) {
          expect(verifyAckRes.value.status).toBe('pending');
        }

        // 3. Admin approves node
        const approveRes = registry.approveNode(agentId, 'user-admin-1', '127.0.0.1');
        expect(approveRes.ok).toBe(true);

        const node = registry.getNode(agentId);
        expect(node.ok && node.value?.status).toBe('online');

        // 4. Verify audit log entry
        const auditLogs = auditRepo.list({ nodeId: agentId });
        expect(auditLogs.ok).toBe(true);
        if (auditLogs.ok) {
          expect(auditLogs.value.total).toBe(1);
          expect(auditLogs.value.logs[0]?.action).toBe('node:approve');
        }
      }
    }
  });

  it('persists and retrieves global settings', () => {
    masterDb.runMigrations();
    const settingsRepo = createSettingsRepo({ db: masterDb.db });

    const initial = settingsRepo.getGlobalSettings();
    expect(initial.ok).toBe(true);
    if (initial.ok) {
      expect(initial.value.logRetentionDays).toBe(7);
    }

    const updateRes = settingsRepo.updateGlobalSettings({
      logRetentionDays: 14,
      logCompressionThresholdMb: 20,
    });
    expect(updateRes.ok).toBe(true);
    if (updateRes.ok) {
      expect(updateRes.value.logRetentionDays).toBe(14);
      expect(updateRes.value.logCompressionThresholdMb).toBe(20);
    }
  });

  it('auto-enrolls worker node immediately when valid joinToken is provided', async () => {
    masterDb.runMigrations();
    const nodesRepo = createNodesRepo({ db: masterDb.db });
    const auditRepo = createAuditRepo({ db: masterDb.db });
    const masterKeyPair = generateEd25519KeyPair();
    const clusterSecretToken = 'cluster-super-secret-join-token-123';

    const registry = createNodeRegistry({
      nodesRepo,
      auditRepo,
      masterKeyPair,
      joinToken: clusterSecretToken,
    });

    const agentKeyPair = generateEd25519KeyPair();
    const agentId = '11111111-2222-3333-4444-555555555555';

    // 1. Agent initiates handshake with valid joinToken
    const handshakeInitRes = registry.initiateHandshake({
      agentId,
      publicKey: agentKeyPair.publicKey,
      hostname: 'auto-enrolled-worker',
      version: '1.0.0',
      port: 4321,
      joinToken: clusterSecretToken,
    });
    expect(handshakeInitRes.ok).toBe(true);

    if (handshakeInitRes.ok) {
      const { challenge } = handshakeInitRes.value;
      const timestamp = Date.now();
      const payloadToSign = `${challenge}:${timestamp}`;
      const signRes = signData(payloadToSign, agentKeyPair.privateKey);
      expect(signRes.ok).toBe(true);

      if (signRes.ok) {
        // 2. Agent responds with challenge signature
        const verifyAckRes = registry.verifyHandshakeResponse({
          agentId,
          signature: signRes.value,
          timestamp,
        });

        expect(verifyAckRes.ok).toBe(true);
        if (verifyAckRes.ok) {
          // Immediately online, no manual approval needed!
          expect(verifyAckRes.value.status).toBe('online');
        }

        const node = registry.getNode(agentId);
        expect(node.ok && node.value?.status).toBe('online');

        // Verify audit log shows auto-enroll
        const auditLogs = auditRepo.list({ nodeId: agentId });
        expect(auditLogs.ok).toBe(true);
        if (auditLogs.ok) {
          expect(auditLogs.value.total).toBe(1);
          expect(auditLogs.value.logs[0]?.action).toBe('node:auto_enroll');
        }
      }
    }
  });
});
