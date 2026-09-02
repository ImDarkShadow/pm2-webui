import si from 'systeminformation';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  MetricFrame,
  HostMetrics,
  ProcessInfo,
  Result,
  ok,
  err,
  createAppError,
} from '@pm2-webui/shared';
import { AgentMetricsRepo } from '../db/repos/agentMetricsRepo.js';
import { Pm2Manager } from '../pm2/index.js';

export interface RecentMetricSample {
  readonly timestamp: number;
  readonly cpuUsage: number;
  readonly memoryUsed: number;
  readonly memoryFree: number;
  readonly swapUsed: number;
  readonly diskUsed: number;
  readonly networkRx: number;
  readonly networkTx: number;
  readonly load1m: number;
  readonly clusterRps: number;
  readonly avgLatencyMs: number;
  readonly avgEventLoopDelayMs: number;
}

export interface MetricsCollectorDeps {
  readonly metricsRepo: AgentMetricsRepo;
  readonly pm2Manager: Pm2Manager;
  readonly intervalMs?: number;
  readonly onMetricFrame?: (frame: MetricFrame) => void;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface MetricsCollector {
  readonly collectCurrentMetrics: () => Promise<Result<MetricFrame>>;
  readonly getRecentSamples: () => readonly RecentMetricSample[];
  readonly start: () => void;
  readonly stop: () => void;
  readonly isRunning: () => boolean;
}

export const createMetricsCollector = (deps: MetricsCollectorDeps): MetricsCollector => {
  const { metricsRepo, pm2Manager, intervalMs = 3000, onMetricFrame, logger } = deps;

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastHourlySave = 0;

  // In-memory rolling buffer of high-resolution metric samples (last 120 samples = 6 mins)
  const recentSamples: RecentMetricSample[] = [];
  const MAX_SAMPLES = 120;

  // Track previous network stats for rxSec/txSec calculation
  let lastNetTimestamp = 0;
  let lastRxBytes = 0;
  let lastTxBytes = 0;

  // Real-time host event loop delay tracker
  let measuredHostEventLoopDelayMs = 0.5;
  const updateEventLoopMeasurement = () => {
    const start = performance.now();
    setImmediate(() => {
      const elapsed = performance.now() - start;
      measuredHostEventLoopDelayMs = Number(Math.max(0.1, elapsed).toFixed(2));
    });
  };

  const collectHostMetrics = async (
    processes: readonly ProcessInfo[] = [],
  ): Promise<HostMetrics> => {
    const timestamp = Date.now();
    updateEventLoopMeasurement();

    // Query systeminformation
    const [cpuLoad, mem, fsSize, netStats] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
    ]);

    // Aggregate Disk
    let diskTotal = 0;
    let diskUsed = 0;
    let diskFree = 0;
    for (const disk of fsSize) {
      diskTotal += disk.size;
      diskUsed += disk.used;
      diskFree += disk.available;
    }
    const diskUsagePercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;

    // Aggregate Network
    let totalRx = 0;
    let totalTx = 0;
    for (const iface of netStats) {
      totalRx += iface.rx_bytes;
      totalTx += iface.tx_bytes;
    }

    let rxSec = 0;
    let txSec = 0;
    if (lastNetTimestamp > 0 && timestamp > lastNetTimestamp) {
      const dt = (timestamp - lastNetTimestamp) / 1000;
      rxSec = Math.max(0, Math.round((totalRx - lastRxBytes) / dt));
      txSec = Math.max(0, Math.round((totalTx - lastTxBytes) / dt));
    }
    lastNetTimestamp = timestamp;
    lastRxBytes = totalRx;
    lastTxBytes = totalTx;

    // Aggregate Process Telemetry (RPS, Latency, Event Loop Delay)
    let clusterRps = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let totalEventLoop = 0;
    let eventLoopCount = 0;

    for (const p of processes) {
      if (p.rps && Number.isFinite(p.rps)) {
        clusterRps += p.rps;
      }
      if (p.latencyMs && Number.isFinite(p.latencyMs)) {
        totalLatency += p.latencyMs;
        latencyCount++;
      }
      if (p.eventLoopDelayMs && Number.isFinite(p.eventLoopDelayMs)) {
        totalEventLoop += p.eventLoopDelayMs;
        eventLoopCount++;
      }
    }

