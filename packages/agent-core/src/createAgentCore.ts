import http from 'node:http';
import crypto from 'node:crypto';
import { Result, ok, generateEd25519KeyPair, CrashEvent, ErrorTraceItem } from '@pm2-webui/shared';
import { loadAgentConfig, AgentConfig } from './config/index.js';
import {
  createAgentDatabase,
  createAgentMetaRepo,
  createAgentMetricsRepo,
  createAgentLogsRepo,
  createAgentCrashRepo,
  createAgentErrorTraceRepo,
  createRetentionCleaner,
  AgentMetricsRepo,
  AgentCrashRepo,
  AgentErrorTraceRepo,
} from './db/index.js';
import { createPm2Manager, Pm2Manager } from './pm2/index.js';
import { createPm2Listener } from './pm2/listener.js';
import { createLogEngine, LogEngine } from './logging/index.js';
import { createErrorTraceExtractor, ErrorTraceExtractor } from './logging/errorTraceExtractor.js';
import { createMetricsCollector, MetricsCollector } from './metrics/index.js';
import { createDeployEngine, DeployEngine } from './deploy/index.js';
import { createMasterWsClient, MasterWsClient } from './transport/masterWsClient.js';
import { createAgentWsServer, AgentWsServer } from './transport/agentWsServer.js';

