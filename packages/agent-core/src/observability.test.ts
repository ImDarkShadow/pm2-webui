import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { LogLine } from '@pm2-webui/shared';
import { createAgentErrorTraceRepo } from './db/repos/agentErrorTraceRepo.js';
import { createAgentMetricsRepo } from './db/repos/agentMetricsRepo.js';
import { createErrorTraceExtractor } from './logging/errorTraceExtractor.js';
import { AGENT_INIT_SQL } from './db/index.js';

describe('Error Tracing Repository & Fingerprinting', () => {
  const db = new Database(':memory:');
  db.exec(AGENT_INIT_SQL);
  const errorTraceRepo = createAgentErrorTraceRepo({ db });

  it('groups duplicate errors under the same fingerprint and increments occurrenceCount', () => {
    const contextLogs: LogLine[] = [
      {
        processName: 'auth-service',
        timestamp: 999990,
        stream: 'stdout',
        message: 'Fetching user 123',
        lineIndex: 1,
      },
    ];

    const errorData = {
      processName: 'auth-service',
      pmId: 0,
      errorName: 'TypeError',
      message: 'Cannot read properties of null (reading id)',
      stackTrace: 'TypeError: Cannot read properties of null (reading id)\n    at getUser (/app/user.js:42:15)',
      timestamp: 1000000,
      contextLogs,
    };

    const first = errorTraceRepo.ingest(errorData);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.value.occurrenceCount).toBe(1);
    expect(first.value.id).toBeDefined();

    // Ingest the same error again
    const second = errorTraceRepo.ingest({
      ...errorData,
      timestamp: 1005000,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Must update the existing row rather than create a duplicate
    expect(second.value.id).toBe(first.value.id);
    expect(second.value.occurrenceCount).toBe(2);
    expect(second.value.lastSeenAt).toBe(1005000);

    const list = errorTraceRepo.list();
    expect(list.ok).toBe(true);
    if (list.ok && list.value[0]) {
      expect(list.value.length).toBe(1);
      expect(list.value[0].occurrenceCount).toBe(2);
    }
  });

  it('resolves an error trace and filters by resolved status', () => {
    const listBefore = errorTraceRepo.list({ status: 'unresolved' });
    expect(listBefore.ok).toBe(true);
    if (!listBefore.ok || !listBefore.value[0]) return;
    expect(listBefore.value.length).toBe(1);

    const traceId = listBefore.value[0].id;
    const resolveRes = errorTraceRepo.resolve(traceId);
    expect(resolveRes.ok).toBe(true);

    const listUnresolved = errorTraceRepo.list({ status: 'unresolved' });
    expect(listUnresolved.ok && listUnresolved.value.length).toBe(0);

    const listResolved = errorTraceRepo.list({ status: 'resolved' });
    expect(listResolved.ok && listResolved.value.length).toBe(1);
  });
});

describe('Stack Trace Extractor & Parsing', () => {
  const db = new Database(':memory:');
  db.exec(AGENT_INIT_SQL);
  const errorTraceRepo = createAgentErrorTraceRepo({ db });

  it('extracts multi-line Node.js stack traces and invokes callback with context', () => {
    let capturedTrace: any = null;
    const extractor = createErrorTraceExtractor({
      errorTraceRepo,
      onErrorTrace: (trace) => {
        capturedTrace = trace;
      },
    });

    const mockContext: LogLine[] = [
      { processName: 'web-api', timestamp: 1000, stream: 'stdout', message: 'Server listening on :3000', lineIndex: 1 },
      { processName: 'web-api', timestamp: 1010, stream: 'stdout', message: 'POST /api/login', lineIndex: 2 },
    ];

    // Simulate multi-line exception log output from PM2 stderr
    extractor.processLogLine(
      {
        processName: 'web-api',
        stream: 'stderr',
        message: 'ReferenceError: secretKey is not defined',
        timestamp: 1020,
        lineIndex: 3,
      },
      () => mockContext,
    );

    extractor.processLogLine(
      {
        processName: 'web-api',
        stream: 'stderr',
        message: '    at AuthController.login (/app/auth.js:18:11)',
        timestamp: 1021,
        lineIndex: 4,
      },
      () => mockContext,
    );

    extractor.processLogLine(
      {
        processName: 'web-api',
        stream: 'stderr',
        message: '    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)',
        timestamp: 1022,
        lineIndex: 5,
      },
      () => mockContext,
    );

    // Normal log line flush triggers stack trace completion
    extractor.processLogLine(
      {
        processName: 'web-api',
        stream: 'stdout',
        message: 'Resuming requests...',
        timestamp: 1030,
        lineIndex: 6,
      },
      () => mockContext,
    );

    expect(capturedTrace).not.toBeNull();
    expect(capturedTrace.processName).toBe('web-api');
    expect(capturedTrace.errorName).toBe('ReferenceError');
    expect(capturedTrace.message).toBe('secretKey is not defined');
    expect(capturedTrace.stackTrace).toContain('at AuthController.login');
    expect(capturedTrace.contextLogs.length).toBe(2);
  });
});

describe('Database Metrics Downsampling (GROUP BY bucketMs)', () => {
  const db = new Database(':memory:');
  db.exec(AGENT_INIT_SQL);
  const metricsRepo = createAgentMetricsRepo({ db });

  it('aggregates and downsamples 1-minute metrics into discrete buckets for long ranges', () => {
    const baseTime = 1700000000000;
    const oneMin = 60 * 1000;

    // Insert 60 1-minute samples (1 hour of data)
    for (let i = 0; i < 60; i++) {
      const res = metricsRepo.insert({
        timestamp: baseTime + i * oneMin,
        cpuUsage: i % 2 === 0 ? 20 : 40,
        memoryUsed: 500 * 1024 * 1024,
        memoryFree: 500 * 1024 * 1024,
        swapUsed: 0,
        diskUsed: 100000,
        networkRx: 1000,
        networkTx: 2000,
        load1m: 0.5,
      });
      expect(res.ok).toBe(true);
    }

    // Query raw (no bucket)
    const rawRes = metricsRepo.queryRange(baseTime, baseTime + 60 * oneMin);
    expect(rawRes.ok).toBe(true);
    if (rawRes.ok) {
      expect(rawRes.value.length).toBe(60);
    }

    // Query with 15-minute bucketMs (downsampled to ~4-5 buckets)
    const fifteenMinMs = 15 * 60 * 1000;
    const bucketRes = metricsRepo.queryRange(baseTime, baseTime + 60 * oneMin, fifteenMinMs);
    expect(bucketRes.ok).toBe(true);
    if (bucketRes.ok && bucketRes.value[0]) {
      expect(bucketRes.value.length).toBeLessThanOrEqual(5);
      // Average CPU between 20 and 40 is 30
      expect(bucketRes.value[0].cpuUsage).toBeCloseTo(30, 0);
    }
  });
});
