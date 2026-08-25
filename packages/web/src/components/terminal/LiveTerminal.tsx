import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Search, ArrowDown, Download, Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';

interface LiveTerminalProps {
  nodeId: string;
  processName: string;
  height?: string;
  className?: string;
}

// Regex to strip ANSI escape sequences safely
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

const cleanAnsi = (text: string): string => {
  return text.replace(ANSI_REGEX, '');
};

export const LiveTerminal: React.FC<LiveTerminalProps> = ({
  nodeId,
  processName,
  height = 'h-96',
  className = '',
}) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [stream, setStream] = useState<'both' | 'stdout' | 'stderr'>('both');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      const data = await api.getRawLogs(nodeId, {
        processName,
        stream,
        search: search || undefined,
        limit: 500,
      });
      setLogs(data.lines || []);
    } catch {
      // Stream polling catch
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2500);
    return () => clearInterval(interval);
  }, [nodeId, processName, stream, search]);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleDownload = () => {
    const text = logs
      .map((l) => `[${new Date(l.timestamp).toISOString()}] [${l.stream}] ${cleanAnsi(l.message)}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${processName}-console.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`flex flex-col bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs ${className}`}
    >
      {/* Terminal Bar Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-xs shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 mr-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </div>
          <Terminal size={13} className="text-zinc-500 dark:text-zinc-400" />
          <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
            {processName} <span className="text-[10px] text-zinc-500">(Read-Only Stream)</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Stream Filter */}
          <div className="flex items-center p-0.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md text-[11px]">
            {(['both', 'stdout', 'stderr'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStream(s)}
                className={`px-2 py-0.5 rounded capitalize font-medium transition-colors ${
                  stream === s
                    ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-bold shadow-2xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Search Filter */}
          <div className="relative">
            <Search size={11} className="absolute left-2 top-2 text-zinc-400 dark:text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md pl-6 pr-2 py-0.5 text-[11px] text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 font-mono"
            />
          </div>

          {/* Auto scroll & Actions */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1 rounded border transition-colors ${
              autoScroll
                ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : 'bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
            title="Auto-scroll"
          >
            <ArrowDown size={13} />
          </button>
          <button
            onClick={handleDownload}
            className="p-1 rounded bg-white dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
            title="Download Logs"
          >
            <Download size={13} />
          </button>
          <button
            onClick={() => setLogs([])}
            className="p-1 rounded bg-white dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
            title="Clear Console"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        ref={terminalRef}
        className={`${height} p-4 font-mono text-xs overflow-y-auto space-y-1 select-text bg-zinc-50 dark:bg-zinc-950`}
      >
        {logs.length === 0 ? (
          <div className="text-center py-12 text-zinc-400 dark:text-zinc-600">
            Waiting for live output from {processName}...
          </div>
        ) : (
          logs.map((l, i) => {
            const isErr = l.stream === 'stderr' || /\b(error|fatal|fail)\b/i.test(l.message);
            const isWarn = /\b(warn|warning)\b/i.test(l.message);

            let colorClass = 'text-zinc-800 dark:text-zinc-300';
            if (isErr) colorClass = 'text-rose-600 dark:text-rose-400 font-medium';
            else if (isWarn) colorClass = 'text-amber-600 dark:text-amber-300 font-medium';

            return (
              <div
                key={i}
                className="flex items-start gap-2.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-900/60 px-1 py-0.5 rounded leading-relaxed transition-colors"
              >
                <span className="text-[10px] text-zinc-400 dark:text-zinc-600 shrink-0 select-none">
                  {new Date(l.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className={`text-[10px] uppercase font-bold shrink-0 select-none ${
                    l.stream === 'stderr'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  [{l.stream}]
                </span>
                <span className={`break-all ${colorClass}`}>{cleanAnsi(l.message)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