export interface AgentCoreDeps {
  readonly config?: Partial<AgentConfig>;
  readonly httpServer?: http.Server;
  readonly onProcessCrash?: (crash: CrashEvent) => void;
  readonly onErrorTrace?: (trace: ErrorTraceItem) => void;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly warn: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface AgentCore {
  readonly agentId: string;
  readonly config: AgentConfig;
  readonly pm2Manager: Pm2Manager;
  readonly logEngine: LogEngine;
  readonly deployEngine: DeployEngine;
  readonly metricsCollector: MetricsCollector;
  readonly metricsRepo: AgentMetricsRepo;
  readonly crashRepo: AgentCrashRepo;
  readonly errorTraceRepo: AgentErrorTraceRepo;
  readonly start: () => Promise<Result<void>>;
  readonly stop: () => void;
}

export const createAgentCore = (deps: AgentCoreDeps = {}): AgentCore => {
  const config = loadAgentConfig(deps.config);
  const { logger, httpServer } = deps;

  // 1. Initialize SQLite Database
  const agentDb = createAgentDatabase({ dbPath: config.dbPath, logger });
  const migrationRes = agentDb.runMigrations();
  if (!migrationRes.ok) {
    logger?.error('Failed to run Agent migrations', migrationRes.error);
  }

  // 2. Repositories
  const agentMetaRepo = createAgentMetaRepo({ db: agentDb.db });
  const metricsRepo = createAgentMetricsRepo({ db: agentDb.db });
  const logsRepo = createAgentLogsRepo({ db: agentDb.db });
  const crashRepo = createAgentCrashRepo({ db: agentDb.db });
  const errorTraceRepo = createAgentErrorTraceRepo({ db: agentDb.db });

  // 3. Ensure Agent ID and Ed25519 KeyPair
  let agentId = config.agentId;
  if (!agentId) {
    const existingIdRes = agentMetaRepo.getAgentId();
    if (existingIdRes.ok && existingIdRes.value) {
      agentId = existingIdRes.value;
    } else {
      agentId = crypto.randomUUID();
      agentMetaRepo.saveAgentId(agentId);
    }
  }

  let keyPairRes = agentMetaRepo.getKeyPair();
  if (!keyPairRes.ok || !keyPairRes.value) {
    logger?.info('Generating new Ed25519 keypair for Agent');
    const newKeyPair = generateEd25519KeyPair();
    agentMetaRepo.saveKeyPair(newKeyPair);
  }

  // 4. PM2 Manager & Listener
  const pm2Manager = createPm2Manager({ logger });
  const logEngine = createLogEngine({
    logsRepo,
    crashRepo,
    logDir: config.logDir,
    logger,
  });

  let wsServer: AgentWsServer | null = null;
  if (httpServer) {
    wsServer = createAgentWsServer({
      server: httpServer,
      agentMetaRepo,
      agentId,
      logger,
    });
  }

  let masterWsClient: MasterWsClient | null = null;

  const errorTraceExtractor = createErrorTraceExtractor({
    errorTraceRepo,
    onErrorTrace: (trace) => {
      masterWsClient?.sendErrorTrace(trace);
      deps.onErrorTrace?.(trace);
    },
    logger,
  });

  const pm2Listener = createPm2Listener({
    onLogLine: (line) => {
      logEngine.ingestLogLine(line);
      errorTraceExtractor.processLogLine(line, () =>
        pm2Listener.getRecentLogsForProcess(line.processName, 10),
      );
      wsServer?.broadcastLogLine(line);
    },
    onProcessCrash: (crash) => {
      logger?.warn(`PM2 Process crash detected: ${crash.processName} (PM_ID: ${crash.pmId})`);
      crashRepo.insert(crash);
      masterWsClient?.sendCrashEvent(crash);
      deps.onProcessCrash?.(crash);
    },
    logger,
  });

  // 5. Metrics Collector
  const metricsCollector = createMetricsCollector({
    metricsRepo,
    pm2Manager,
    intervalMs: config.metricsIntervalMs,
    onMetricFrame: (frame) => {
      masterWsClient?.sendMetrics(frame);
      wsServer?.broadcastMetrics(frame);
    },
    logger,
  });

  // 6. Master WS Client
  if (config.masterWsUrl) {
    masterWsClient = createMasterWsClient({
      masterWsUrl: config.masterWsUrl,
      agentId,
      hostname: config.hostname,
      port: config.port,
      joinToken: config.joinToken,
      agentMetaRepo,
      pm2Manager,
      logEngine,
      metricsCollector,
      metricsRepo,
      errorTraceRepo,
      crashRepo,
      logger,
    });
  }

  // 7. Retention Cleaner
  const retentionCleaner = createRetentionCleaner({
    metricsRepo,
    logsRepo,
    crashRepo,
    logRetentionDays: config.logRetentionDays,
    metricsRetentionDays: config.metricsRetentionDays,
    logger,
  });

  let stopCleanupSchedule: (() => void) | null = null;

  const start = async (): Promise<Result<void>> => {
    logger?.info(`Starting AgentCore [ID: ${agentId}, Host: ${config.hostname}]`);

    // Connect PM2
    const pm2Res = await pm2Manager.connect();
    if (!pm2Res.ok) {
      logger?.warn('PM2 Daemon is not currently active. Commands will retry upon launch.');
    }

    // Start PM2 Listener
    await pm2Listener.start();

    // Start Log Engine
    logEngine.start();

    // Start Metrics Collector
    metricsCollector.start();

    // Start Scheduled Retention Cleanup
    stopCleanupSchedule = retentionCleaner.startScheduled();

    // Connect to Master WS
    if (masterWsClient) {
      masterWsClient.connect();
    }

    return ok(undefined);
  };

  const stop = (): void => {
    logger?.info(`Stopping AgentCore [ID: ${agentId}]`);
    if (stopCleanupSchedule) {
      stopCleanupSchedule();
      stopCleanupSchedule = null;
    }
    errorTraceExtractor.flushPending();
    masterWsClient?.disconnect();
    metricsCollector.stop();
    logEngine.stop();
    pm2Listener.stop();
    pm2Manager.disconnect();
    wsServer?.close();
    agentDb.close();
  };

  const deployEngine = createDeployEngine({
    appsRootPath: config.appsDir,
    pm2Manager,
    logger,
  });

  return {
    agentId,
    config,
    pm2Manager,
    logEngine,
    deployEngine,
    metricsCollector,
    metricsRepo,
    crashRepo,
    errorTraceRepo,
    start,
    stop,
  };
};
