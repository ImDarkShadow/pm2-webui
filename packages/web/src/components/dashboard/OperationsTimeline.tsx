import React, { useState } from 'react';
import {
  Rocket,
  RotateCw,
  Zap,
  AlertTriangle,
  Server,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { OperationsTimelineEvent } from '@pm2-cluster/shared';

export interface OperationsTimelineProps {
  readonly events: readonly OperationsTimelineEvent[];
  readonly loading?: boolean;
}

export const OperationsTimeline: React.FC<OperationsTimelineProps> = ({ events, loading }) => {
  const [filter, setFilter] = useState<'all' | 'deploys' | 'incidents' | 'restarts'>('all');

  const filteredEvents = events.filter((ev) => {
    if (filter === 'all') return true;
    if (filter === 'deploys') return ev.type.startsWith('deploy');
    if (filter === 'incidents') return ev.type === 'process_crash' || ev.status === 'error';
    if (filter === 'restarts') return ev.type === 'process_restart' || ev.type === 'process_reload';
    return true;
  });

  const getEventIcon = (event: OperationsTimelineEvent) => {
    switch (event.type) {
      case 'deploy_success':
        return <Rocket size={14} className="text-emerald-500" />;
      case 'deploy_start':
        return <Rocket size={14} className="text-blue-500" />;
      case 'deploy_failure':
        return <XCircle size={14} className="text-rose-500" />;
      case 'process_reload':
        return <Zap size={14} className="text-amber-500" />;
      case 'process_restart':
        return <RotateCw size={14} className="text-blue-400" />;
      case 'process_crash':
        return <AlertTriangle size={14} className="text-rose-500" />;
      case 'process_recovered':
        return <CheckCircle2 size={14} className="text-emerald-400" />;
      case 'node_online':
        return <Server size={14} className="text-emerald-500" />;
      case 'security_alert':
        return <ShieldAlert size={14} className="text-purple-400" />;
      default:
        return <Clock size={14} className="text-zinc-400" />;
    }
  };

  const getEventBadgeColor = (status: OperationsTimelineEvent['status']) => {
    switch (status) {
      case 'success':
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
      case 'error':
        return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
      case 'warning':
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
      default:
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    }
  };

  const formatRelativeTime = (timestamp: number) => {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300">
            <Clock size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Live Operations Timeline
            </h2>
            <p className="text-xs text-zinc-500">
              Real-time cluster activity, deployments, recoveries & incident stream
            </p>
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-950 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px]">
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-1 rounded font-medium transition-colors ${
              filter === 'all'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('deploys')}
            className={`px-2 py-1 rounded font-medium transition-colors ${
              filter === 'deploys'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            Deploys
          </button>
          <button
            onClick={() => setFilter('restarts')}
            className={`px-2 py-1 rounded font-medium transition-colors ${
              filter === 'restarts'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            Restarts
          </button>
          <button
            onClick={() => setFilter('incidents')}
            className={`px-2 py-1 rounded font-medium transition-colors ${
              filter === 'incidents'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            Incidents
          </button>
        </div>
      </div>

      {/* Timeline Stream */}
      {loading && events.length === 0 ? (
        <div className="py-8 text-center text-xs text-zinc-500">Loading operations timeline...</div>
      ) : filteredEvents.length === 0 ? (
        <div className="py-8 text-center text-xs text-zinc-500">
          No operational events recorded yet.
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[1.5px] before:bg-zinc-200 dark:before:bg-zinc-800">
          {filteredEvents.slice(0, 10).map((ev) => (
            <div key={ev.id} className="relative group">
              {/* Event Dot */}
              <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 flex items-center justify-center shadow-xs">
                {getEventIcon(ev)}
              </div>

              {/* Event Content */}
              <div className="p-3 rounded-lg bg-zinc-50/80 dark:bg-zinc-950/60 border border-zinc-200/80 dark:border-zinc-800/80 group-hover:border-zinc-300 dark:group-hover:border-zinc-700 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {ev.title}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${getEventBadgeColor(
                        ev.status,
                      )}`}
                    >
                      {ev.status}
                    </span>
                  </div>
                  <span
                    className="text-[11px] text-zinc-400 font-mono"
                    title={new Date(ev.timestamp).toLocaleString()}
                  >
                    {formatRelativeTime(ev.timestamp)}
                  </span>
                </div>

                <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
                  {ev.nodeHostname && <span>Node: {ev.nodeHostname}</span>}
                  {ev.processName && <span>• Process: {ev.processName}</span>}
                  {ev.appId && <span>• App ID: {ev.appId}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
