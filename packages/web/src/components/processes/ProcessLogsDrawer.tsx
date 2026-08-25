import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Terminal,
  Download,
  Trash2,
  Pause,
  Play,
  Search,
  ArrowDown,
  Server,
} from 'lucide-react';
import { ClusterProcessInfo } from '@pm2-cluster/shared';
import { api } from '../../api/client.js';

export interface ProcessLogsDrawerProps {
  readonly process: ClusterProcessInfo | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

const MAX_RING_BUFFER_LINES = 1000;

export const ProcessLogsDrawer: React.FC<ProcessLogsDrawerProps> = ({
  process: proc,
  isOpen,
  onClose,
}) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'out' | 'err'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !proc) return;

    setLogs([]);
    let isCancelled = false;

    // Initial progressive log fetch
    api
      .getLogs(proc.nodeId, proc.name, { lines: 150 })
      .then((data) => {
        if (isCancelled) return;
        const initialLines = Array.isArray(data.lines) ? data.lines : [];
        setLogs(initialLines.slice(-MAX_RING_BUFFER_LINES));
      })
      .catch((err) => {
        if (isCancelled) return;
        setLogs([`[PM2 Cluster Logs] Failed to load initial log chunk: ${err.message}`]);
      });

    // Progressive log polling interval
    const interval = setInterval(() => {
      if (isPaused || isCancelled) return;
      api
        .getLogs(proc.nodeId, proc.name, { lines: 30 })
        .then((data) => {
          if (isCancelled) return;
          if (data.lines && data.lines.length > 0) {
            setLogs((prev) => {
              const combined = [...prev, ...data.lines];
              if (combined.length > MAX_RING_BUFFER_LINES) {
                return combined.slice(combined.length - MAX_RING_BUFFER_LINES);
              }
              return combined;
            });
          }
        })
        .catch(() => {});
    }, 2500);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [isOpen, proc, isPaused]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  if (!isOpen || !proc) return null;

  const handleScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const handleClear = () => {
    setLogs([]);
  };

  const handleDownload = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${proc.name}-node-${proc.nodeHostname || 'local'}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs.filter((line) => {
    if (filterType === 'out' && line.includes('[ERR]')) return false;
    if (filterType === 'err' && !line.includes('[ERR]') && !line.includes('Error')) return false;
    if (searchQuery && !line.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Terminal size={17} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{proc.name}</h2>
                <span className="text-[10px] font-mono bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400 px-1.5 py-0.2 rounded">
                  pm_id: {proc.pmId}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono flex items-center gap-1 mt-0.5">
                <Server size={11} /> {proc.nodeHostname || 'local'} ({proc.nodeIp || '127.0.0.1'})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-3 border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-900/40 flex items-center justify-between gap-2 text-xs">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search
              size={13}
              className="absolute left-2.5 top-2 text-zinc-400 dark:text-zinc-500"
            />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-8 pr-3 py-1 text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 font-mono"
            />
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px]">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2 py-0.5 rounded ${
                filterType === 'all'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-bold shadow-2xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterType('out')}
              className={`px-2 py-0.5 rounded ${
                filterType === 'out'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-bold shadow-2xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              out
            </button>
            <button
              onClick={() => setFilterType('err')}
              className={`px-2 py-0.5 rounded ${
                filterType === 'err'
                  ? 'bg-white dark:bg-zinc-800 text-rose-600 dark:text-rose-400 font-bold shadow-2xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              err
            </button>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`p-1.5 rounded-lg border transition-colors ${
                isPaused
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                  : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
              title={isPaused ? 'Resume Streaming' : 'Pause Streaming'}
            >
              {isPaused ? <Play size={13} /> : <Pause size={13} />}
            </button>

            <button
              onClick={handleClear}
              className="p-1.5 rounded-lg bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
              title="Clear Terminal"
            >
              <Trash2 size={13} />
            </button>

            <button
              onClick={handleDownload}
              className="p-1.5 rounded-lg bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
              title="Download Logs"
            >
              <Download size={13} />
            </button>
          </div>
        </div>

        {/* Console Body */}
        <div
          ref={terminalRef}
          onScroll={handleScroll}
          className="flex-1 p-4 overflow-y-auto font-mono text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-950 space-y-0.5 select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-zinc-400 dark:text-zinc-600">
              Waiting for process log output...
            </div>
          ) : (
            filteredLogs.map((line, idx) => {
              const isError =
                line.includes('[ERR]') || line.includes('Error:') || line.includes('Exception:');
              return (
                <div
                  key={idx}
                  className={`break-all py-0.5 px-1 rounded ${
                    isError
                      ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20'
                      : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-900/60'
                  }`}
                >
                  <span className="text-zinc-400 dark:text-zinc-600 select-none mr-2">
                    {String(idx + 1).padStart(3, '0')}
                  </span>
                  {line}
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Footer Autoscroll Notice */}
        {!autoScroll && (
          <div className="absolute bottom-4 right-6">
            <button
              onClick={() => {
                setAutoScroll(true);
                logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white dark:text-zinc-950 text-xs font-bold rounded-full shadow-lg transition-colors"
            >
              <ArrowDown size={13} /> Scroll to Bottom
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
