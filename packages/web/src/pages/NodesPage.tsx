import React, { useEffect, useState } from 'react';
import { Server, Check, X, RefreshCw } from 'lucide-react';
import { api } from '../api/client.js';
import { useNodeStore } from '../store/nodeStore.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { Modal } from '../components/ui/Modal.js';

export const NodesPage: React.FC = () => {
  const { nodes, setNodes, setSelectedNodeId } = useNodeStore();
  const [loading, setLoading] = useState(false);
  const [selectedPendingNode, setSelectedPendingNode] = useState<any | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadNodes = async () => {
    setLoading(true);
    try {
      const data = await api.getNodes();
      setNodes(data);
    } catch (err) {
      console.error('Failed to load nodes', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNodes();
  }, []);

  const handleApprove = async (nodeId: string) => {
    try {
      await api.approveNode(nodeId);
      setFeedback(`Node ${nodeId.slice(0, 8)} approved successfully`);
      setSelectedPendingNode(null);
      await loadNodes();
    } catch (err: any) {
      setFeedback(`Failed: ${err.message}`);
    }
  };

  const handleReject = async (nodeId: string) => {
    try {
      await api.rejectNode(nodeId, 'Administrative rejection');
      setFeedback(`Node ${nodeId.slice(0, 8)} rejected`);
      setSelectedPendingNode(null);
      await loadNodes();
    } catch (err: any) {
      setFeedback(`Failed: ${err.message}`);
    }
  };

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
            <Server size={18} className="text-emerald-500" /> Node Management
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Manage cluster workers, approve enrollments, and check connectivity topology
          </p>
        </div>
        <button
          onClick={loadNodes}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors shadow-sm"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh Nodes
        </button>
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 flex items-center justify-between">
          <span>{feedback}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            &times;
          </button>
        </div>
      )}

      {/* Nodes Table */}
      <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-medium">
              <th className="py-3 px-4">Hostname</th>
              <th className="py-3 px-4">IP & Port</th>
              <th className="py-3 px-4">Topology Mode</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Version</th>
              <th className="py-3 px-4">Last Seen</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-zinc-400 dark:text-zinc-500">
                  No nodes found in cluster.
                </td>
              </tr>
            ) : (
              nodes.map((node) => (
                <tr
                  key={node.id}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="font-medium text-zinc-900 dark:text-zinc-200 flex items-center gap-2">
                      <Server size={14} className="text-zinc-400 dark:text-zinc-500" />
                      <span>{node.hostname}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {node.id.slice(0, 13)}...
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-zinc-800 dark:text-zinc-300">
                    {node.ipAddress}:{node.port}
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={node.connectivityMode} />
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={node.status} />
                  </td>
                  <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400 font-mono">
                    v{node.version || '1.0.0'}
                  </td>
                  <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400">
                    {new Date(node.lastSeenAt || Date.now()).toLocaleTimeString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {node.status === 'pending' ? (
                      <button
                        onClick={() => setSelectedPendingNode(node)}
                        className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 border border-amber-500/40 text-xs font-medium transition-colors"
                      >
                        Review Request
                      </button>
                    ) : (
                      <button
                        onClick={() => setSelectedNodeId(node.id)}
                        className="px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors border border-zinc-200 dark:border-zinc-700"
                      >
                        Select Node
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pending Approval Modal */}
      {selectedPendingNode && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedPendingNode(null)}
          title="Review Node Enrollment Request"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-zinc-100 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-2 font-mono">
              <div className="flex justify-between">
                <span className="text-zinc-500">Agent UUID:</span>
                <span className="text-zinc-800 dark:text-zinc-200">{selectedPendingNode.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Hostname:</span>
                <span className="text-zinc-800 dark:text-zinc-200">
                  {selectedPendingNode.hostname}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">IP Address:</span>
                <span className="text-zinc-800 dark:text-zinc-200">
                  {selectedPendingNode.ipAddress}:{selectedPendingNode.port}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Ed25519 PubKey:</span>
                <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-[200px]">
                  {selectedPendingNode.publicKey}
                </span>
              </div>
            </div>

            <p className="text-zinc-600 dark:text-zinc-400">
              Approving this node adds it to the cluster and allows it to report telemetry, receive
              process commands, and stream logs.
            </p>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => handleReject(selectedPendingNode.id)}
                className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-600 dark:text-rose-300 border border-zinc-200 dark:border-zinc-700 hover:border-rose-300 dark:hover:border-rose-800 text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                <X size={13} /> Reject Node
              </button>
              <button
                onClick={() => handleApprove(selectedPendingNode.id)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Check size={13} /> Approve Enrollment
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
