import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
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
import { createMasterServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const startMasterNode = async () => {
  const masterDataDir =
    process.env.MASTER_DATA_DIR || path.join(os.homedir(), '.pm2-webui', 'master');
  const masterDbPath = path.join(masterDataDir, 'master.db');
  const port = Number(process.env.PORT || 3005);
  const jwtSecret = process.env.JWT_SECRET || 'pm2-cluster-jwt-super-secret-key-32-chars';

  console.log('🚀 Initializing PM2 Web UI Master...');

  // 1. Initialize Master SQLite DB & Migrations
  const masterDb = createMasterDatabase({ dbPath: masterDbPath, logger: console });
  const migrationRes = masterDb.runMigrations();
  if (!migrationRes.ok) {
    console.error('Failed to run Master migrations:', migrationRes.error);
  }

  // 2. Repositories
  const usersRepo = createUsersRepo({ db: masterDb.db });
  const nodesRepo = createNodesRepo({ db: masterDb.db });
  const auditRepo = createAuditRepo({ db: masterDb.db });
  const settingsRepo = createSettingsRepo({ db: masterDb.db });
  const sessionsRepo = createSessionsRepo({ db: masterDb.db });
  const gitAppsRepo = createGitAppsRepo({ db: masterDb.db });
  const deploymentsRepo = createDeploymentsRepo({ db: masterDb.db });
  const recoveryCodesRepo = createRecoveryCodesRepo({ db: masterDb.db });
  const apiTokensRepo = createApiTokensRepo({ db: masterDb.db });

  // 3. Master Key Pair
  const masterKeyPair = generateEd25519KeyPair();

  // 4. Modular Security Services
  const securityAuditService = createSecurityAuditService({
    auditRepo,
    logger: console,
  });

  const lockoutService = createLockoutService({
    usersRepo,
    maxAttempts: 5,
    lockoutDurationMs: 15 * 60 * 1000,
  });

  const twoFactorService = createTwoFactorService({
    usersRepo,
    recoveryCodesRepo,
    encryptionKey: jwtSecret,
  });

  const sessionService = createSessionService({
    sessionsRepo,
    jwtSecret,
  });

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
    logger: console,
  });

  await authService.ensureInitialAdmin({
    username: process.env.ADMIN_USER || 'admin',
    email: process.env.ADMIN_EMAIL || 'admin@pm2-cluster.local',
    password: process.env.ADMIN_PASSWORD || 'adminpassword123',
  });

  // 5. Node Registry & Relay Proxy
  const nodeRegistry = createNodeRegistry({
    nodesRepo,
    auditRepo,
    masterKeyPair,
    joinToken: process.env.CLUSTER_JOIN_TOKEN || process.env.JOIN_TOKEN,
    logger: console,
  });

  const relayProxy = createRelayProxyEngine({
    nodeRegistry,
    logger: console,
  });

  // 6. Initialize local AgentCore (Master is also an Agent)
  const localAgentCore = createAgentCore({
    config: {
      hostname: 'master-node',
      port: port,
      dbPath: path.join(masterDataDir, 'agent.db'),
      logDir: path.join(masterDataDir, 'logs'),
    },
    logger: console,
  });

  await localAgentCore.start();

  // Register master itself as an approved online node in registry
  nodesRepo.create({
    id: localAgentCore.agentId,
    hostname: os.hostname(),
    ipAddress: '127.0.0.1',
    port,
    publicKey: masterKeyPair.publicKey,
    connectivityMode: 'direct',
    status: 'online',
    version: '1.0.0',
    enrolledAt: Date.now(),
    lastSeenAt: Date.now(),
  });

  // 7. Start Fastify Server
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  const server = await createMasterServer({
    port,
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
    webDistPath,
  });

  const address = await server.start();
  console.log(`✅ Master Server listening at ${address}`);

  // Graceful Shutdown
  const shutdown = async () => {
    console.log('🛑 Shutting down Master Server...');
    await server.stop();
    localAgentCore.stop();
    masterDb.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return {
    server,
    localAgentCore,
    masterDb,
    authService,
    twoFactorService,
    sessionService,
    apiTokenService,
    lockoutService,
    securityAuditService,
    nodeRegistry,
    relayProxy,
  };
};

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startMasterNode().catch((err) => {
    console.error('Fatal error starting Master:', err);
    process.exit(1);
  });
}
