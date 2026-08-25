import React, { useState, useEffect } from 'react';
import { X, Rocket, GitBranch, Server, CheckCircle2, RefreshCw, Layers } from 'lucide-react';
import { api } from '../../api/client.js';

export interface ClusterDeployModalProps {
  readonly app: any | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onDeployComplete?: () => void;
}

export const ClusterDeployModal: React.FC<ClusterDeployModalProps> = ({
  app,
  isOpen,
  onClose,
  onDeployComplete,
}) => {
  const [nodes, setNodes] = useState<any[]>([]);
  const [deployScope, setDeployScope] = useState<'all' | 'selective'>('all');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [commitHash, setCommitHash] = useState('');
  const [strategy, setStrategy] = useState<'parallel' | 'rolling'>('parallel');
  const [loading, setLoading] = useState(false);
  const [deployResult, setDeployResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && app) {
      setBranch(app.branch || 'main');
      setCommitHash('');
      setDeployResult(null);
      setError(null);
      api
        .getNodes()
        .then((allNodes) => {
          const online = allNodes.filter((n: any) => n.status === 'online');
          setNodes(online);
          setSelectedNodeIds(online.map((n: any) => n.id));
        })
        .catch(console.error);
    }
  }, [isOpen, app]);

  if (!isOpen || !app) return null;

  const toggleNodeSelect = (nodeId: string) => {
    if (selectedNodeIds.includes(nodeId)) {
      setSelectedNodeIds(selectedNodeIds.filter((id) => id !== nodeId));
    } else {
      setSelectedNodeIds([...selectedNodeIds, nodeId]);
    }
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const targetNodeIds = deployScope === 'all' ? undefined : selectedNodeIds;

    try {
      const res = await api.clusterDeploy(app.id, {
        targetNodeIds,
        branch,
        commitHash: commitHash.trim() || undefined,
        strategy,
      });
      setDeployResult(res);
      if (onDeployComplete) onDeployComplete();
    } catch (err: any) {
      setError(err.message || 'Cluster deployment failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <Rocket size={17} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Deploy '{app.name}' Across Cluster
              </h2>
              <p className="text-xs text-zinc-500 font-mono">{app.repoUrl}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-600 dark:text-rose-300">
            {error}
          </div>
        )}

        {deployResult ? (
          /* Deployment Results Summary */
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-500" /> Deployment Complete
                </span>
                <span className="text-xs text-zinc-500 font-mono">{deployResult.durationMs}ms</span>
              </div>

              {/* Successful Nodes */}
              {deployResult.successfulNodes?.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">
                    Successful Nodes ({deployResult.successfulNodes.length}):
                  </span>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {deployResult.successfulNodes.map((nid: string) => {
                      const node = nodes.find((n) => n.id === nid);
                      return (
                        <span
                          key={nid}
                          className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 text-xs font-mono"
                        >
                          {node?.hostname || nid}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Failed Nodes */}
              {deployResult.failedNodes?.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-zinc-200 dark:border-zinc-800">
                  <span className="text-[11px] text-rose-600 dark:text-rose-400 font-bold uppercase tracking-wider">
                    Failed Nodes ({deployResult.failedNodes.length}):
                  </span>
                  <div className="space-y-1 pt-0.5">
                    {deployResult.failedNodes.map((fn: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-2 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-mono"
                      >
                        <strong>{fn.nodeId}:</strong> {fn.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-zinc-100 dark:text-zinc-950 text-xs font-semibold rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          /* Deploy Form */
          <form onSubmit={handleDeploy} className="space-y-4 text-xs">
            {/* Target Scope Selection */}
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                Target Node Scope
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeployScope('all')}
                  className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2 ${
                    deployScope === 'all'
                      ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-400 dark:border-zinc-600 text-zinc-900 dark:text-zinc-100'
                      : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
                  }`}
                >
                  <Server size={14} className="text-emerald-500" />
                  <div>
                    <div className="font-semibold">All Connected Nodes</div>
                    <div className="text-[10px] text-zinc-400">
                      Deploy across entire active cluster
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeployScope('selective')}
                  className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2 ${
                    deployScope === 'selective'
                      ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-400 dark:border-zinc-600 text-zinc-900 dark:text-zinc-100'
                      : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
                  }`}
                >
                  <Layers size={14} className="text-blue-500" />
                  <div>
                    <div className="font-semibold">Selective Nodes</div>
                    <div className="text-[10px] text-zinc-400">
                      Pick specific target worker nodes
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Selective Nodes Checklist */}
            {deployScope === 'selective' && (
              <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Select Target Nodes ({selectedNodeIds.length} of {nodes.length} selected):
                </span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {nodes.map((node) => (
                    <label
                      key={node.id}
                      className="flex items-center justify-between p-2 rounded bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedNodeIds.includes(node.id)}
                          onChange={() => toggleNodeSelect(node.id)}
                          className="rounded text-emerald-600 focus:ring-0"
                        />
                        <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                          {node.hostname}
                        </span>
                      </div>
                      <span className="text-[11px] text-zinc-500 font-mono">{node.ipAddress}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Branch & Commit Override */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                  Git Branch
                </label>
                <div className="relative">
                  <GitBranch size={13} className="absolute left-2.5 top-2.5 text-zinc-400" />
                  <input
                    type="text"
                    required
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                  Commit Hash (Optional)
                </label>
                <input
                  type="text"
                  value={commitHash}
                  onChange={(e) => setCommitHash(e.target.value)}
                  placeholder="HEAD / specific SHA"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            {/* Strategy */}
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Deployment Strategy
              </label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as any)}
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
              >
                <option value="parallel">
                  Parallel (Simultaneous pull & zero-downtime graceful reload)
                </option>
                <option value="rolling">Rolling Wave (Node-by-node with health checks)</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || (deployScope === 'selective' && selectedNodeIds.length === 0)}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {loading ? <RefreshCw size={13} className="animate-spin" /> : <Rocket size={13} />}
                {loading ? 'Deploying Across Cluster...' : 'Deploy Now'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
