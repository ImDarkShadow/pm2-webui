import React, { useEffect, useState } from 'react';
import { Shield, RefreshCw } from 'lucide-react';
import { api } from '../api/client.js';

export const AuditPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const loadAuditLogs = async (p = page) => {
    setLoading(true);
    try {
      const data = await api.getAuditLogs(p, 25);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, [page]);

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
            <Shield size={18} className="text-emerald-500" /> Audit Trail & Security Ledger
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Immutable append-only record of administrative actions, process controls, and secret
            reveals
          </p>
        </div>

        <button
          onClick={() => loadAuditLogs(page)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors shadow-sm"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs border-collapse font-mono">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400">
              <th className="py-3 px-4 w-16">ID</th>
              <th className="py-3 px-4">Timestamp</th>
              <th className="py-3 px-4">User</th>
              <th className="py-3 px-4">Action</th>
              <th className="py-3 px-4">Target / Scope</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">IP Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
            {logs.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="py-8 text-center text-zinc-400 dark:text-zinc-500 font-sans"
                >
                  No audit records found.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr
                  key={log.id}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="py-2.5 px-4 text-zinc-400 dark:text-zinc-500">#{log.id}</td>
                  <td className="py-2.5 px-4 text-zinc-600 dark:text-zinc-400">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-zinc-900 dark:text-zinc-200 font-semibold">
                    {log.username || log.userId}
                  </td>
                  <td className="py-2.5 px-4 font-bold text-sky-600 dark:text-sky-300">
                    {log.action}
                  </td>
                  <td className="py-2.5 px-4 text-zinc-600 dark:text-zinc-400 truncate max-w-[180px]">
                    {log.processName || log.nodeId || '-'}
                  </td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        log.status === 'success'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50'
                          : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/50'
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-zinc-400 dark:text-zinc-500">{log.ipAddress}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Total Records: {total}</span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="px-2.5 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 shadow-sm"
          >
            Previous
          </button>
          <span className="font-mono text-zinc-800 dark:text-zinc-300">Page {page}</span>
          <button
            disabled={logs.length < 25}
            onClick={() => setPage(page + 1)}
            className="px-2.5 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 shadow-sm"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};
