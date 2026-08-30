import React from 'react';
import {
  Play,
  Square,
  RotateCw,
  Zap,
  Sliders,
  Terminal,
  GitBranch,
  Server,
  Activity,
  Cpu,
} from 'lucide-react';
import { ClusterProcessInfo } from '@pm2-webui/shared';

export interface ProcessCardProps {
  readonly process: ClusterProcessInfo;
  readonly isSelected?: boolean;
  readonly density?: 'comfortable' | 'compact';
  readonly onToggleSelect?: () => void;
  readonly onAction: (
    action: 'start' | 'stop' | 'restart' | 'reload' | 'delete',
    target: string | number,
    nodeId: string,
  ) => void;
  readonly onOpenLogs: (proc: ClusterProcessInfo) => void;
  readonly onOpenScale: (proc: ClusterProcessInfo) => void;
  readonly onClickName?: () => void;
}

export const ProcessCard: React.FC<ProcessCardProps> = ({
  process: proc,
  isSelected,
  density = 'comfortable',
  onToggleSelect,
  onAction,
  onOpenLogs,
  onOpenScale,
  onClickName,
}) => {
  const isOnline = proc.status === 'online';
  const isErrored = proc.status === 'errored';
  const isStopped = proc.status === 'stopped';
  const isCompact = density === 'compact';

  const cpuPercent = proc.monit?.cpu ?? 0;
  const memoryMb = Math.round((proc.monit?.memory || 0) / 1024 / 1024);

  const getStatusPulseColor = () => {
    if (isOnline) return 'bg-emerald-500 shadow-emerald-500/50';
    if (isErrored) return 'bg-rose-500 shadow-rose-500/50';
    if (isStopped) return 'bg-zinc-500 shadow-zinc-500/50';
    return 'bg-amber-500 shadow-amber-500/50';
  };

  const getCpuBarColor = () => {
    if (cpuPercent > 80) return 'bg-rose-500';
    if (cpuPercent > 50) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '0s';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div
      className={`group relative bg-white dark:bg-zinc-900/80 border rounded-xl transition-all duration-200 hover:shadow-md ${
        isCompact ? 'p-3' : 'p-4'
      } ${
        isSelected
          ? 'border-emerald-500 ring-1 ring-emerald-500/30'
          : 'border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="rounded text-emerald-600 focus:ring-0 cursor-pointer"
            />
          )}

          {/* Status Dot */}
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {isOnline && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 shadow-sm ${getStatusPulseColor()}`}
            />
          </span>

          <div className="min-w-0">
            <button
              type="button"
              onClick={onClickName}
              className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate hover:text-emerald-500 transition-colors text-left block"
            >
              {proc.name}
            </button>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
              <span>id: #{proc.pmId}</span>
              <span>•</span>
              <span
                className="flex items-center gap-0.5"
                title={`Host: ${proc.nodeHostname || 'local'}`}
              >
                <Server size={10} className="text-zinc-400" />
                <span className="truncate max-w-[80px]">{proc.nodeHostname || 'local'}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Instances Chip */}
        {(proc.instances || 1) > 1 && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shrink-0">
            {proc.instances}x
          </span>
        )}
      </div>

      {/* Resource Meters */}
      <div className={`space-y-1.5 text-xs ${isCompact ? 'mt-2' : 'mt-3.5'}`}>
        {/* CPU */}
        <div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-0.5">
            <span className="flex items-center gap-1">
              <Cpu size={11} /> CPU
            </span>
            <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
              {cpuPercent}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${getCpuBarColor()}`}
              style={{ width: `${Math.min(100, Math.max(2, cpuPercent))}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-0.5">
            <span className="flex items-center gap-1">
              <Activity size={11} /> RAM
            </span>
            <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
              {memoryMb} MB
            </span>
          </div>
          <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, Math.max(3, (memoryMb / 1024) * 100))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Meta Footer */}
      <div
        className={`border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-500 ${isCompact ? 'mt-2 pt-2' : 'mt-3 pt-2.5'}`}
      >
        <div className="flex items-center gap-1.5">
          <span>{formatUptime(proc.uptime)}</span>
          <span>•</span>
          <span>{proc.restarts ?? 0}r</span>
        </div>

        {proc.git && (
          <span
            className="flex items-center gap-1 font-mono text-[9px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-600 dark:text-zinc-300"
            title={`Branch: ${proc.git.branch} (${proc.git.commitHash})`}
          >
            <GitBranch size={10} />
            <span className="truncate max-w-[65px]">{proc.git.branch}</span>
          </span>
        )}
      </div>

      {/* Action Toolbar */}
      <div
        className={`border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-1 ${isCompact ? 'mt-2 pt-1.5' : 'mt-3 pt-2'}`}
      >
        <div className="flex items-center gap-0.5">
          {/* Graceful Reload */}
          <button
            type="button"
            onClick={() => onAction('reload', proc.pmId, proc.nodeId)}
            className="p-1 text-zinc-500 hover:text-amber-500 hover:bg-amber-500/10 rounded-md transition-colors"
            title="Graceful Reload (Zero-Downtime)"
          >
            <Zap size={13} />
          </button>

          {/* Hard Restart */}
          <button
            type="button"
            onClick={() => onAction('restart', proc.pmId, proc.nodeId)}
            className="p-1 text-zinc-500 hover:text-blue-500 hover:bg-blue-500/10 rounded-md transition-colors"
            title="Hard Restart"
          >
            <RotateCw size={13} />
          </button>

          {/* Stop / Start */}
          {isOnline ? (
            <button
              type="button"
              onClick={() => onAction('stop', proc.pmId, proc.nodeId)}
              className="p-1 text-zinc-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-md transition-colors"
              title="Stop Process"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onAction('start', proc.pmId, proc.nodeId)}
              className="p-1 text-zinc-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-md transition-colors"
              title="Start Process"
            >
              <Play size={13} />
            </button>
          )}

          {/* Scale */}
          <button
            type="button"
            onClick={() => onOpenScale(proc)}
            className="p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            title="Scale Cluster Instances"
          >
            <Sliders size={13} />
          </button>
        </div>

        {/* Quick Logs Drawer Trigger */}
        <button
          type="button"
          onClick={() => onOpenLogs(proc)}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
        >
          <Terminal size={11} /> Logs
        </button>
      </div>
    </div>
  );
};