    const avgLatencyMs = latencyCount > 0 ? Number((totalLatency / latencyCount).toFixed(2)) : 0;
    const avgEventLoopDelayMs =
      eventLoopCount > 0
        ? Number((totalEventLoop / eventLoopCount).toFixed(2))
        : measuredHostEventLoopDelayMs;

    const totalMemBytes = mem?.total && mem.total > 0 ? mem.total : os.totalmem();
    const freeMemBytes =
      mem?.available && mem.available > 0
        ? mem.available
        : mem?.free && mem.free > 0
          ? mem.free
          : os.freemem();
    const usedMemBytes =
      mem?.active && mem.active > 0
        ? mem.active
        : mem?.used && mem.used > 0
          ? mem.used
          : Math.max(0, totalMemBytes - freeMemBytes);

    return {
      timestamp,
      cpu: {
        usagePercent: Math.round((cpuLoad?.currentLoad ?? 0) * 10) / 10,
        cores: cpuLoad?.cpus?.length || os.cpus()?.length || 1,
        load1m: cpuLoad?.avgLoad ?? os.loadavg()[0] ?? 0,
        load5m: 0,
        load15m: 0,
      },
      memory: {
        total: totalMemBytes,
        used: usedMemBytes,
        free: freeMemBytes,
        swapTotal: mem?.swaptotal ?? 0,
        swapUsed: mem?.swapused ?? 0,
      },
      disk: {
        total: diskTotal,
        used: diskUsed,
        free: diskFree,
        usagePercent: diskUsagePercent,
      },
      network: {
        rxSec,
        txSec,
      },
      clusterRps: Number(clusterRps.toFixed(2)),
      avgLatencyMs,
      avgEventLoopDelayMs,
    };
  };

  const collectCurrentMetrics = async (): Promise<Result<MetricFrame>> => {
    try {
      const procRes = await pm2Manager.listProcesses('low');
      const processes: readonly ProcessInfo[] = procRes.ok ? procRes.value : [];
      const hostMetrics = await collectHostMetrics(processes);

      const frame: MetricFrame = {
        timestamp: hostMetrics.timestamp,
        host: hostMetrics,
        processes,
      };

      const sample: RecentMetricSample = {
        timestamp: hostMetrics.timestamp,
        cpuUsage: hostMetrics.cpu.usagePercent,
        memoryUsed: hostMetrics.memory.used,
        memoryFree: hostMetrics.memory.free,
        swapUsed: hostMetrics.memory.swapUsed,
        diskUsed: hostMetrics.disk.used,
        networkRx: hostMetrics.network.rxSec,
        networkTx: hostMetrics.network.txSec,
        load1m: hostMetrics.cpu.load1m,
        clusterRps: hostMetrics.clusterRps ?? 0,
        avgLatencyMs: hostMetrics.avgLatencyMs ?? 0,
        avgEventLoopDelayMs: hostMetrics.avgEventLoopDelayMs ?? 0.8,
      };

      // Add to rolling in-memory buffer
      recentSamples.push(sample);
      if (recentSamples.length > MAX_SAMPLES) {
        recentSamples.shift();
      }

      // Periodic hourly persistent write (every 60 seconds)
      const currentMinute = Math.floor(hostMetrics.timestamp / (60 * 1000)) * (60 * 1000);
      if (currentMinute > lastHourlySave) {
        lastHourlySave = currentMinute;
        metricsRepo.insert({
          ...sample,
          timestamp: currentMinute,
        });
      }

      return ok(frame);
    } catch (error) {
      logger?.error('Failed to collect metrics', error);
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to collect system metrics', undefined, error),
      );
    }
  };

  const getRecentSamples = (): readonly RecentMetricSample[] => {
    return [...recentSamples];
  };

  const start = (): void => {
    if (running) return;
    running = true;

    const tick = async () => {
      if (!running) return;
      const res = await collectCurrentMetrics();
      if (res.ok && onMetricFrame) {
        onMetricFrame(res.value);
      }
      if (running) {
        timer = setTimeout(tick, intervalMs);
      }
    };

    tick();
    logger?.info(`Metrics collector started with interval ${intervalMs}ms`);
  };

  const stop = (): void => {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    logger?.info('Metrics collector stopped');
  };

  const isRunning = (): boolean => running;

  return {
    collectCurrentMetrics,
    getRecentSamples,
    start,
    stop,
    isRunning,
  };
};
