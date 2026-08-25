import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  RotateCw,
  Square,
  Play,
  Eye,
  EyeOff,
  Cpu,
  HardDrive,
  Clock,
  ShieldAlert,
  Activity,
  Zap,
  Terminal as TerminalIcon,
  PlayCircle,
  Sliders,
  GitBranch,
  Folder,
  User,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useNodeStore } from '../store/nodeStore.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { MetricsAreaChart } from '../components/charts/MetricsAreaChart.js';
import { LiveTerminal } from '../components/terminal/LiveTerminal.js';
import { Modal } from '../components/ui/Modal.js';

interface ProcessDetailPageProps {
  processName: string;
  onBack: () => void;
}

export const ProcessDetailPage: React.FC<ProcessDetailPageProps> = ({ processName, onBack }) => {
  const { selectedNodeId } = useNodeStore();
  const [processInfo, setProcessInfo] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'probes' | 'actions' | 'terminal' | 'env'
  >('overview');
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [actionOutput, setActionOutput] = useState<string | null>(null);
  const [scaleModalOpen, setScaleModalOpen] = useState(false);
  const [targetInstances, setTargetInstances] = useState(2);
  const [loading, setLoading] = useState(true);
  const [copiedCommit, setCopiedCommit] = useState(false);

  // Live streaming time-series history for charts
  const [procMetricsHistory, setProcMetricsHistory] = useState<any[]>([]);

  const loadDetails = async () => {
    if (!selectedNodeId) return;
    try {
      const procs = await api.getProcesses(selectedNodeId);
      const found = procs.find((p: any) => p.name === processName);
      if (found) {
        setProcessInfo(found);
        setTargetInstances(found.instances || 2);

        const nowStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const memMb = Math.round((found.monit?.memory || 0) / (1024 * 1024));

        setProcMetricsHistory((prev) => {
          const next = [
            ...prev,
            {
              time: nowStr,
              cpu: found.monit?.cpu || 0,
              memory: memMb,
              rps: found.rps || 0,
              eventLoop: found.eventLoopDelayMs || 0.8,
            },
          ];

          // Ensure at least 2 points for Recharts interpolation
          if (next.length === 1) {
            return [{ ...next[0], time: 'Start' }, next[0]];
          }
          return next.slice(-30);
        });
      }

      const envData = await api
        .getProcessEnv(selectedNodeId, processName)
        .catch(() => ({ env: {} }));
      setEnvVars(envData.env || {});
    } catch (err) {
      console.error('Failed to load process details', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetails();
    const interval = setInterval(loadDetails, 4000);
    return () => clearInterval(interval);
  }, [selectedNodeId, processName]);

  const handleRevealKey = async (key: string) => {
    if (!selectedNodeId) return;
    try {
      const res = await api.revealProcessEnvKey(selectedNodeId, processName, key);
      setRevealedKeys((prev) => ({ ...prev, [key]: res.value }));
    } catch (err: any) {
      alert(`Failed to reveal secret: ${err.message}`);
    }
  };

  const handleAction = async (action: string) => {
    if (!selectedNodeId || !processInfo) return;
    try {
      await api.executeProcessAction(selectedNodeId, action, processInfo.pmId);
      await loadDetails();
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
    }
  };

  const handleTriggerCustomAction = async (actionName: string) => {
    if (!selectedNodeId || !processInfo) return;
    try {
      const res = await api.triggerProcessAction(selectedNodeId, processInfo.pmId, actionName);
      setActionOutput(`Action '${actionName}' completed: ${JSON.stringify(res.result || res)}`);
    } catch (err: any) {
      setActionOutput(`Action '${actionName}' failed: ${err.message}`);
    }
  };

  const handleScale = async () => {
    if (!selectedNodeId) return;
    try {
      await api.scaleProcess(selectedNodeId, processName, targetInstances);
      setScaleModalOpen(false);
      await loadDetails();
    } catch (err: any) {
      alert(`Scale failed: ${err.message}`);
    }
  };

  if (!processInfo && !loading) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
        >
          <ArrowLeft size={14} /> Back to Processes
        </button>
        <div className="p-8 text-center text-zinc-500 text-sm">
          Process '{processName}' not found.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Top Breadcrumb & Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors shadow-2xs"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
                {processName}
              </h1>
              {processInfo && <StatusBadge status={processInfo.status} />}
            </div>
            <span className="text-xs text-zinc-500 font-mono">
              PM_ID: #{processInfo?.pmId} • PID: {processInfo?.pid || '-'} • Mode:{' '}
              {processInfo?.execMode || 'fork_mode'}
            </span>
          </div>
        </div>

        {/* Action Controls */}
        {processInfo && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setScaleModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors shadow-sm"
            >
              <Sliders size={13} /> Scale ({processInfo.instances || 1}x)
            </button>
            <button
              onClick={() => handleAction('restart')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors shadow-sm"
            >
              <RotateCw size={13} /> Restart
            </button>
            {processInfo.status === 'online' ? (
              <button
                onClick={() => handleAction('stop')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-amber-600 dark:text-amber-300 transition-colors shadow-sm"
              >
                <Square size={13} /> Stop
              </button>
            ) : (
              <button
                onClick={() => handleAction('start')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-emerald-600 dark:text-emerald-300 transition-colors shadow-sm"
              >
                <Play size={13} /> Start
              </button>
            )}
          </div>
        )}
      </div>

      {/* 5 Tab Navigation Bar */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 pb-2 overflow-x-auto">
        {[
          { id: 'overview', label: 'Resource Overview', icon: Cpu },
          { id: 'probes', label: 'Telemetry & Probes', icon: Activity },
          { id: 'actions', label: 'Custom PM2 Actions', icon: PlayCircle },
          { id: 'terminal', label: 'Live Console Stream', icon: TerminalIcon },
          { id: 'env', label: 'Environment & Secrets', icon: ShieldAlert },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <span>CPU Usage</span>
                <Cpu size={15} />
              </div>
              <div className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {processInfo?.monit?.cpu || 0}%
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <span>Memory RSS</span>
                <HardDrive size={15} />
              </div>
              <div className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {((processInfo?.monit?.memory || 0) / (1024 * 1024)).toFixed(1)} MB
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <span>V8 Heap Allocated</span>
                <Activity size={15} />
              </div>
              <div className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {processInfo?.heapUsedMb
                  ? `${processInfo.heapUsedMb} MB`
                  : `${(((processInfo?.monit?.memory || 0) / (1024 * 1024)) * 0.7).toFixed(1)} MB`}
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <span>Restarts & Stability</span>
                <Clock size={15} />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {processInfo?.restarts || 0}
                </span>
                <span className="text-xs text-zinc-500">restarts</span>
              </div>
            </div>
          </div>

          {/* Time Series Area Chart */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Process CPU & Memory Timeline
            </h2>
            <MetricsAreaChart
              data={procMetricsHistory}
              series={[
                { key: 'cpu', label: 'CPU %', color: '#38bdf8', unit: '%' },
                { key: 'memory', label: 'Memory (MB)', color: '#a855f7', unit: 'MB' },
              ]}
              height={220}
            />
          </div>

          {/* Git & Version Control Details (Auto-Detected) */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranch size={16} className="text-sky-500" />
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Version Control & Git Information
                </h2>
              </div>
              {processInfo?.git ? (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    processInfo.git.isDirty
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  }`}
                >
                  {processInfo.git.isDirty ? 'Uncommitted Local Changes' : 'Clean Working Tree'}
                </span>
              ) : (
                <span className="text-[11px] text-zinc-400 font-mono">
                  No Git repository detected
                </span>
              )}
            </div>

            {processInfo?.git ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-3">
                  <div>
                    <span className="text-zinc-500 text-[11px] block">Active Branch</span>
                    <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 mt-0.5">
                      <GitBranch size={13} className="text-sky-500" /> {processInfo.git.branch}
                    </span>
                  </div>

                  <div>
                    <span className="text-zinc-500 text-[11px] block">Latest Commit Hash</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono text-zinc-800 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                        {processInfo.git.commitHash || 'N/A'}
                      </span>
                      {processInfo.git.commitHash && (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(processInfo.git.commitHash);
                            setCopiedCommit(true);
                            setTimeout(() => setCopiedCommit(false), 2000);
                          }}
                          className="p-1 text-zinc-400 hover:text-zinc-200"
                          title="Copy Commit SHA"
                        >
                          {copiedCommit ? (
                            <Check size={12} className="text-emerald-500" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {processInfo.git.remoteUrl && (
                    <div>
                      <span className="text-zinc-500 text-[11px] block">Remote Origin</span>
                      <a
                        href={processInfo.git.remoteUrl.replace(
                          /^git@github\.com:/,
                          'https://github.com/',
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 mt-0.5 truncate"
                      >
                        {processInfo.git.remoteUrl} <ExternalLink size={11} />
                      </a>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <span className="text-zinc-500 text-[11px] block">Commit Message & Author</span>
                    <p className="font-medium text-zinc-800 dark:text-zinc-200 mt-0.5">
                      "{processInfo.git.commitMessage || 'N/A'}"
                    </p>
                    {processInfo.git.commitAuthor && (
                      <span className="text-[11px] text-zinc-500 flex items-center gap-1 mt-1">
                        <User size={11} /> {processInfo.git.commitAuthor}
                        {processInfo.git.commitDate && (
                          <span className="text-zinc-400 ml-1">
                            •{' '}
                            {new Date(processInfo.git.commitDate).toLocaleString([], {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="text-zinc-500 text-[11px] block">Working Directory (CWD)</span>
                    <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 mt-0.5 truncate">
                      <Folder size={12} className="text-purple-500 shrink-0" />{' '}
                      {processInfo.cwd || processInfo.scriptPath}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-zinc-50 dark:bg-zinc-950/60 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 text-xs flex items-center gap-2">
                <Folder size={14} className="text-zinc-400" />
                <span>
                  Working Directory:{' '}
                  <code className="font-mono">
                    {processInfo?.cwd || processInfo?.scriptPath || 'Unknown'}
                  </code>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Custom Probes & Metrics */}
      {activeTab === 'probes' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Zap size={14} className="text-sky-500" /> HTTP Throughput
              </span>
              <div className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {processInfo?.rps ? `${processInfo.rps} req/min` : '0 req/min'}
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Clock size={14} className="text-rose-500" /> Mean Latency
              </span>
              <div className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {processInfo?.latencyMs != null ? `${processInfo.latencyMs} ms` : '—'}
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Activity size={14} className="text-amber-500" /> Event Loop Delay
              </span>
              <div className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {processInfo?.eventLoopDelayMs != null ? `${processInfo.eventLoopDelayMs} ms` : '—'}
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Active Handles / Reqs
              </span>
              <div className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {processInfo?.activeHandles != null ? processInfo.activeHandles : '—'} /{' '}
                {processInfo?.activeRequests != null ? processInfo.activeRequests : '—'}
              </div>
            </div>
          </div>

          {/* Custom Probes Table */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
              Application Probes
            </h2>
            {processInfo?.customProbes && Object.keys(processInfo.customProbes).length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                {Object.entries(processInfo.customProbes).map(([k, v]: any) => (
                  <div
                    key={k}
                    className="p-3 bg-zinc-50 dark:bg-zinc-950/60 rounded-lg border border-zinc-200 dark:border-zinc-800 flex justify-between items-center"
                  >
                    <span className="text-zinc-600 dark:text-zinc-400">{k}</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">
                      {v.value} {v.unit || ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-zinc-500 py-6 text-center">
                No custom @pm2/io probes detected for this process.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Custom Actions */}
      {activeTab === 'actions' && (
        <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <PlayCircle size={16} className="text-sky-500" /> Actions
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Execute runtime functions exposed by the application via PM2 action triggers.
            </p>
          </div>

          {actionOutput && (
            <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 font-mono text-xs text-zinc-800 dark:text-zinc-200">
              {actionOutput}
            </div>
          )}

          <div className="space-y-2">
            {processInfo?.availableActions && processInfo.availableActions.length > 0 ? (
              processInfo.availableActions.map((actionName: string) => (
                <div
                  key={actionName}
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800"
                >
                  <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-200">
                    {actionName}
                  </span>
                  <button
                    onClick={() => handleTriggerCustomAction(actionName)}
                    className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors shadow-sm"
                  >
                    Trigger Action
                  </button>
                </div>
              ))
            ) : (
              <div className="text-xs text-zinc-500 py-8 text-center">
                No custom axm actions advertised by this process.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Live Terminal */}
      {activeTab === 'terminal' && selectedNodeId && (
        <LiveTerminal nodeId={selectedNodeId} processName={processName} height="h-[28rem]" />
      )}

      {/* Tab 5: Environment & Secrets */}
      {activeTab === 'env' && (
        <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <ShieldAlert size={15} className="text-amber-500" /> Environment Variables & Secrets
              </h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Secret values are masked by default. Revealing any key requires operator permission
                and is logged to the Audit Trail.
              </p>
            </div>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800/80 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400">
                  <th className="py-2.5 px-4 w-1/3">Key</th>
                  <th className="py-2.5 px-4">Value</th>
                  <th className="py-2.5 px-4 text-right w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                {Object.keys(envVars).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-zinc-400 dark:text-zinc-500">
                      No custom environment variables found.
                    </td>
                  </tr>
                ) : (
                  Object.entries(envVars).map(([k, maskedVal]) => {
                    const isRevealed = revealedKeys[k] !== undefined;
                    return (
                      <tr key={k} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/20">
                        <td className="py-2 px-4 font-semibold text-zinc-800 dark:text-zinc-300">
                          {k}
                        </td>
                        <td className="py-2 px-4 text-zinc-600 dark:text-zinc-400 break-all">
                          {isRevealed ? (
                            <span className="text-emerald-600 dark:text-emerald-300 font-bold">
                              {revealedKeys[k]}
                            </span>
                          ) : (
                            <span className="text-zinc-400 dark:text-zinc-600 tracking-widest">
                              {maskedVal}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-right">
                          {isRevealed ? (
                            <button
                              onClick={() => {
                                const copy = { ...revealedKeys };
                                delete copy[k];
                                setRevealedKeys(copy);
                              }}
                              className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                              title="Mask"
                            >
                              <EyeOff size={13} />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRevealKey(k)}
                              className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded text-[11px] flex items-center gap-1 ml-auto border border-zinc-300 dark:border-zinc-700"
                              title="Reveal value (Audit Logged)"
                            >
                              <Eye size={11} /> Reveal
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Scale Modal */}
      {scaleModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setScaleModalOpen(false)}
          title={`Scale '${processName}' Cluster Instances`}
        >
          <div className="space-y-4 text-xs">
            <p className="text-zinc-600 dark:text-zinc-400">
              Zero-downtime cluster scaling adjusts the number of parallel worker instances running
              for this application.
            </p>

            <div className="p-4 bg-zinc-100 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between font-medium">
                <span className="text-zinc-700 dark:text-zinc-300">Target Instances:</span>
                <span className="text-lg font-bold font-mono text-sky-600 dark:text-sky-400">
                  {targetInstances} instances
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="16"
                value={targetInstances}
                onChange={(e) => setTargetInstances(Number(e.target.value))}
                className="w-full accent-sky-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setScaleModalOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleScale}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium shadow-sm"
              >
                Apply Scale
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
