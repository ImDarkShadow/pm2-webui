import fs from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  MetricFrame,
  HostMetrics,
  ProcessInfo,
  ProcessMetricSample,
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
  readonly getRecentProcessSamples: (processName: string) => readonly ProcessMetricSample[];
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
  const recentProcessSamples = new Map<string, ProcessMetricSample[]>();
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

  // Track CPU ticks for CPU utilization calculation
  let prevCpuTimes = os.cpus().map((c) => c.times);
  const getCpuUsage = (): number => {
    const currentCpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    currentCpus.forEach((cpu, i) => {
      const prev = prevCpuTimes[i];
      if (!prev) return;
      const idle = cpu.times.idle - prev.idle;
      const total =
        cpu.times.user -
        prev.user +
        (cpu.times.nice - prev.nice) +
        (cpu.times.sys - prev.sys) +
        (cpu.times.irq - prev.irq) +
        idle;
      totalIdle += idle;
      totalTick += total;
    });

    prevCpuTimes = currentCpus.map((c) => c.times);
    if (totalTick <= 0) return 0;
    const usage = 100 - (totalIdle / totalTick) * 100;
    return Math.round(Math.max(0, Math.min(100, usage)) * 10) / 10;
  };

  const collectHostMetrics = async (
    processes: readonly ProcessInfo[] = [],
  ): Promise<HostMetrics> => {
    const timestamp = Date.now();
    updateEventLoopMeasurement();

    const cpuUsagePercent = getCpuUsage();

    // Native Disk metrics via statfsSync
    let diskTotal = 0;
    let diskUsed = 0;
    let diskFree = 0;
    try {
      if (typeof fs.statfsSync === 'function') {
        const stats = fs.statfsSync(process.cwd());
        diskTotal = stats.bsize * stats.blocks;
        diskFree = stats.bsize * stats.bavail;
        diskUsed = Math.max(0, diskTotal - diskFree);
      }
    } catch {
      // fallback
    }
    const diskUsagePercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;

    // Native Network metrics via /proc/net/dev on Linux
    let totalRx = 0;
    let totalTx = 0;
    try {
      if (process.platform === 'linux' && fs.existsSync('/proc/net/dev')) {
        const content = fs.readFileSync('/proc/net/dev', 'utf8');
        const lines = content.split('\n');
        for (let i = 2; i < lines.length; i++) {
          const line = lines[i]?.trim();
          if (!line || line.startsWith('lo:')) continue;
          const parts = line.split(/\s+/);
          const rx = Number(parts[1]);
          const tx = Number(parts[9]);
          if (!isNaN(rx)) totalRx += rx;
          if (!isNaN(tx)) totalTx += tx;
        }
      }
    } catch {
      // fallback
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

    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);
    const loadAvg = os.loadavg();

    return {
      timestamp,
      cpu: {
        usagePercent: cpuUsagePercent,
        cores: os.cpus()?.length || 1,
        load1m: Number((loadAvg[0] ?? 0).toFixed(2)),
        load5m: Number((loadAvg[1] ?? 0).toFixed(2)),
        load15m: Number((loadAvg[2] ?? 0).toFixed(2)),
      },
      memory: {
        total: totalMemBytes,
        used: usedMemBytes,
        free: freeMemBytes,
        swapTotal: 0,
        swapUsed: 0,
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

      // Record per-process rolling samples
      for (const p of processes) {
        let list = recentProcessSamples.get(p.name);
        if (!list) {
          list = [];
          recentProcessSamples.set(p.name, list);
        }
        list.push({
          timestamp: hostMetrics.timestamp,
          processName: p.name,
          pmId: p.pmId,
          cpu: p.monit?.cpu ?? p.cpu ?? 0,
          memoryBytes: p.monit?.memory ?? p.memory ?? 0,
          heapUsedMb: p.heapUsedMb,
          heapTotalMb: p.heapTotalMb,
          eventLoopDelayMs: p.eventLoopDelayMs,
          rps: p.rps,
          latencyMs: p.latencyMs,
          restarts: p.restarts,
          status: p.status,
        });
        if (list.length > MAX_SAMPLES) {
          list.shift();
        }
      }

      // Periodic hourly/minute persistent write (every 60 seconds)
      const currentMinute = Math.floor(hostMetrics.timestamp / (60 * 1000)) * (60 * 1000);
      if (currentMinute > lastHourlySave) {
        lastHourlySave = currentMinute;
        metricsRepo.insert({
          ...sample,
          timestamp: currentMinute,
        });

        // Persist per-process metrics
        const procSamples: ProcessMetricSample[] = processes.map((p) => ({
          processName: p.name,
          timestamp: currentMinute,
          pmId: p.pmId,
          cpu: p.monit?.cpu ?? p.cpu ?? 0,
          memoryBytes: p.monit?.memory ?? p.memory ?? 0,
          heapUsedMb: p.heapUsedMb,
          heapTotalMb: p.heapTotalMb,
          eventLoopDelayMs: p.eventLoopDelayMs,
          rps: p.rps,
          latencyMs: p.latencyMs,
          restarts: p.restarts,
          status: p.status,
        }));
        if (procSamples.length > 0) {
          metricsRepo.insertProcessMetrics(procSamples);
        }
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

  const getRecentProcessSamples = (processName: string): readonly ProcessMetricSample[] => {
    const list = recentProcessSamples.get(processName) || [];
    return [...list];
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
    getRecentProcessSamples,
    start,
    stop,
    isRunning,
  };
};
