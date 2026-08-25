import React, { useEffect, useState } from 'react';
import {
  Square,
  RotateCw,
  Zap,
  Search,
  ExternalLink,
  Layers,
  LayoutGrid,
  List,
  Server,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useNodeStore } from '../store/nodeStore.js';
import { usePreferencesStore } from '../store/preferencesStore.js';
import { usePageVisibility } from '../hooks/usePageVisibility.js';
import { ClusterProcessInfo } from '@pm2-cluster/shared';
import { ProcessCard } from '../components/processes/ProcessCard.js';
import { ProcessLogsDrawer } from '../components/processes/ProcessLogsDrawer.js';
import { Modal } from '../components/ui/Modal.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';

export interface ProcessesPageProps {
  readonly onSelectProcess: (procName: string) => void;
}

export const ProcessesPage: React.FC<ProcessesPageProps> = ({ onSelectProcess }) => {
  const { nodes, selectedNodeId, setSelectedNodeId } = useNodeStore();
  const {
    processViewMode,
    setProcessViewMode,
    selectedNodeFilter,
    setSelectedNodeFilter,
    density,
  } = usePreferencesStore();
  const isVisible = usePageVisibility();

  const [processes, setProcesses] = useState<ClusterProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTargets, setSelectedTargets] = useState<
    { nodeId: string; pmId: number | string }[]
  >([]);
  const [scalingProc, setScalingProc] = useState<ClusterProcessInfo | null>(null);
  const [targetInstances, setTargetInstances] = useState<number>(2);
  const [activeLogsProc, setActiveLogsProc] = useState<ClusterProcessInfo | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Pagination for high-scale clusters
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 48;

  const loadProcesses = async () => {
    // Optimization: Skip fetching if tab is hidden/minimized
    if (!isVisible) return;

    try {
      if (selectedNodeFilter === 'all' || !selectedNodeId) {
        const allProcs = await api.getAllProcesses();
        setProcesses(allProcs || []);
      } else {
        const nodeProcs = await api.getProcesses(selectedNodeId);
        const node = nodes.find((n) => n.id === selectedNodeId);
        const formatted: ClusterProcessInfo[] = (nodeProcs || []).map((p: any) => ({
          ...p,
          nodeId: selectedNodeId,
          nodeHostname: node?.hostname || 'local',
          nodeIp: node?.ipAddress || '127.0.0.1',
        }));
        setProcesses(formatted);
      }
    } catch (err: any) {
      console.error('Failed to load processes', err);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadProcesses().finally(() => setLoading(false));

    const interval = setInterval(loadProcesses, 4000);
    return () => clearInterval(interval);
  }, [selectedNodeFilter, selectedNodeId, isVisible]);

  // Optimistic UI Action Dispatcher with Rollback
  const handleAction = async (
    action: 'start' | 'stop' | 'restart' | 'reload' | 'delete',
    target: string | number,
    nodeId: string,
  ) => {
    const previousProcesses = [...processes];

    // Optimistic Update
    setProcesses((prev) =>
      prev.map((p) => {
        if (p.nodeId === nodeId && p.pmId === target) {
          return {
            ...p,
            status: action === 'stop' ? 'stopped' : 'online',
          };
        }
        return p;
      }),
    );

    try {
      await api.executeProcessAction(nodeId, action, target);
      setFeedback(`Action '${action}' executed successfully on ${target}`);
      await loadProcesses();
    } catch (err: any) {
      // Auto Rollback on Failure
      setProcesses(previousProcesses);
      setFeedback(`Failed to execute '${action}': ${err.message}`);
    }
  };

  // Cross-Node Batch Action Dispatcher
  const handleBatchAction = async (action: 'start' | 'stop' | 'restart' | 'reload' | 'delete') => {
    if (selectedTargets.length === 0) return;
    const previousProcesses = [...processes];

    try {
      const res = await api.batchProcessActionCrossNode(action, selectedTargets);
      setFeedback(
        `Batch action '${action}' completed: ${res.successful?.length || 0} successful, ${
          res.failed?.length || 0
        } failed`,
      );
      setSelectedTargets([]);
      await loadProcesses();
    } catch (err: any) {
      setProcesses(previousProcesses);
      setFeedback(`Batch action failed: ${err.message}`);
    }
  };

  const handleScale = async () => {
    if (!scalingProc) return;
    try {
      await api.scaleProcess(scalingProc.nodeId, scalingProc.name, targetInstances);
      setFeedback(`Scaled '${scalingProc.name}' to ${targetInstances} instances`);
      setScalingProc(null);
      await loadProcesses();
    } catch (err: any) {
      setFeedback(`Scale failed: ${err.message}`);
    }
  };

  const toggleSelectTarget = (nodeId: string, pmId: number | string) => {
    const exists = selectedTargets.some((t) => t.nodeId === nodeId && t.pmId === pmId);
    if (exists) {
      setSelectedTargets(selectedTargets.filter((t) => !(t.nodeId === nodeId && t.pmId === pmId)));
    } else {
      setSelectedTargets([...selectedTargets, { nodeId, pmId }]);
    }
  };

  // Filtering
  const filteredProcesses = processes.filter((proc) => {
    const matchesSearch =
      proc.name.toLowerCase().includes(search.toLowerCase()) ||
      String(proc.pmId).includes(search) ||
      proc.nodeHostname?.toLowerCase().includes(search.toLowerCase()) ||
      proc.git?.branch?.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'all' || proc.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredProcesses.length / pageSize) || 1;
  const paginatedProcesses = filteredProcesses.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const isAllSelected =
    filteredProcesses.length > 0 &&
    filteredProcesses.every((p) =>
      selectedTargets.some((t) => t.nodeId === p.nodeId && t.pmId === p.pmId),
    );

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedTargets([]);
    } else {
      setSelectedTargets(filteredProcesses.map((p) => ({ nodeId: p.nodeId, pmId: p.pmId })));
    }
  };

  const isCompact = (density as any) === 'compact';

  return (
    <div className={`w-full ${isCompact ? 'space-y-3 sm:space-y-4' : 'space-y-5'}`}>
      {/* Header & View Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
            <Layers size={18} className="text-emerald-500" /> Cluster Processes
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {filteredProcesses.length} processes across{' '}
            {selectedNodeFilter === 'all' ? 'all cluster nodes' : 'selected node'}
          </p>
        </div>

        {/* View Mode & Node Filter Switches */}
        <div className="flex items-center gap-2">
          {/* Node Filter Selector */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1 text-xs shadow-2xs">
            <Server size={13} className="text-zinc-400" />
            <select
              value={selectedNodeFilter}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedNodeFilter(val);
                if (val !== 'all') setSelectedNodeId(val);
              }}
              className="bg-transparent text-xs text-zinc-800 dark:text-zinc-200 font-semibold focus:outline-none cursor-pointer"
            >
              <option value="all">All Nodes (Cluster-Wide)</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.hostname} ({n.ipAddress})
                </option>
              ))}
            </select>
          </div>

          {/* Cards vs Table View Switcher */}
          <div className="flex p-0.5 bg-zinc-100 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-2xs">
            <button
              onClick={() => setProcessViewMode('cards')}
              className={`p-1.5 rounded-md transition-colors ${
                processViewMode === 'cards'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
              title="Card Grid View"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setProcessViewMode('table')}
              className={`p-1.5 rounded-md transition-colors ${
                processViewMode === 'table'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
              title="Compact Table View"
            >
              <List size={14} />
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 flex items-center justify-between shadow-xs">
          <span>{feedback}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {/* Search & Batch Action Bar */}
      <div className="bg-white dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-2.5 shadow-2xs">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Filter by name, ID, host, or git branch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 font-medium"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 font-medium cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="online">Online</option>
            <option value="stopped">Stopped</option>
            <option value="errored">Errored</option>
          </select>
        </div>

        {/* Batch Actions */}
        {selectedTargets.length > 0 && (
          <div className="flex items-center gap-1.5 animate-in fade-in duration-150">
            <span className="text-xs text-zinc-500 font-semibold px-1">
              {selectedTargets.length} selected
            </span>

            {/* Batch Graceful Reload */}
            <button
              onClick={() => handleBatchAction('reload')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
              title="Graceful Reload all selected processes (Zero Downtime)"
            >
              <Zap size={13} /> Reload
            </button>

            {/* Batch Restart */}
            <button
              onClick={() => handleBatchAction('restart')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs font-semibold hover:bg-blue-500/20 transition-colors"
              title="Hard Restart all selected processes"
            >
              <RotateCw size={13} /> Restart
            </button>

            {/* Batch Stop */}
            <button
              onClick={() => handleBatchAction('stop')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-semibold hover:bg-rose-500/20 transition-colors"
              title="Stop all selected processes"
            >
              <Square size={13} /> Stop
            </button>
          </div>
        )}
      </div>

      {/* Main Process List / Grid */}
      {loading && processes.length === 0 ? (
        <div className="py-20 text-center text-xs text-zinc-500">Loading cluster processes...</div>
      ) : paginatedProcesses.length === 0 ? (
        <div className="py-20 text-center text-xs text-zinc-500">
          No processes matching the current filter.
        </div>
      ) : processViewMode === 'cards' ? (
        /* Visual Cards Grid (Fluid Responsive Layout from 1 to 6 columns) */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3 sm:gap-3.5">
          {paginatedProcesses.map((proc) => {
            const isSelected = selectedTargets.some(
              (t) => t.nodeId === proc.nodeId && t.pmId === proc.pmId,
            );
            return (
              <ProcessCard
                key={`${proc.nodeId}-${proc.pmId}`}
                process={proc}
                isSelected={isSelected}
                density={density as any}
                onToggleSelect={() => toggleSelectTarget(proc.nodeId, proc.pmId)}
                onAction={handleAction}
                onOpenLogs={(p) => setActiveLogsProc(p)}
                onOpenScale={(p) => setScalingProc(p)}
                onClickName={() => onSelectProcess(proc.name)}
              />
            );
          })}
        </div>
      ) : (
        /* Compact High-Density Table View */
        <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-zinc-50/90 dark:bg-zinc-950/90 border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500 font-semibold sticky top-0">
                <tr>
                  <th className={`w-8 ${isCompact ? 'p-2' : 'p-3'}`}>
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      className="rounded text-emerald-600 focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className={isCompact ? 'p-2' : 'p-3'}>Process Name</th>
                  <th className={isCompact ? 'p-2' : 'p-3'}>Node / Host</th>
                  <th className={isCompact ? 'p-2' : 'p-3'}>Status</th>
                  <th className={isCompact ? 'p-2' : 'p-3'}>CPU</th>
                  <th className={isCompact ? 'p-2' : 'p-3'}>Memory</th>
                  <th className={isCompact ? 'p-2' : 'p-3'}>Restarts</th>
                  <th className={isCompact ? 'p-2' : 'p-3'}>Uptime</th>
                  <th className={`text-right ${isCompact ? 'p-2' : 'p-3'}`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80 font-mono">
                {paginatedProcesses.map((proc) => {
                  const isSelected = selectedTargets.some(
                    (t) => t.nodeId === proc.nodeId && t.pmId === proc.pmId,
                  );
                  const padClass = isCompact ? 'py-2 px-2.5' : 'py-3 px-3.5';
                  return (
                    <tr
                      key={`${proc.nodeId}-${proc.pmId}`}
                      className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className={padClass}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectTarget(proc.nodeId, proc.pmId)}
                          className="rounded text-emerald-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className={padClass}>
                        <button
                          type="button"
                          onClick={() => onSelectProcess(proc.name)}
                          className="font-bold text-zinc-900 dark:text-zinc-100 hover:text-emerald-500 text-left font-sans"
                        >
                          {proc.name}
                        </button>
                        <span className="text-[10px] text-zinc-500 ml-2">id: #{proc.pmId}</span>
                      </td>
                      <td className={`${padClass} text-zinc-600 dark:text-zinc-300 font-sans`}>
                        {proc.nodeHostname || 'local'}
                      </td>
                      <td className={padClass}>
                        <StatusBadge status={proc.status} />
                      </td>
                      <td className={padClass}>{proc.monit?.cpu ?? 0}%</td>
                      <td className={padClass}>
                        {Math.round((proc.monit?.memory || 0) / 1024 / 1024)} MB
                      </td>
                      <td className={padClass}>{proc.restarts ?? 0}</td>
                      <td className={padClass}>
                        {proc.uptime ? `${Math.floor(proc.uptime / 60)}m` : '0s'}
                      </td>
                      <td className={`${padClass} text-right`}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleAction('reload', proc.pmId, proc.nodeId)}
                            className="p-1 text-zinc-400 hover:text-amber-500"
                            title="Graceful Reload"
                          >
                            <Zap size={13} />
                          </button>
                          <button
                            onClick={() => handleAction('restart', proc.pmId, proc.nodeId)}
                            className="p-1 text-zinc-400 hover:text-blue-500"
                            title="Hard Restart"
                          >
                            <RotateCw size={13} />
                          </button>
                          <button
                            onClick={() => setActiveLogsProc(proc)}
                            className="p-1 text-zinc-400 hover:text-zinc-200"
                            title="Quick Logs"
                          >
                            <ExternalLink size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-zinc-500 pt-2">
          <span>
            Page {currentPage} of {totalPages} ({filteredProcesses.length} total processes)
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Scaling Modal */}
      {scalingProc && (
        <Modal
          isOpen={true}
          onClose={() => setScalingProc(null)}
          title={`Scale Cluster Instances: ${scalingProc.name}`}
        >
          <div className="space-y-4 text-xs">
            <p className="text-zinc-600 dark:text-zinc-400">
              Set the number of parallel cluster worker processes to scale across this node.
            </p>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Target Instances (1 - 32)
              </label>
              <input
                type="number"
                min={1}
                max={32}
                value={targetInstances}
                onChange={(e) => setTargetInstances(Number(e.target.value))}
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 font-mono"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setScalingProc(null)}
                className="px-3 py-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={handleScale}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold"
              >
                Apply Scale
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Slide-out Terminal Logs Drawer */}
      <ProcessLogsDrawer
        process={activeLogsProc}
        isOpen={!!activeLogsProc}
        onClose={() => setActiveLogsProc(null)}
      />
    </div>
  );
};
