import { Result, ok } from '@pm2-cluster/shared';
import { AgentMetricsRepo } from './repos/agentMetricsRepo.js';
import { AgentLogsRepo } from './repos/agentLogsRepo.js';
import { AgentCrashRepo } from './repos/agentCrashRepo.js';

export interface RetentionCleanerDeps {
  readonly metricsRepo: AgentMetricsRepo;
  readonly logsRepo: AgentLogsRepo;
  readonly crashRepo: AgentCrashRepo;
  readonly logRetentionDays?: number;
  readonly metricsRetentionDays?: number;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface RetentionCleaner {
  readonly runCleanup: () => Result<{
    metricsPurged: number;
    logSummariesPurged: number;
    logSegmentsPurged: number;
    crashesPurged: number;
  }>;
  readonly startScheduled: (intervalMs?: number) => () => void;
}

export const createRetentionCleaner = (deps: RetentionCleanerDeps): RetentionCleaner => {
  const {
    metricsRepo,
    logsRepo,
    crashRepo,
    logRetentionDays = 7,
    metricsRetentionDays = 30,
    logger,
  } = deps;

  const runCleanup = (): Result<{
    metricsPurged: number;
    logSummariesPurged: number;
    logSegmentsPurged: number;
    crashesPurged: number;
  }> => {
    const now = Date.now();
    const metricsCutoff = now - metricsRetentionDays * 24 * 60 * 60 * 1000;
    const logsCutoff = now - logRetentionDays * 24 * 60 * 60 * 1000;

    const metricsRes = metricsRepo.purgeOlderThan(metricsCutoff);
    const logsRes = logsRepo.purgeOlderThan(logsCutoff);
    const crashRes = crashRepo.purgeOlderThan(logsCutoff);

    const metricsPurged = metricsRes.ok ? metricsRes.value : 0;
    const logSummariesPurged = logsRes.ok ? logsRes.value.summariesPurged : 0;
    const logSegmentsPurged = logsRes.ok ? logsRes.value.segmentsPurged : 0;
    const crashesPurged = crashRes.ok ? crashRes.value : 0;

    logger?.info?.(
      `Retention cleanup finished: ${metricsPurged} metrics, ${logSummariesPurged} log summaries, ${logSegmentsPurged} segments, ${crashesPurged} crashes purged`,
    );

    return ok({
      metricsPurged,
      logSummariesPurged,
      logSegmentsPurged,
      crashesPurged,
    });
  };

  const startScheduled = (intervalMs = 60 * 60 * 1000): (() => void) => {
    const timer = setInterval(() => {
      runCleanup();
    }, intervalMs);

    return () => clearInterval(timer);
  };

  return {
    runCleanup,
    startScheduled,
  };
};
