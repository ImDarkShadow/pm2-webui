import React, { useEffect, useState } from 'react';
import { Package, Download, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useNodeStore } from '../store/nodeStore.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';

interface PluginItem {
  name: string;
  description: string;
  version: string;
  status: 'online' | 'stopped' | 'errored' | 'uninstalled';
  isAllowed: boolean;
}

const OFFICIAL_PLUGINS: PluginItem[] = [
  {
    name: 'pm2-logrotate',
    description:
      'Automated log rotation, maximum log size enforcement, gzip compression, and retention management.',
    version: 'latest',
    status: 'uninstalled',
    isAllowed: true,
  },
  {
    name: 'pm2-server-monit',
    description:
      'System health agent monitoring host CPU, RAM, load averages, and critical process thresholds.',
    version: 'latest',
    status: 'uninstalled',
    isAllowed: true,
  },
  {
    name: 'pm2-sysmonit',
    description:
      'Low-overhead system monitor reporting storage disk I/O, network bandwidth, and hardware telemetry.',
    version: 'latest',
    status: 'uninstalled',
    isAllowed: true,
  },
  {
    name: 'pm2-slack',
    description:
      'Real-time alerting bridge that forwards application crashes, exceptions, and restarts to Slack channels.',
    version: 'latest',
    status: 'uninstalled',
    isAllowed: true,
  },
];

export const PluginsPage: React.FC = () => {
  const { nodes, selectedNodeId, setNodes } = useNodeStore();
  const [plugins, setPlugins] = useState<PluginItem[]>(OFFICIAL_PLUGINS);
  const [loading, setLoading] = useState(false);
  const [installingPlugin, setInstallingPlugin] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadNodesAndPlugins = async () => {
    setLoading(true);
    try {
      let activeNodeId = selectedNodeId;

      // Ensure nodes are loaded
      if (nodes.length === 0 || !activeNodeId) {
        const fetchedNodes = await api.getNodes();
        if (fetchedNodes.length > 0) {
          setNodes(fetchedNodes);
          activeNodeId = fetchedNodes[0].id;
        }
      }

      if (activeNodeId) {
        const livePlugins = await api.getPlugins(activeNodeId).catch(() => []);
        if (Array.isArray(livePlugins) && livePlugins.length > 0) {
          const merged = OFFICIAL_PLUGINS.map((base) => {
            const match = livePlugins.find((lp: any) => lp.name === base.name);
            return match ? { ...base, ...match } : base;
          });
          setPlugins(merged);
        }
      }
    } catch (err) {
      console.error('Failed to load plugins', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNodesAndPlugins();
  }, [selectedNodeId]);

  const handleInstall = async (pluginName: string) => {
    const targetNode = selectedNodeId || (nodes[0] ? nodes[0].id : null);
    if (!targetNode) {
      setFeedback('Error: No active node selected.');
      return;
    }

    setInstallingPlugin(pluginName);
    setFeedback(`Installing '${pluginName}'... Please wait.`);

    try {
      await api.installPlugin(targetNode, pluginName);
      setFeedback(`Plugin '${pluginName}' installed successfully.`);
      await loadNodesAndPlugins();
    } catch (err: any) {
      setFeedback(`Install failed: ${err.message}`);
    } finally {
      setInstallingPlugin(null);
    }
  };

  const handleUninstall = async (pluginName: string) => {
    const targetNode = selectedNodeId || (nodes[0] ? nodes[0].id : null);
    if (!targetNode) return;

    setInstallingPlugin(pluginName);
    try {
      await api.uninstallPlugin(targetNode, pluginName);
      setFeedback(`Plugin '${pluginName}' uninstalled.`);
      await loadNodesAndPlugins();
    } catch (err: any) {
      setFeedback(`Uninstall failed: ${err.message}`);
    } finally {
      setInstallingPlugin(null);
    }
  };

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
            <Package size={18} className="text-emerald-500" /> Plugins
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Install and manage PM2 modules on your nodes
          </p>
        </div>

        <button
          onClick={loadNodesAndPlugins}
          disabled={loading || installingPlugin !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-800 dark:text-zinc-200 transition-colors shadow-2xs disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 flex items-center justify-between shadow-2xs">
          <span>{feedback}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-bold ml-2"
          >
            &times;
          </button>
        </div>
      )}

      {/* Plugins Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {plugins.map((plugin) => {
          const isInstalled = plugin.status !== 'uninstalled';
          const isBusy = installingPlugin === plugin.name;

          return (
            <div
              key={plugin.name}
              className="p-5 rounded-xl bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 shadow-sm flex flex-col justify-between space-y-4 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-sky-500" />
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm font-mono">
                      {plugin.name}
                    </span>
                  </div>
                  <StatusBadge status={plugin.status} />
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2 leading-relaxed">
                  {plugin.description}
                </p>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
                <span className="text-[11px] font-mono text-zinc-400">
                  Version: {plugin.version || 'latest'}
                </span>
                {isInstalled ? (
                  <button
                    disabled={isBusy}
                    onClick={() => handleUninstall(plugin.name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-600 dark:text-rose-300 text-xs font-medium transition-colors border border-zinc-200 dark:border-zinc-700 disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    {isBusy ? 'Uninstalling...' : 'Uninstall'}
                  </button>
                ) : (
                  <button
                    disabled={isBusy}
                    onClick={() => handleInstall(plugin.name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    {isBusy ? 'Installing...' : 'Install Plugin'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
