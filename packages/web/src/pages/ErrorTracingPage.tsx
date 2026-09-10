import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  RefreshCw,
  Search,
  Check,
  Copy,
  Terminal,
  Flame,
  Filter,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useNodeStore } from '../store/nodeStore.js';
import { usePreferencesStore } from '../store/preferencesStore.js';
import { Modal } from '../components/ui/Modal.js';

export const ErrorTracingPage: React.FC = () => {
  const { selectedNodeId, nodes } = useNodeStore();
  const { density } = usePreferencesStore();
  const isCompact = (density as any) === 'compact';

  const [activeSubTab, setActiveSubTab] = useState<'traces' | 'crashes'>('traces');
  const [traces, setTraces] = useState<any[]>([]);
  const [crashes, setCrashes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [processFilter, setProcessFilter] = useState<string>('all');
  const [unresolvedOnly, setUnresolvedOnly] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Trace for Modal
  const [selectedTrace, setSelectedTrace] = useState<any | null>(null);
  const [copiedStack, setCopiedStack] = useState(false);

  const activeNodeId = selectedNodeId || nodes[0]?.id;

  const loadData = async () => {
    if (!activeNodeId) return;
    setLoading(true);
    try {
      if (activeSubTab === 'traces') {
        const data = await api.getErrorTraces(activeNodeId, {
          processName: processFilter !== 'all' ? processFilter : undefined,
          resolved: unresolvedOnly ? false : undefined,
          search: searchQuery || undefined,
          limit: 100,
        });
        setTraces(Array.isArray(data) ? data : []);
      } else {
        const data = await api.getCrashes(
          activeNodeId,
          processFilter !== 'all' ? processFilter : undefined,
          50,
        );
        setCrashes(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load observability data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeNodeId, activeSubTab, processFilter, unresolvedOnly]);

  const handleResolve = async (errorId: string) => {
    if (!activeNodeId) return;
    try {
      await api.resolveErrorTrace(activeNodeId, errorId);
      setTraces((prev) =>
        prev.map((t) => (t.id === errorId ? { ...t, resolved: true, resolvedAt: Date.now() } : t)),
      );
      if (selectedTrace?.id === errorId) {
        setSelectedTrace((prev: any) => ({ ...prev, resolved: true, resolvedAt: Date.now() }));
      }
    } catch (err: any) {
      alert(`Failed to resolve error trace: ${err.message}`);
    }
  };

  // Get distinct processes from loaded data
  const processNames = Array.from(
    new Set([...traces.map((t) => t.processName), ...crashes.map((c) => c.processName)]),
  ).filter(Boolean);

  const filteredTraces = traces.filter((t) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchMsg = t.message?.toLowerCase().includes(q);
      const matchName = t.errorName?.toLowerCase().includes(q);
      const matchProc = t.processName?.toLowerCase().includes(q);
      const matchFingerprint = t.fingerprint?.toLowerCase().includes(q);
      if (!matchMsg && !matchName && !matchProc && !matchFingerprint) return false;
    }
    return true;
  });

  const formatRelativeTime = (ts: number): string => {
    if (!ts) return 'Unknown';
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  };

  return (
    <div className={`w-full ${isCompact ? 'space-y-4' : 'space-y-6'}`}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
            <AlertOctagon size={20} className="text-rose-500" /> Error Tracing & Crash Analytics
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Automated exception grouping, SHA256 fingerprinting, stack traces, and process crash
            post-mortems
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub-tab Switcher */}
          <div className="flex items-center p-0.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs shadow-2xs">
            <button
              onClick={() => setActiveSubTab('traces')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors ${
                activeSubTab === 'traces'
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <AlertOctagon size={13} className="text-rose-500" />
              <span>Error Traces</span>
            </button>
            <button
              onClick={() => setActiveSubTab('crashes')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors ${
                activeSubTab === 'crashes'
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Flame size={13} className="text-amber-500" />
              <span>Crash Dumps</span>
            </button>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors shadow-2xs"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="text"
              placeholder="Search error, message, or fingerprint..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-rose-500 w-64"
            />
          </div>

          {/* Process Filter */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Filter size={13} />
            <select
              value={processFilter}
              onChange={(e) => setProcessFilter(e.target.value)}
              className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none"
            >
              <option value="all">All Processes</option>
              {processNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Unresolved Only Checkbox (Only for traces) */}
          {activeSubTab === 'traces' && (
            <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={unresolvedOnly}
                onChange={(e) => setUnresolvedOnly(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-700 text-rose-600 focus:ring-rose-500 h-3.5 w-3.5"
              />
              <span>Unresolved Only</span>
            </label>
          )}
        </div>

        <div className="text-xs text-zinc-400 font-mono">
          {activeSubTab === 'traces'
            ? `${filteredTraces.length} Error Group${filteredTraces.length === 1 ? '' : 's'}`
            : `${crashes.length} Crash Event${crashes.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {/* Sub-Tab 1: Error Traces Table */}
      {activeSubTab === 'traces' && (
        <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-medium">
                <th className="py-3 px-4">Error & Fingerprint</th>
                <th className="py-3 px-4">Process</th>
                <th className="py-3 px-4">Message Preview</th>
                <th className="py-3 px-4 text-center">Occurrences</th>
                <th className="py-3 px-4">Last Seen</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
              {filteredTraces.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">
                    <CheckCircle2 size={32} className="mx-auto text-emerald-500/60 mb-2" />
                    <p className="font-medium text-zinc-700 dark:text-zinc-300">
                      No errors detected!
                    </p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      All processes on this node are operating cleanly without unhandled exceptions.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredTraces.map((trace) => {
                  const isResolved = Boolean(trace.resolved);
                  return (
                    <tr
                      key={trace.id}
                      className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono text-xs text-rose-600 dark:text-rose-400">
                            {trace.errorName || 'Error'}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-400">
                            #{trace.fingerprint?.slice(0, 10)}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono font-medium text-zinc-700 dark:text-zinc-300">
                        {trace.processName}
                        <span className="text-[10px] text-zinc-400 ml-1">#{trace.pmId}</span>
                      </td>

                      <td className="py-3 px-4 max-w-xs truncate font-mono text-zinc-600 dark:text-zinc-400">
                        {trace.message}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-mono">
                          {trace.occurrenceCount || 1}x
                        </span>
                      </td>

                      <td className="py-3 px-4 text-zinc-500 font-mono text-[11px]">
                        <span title={new Date(trace.lastSeenAt).toLocaleString()}>
                          {formatRelativeTime(trace.lastSeenAt)}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {isResolved ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 size={11} /> Resolved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <AlertOctagon size={11} /> Active
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => setSelectedTrace(trace)}
                          className="px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium text-xs transition-colors"
                        >
                          View Trace
                        </button>
                        {!isResolved && (
                          <button
                            onClick={() => handleResolve(trace.id)}
                            className="px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium text-xs transition-colors"
                          >
                            Resolve
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
      )}

      {/* Sub-Tab 2: Crash Dumps & Post-Mortems */}
      {activeSubTab === 'crashes' && (
        <div className="space-y-4">
          {crashes.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-12 text-center text-zinc-400">
              <CheckCircle2 size={32} className="mx-auto text-emerald-500/60 mb-2" />
              <p className="font-medium text-zinc-700 dark:text-zinc-300">
                No process crashes recorded!
              </p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Node lifecycle events show all processes running stably without sudden exits.
              </p>
            </div>
          ) : (
            crashes.map((crash) => {
              const dateStr = new Date(crash.crashedAt).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'medium',
              });

              return (
                <div
                  key={crash.id}
                  className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <Flame size={18} className="text-rose-500" />
                      <div>
                        <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 font-mono">
                          {crash.processName}
                          <span className="text-zinc-400 font-normal text-xs ml-1.5">
                            (PM_ID #{crash.pmId})
                          </span>
                        </h3>
                        <span className="text-[11px] text-zinc-400">
                          Crashed at {dateStr} ({formatRelativeTime(crash.crashedAt)})
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-semibold">
                        Exit Code: {crash.exitCode ?? 'N/A'}
                      </span>
                      {crash.signal && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Signal: {crash.signal}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Pre-Crash Context Logs */}
                  {crash.logsBefore && crash.logsBefore.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500 font-medium">
                        <Terminal size={12} />
                        <span>Pre-Crash Context Logs (Stdout / Stderr before crash):</span>
                      </div>
                      <div className="p-3 bg-zinc-950 rounded-lg text-zinc-200 font-mono text-[11px] overflow-x-auto max-h-48 divide-y divide-zinc-900">
                        {crash.logsBefore.map((l: any, i: number) => (
                          <div key={i} className="py-0.5 flex gap-2">
                            <span className="text-zinc-500 select-none shrink-0">
                              {l.stream || 'err'}
                            </span>
                            <span
                              className={l.stream === 'stderr' ? 'text-rose-400' : 'text-zinc-300'}
                            >
                              {l.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Error Trace Detail Modal */}
      {selectedTrace && (
        <Modal
          isOpen={Boolean(selectedTrace)}
          onClose={() => setSelectedTrace(null)}
          title={`Error Details: ${selectedTrace.errorName || 'Unhandled Exception'}`}
          maxWidth="max-w-3xl"
        >
          <div className="space-y-4">
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-zinc-50 dark:bg-zinc-950/60 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="space-y-1 font-mono text-xs">
                <div>
                  <span className="text-zinc-400">Process:</span>{' '}
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    {selectedTrace.processName} (#{selectedTrace.pmId})
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">Fingerprint:</span>{' '}
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {selectedTrace.fingerprint}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-mono">
                  {selectedTrace.occurrenceCount || 1} Occurrences
                </span>
                {!selectedTrace.resolved && (
                  <button
                    onClick={() => handleResolve(selectedTrace.id)}
                    className="px-3 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-xs font-medium transition-colors"
                  >
                    Mark Resolved
                  </button>
                )}
              </div>
            </div>

            {/* Error Message */}
            <div className="space-y-1">
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Exception Message:
              </span>
              <div className="p-3 bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20 rounded-lg font-mono text-xs text-rose-700 dark:text-rose-300 select-text">
                {selectedTrace.message}
              </div>
            </div>

            {/* Stack Trace */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Stack Trace:
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedTrace.stackTrace || '');
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
                {selectedTrace.stackTrace || 'No stack trace available.'}
              </pre>
            </div>

            {/* Context Logs */}
            {selectedTrace.contextLogs && selectedTrace.contextLogs.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Surrounding Context Logs:
                </span>
                <div className="p-3 bg-zinc-950 rounded-lg font-mono text-[11px] text-zinc-300 max-h-48 overflow-y-auto space-y-1 border border-zinc-800">
                  {selectedTrace.contextLogs.map((log: any, idx: number) => (
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
    </div>
  );
};
