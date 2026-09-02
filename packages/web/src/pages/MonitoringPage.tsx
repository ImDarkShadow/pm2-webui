import React, { useState, useEffect } from 'react';
import { Activity, Cpu, HardDrive, Network, Zap, Server, RefreshCw } from 'lucide-react';
import { api } from '../api/client.js';
import { useNodeStore } from '../store/nodeStore.js';
import { MetricsAreaChart } from '../components/charts/MetricsAreaChart.js';
import { LiveThroughputChart } from '../components/charts/LiveThroughputChart.js';

import { usePreferencesStore } from '../store/preferencesStore.js';

export const MonitoringPage: React.FC = () => {
  const { selectedNodeId, nodes, setNodes } = useNodeStore();
  const { density } = usePreferencesStore();
  const isCompact = (density as any) === 'compact';

  const [timeRange, setTimeRange] = useState('24h');
  const [currentMetrics, setCurrentMetrics] = useState<any | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<any[]>([]);
  const [throughputHistory, setThroughputHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMetrics = async () => {
    let activeNodeId = selectedNodeId;

    if (!activeNodeId) {
      const fetchedNodes = await api.getNodes().catch(() => []);
      if (fetchedNodes.length > 0) {
        setNodes(fetchedNodes);
        activeNodeId = fetchedNodes[0].id;
      }
    }

    if (!activeNodeId) return;

    setLoading(true);

    const rangeMap: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    const duration = rangeMap[timeRange] || 24 * 60 * 60 * 1000;
    const now = Date.now();

    try {
      const data = await api.getMetrics(activeNodeId, now - duration, now, 500);

      if (data.current) {
        setCurrentMetrics(data.current.host || data.current);
      }

      let formatted: any[] = [];

      if (data.history && data.history.length > 0) {
        formatted = data.history.map((m: any) => {
          const totalMem = (m.memoryUsed || 0) + (m.memoryFree || 1);
          const memPercent = Math.min(
            100,
            Math.max(0, Math.round(((m.memoryUsed || 0) / totalMem) * 100)),
          );
          return {
            time: new Date(m.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            cpu: m.cpuUsage ?? 0,
            memory: memPercent,
            swap: Math.round(((m.swapUsed || 0) / ((m.swapUsed || 0) + 1)) * 100),
            disk: Math.round((m.diskUsed || 0) / 1024 / 1024 / 1024),
            rx: Math.round((m.networkRx || 0) / 1024),
            tx: Math.round((m.networkTx || 0) / 1024),
            eventLoop: m.avgEventLoopDelayMs || 0,
            rps: m.clusterRps || 0,
            latencyMs: m.avgLatencyMs || 0,
          };
        });
      }

      // If database history is scarce on first boot, seed with current host metrics
      if (formatted.length < 2 && data.current?.host) {
        const h = data.current.host;
        const totalMem = (h.memory?.used || 0) + (h.memory?.free || 1);
        const memPercent = Math.min(
          100,
          Math.max(0, Math.round(((h.memory?.used || 0) / totalMem) * 100)),
        );
        const nowStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        const point = {
          time: nowStr,
          cpu: h.cpu?.usagePercent ?? 0,
          memory: memPercent,
          swap: Math.round(((h.memory?.swapUsed || 0) / ((h.memory?.swapUsed || 0) + 1)) * 100),
          disk: h.disk?.usagePercent ?? 0,
          rx: Math.round((h.network?.rxSec || 0) / 1024),
          tx: Math.round((h.network?.txSec || 0) / 1024),
          eventLoop: h.avgEventLoopDelayMs || 0,
          rps: h.clusterRps || 0,
          latencyMs: h.avgLatencyMs || 0,
        };

        formatted = [{ ...point, time: 'Start' }, point];
      }

      setMetricsHistory(formatted);
      setThroughputHistory(formatted);
    } catch (err) {
      console.error('Failed to fetch metrics', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, [selectedNodeId, timeRange, nodes]);

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  const chartHeight = isCompact ? 200 : 230;

  return (
    <div className={`w-full ${isCompact ? 'space-y-4' : 'space-y-6'}`}>
      {/* Header & Range Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
            <Activity size={18} className="text-emerald-500" /> Fleet Telemetry & Monitoring
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Live real-time telemetry for host CPU, RAM, HTTP throughput, event loop lag, and
            disk/network I/O
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center p-0.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs shadow-2xs">
            {['1h', '6h', '24h', '7d', '30d'].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  timeRange === range
                    ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {range}
              </button>
            ))}
          </div>

          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="p-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors shadow-2xs"
            title="Refresh Metrics"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Top 4 Real-Time Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* CPU */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3' : 'p-4'} shadow-2xs flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>Host CPU Utilization</span>
            <Cpu size={15} className="text-sky-500" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {currentMetrics?.cpu?.usagePercent ?? 0}%
            </span>
            <span className="text-xs text-zinc-500">({currentMetrics?.cpu?.cores || 1} Cores)</span>
          </div>
          <span className="mt-2 text-[11px] text-zinc-500 font-mono">
            Load: {currentMetrics?.cpu?.load1m?.toFixed(2) || '0.00'} (1m)
          </span>
        </div>

        {/* Memory */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3' : 'p-4'} shadow-2xs flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>Memory (RAM)</span>
            <HardDrive size={15} className="text-purple-500" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {formatBytes(currentMetrics?.memory?.used)}
            </span>
            <span className="text-xs text-zinc-500 font-mono">
              / {formatBytes(currentMetrics?.memory?.total)}
            </span>
          </div>
          <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-purple-500 h-full rounded-full transition-all"
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    ((currentMetrics?.memory?.used || 0) / (currentMetrics?.memory?.total || 1)) *
                      100,
                  ),
                )}%`,
              }}
            />
          </div>
        </div>

        {/* Throughput & Latency */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3' : 'p-4'} shadow-2xs flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>Cluster Throughput</span>
            <Zap size={15} className="text-emerald-500" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {currentMetrics?.clusterRps ?? 0}
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              req/min
            </span>
          </div>
          <span className="mt-2 text-[11px] text-zinc-500">
            Avg Latency:{' '}
            {currentMetrics?.avgLatencyMs ? `${currentMetrics.avgLatencyMs} ms` : '< 1 ms'}
          </span>
        </div>

        {/* Event Loop & Storage */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3' : 'p-4'} shadow-2xs flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>Event Loop & Disk</span>
            <Server size={15} className="text-amber-500" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {currentMetrics?.avgEventLoopDelayMs
                ? `${currentMetrics.avgEventLoopDelayMs} ms`
                : '0.5 ms'}
            </span>
            <span className="text-xs text-zinc-500">loop delay</span>
          </div>
          <span className="mt-2 text-[11px] text-zinc-500 font-mono">
            Disk: {currentMetrics?.disk?.usagePercent ?? 0}% (
            {formatBytes(currentMetrics?.disk?.used)})
          </span>
        </div>
      </div>

      {/* Grid of 4 Interactive Recharts Panels (Screen-Aware Auto Reflow) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {/* 1. CPU Load Area Chart */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'} shadow-2xs space-y-3`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu size={16} className="text-sky-500" />
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                CPU Load History
              </h2>
            </div>
            <span className="text-xs font-mono text-zinc-500">% usage</span>
          </div>
          <MetricsAreaChart
            data={metricsHistory}
            series={[{ key: 'cpu', label: 'CPU Usage', color: '#38bdf8', unit: '%' }]}
            height={chartHeight}
            yAxisUnit="%"
          />
        </div>

        {/* 2. Throughput & Latency Dual-Axis Chart */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'} shadow-2xs space-y-3`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-emerald-500" />
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Throughput & Latency
              </h2>
            </div>
            <span className="text-xs font-mono text-zinc-500">RPS & ms</span>
          </div>
          <LiveThroughputChart data={throughputHistory} height={chartHeight} />
        </div>

        {/* 3. Memory Area Chart */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'} shadow-2xs space-y-3`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive size={16} className="text-purple-500" />
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Memory Utilization
              </h2>
            </div>
            <span className="text-xs font-mono text-zinc-500">% memory</span>
          </div>
          <MetricsAreaChart
            data={metricsHistory}
            series={[{ key: 'memory', label: 'RAM RSS', color: '#a855f7', unit: '%' }]}
            height={chartHeight}
            yAxisUnit="%"
          />
        </div>

        {/* 4. Network Bandwidth (RX / TX) */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'} shadow-2xs space-y-3`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network size={16} className="text-amber-500" />
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Network Bandwidth (RX / TX)
              </h2>
            </div>
            <span className="text-xs font-mono text-zinc-500">KB/s</span>
          </div>
          <MetricsAreaChart
            data={metricsHistory}
            series={[
              { key: 'rx', label: 'Inbound (RX)', color: '#10b981', unit: ' KB/s' },
              { key: 'tx', label: 'Outbound (TX)', color: '#f59e0b', unit: ' KB/s' },
            ]}
            height={chartHeight}
            yAxisUnit=" KB/s"
          />
        </div>
      </div>
    </div>
  );
};
