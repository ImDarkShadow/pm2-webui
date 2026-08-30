import fs from 'node:fs';
import {
  LogLine,
  LogGranularity,
  LogSummaryBucket,
  Result,
  ok,
  err,
  createAppError,
} from '@pm2-webui/shared';
import { AgentLogsRepo, StoredLogSummary } from '../db/repos/agentLogsRepo.js';
import { AgentCrashRepo } from '../db/repos/agentCrashRepo.js';

export interface LogEngineDeps {
  readonly logsRepo: AgentLogsRepo;
  readonly crashRepo: AgentCrashRepo;
  readonly logDir: string;
  readonly maxSegmentSizeBytes?: number; // default 10MB
  readonly flushIntervalMs?: number; // default 1000ms
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface RawLogQueryOptions {
  readonly processName: string;
  readonly stream?: 'stdout' | 'stderr' | 'both';
  readonly from?: number;
  readonly to?: number;
  readonly search?: string;
  readonly isRegex?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface LogEngine {
  readonly ingestLogLine: (line: LogLine) => void;
  readonly flush: () => Promise<Result<void>>;
  readonly querySummaries: (
    processName: string,
    granularity: LogGranularity,
    from: number,
    to: number,
  ) => Result<readonly LogSummaryBucket[]>;
  readonly queryRawLogs: (
    options: RawLogQueryOptions,
  ) => Result<{ lines: readonly LogLine[]; total: number }>;
  readonly getCrashContext: (
    crashId: string,
  ) => Result<{ logsBefore: readonly LogLine[]; logsAfter: readonly LogLine[] } | null>;
  readonly start: () => void;
  readonly stop: () => void;
}

const GRANULARITY_MS: Record<LogGranularity, number> = {
  '1s': 1000,
  '10s': 10_000,
  '1m': 60_000,
  '10m': 600_000,
  '1h': 3_600_000,
};

export const createLogEngine = (deps: LogEngineDeps): LogEngine => {
  const {
    logsRepo,
    crashRepo,
    logDir,
    maxSegmentSizeBytes: _maxSegmentSizeBytes = 10 * 1024 * 1024,
    flushIntervalMs = 1000,
    logger,
  } = deps;

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const inMemoryLogs: LogLine[] = [];
  const MAX_IN_MEMORY_LOGS = 50_000;
  let timer: NodeJS.Timeout | null = null;

  // Active bucket aggregation map: key = `${processName}:${granularity}:${bucketTs}`
  const summaryBuckets = new Map<string, StoredLogSummary>();

  const isErrorLine = (text: string): boolean => {
    return /\b(error|fatal|exception|failed|panic)\b/i.test(text);
  };

  const isWarnLine = (text: string): boolean => {
    return /\b(warn|warning)\b/i.test(text);
  };

  const aggregateToBuckets = (line: LogLine) => {
    const isErr = isErrorLine(line.message);
    const isWarn = isWarnLine(line.message);

    const granularities: LogGranularity[] = ['1s', '10s', '1m', '10m', '1h'];

    for (const gran of granularities) {
      const bucketMs = GRANULARITY_MS[gran];
      const bucketTimestamp = Math.floor(line.timestamp / bucketMs) * bucketMs;
      const key = `${line.processName}:${gran}:${bucketTimestamp}`;

      const existing = summaryBuckets.get(key);
      if (existing) {
        summaryBuckets.set(key, {
          ...existing,
          lineCount: existing.lineCount + 1,
          errorCount: existing.errorCount + (isErr ? 1 : 0),
          warnCount: existing.warnCount + (isWarn ? 1 : 0),
          sampleText: existing.sampleText || (isErr ? line.message.slice(0, 200) : undefined),
        });
      } else {
        summaryBuckets.set(key, {
          processName: line.processName,
          granularity: gran,
          bucketTimestamp,
          lineCount: 1,
          errorCount: isErr ? 1 : 0,
          warnCount: isWarn ? 1 : 0,
          sampleText: isErr ? line.message.slice(0, 200) : line.message.slice(0, 100),
        });
      }
    }
  };

  const ingestLogLine = (line: LogLine): void => {
    inMemoryLogs.push(line);
    if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
      inMemoryLogs.shift();
    }
    aggregateToBuckets(line);
  };

  const flush = async (): Promise<Result<void>> => {
    if (summaryBuckets.size === 0) return ok(undefined);

    try {
      // Flush summary buckets into SQLite
      for (const bucket of summaryBuckets.values()) {
        logsRepo.insertSummary(bucket);
      }
      summaryBuckets.clear();
      return ok(undefined);
    } catch (error) {
      logger?.error('Failed to flush log summaries', error);
      return err(createAppError('INTERNAL_ERROR', 'Failed to flush logs', undefined, error));
    }
  };

  const querySummaries = (
    processName: string,
    granularity: LogGranularity,
    from: number,
    to: number,
  ): Result<readonly LogSummaryBucket[]> => {
    return logsRepo.querySummaries(processName, granularity, from, to);
  };

  const queryRawLogs = (
    options: RawLogQueryOptions,
  ): Result<{ lines: readonly LogLine[]; total: number }> => {
    const {
      processName,
      stream = 'both',
      from,
      to,
      search,
      isRegex = false,
      limit = 500,
      offset = 0,
    } = options;

    let regex: RegExp | null = null;
    if (search) {
      try {
        regex = isRegex
          ? new RegExp(search, 'i')
          : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      } catch (error) {
        return err(createAppError('VALIDATION_ERROR', 'Invalid search regex', undefined, error));
      }
    }

    const filtered = inMemoryLogs.filter((line) => {
      if (line.processName !== processName) return false;
      if (stream !== 'both' && line.stream !== stream) return false;
      if (from !== undefined && line.timestamp < from) return false;
      if (to !== undefined && line.timestamp > to) return false;
      if (regex && !regex.test(line.message)) return false;
      return true;
    });

    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    return ok({
      lines: paginated,
      total,
    });
  };

  const getCrashContext = (
    crashId: string,
  ): Result<{ logsBefore: readonly LogLine[]; logsAfter: readonly LogLine[] } | null> => {
    const crashRes = crashRepo.findById(crashId);
    if (!crashRes.ok || !crashRes.value) {
      return ok(null);
    }
    return ok({
      logsBefore: crashRes.value.logsBefore,
      logsAfter: crashRes.value.logsAfter,
    });
  };

  const start = (): void => {
    if (timer) return;
    timer = setInterval(() => {
      flush();
    }, flushIntervalMs);
    logger?.info('Log engine started');
  };

  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    flush();
    logger?.info('Log engine stopped');
  };

  return {
    ingestLogLine,
    flush,
    querySummaries,
    queryRawLogs,
    getCrashContext,
    start,
    stop,
  };
};
