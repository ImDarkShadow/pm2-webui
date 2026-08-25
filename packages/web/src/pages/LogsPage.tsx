import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Search, Download, ArrowDown } from 'lucide-react';
import { api } from '../api/client.js';
import { useNodeStore } from '../store/nodeStore.js';

export const LogsPage: React.FC = () => {
  const { selectedNodeId } = useNodeStore();
  const [processes, setProcesses] = useState<any[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<string>('');
  const [stream, setStream] = useState<string>('both');
  const [granularity, setGranularity] = useState<'1h' | '10m' | '1m' | '10s' | '1s'>('1m');
  const [summaries, setSummaries] = useState<any[]>([]);
  const [rawLogs, setRawLogs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(false);

  const logContainerRef = useRef<HTMLDivElement>(null);

  // Load Process List
  useEffect(() => {
    if (!selectedNodeId) return;
    api.getProcesses(selectedNodeId).then((procs) => {
      setProcesses(procs);
      if (procs.length > 0 && !selectedProcess) {
        setSelectedProcess(procs[0].name);
      }
    });
  }, [selectedNodeId]);

  // Load Hierarchical Summary Tree
  useEffect(() => {
    if (!selectedNodeId || !selectedProcess) return;
    api
      .getLogTree(selectedNodeId, selectedProcess, granularity)
      .then(setSummaries)
      .catch(console.error);
  }, [selectedNodeId, selectedProcess, granularity]);

  // Load Raw Logs
  const fetchRawLogs = async () => {
    if (!selectedNodeId || !selectedProcess) return;
    setLoading(true);
    try {
      const data = await api.getRawLogs(selectedNodeId, {
        processName: selectedProcess,
        stream,
        search: search || undefined,
        isRegex,
        limit: 1000,
      });
      setRawLogs(data.lines || []);
    } catch (err) {
      console.error('Failed to load raw logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRawLogs();
    const interval = setInterval(fetchRawLogs, 3000);
    return () => clearInterval(interval);
  }, [selectedNodeId, selectedProcess, stream, search, isRegex]);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [rawLogs, autoScroll]);

  const handleDownload = () => {
    const content = rawLogs
      .map((l) => `[${new Date(l.timestamp).toISOString()}] [${l.stream}] ${l.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedProcess || 'cluster'}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full h-[calc(100vh-6.5rem)] flex flex-col space-y-3">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
            <Terminal size={18} className="text-emerald-500" /> Logs
          </h1>
          <p className="text-xs text-zinc-500">Stream and filter live PM2 process output</p>
        </div>

        {/* Process & Stream Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedProcess}
            onChange={(e) => setSelectedProcess(e.target.value)}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-semibold rounded-lg px-3 py-1.5 text-zinc-800 dark:text-zinc-200 focus:outline-none shadow-2xs cursor-pointer"
          >
            {processes.map((p) => (
              <option key={p.pmId} value={p.name}>
                {p.name} (#{p.pmId})
              </option>
            ))}
          </select>

          <div className="flex items-center p-0.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs shadow-2xs">
            {['both', 'stdout', 'stderr'].map((st) => (
              <button
                key={st}
                onClick={() => setStream(st)}
                className={`px-2 py-1 rounded capitalize font-medium transition-colors ${
                  stream === st
                    ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <button
            onClick={handleDownload}
            className="p-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors shadow-2xs"
            title="Download Logs"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Progressive Zoom Tree Resolution Bar */}
      <div className="bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-2.5 shrink-0 flex items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Resolution:
          </span>
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-950 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs">
            {(['1h', '10m', '1m', '10s', '1s'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-2 py-0.5 rounded font-mono font-medium transition-colors ${
                  granularity === g
                    ? 'bg-white dark:bg-zinc-800 text-sky-600 dark:text-sky-300 font-bold shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Bucket Timeline Visualization Bars */}
        <div className="flex-1 flex items-end gap-1 h-6 px-2 overflow-hidden">
          {summaries.slice(-30).map((b, i) => {
            const hasErrors = b.errorCount > 0;
            const height = Math.min(24, Math.max(4, b.lineCount * 3));
            return (
              <div
                key={i}
                title={`${new Date(b.bucketTimestamp).toLocaleTimeString()}: ${b.lineCount} lines (${b.errorCount} errors)`}
                style={{ height: `${height}px` }}
                className={`flex-1 rounded-t-sm transition-all cursor-pointer ${
                  hasErrors
                    ? 'bg-rose-500 hover:bg-rose-400'
                    : 'bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Search & Auto-scroll Bar */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-2.5 text-zinc-400 dark:text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter logs by keyword or regex..."
            className="w-full bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-8 pr-16 py-1.5 text-xs font-mono text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
          <button
            onClick={() => setIsRegex(!isRegex)}
            className={`absolute right-2 top-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
              isRegex
                ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/40'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            .*
          </button>
        </div>

        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            autoScroll
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
        >
          <ArrowDown size={13} />
          Auto-scroll
        </button>
      </div>

      {/* Log Output Window */}
      <div
        ref={logContainerRef}
        className="flex-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/90 rounded-xl p-4 font-mono text-xs overflow-y-auto space-y-1 select-text shadow-xs"
      >
        {rawLogs.length === 0 ? (
          <div className="text-center py-16 text-zinc-400 dark:text-zinc-600">
            {loading ? 'Fetching log streams...' : 'No logs available for selected process.'}
          </div>
        ) : (
          rawLogs.map((line, idx) => {
            const isErr = line.stream === 'stderr' || /\b(error|fatal|fail)\b/i.test(line.message);
            const isWarn = /\b(warn|warning)\b/i.test(line.message);

            let colorClass = 'text-zinc-800 dark:text-zinc-300';
            if (isErr) colorClass = 'text-rose-600 dark:text-rose-400 font-medium';
            else if (isWarn) colorClass = 'text-amber-600 dark:text-amber-300 font-medium';

            return (
              <div
                key={idx}
                className="flex items-start gap-3 hover:bg-zinc-200/60 dark:hover:bg-zinc-900/60 px-1.5 py-0.5 rounded leading-relaxed transition-colors"
              >
                <span className="text-[10px] text-zinc-400 dark:text-zinc-600 shrink-0 select-none">
                  {new Date(line.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className={`text-[10px] uppercase font-bold shrink-0 select-none ${
                    line.stream === 'stderr'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  [{line.stream}]
                </span>
                <span className={`break-all ${colorClass}`}>{line.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
