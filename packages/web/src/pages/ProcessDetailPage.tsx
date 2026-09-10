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
  AlertOctagon,
  Flame,
  CheckCircle2,
  RotateCcw,
  BookmarkCheck,
  BookmarkPlus,
  ArrowDownToLine,
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
    'overview' | 'probes' | 'errors' | 'actions' | 'terminal' | 'env'
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
  // Process-specific Error Traces & Crash Dumps
  const [procErrors, setProcErrors] = useState<any[]>([]);
  const [procCrashes, setProcCrashes] = useState<any[]>([]);
  const [selectedErrorTrace, setSelectedErrorTrace] = useState<any | null>(null);
  const [copiedStack, setCopiedStack] = useState(false);

  // Process Git Management & Deployments
  const [gitTracked, setGitTracked] = useState(false);
  const [, setGitApp] = useState<any | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [gitPullLoading, setGitPullLoading] = useState(false);
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [commitsList, setCommitsList] = useState<any[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [selectedCommitHash, setSelectedCommitHash] = useState('');
  const [customCommitHash, setCustomCommitHash] = useState('');
  const [gitFeedback, setGitFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadHistoricalMetrics = async () => {
    if (!selectedNodeId) return;
    try {
      const now = Date.now();
      const past24h = now - 24 * 60 * 60 * 1000;
      const data = await api.getProcessMetrics(selectedNodeId, processName, past24h, now, 500);
      if (Array.isArray(data) && data.length > 0) {
        const formatted = data.map((m: any) => {
          const d = new Date(m.timestamp);
          return {
            time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            rawTimestamp: m.timestamp,
            cpu: m.cpuPercent ?? 0,
            memory: Math.round((m.memoryBytes || 0) / (1024 * 1024)),
            heapUsed: m.heapUsed ? Math.round(m.heapUsed / (1024 * 1024)) : undefined,
            heapTotal: m.heapTotal ? Math.round(m.heapTotal / (1024 * 1024)) : undefined,
            eventLoop: m.eventLoopDelayMs ?? 0,
            rps: m.rps ?? 0,
            latency: m.latencyMs ?? 0,
          };
        });
        setProcMetricsHistory(formatted);
      }
    } catch (err) {
      console.error('Failed to load historical process metrics', err);
    }
  };

  const loadProcessObservability = async () => {
    if (!selectedNodeId) return;
    try {
      const [errs, crs] = await Promise.all([
        api.getErrorTraces(selectedNodeId, { processName, limit: 50 }).catch(() => []),
        api.getCrashes(selectedNodeId, processName, 20).catch(() => []),
      ]);
      setProcErrors(Array.isArray(errs) ? errs : []);
      setProcCrashes(Array.isArray(crs) ? crs : []);
    } catch (e) {
      console.error('Failed to load process errors/crashes', e);
    }
  };

  const handleResolveProcessError = async (errorId: string) => {
    if (!selectedNodeId) return;
    try {
      await api.resolveErrorTrace(selectedNodeId, errorId);
      setProcErrors((prev) =>
        prev.map((t) => (t.id === errorId ? { ...t, resolved: true, resolvedAt: Date.now() } : t)),
      );
      if (selectedErrorTrace?.id === errorId) {
        setSelectedErrorTrace((prev: any) => ({ ...prev, resolved: true, resolvedAt: Date.now() }));
      }
    } catch (err: any) {
      alert(`Failed to resolve error: ${err.message}`);
    }
  };

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
          const point = {
            time: nowStr,
            rawTimestamp: Date.now(),
            cpu: found.monit?.cpu || 0,
            memory: memMb,
            heapUsed: found.heapUsedMb,
            heapTotal: found.heapTotalMb,
            rps: found.rps || 0,
            eventLoop: found.eventLoopDelayMs || 0.8,
          };

          if (prev.length === 0) {
            return [{ ...point, time: 'Start' }, point];
          }
          return [...prev, point].slice(-60);
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

  const checkGitStatus = async () => {
    if (!selectedNodeId) return;
    try {
      const res = await api.getProcessGitStatus(selectedNodeId, processName);
      setGitTracked(Boolean(res.isTracked));
      setGitApp(res.gitApp || null);
    } catch {
      // Ignored
    }
  };

  const handleTrackInDeployments = async () => {
    if (!selectedNodeId) return;
    setTrackingLoading(true);
    setGitFeedback(null);
    try {
      const res = await api.trackProcessInDeployments(selectedNodeId, processName);
      setGitTracked(true);
      setGitApp(res.app);
      setGitFeedback({
        type: 'success',
        text: res.alreadyTracked
          ? 'Process is already tracked in Git Deployments.'
          : 'Process successfully linked to Git Deployments!',
      });
    } catch (err: any) {
      setGitFeedback({ type: 'error', text: `Failed to link deployments: ${err.message}` });
    } finally {
      setTrackingLoading(false);
    }
  };

  const handleProcessGitPull = async () => {
    if (!selectedNodeId) return;
    setGitPullLoading(true);
    setGitFeedback(null);
    try {
      await api.processGitPull(selectedNodeId, processName, true);
      setGitFeedback({
        type: 'success',
        text: 'Git pull & rebase completed. Process reloaded with latest code.',
      });
      await loadDetails();
      await checkGitStatus();
    } catch (err: any) {
      setGitFeedback({ type: 'error', text: `Git pull failed: ${err.message}` });
    } finally {
      setGitPullLoading(false);
    }
  };

  const handleOpenRollbackModal = async () => {
    if (!selectedNodeId) return;
    setRollbackModalOpen(true);
    setCommitsLoading(true);
    setSelectedCommitHash('');
    setCustomCommitHash('');
    try {
      const res = await api.getProcessGitCommits(selectedNodeId, processName, 20);
      const commits = res.commits || [];
      setCommitsList(commits);
      if (commits.length > 1) {
        setSelectedCommitHash(commits[1].hash);
      }
    } catch (err: any) {
      setCommitsList([]);
    } finally {
      setCommitsLoading(false);
    }
  };

  const handleExecuteRollback = async () => {
    if (!selectedNodeId) return;
    const targetHash = (customCommitHash || selectedCommitHash).trim();
    if (!targetHash) return;

    setRollbackLoading(true);
    try {
      await api.processGitRollback(selectedNodeId, processName, targetHash);
      setRollbackModalOpen(false);
      setGitFeedback({
        type: 'success',
        text: `Rollback to ${targetHash.slice(0, 7)} successful. Process reloaded.`,
      });
      await loadDetails();
      await checkGitStatus();
    } catch (err: any) {
      alert(`Rollback failed: ${err.message}`);
    } finally {
      setRollbackLoading(false);
    }
  };

  useEffect(() => {
    loadHistoricalMetrics();
    loadProcessObservability();
    checkGitStatus();
  }, [selectedNodeId, processName]);

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

      {/* Tab Navigation Bar */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 pb-2 overflow-x-auto">
        {[
          { id: 'overview', label: 'Resource Overview', icon: Cpu },
          { id: 'probes', label: 'Telemetry & Probes', icon: Activity },
          { id: 'errors', label: 'Errors & Crashes', icon: AlertOctagon },
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch size={16} className="text-sky-500" />
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Version Control & Git Information
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {processInfo?.git ? (
                  <>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        processInfo.git.isDirty
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      }`}
                    >
                      {processInfo.git.isDirty ? 'Uncommitted Local Changes' : 'Clean Working Tree'}
                    </span>

                    {/* Track in Deployments Badge or Button */}
                    {gitTracked ? (
                      <a
                        href="/deployments"
                        className="px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                        title="View registered deployment application"
                      >
                        <BookmarkCheck size={13} />
                        <span>Tracked in Deployments</span>
                        <ExternalLink size={10} />
                      </a>
                    ) : (
                      <button
                        onClick={handleTrackInDeployments}
                        disabled={trackingLoading}
                        className="px-2.5 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                        title="Register process into Git Deployments"
                      >
                        <BookmarkPlus size={13} />
                        <span>{trackingLoading ? 'Linking...' : 'Track in Deployments'}</span>
                      </button>
                    )}

                    {/* Git Pull & Rebase Button */}
                    <button
                      onClick={handleProcessGitPull}
                      disabled={gitPullLoading}
                      className="px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs"
                      title="Pull latest code from remote and reload process"
                    >
                      <ArrowDownToLine
                        size={13}
                        className={gitPullLoading ? 'animate-bounce text-sky-500' : 'text-sky-500'}
                      />
                      <span>{gitPullLoading ? 'Pulling...' : 'Pull & Rebase'}</span>
                    </button>

                    {/* Rollback Button */}
                    <button
                      onClick={handleOpenRollbackModal}
                      className="px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-100 dark:hover:bg-amber-950/40 text-zinc-800 dark:text-zinc-200 hover:text-amber-600 dark:hover:text-amber-400 border border-zinc-200 dark:border-zinc-700 text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs"
                      title="Rollback process to a previous git commit"
                    >
                      <RotateCcw size={13} className="text-amber-500" />
                      <span>Rollback...</span>
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-zinc-400 font-mono">
                    No Git repository detected
                  </span>
                )}
              </div>
            </div>

            {/* Git Feedback Alert */}
            {gitFeedback && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-center justify-between border ${
                  gitFeedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300'
                }`}
              >
                <span>{gitFeedback.text}</span>
                <button
                  onClick={() => setGitFeedback(null)}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 ml-2"
                >
                  &times;
                </button>
              </div>
            )}

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

          {/* V8 Heap Memory Timeline */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Activity size={16} className="text-purple-500" />
                V8 Heap Allocation & Memory Timeline
              </h2>
              <span className="text-xs font-mono text-zinc-400">MB</span>
            </div>
            <MetricsAreaChart
              data={procMetricsHistory}
              series={[
                { key: 'memory', label: 'RAM RSS', color: '#a855f7', unit: 'MB' },
                { key: 'heapUsed', label: 'V8 Heap Used', color: '#ec4899', unit: 'MB' },
                { key: 'heapTotal', label: 'V8 Heap Total', color: '#38bdf8', unit: 'MB' },
              ]}
              height={200}
              yAxisUnit=" MB"
            />
          </div>
        </div>
      )}

      {/* Tab: Process Errors & Crashes */}
      {activeTab === 'errors' && (
        <div className="space-y-6">
          {/* 1. Error Traces Table */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <AlertOctagon size={16} className="text-rose-500" />
                  Exception Groups & Stack Traces ({procErrors.length})
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Fingerprinted unhandled exceptions detected in {processName}'s logs.
                </p>
              </div>
              <button
                onClick={loadProcessObservability}
                className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 text-xs flex items-center gap-1.5 transition-colors"
              >
                <RotateCw size={13} /> Refresh
              </button>
            </div>

            {procErrors.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-400">
                <CheckCircle2 size={24} className="mx-auto text-emerald-500 mb-1.5" />
                No unhandled error traces recorded for {processName}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
                      <th className="py-2.5 px-3">Error</th>
                      <th className="py-2.5 px-3">Message</th>
                      <th className="py-2.5 px-3 text-center">Occurrences</th>
                      <th className="py-2.5 px-3">Last Seen</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                    {procErrors.map((err) => (
                      <tr key={err.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20">
                        <td className="py-2.5 px-3 font-mono font-semibold text-rose-600 dark:text-rose-400">
                          {err.errorName || 'Error'}
                          <span className="block text-[10px] text-zinc-400 font-normal">
                            #{err.fingerprint?.slice(0, 8)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 max-w-sm truncate font-mono text-zinc-700 dark:text-zinc-300">
                          {err.message}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-mono">
                            {err.occurrenceCount || 1}x
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-zinc-500 font-mono text-[11px]">
                          {new Date(err.lastSeenAt).toLocaleString([], {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="py-2.5 px-3">
                          {err.resolved ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                              <CheckCircle2 size={11} /> Resolved
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600">
                              <AlertOctagon size={11} /> Active
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-2 whitespace-nowrap">
                          <button
                            onClick={() => setSelectedErrorTrace(err)}
                            className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium text-xs transition-colors"
                          >
                            Trace
                          </button>
                          {!err.resolved && (
                            <button
                              onClick={() => handleResolveProcessError(err.id)}
                              className="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium text-xs transition-colors"
                            >
                              Resolve
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 2. Process Crash History */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Flame size={16} className="text-amber-500" />
                Crash History & Post-Mortems ({procCrashes.length})
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Sudden exits, SIGSEGV/SIGTERM signals, and surrounding output buffer logs.
              </p>
            </div>

            {procCrashes.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-400">
                <CheckCircle2 size={24} className="mx-auto text-emerald-500 mb-1.5" />
                No crash events recorded for {processName}. Process is stable.
              </div>
            ) : (
              <div className="space-y-3">
                {procCrashes.map((crash) => (
                  <div
                    key={crash.id}
                    className="p-4 bg-zinc-50 dark:bg-zinc-950/60 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-zinc-500">
                        {new Date(crash.crashedAt).toLocaleString([], {
                          dateStyle: 'medium',
                          timeStyle: 'medium',
                        })}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-rose-500/10 text-rose-600 font-semibold border border-rose-500/20">
                          Exit: {crash.exitCode ?? 'N/A'}
                        </span>
                        {crash.signal && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            Signal: {crash.signal}
                          </span>
                        )}
                      </div>
                    </div>

                    {crash.logsBefore && crash.logsBefore.length > 0 && (
                      <div className="p-2.5 bg-zinc-950 rounded-lg font-mono text-[11px] text-zinc-300 max-h-36 overflow-y-auto space-y-0.5">
                        {crash.logsBefore.map((l: any, i: number) => (
                          <div key={i} className="flex gap-2">
                            <span className="text-zinc-600 select-none shrink-0">{l.stream}</span>
                            <span
                              className={l.stream === 'stderr' ? 'text-rose-400' : 'text-zinc-300'}
                            >
                              {l.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
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

      {/* Error Trace Detail Modal */}
      {selectedErrorTrace && (
        <Modal
          isOpen={Boolean(selectedErrorTrace)}
          onClose={() => setSelectedErrorTrace(null)}
          title={`Error Details: ${selectedErrorTrace.errorName || 'Unhandled Exception'}`}
          maxWidth="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-zinc-50 dark:bg-zinc-950/60 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="space-y-1 font-mono text-xs">
                <div>
                  <span className="text-zinc-400">Process:</span>{' '}
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    {selectedErrorTrace.processName} (#{selectedErrorTrace.pmId})
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">Fingerprint:</span>{' '}
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {selectedErrorTrace.fingerprint}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-mono">
                  {selectedErrorTrace.occurrenceCount || 1} Occurrences
                </span>
                {!selectedErrorTrace.resolved && (
                  <button
                    onClick={() => handleResolveProcessError(selectedErrorTrace.id)}
                    className="px-3 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-xs font-medium transition-colors"
                  >
                    Mark Resolved
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Exception Message:
              </span>
              <div className="p-3 bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20 rounded-lg font-mono text-xs text-rose-700 dark:text-rose-300 select-text">
                {selectedErrorTrace.message}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Stack Trace:
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedErrorTrace.stackTrace || '');
                    setCopiedStack(true);
                    setTimeout(() => setCopiedStack(false), 2000);
                  }}
                  className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  {copiedStack ? (
                    <Check size={12} className="text-emerald-500" />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span>{copiedStack ? 'Copied' : 'Copy Stack Trace'}</span>
                </button>
              </div>
              <pre className="p-4 bg-zinc-950 text-zinc-300 rounded-lg font-mono text-xs overflow-x-auto max-h-72 select-text border border-zinc-800">
                {selectedErrorTrace.stackTrace || 'No stack trace available.'}
              </pre>
            </div>

            {selectedErrorTrace.contextLogs && selectedErrorTrace.contextLogs.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Surrounding Context Logs:
                </span>
                <div className="p-3 bg-zinc-950 rounded-lg font-mono text-[11px] text-zinc-300 max-h-48 overflow-y-auto space-y-1 border border-zinc-800">
                  {selectedErrorTrace.contextLogs.map((log: any, idx: number) => (
                    <div key={idx} className="flex gap-2">
                      <span className="text-zinc-500 select-none">
                        {new Date(log.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <span
                        className={log.stream === 'stderr' ? 'text-rose-400' : 'text-zinc-300'}
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Git Rollback Modal */}
      {rollbackModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setRollbackModalOpen(false)}
          title={`Rollback "${processName}" to a Commit`}
        >
          <div className="space-y-4 text-xs">
            <p className="text-zinc-600 dark:text-zinc-400">
              Select a previous commit from Git history to hard-reset the process working directory and restart it.
            </p>

            {commitsLoading ? (
              <div className="p-8 text-center text-zinc-400 flex flex-col items-center gap-2">
                <RotateCw size={18} className="animate-spin" />
                <span>Fetching commit history...</span>
              </div>
            ) : commitsList.length === 0 ? (
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 text-center">
                No commit history found via git log.
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-2 pr-1 divide-y divide-zinc-100 dark:divide-zinc-800/60 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 bg-zinc-50/50 dark:bg-zinc-950/40">
                {commitsList.map((c, index) => {
                  const isCurrent = index === 0;
                  const isSelected = selectedCommitHash === c.hash;
                  return (
                    <div
                      key={c.hash}
                      onClick={() => {
                        setSelectedCommitHash(c.hash);
                        setCustomCommitHash('');
                      }}
                      className={`pt-2 first:pt-0 pb-2 cursor-pointer flex items-start gap-2.5 transition-colors rounded px-2 ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500/30'
                          : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name="selectedCommit"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedCommitHash(c.hash);
                          setCustomCommitHash('');
                        }}
                        className="mt-1 text-amber-500 focus:ring-amber-400"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100 bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[11px]">
                            {c.shortHash}
                          </span>
                          {isCurrent && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-500/20 text-sky-600 dark:text-sky-300">
                              Current HEAD
                            </span>
                          )}
                          <span className="text-zinc-400 text-[10px]">
                            {new Date(c.date).toLocaleString([], {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        </div>
                        <p className="text-zinc-800 dark:text-zinc-200 font-medium truncate mt-1">
                          {c.message}
                        </p>
                        <span className="text-[10px] text-zinc-400">By {c.author}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Custom Commit Input */}
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-1">
              <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 block">
                Or specify target commit hash / tag manually:
              </label>
              <input
                type="text"
                value={customCommitHash}
                onChange={(e) => {
                  setCustomCommitHash(e.target.value);
                  setSelectedCommitHash('');
                }}
                placeholder="e.g. 9f4a12c or full 40-char SHA"
                className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setRollbackModalOpen(false)}
                disabled={rollbackLoading}
                className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteRollback}
                disabled={rollbackLoading || (!selectedCommitHash && !customCommitHash.trim())}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm"
              >
                {rollbackLoading ? <RotateCw size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                Confirm Rollback
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
