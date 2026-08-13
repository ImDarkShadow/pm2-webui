import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createAgentDatabase,
  createAgentMetaRepo,
  createAgentMetricsRepo,
  createAgentLogsRepo,
  createAgentCrashRepo,
  createRetentionCleaner,
} from './db/index.js';
import { createLogEngine } from './logging/index.js';
import { createPm2Manager } from './pm2/index.js';
import { createAgentCore } from './createAgentCore.js';
import { generateEd25519KeyPair, LogLine } from '@pm2-cluster/shared';

describe('Agent Core Backend Integration', () => {
  let tempDir: string;
  let dbPath: string;
  let logDir: string;
  let agentDb: ReturnType<typeof createAgentDatabase>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-agent-test-'));
    dbPath = path.join(tempDir, 'agent.db');
    logDir = path.join(tempDir, 'logs');
    agentDb = createAgentDatabase({ dbPath });
  });

  afterEach(() => {
    agentDb.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs migrations and saves/retrieves agent metadata and keypairs', () => {
    const migRes = agentDb.runMigrations();
    expect(migRes.ok).toBe(true);

    const metaRepo = createAgentMetaRepo({ db: agentDb.db });
    const keyPair = generateEd25519KeyPair();

    const saveRes = metaRepo.saveKeyPair(keyPair);
    expect(saveRes.ok).toBe(true);

    const loadedRes = metaRepo.getKeyPair();
    expect(loadedRes.ok).toBe(true);
    if (loadedRes.ok) {
      expect(loadedRes.value?.publicKey).toBe(keyPair.publicKey);
      expect(loadedRes.value?.privateKey).toBe(keyPair.privateKey);
    }
  });

  it('ingests logs, generates multi-resolution buckets and performs search', async () => {
    agentDb.runMigrations();
    const logsRepo = createAgentLogsRepo({ db: agentDb.db });
    const crashRepo = createAgentCrashRepo({ db: agentDb.db });

    const logEngine = createLogEngine({
      logsRepo,
      crashRepo,
      logDir,
    });

    const baseTime = Math.floor(Date.now() / 1000) * 1000;
    const lines: LogLine[] = [
      {
        timestamp: baseTime + 10,
        processName: 'api',
        stream: 'stdout',
        message: 'Application started on port 3000',
        lineIndex: 1,
      },
      {
        timestamp: baseTime + 50,
        processName: 'api',
        stream: 'stderr',
        message: 'ERROR: Database connection timeout',
        lineIndex: 2,
      },
      {
        timestamp: baseTime + 100,
        processName: 'api',
        stream: 'stdout',
        message: 'WARN: High latency detected',
        lineIndex: 3,
      },
    ];

    for (const line of lines) {
      logEngine.ingestLogLine(line);
    }

    // Query raw logs with search
    const searchRes = logEngine.queryRawLogs({
      processName: 'api',
      search: 'Database',
    });
    expect(searchRes.ok).toBe(true);
    if (searchRes.ok) {
      expect(searchRes.value.total).toBe(1);
      expect(searchRes.value.lines[0]?.message).toContain('Database connection timeout');
    }

    // Flush and query hierarchical summaries
    await logEngine.flush();

    const summariesRes = logEngine.querySummaries('api', '1s', baseTime - 1000, baseTime + 1000);
    expect(summariesRes.ok).toBe(true);
    if (summariesRes.ok) {
      expect(summariesRes.value.length).toBeGreaterThan(0);
      const bucket = summariesRes.value[0];
      expect(bucket?.lineCount).toBe(3);
      expect(bucket?.errorCount).toBe(1);
      expect(bucket?.warnCount).toBe(1);
    }
  });

  it('queues PM2 tasks and prevents concurrent call hazards', async () => {
    let activeCalls = 0;
    let maxSimultaneousCalls = 0;

    const mockPm2: any = {
      connect: (cb: any) => cb(null),
      disconnect: () => {},
      list: (cb: any) => {
        activeCalls++;
        maxSimultaneousCalls = Math.max(maxSimultaneousCalls, activeCalls);
        setTimeout(() => {
          activeCalls--;
          cb(null, [{ name: 'web-worker', pm2_env: { status: 'online', pm_id: 1 } }]);
        }, 10);
      },
    };

    const pm2Manager = createPm2Manager({
      pm2Instance: mockPm2,
      timeoutMs: 5000,
    });

    // Fire 10 simultaneous list calls
    const promises = Array.from({ length: 10 }).map(() => pm2Manager.listProcesses('normal'));
    const results = await Promise.all(promises);

    expect(results.every((r) => r.ok)).toBe(true);
    // Serialized queue ensures at most 1 active call to PM2 daemon
    expect(maxSimultaneousCalls).toBe(1);
  });

  it('purges expired metrics and logs during retention cleanup', () => {
    agentDb.runMigrations();
    const metricsRepo = createAgentMetricsRepo({ db: agentDb.db });
    const logsRepo = createAgentLogsRepo({ db: agentDb.db });
    const crashRepo = createAgentCrashRepo({ db: agentDb.db });

    const now = Date.now();
    const oldTimestamp = now - 40 * 24 * 60 * 60 * 1000; // 40 days ago

    metricsRepo.insert({
      timestamp: oldTimestamp,
      cpuUsage: 20,
      memoryUsed: 1000,
      memoryFree: 1000,
      swapUsed: 0,
      diskUsed: 1000,
      networkRx: 0,
      networkTx: 0,
      load1m: 0.5,
    });

    const cleaner = createRetentionCleaner({
      metricsRepo,
      logsRepo,
      crashRepo,
      metricsRetentionDays: 30,
      logRetentionDays: 7,
    });

    const cleanRes = cleaner.runCleanup();
    expect(cleanRes.ok).toBe(true);
    if (cleanRes.ok) {
      expect(cleanRes.value.metricsPurged).toBe(1);
    }
  });

  it('starts and stops AgentCore cleanly', async () => {
    const agentCore = createAgentCore({
      config: {
        dbPath: path.join(tempDir, 'core-agent.db'),
        logDir: path.join(tempDir, 'core-logs'),
      },
    });

    const startRes = await agentCore.start();
    expect(startRes.ok).toBe(true);
    expect(agentCore.agentId).toBeDefined();

    agentCore.stop();
  });
});
