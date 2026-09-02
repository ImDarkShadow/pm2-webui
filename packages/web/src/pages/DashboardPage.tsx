import React, { useState, useEffect } from 'react';
import {
  Layers,
  Activity,
  Zap,
  HardDrive,
  CheckCircle2,
  GitBranch,
  Rocket,
  Server,
  TrendingUp,
  RefreshCw,
  ArrowUpRight,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useNodeStore } from '../store/nodeStore.js';
import { usePreferencesStore } from '../store/preferencesStore.js';
import { usePageVisibility } from '../hooks/usePageVisibility.js';
import { MetricsAreaChart } from '../components/charts/MetricsAreaChart.js';
import { StatusDistributionDonut } from '../components/charts/StatusDistributionDonut.js';
import { OperationsTimeline } from '../components/dashboard/OperationsTimeline.js';
import { ClusterDeployModal } from '../components/deploy/ClusterDeployModal.js';

export interface DashboardPageProps {
  readonly onNavigate: (tab: string) => void;
  readonly onSelectProcess?: (procName: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const { nodes, setNodes, selectedNodeId, setSelectedNodeId } = useNodeStore();
  const { density } = usePreferencesStore();
  const isVisible = usePageVisibility();

  const [processes, setProcesses] = useState<any[]>([]);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [gitApps, setGitApps] = useState<any[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [currentMetrics, setCurrentMetrics] = useState<any | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedAppForDeploy, setSelectedAppForDeploy] = useState<any | null>(null);

  const loadDashboardData = async () => {
    if (!isVisible) return;

    let activeNodeId = selectedNodeId;
    if (!activeNodeId) {
      const fetchedNodes = await api.getNodes().catch(() => []);
      if (fetchedNodes.length > 0) {
        setNodes(fetchedNodes);
        activeNodeId = fetchedNodes[0].id;
      }
    }

    try {
      const [procs, recDeployments, apps, timelineData] = await Promise.all([
        api.getAllProcesses().catch(() => []),
        api.getRecentDeployments().catch(() => []),
        api.getGitApps().catch(() => []),
        api.getTimeline().catch(() => []),
      ]);

      setProcesses(procs || []);
      setDeployments(recDeployments || []);
      setGitApps(apps || []);
      setTimelineEvents(timelineData || []);

      if (activeNodeId) {
        const now = Date.now();
        const metricsData = await api
          .getMetrics(activeNodeId, now - 3600000, now, 100)
          .catch(() => null);
        if (metricsData) {
          if (metricsData.current) {
            setCurrentMetrics(metricsData.current.host || metricsData.current);
          }

          if (metricsData.history && metricsData.history.length > 0) {
            const formatted = metricsData.history.map((m: any) => {
              const totalMem = (m.memoryUsed || 0) + (m.memoryFree || 1);
              return {
                time: new Date(m.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                cpu: m.cpuUsage ?? 0,
                memory: Math.min(100, Math.round(((m.memoryUsed || 0) / totalMem) * 100)),
                rps: m.clusterRps || 0,
              };
            });
            if (formatted.length === 1) {
              formatted.unshift({ ...formatted[0], time: 'Initial' });
            }
            setMetricsHistory(formatted);
          } else if (metricsData.current?.host || metricsData.current?.cpu || metricsData.current?.memory) {
            const h = metricsData.current.host || metricsData.current;
            const totalMem = h.memory?.total || (h.memory?.used || 0) + (h.memory?.free || 1);
            const p = {
              time: 'Now',
              cpu: h.cpu?.usagePercent ?? 0,
              memory: Math.min(100, Math.round(((h.memory?.used || 0) / totalMem) * 100)),
              rps: h.clusterRps || 0,
            };
            setMetricsHistory([{ ...p, time: 'Start' }, p]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load dashboard data', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    loadDashboardData();
  };

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 4000);
    return () => clearInterval(interval);
  }, [selectedNodeId, isVisible]);

  // Aggregate Cluster Metrics
  const totalProcesses = processes.length;
  const onlineProcesses = processes.filter((p) => p.status === 'online').length;
  const stoppedProcesses = processes.filter((p) => p.status === 'stopped').length;
  const erroredProcesses = processes.filter((p) => p.status === 'errored').length;

  const totalRps = processes.reduce((acc, p) => acc + (p.rps || 0), 0);
  const totalMemoryMb = processes.reduce(
    (acc, p) => acc + Math.round((p.monit?.memory ?? p.memory ?? 0) / 1024 / 1024),
    0,
  );
  const hostMemoryUsedGb = currentMetrics?.memory?.used
    ? (currentMetrics.memory.used / (1024 * 1024 * 1024)).toFixed(1)
    : null;
  const hostMemoryTotalGb = currentMetrics?.memory?.total
    ? (currentMetrics.memory.total / (1024 * 1024 * 1024)).toFixed(1)
    : null;
  const hostMemoryPercent =
    currentMetrics?.memory?.total && currentMetrics.memory.total > 0
      ? Math.round((currentMetrics.memory.used / currentMetrics.memory.total) * 100)
      : null;
  const onlineNodes = nodes.filter((n) => n.status === 'online');
  const healthyPercent =
    totalProcesses > 0 ? Math.round((onlineProcesses / totalProcesses) * 100) : 100;

  const isCompact = density === 'compact';

  return (
    <div className={`w-full ${isCompact ? 'space-y-4' : 'space-y-6'}`}>
      {/* Top Header & Quick Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Activity size={18} />
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Dashboard
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Overview of your cluster nodes, processes, and deployments
          </p>
        </div>

        {/* Global Quick Action Toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors shadow-2xs"
            title="Refresh Data"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>

          {gitApps.length > 0 && (
            <button
              onClick={() => setSelectedAppForDeploy(gitApps[0])}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
            >
              <Rocket size={13} />
              <span>Deploy App</span>
            </button>
          )}

          <button
            onClick={() => onNavigate('processes')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-zinc-100 dark:text-zinc-950 rounded-lg text-xs font-semibold transition-colors shadow-xs"
          >
            <Layers size={13} />
            <span>Processes ({totalProcesses})</span>
          </button>
        </div>
      </div>

      {/* Aggregate KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        {/* 1. Total Cluster RPS */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3' : 'p-4'} shadow-2xs flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between text-zinc-500 text-xs mb-2">
            <span className="font-semibold flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
              <Zap size={14} className="text-amber-500" /> Requests / Min
            </span>
            <span className="text-[9px] uppercase font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
              Live
            </span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono tracking-tight">
            {totalRps.toLocaleString()}{' '}
            <span className="text-xs font-sans text-zinc-500 font-normal">req/min</span>
          </div>
          <div className="mt-2 text-[11px] text-zinc-500 flex items-center justify-between">
            <span>Across processes:</span>
            <span className="text-zinc-700 dark:text-zinc-300 font-medium">
              {totalProcesses} total
            </span>
          </div>
        </div>

        {/* 2. Active Processes & Health */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3' : 'p-4'} shadow-2xs flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between text-zinc-500 text-xs mb-2">
            <span className="font-semibold flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
              <CheckCircle2 size={14} className="text-emerald-500" /> Process Status
            </span>
            <span
              className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                erroredProcesses > 0
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {healthyPercent}% Online
            </span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono tracking-tight">
            {onlineProcesses}{' '}
            <span className="text-xs font-sans text-zinc-500 font-normal">
              / {totalProcesses} online
            </span>
          </div>
          <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                erroredProcesses > 0 ? 'bg-rose-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${healthyPercent}%` }}
            />
          </div>
        </div>

        {/* 3. Cluster Memory Usage */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3' : 'p-4'} shadow-2xs flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between text-zinc-500 text-xs mb-2">
            <span className="font-semibold flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
              <HardDrive size={14} className="text-blue-500" /> Memory
            </span>
            <span className="text-[9px] uppercase font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
              {totalMemoryMb > 0 ? 'PM2 RSS' : 'Host RAM'}
            </span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono tracking-tight">
            {totalMemoryMb > 0
              ? totalMemoryMb > 1024
                ? `${(totalMemoryMb / 1024).toFixed(2)} GB`
                : `${totalMemoryMb} MB`
              : hostMemoryUsedGb
                ? `${hostMemoryUsedGb} GB`
                : '0 MB'}
          </div>
          <div className="mt-2 text-[11px] text-zinc-500 flex items-center justify-between">
            <span>{totalMemoryMb > 0 ? 'Avg / proc (Host):' : 'Host RAM:'}</span>
            <span className="font-mono">
              {totalMemoryMb > 0
                ? `${totalProcesses > 0 ? Math.round(totalMemoryMb / totalProcesses) : 0} MB ${hostMemoryPercent ? `(${hostMemoryPercent}% sys)` : ''}`
                : hostMemoryTotalGb
                  ? `${hostMemoryUsedGb}/${hostMemoryTotalGb} GB (${hostMemoryPercent}%)`
                  : 'Idle'}
            </span>
          </div>
        </div>

        {/* 4. Node Topology */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3' : 'p-4'} shadow-2xs flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between text-zinc-500 text-xs mb-2">
            <span className="font-semibold flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
              <Server size={14} className="text-purple-500" /> Nodes
            </span>
            <span className="text-[9px] uppercase font-bold text-purple-600 dark:text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
              Active
            </span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono tracking-tight">
            {onlineNodes.length}{' '}
            <span className="text-xs font-sans text-zinc-500 font-normal">
              / {nodes.length} online
            </span>
          </div>
          <div className="mt-2 text-[11px] text-zinc-500 flex items-center justify-between">
            <button
              onClick={() => onNavigate('nodes')}
              className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium flex items-center gap-1"
            >
              + Connect Worker →
            </button>
            <span className="text-zinc-500 font-mono text-[10px]">
              {nodes.length === 1 ? 'Master only' : `${nodes.length} nodes`}
            </span>
          </div>
        </div>

        {/* 5. Git CI/CD Deployments */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3' : 'p-4'} shadow-2xs flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between text-zinc-500 text-xs mb-2">
            <span className="font-semibold flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
              <GitBranch size={14} className="text-sky-500" /> Git Apps
            </span>
            <span className="text-[9px] uppercase font-bold text-sky-600 dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded">
              Deploy
            </span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono tracking-tight">
            {gitApps.length}{' '}
            <span className="text-xs font-sans text-zinc-500 font-normal">apps connected</span>
          </div>
          <div className="mt-2 text-[11px] text-zinc-500 flex items-center justify-between">
            <span>Deployments:</span>
            <span className="font-mono font-medium">{deployments.length} total</span>
          </div>
        </div>
      </div>

      {/* Cluster Node Status Grid */}
      <div
        className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'} shadow-2xs space-y-3`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-emerald-500" />
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Node Status</h2>
            <span className="text-[11px] text-zinc-500 font-mono">
              ({nodes.length} registered nodes)
            </span>
          </div>
          <button
            onClick={() => onNavigate('nodes')}
            className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-semibold flex items-center gap-0.5"
          >
            Manage Nodes <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
          {nodes.map((node) => {
            const isSelected = node.id === selectedNodeId;
            const nodeProcs = processes.filter((p) => p.nodeId === node.id);
            const nodeProcCount = nodeProcs.length;
            const isOnline = node.status === 'online';
            const hasError = nodeProcs.some((p) => p.status === 'errored');

            return (
              <div
                key={node.id}
                onClick={() => {
                  setSelectedNodeId(node.id);
                  onNavigate('processes');
                }}
                className={`p-3 rounded-xl border cursor-pointer transition-all duration-150 relative group ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10 shadow-xs ring-1 ring-emerald-500/20'
                    : 'border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-950/40 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-2xs'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="relative flex h-2 w-2 shrink-0">
                      {isOnline && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      )}
                      <span
                        className={`relative inline-flex rounded-full h-2 w-2 ${
                          isOnline ? (hasError ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-zinc-500'
                        }`}
                      />
                    </span>
                    <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate group-hover:text-emerald-500 transition-colors">
                      {node.hostname}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">
                    {node.connectivityMode}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                  <span>{nodeProcCount} processes</span>
                  <span>
                    {node.ipAddress}:{node.port}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Responsive Grid: Real-Time Charts & Status Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Left: Metrics Chart (2 cols on large screen) */}
        <div
          className={`lg:col-span-2 bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'} shadow-2xs space-y-3`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <TrendingUp size={16} className="text-blue-500" /> Active Node Telemetry History
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                CPU load, Memory utilization & Requests/min over time
              </p>
            </div>
            {currentMetrics && (
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-emerald-600 dark:text-emerald-400">
                  CPU: {currentMetrics.cpu?.usagePercent ?? 0}%
                </span>
                <span className="text-blue-500">
                  RAM:{' '}
                  {Math.round(
                    ((currentMetrics.memory?.used || 0) / (currentMetrics.memory?.total || 1)) *
                      100,
                  )}
                  %
                </span>
              </div>
            )}
          </div>

          <div className={isCompact ? 'h-52 sm:h-60' : 'h-60 sm:h-72'}>
            <MetricsAreaChart
              data={metricsHistory}
              series={[
                { key: 'cpu', label: 'CPU Load', color: '#10b981', unit: '%' },
                { key: 'memory', label: 'RAM RSS', color: '#3b82f6', unit: '%' },
              ]}
            />
          </div>
        </div>

        {/* Right: Status Breakdown Donut (1 col) */}
        <div
          className={`bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl ${isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'} shadow-2xs flex flex-col justify-between space-y-3`}
        >
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Layers size={16} className="text-purple-500" /> Status Distribution
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">Cluster-wide process health breakdown</p>
          </div>

          <div className={isCompact ? 'h-48' : 'h-56'}>
            <StatusDistributionDonut
              online={onlineProcesses}
              stopped={stoppedProcesses}
              errored={erroredProcesses}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <div className="p-1 rounded bg-zinc-50 dark:bg-zinc-950/60">
              <span className="block text-[9px] text-zinc-500 uppercase font-semibold">Online</span>
              <span className="font-bold text-emerald-500">{onlineProcesses}</span>
            </div>
            <div className="p-1 rounded bg-zinc-50 dark:bg-zinc-950/60">
              <span className="block text-[9px] text-zinc-500 uppercase font-semibold">
                Stopped
              </span>
              <span className="font-bold text-zinc-400">{stoppedProcesses}</span>
            </div>
            <div className="p-1 rounded bg-zinc-50 dark:bg-zinc-950/60">
              <span className="block text-[9px] text-zinc-500 uppercase font-semibold">
                Errored
              </span>
              <span className="font-bold text-rose-500">{erroredProcesses}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Operations Timeline */}
      <OperationsTimeline events={timelineEvents} loading={loading} />

      {/* Cluster Multi-Node Deploy Modal */}
      <ClusterDeployModal
        app={selectedAppForDeploy}
        isOpen={!!selectedAppForDeploy}
        onClose={() => setSelectedAppForDeploy(null)}
        onDeployComplete={loadDashboardData}
      />
    </div>
  );
};
