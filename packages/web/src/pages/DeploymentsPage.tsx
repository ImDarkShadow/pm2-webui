import React, { useState, useEffect } from 'react';
import { GitBranch, Rocket, Plus, Terminal, Search } from 'lucide-react';
import { api } from '../api/client.js';
import { useNodeStore } from '../store/nodeStore.js';

interface DeploymentsPageProps {
  onSelectApp: (appId: string) => void;
}

export const DeploymentsPage: React.FC<DeploymentsPageProps> = ({ onSelectApp }) => {
  const { nodes } = useNodeStore();
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deployingAppId, setDeployingAppId] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    nodeId: nodes[0]?.id || 'local',
    repoUrl: '',
    branch: 'main',
    installCommand: 'npm ci || npm install',
    buildCommand: 'npm run build',
    startScript: 'dist/index.js',
    instances: 1,
    autoDeploy: true,
  });

  const loadApps = async () => {
    try {
      setLoading(true);
      const data = await api.getGitApps();
      setApps(data || []);
    } catch (err) {
      console.error('Failed to fetch git apps', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApps();
    const interval = setInterval(loadApps, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createGitApp({
        ...formData,
        nodeId: formData.nodeId || nodes[0]?.id || 'local',
      });
      setCreateModalOpen(false);
      setFormData({
        name: '',
        nodeId: nodes[0]?.id || 'local',
        repoUrl: '',
        branch: 'main',
        installCommand: 'npm ci || npm install',
        buildCommand: 'npm run build',
        startScript: 'dist/index.js',
        instances: 1,
        autoDeploy: true,
      });
      loadApps();
    } catch (err: any) {
      alert(err.message || 'Failed to create git app');
    }
  };

  const handleTriggerDeploy = async (appId: string) => {
    try {
      setDeployingAppId(appId);
      await api.triggerDeploy(appId);
      loadApps();
    } catch (err: any) {
      alert(err.message || 'Failed to trigger deploy');
    } finally {
      setTimeout(() => setDeployingAppId(null), 1000);
    }
  };

  const filteredApps = apps.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.repoUrl.toLowerCase().includes(search.toLowerCase()) ||
      a.branch.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
            <GitBranch size={18} className="text-emerald-500" /> Continuous Deployments & Releases
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Zero-downtime rolling releases, commit history, and instant rollbacks for your
            Git-connected PM2 workloads
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 text-zinc-400" size={13} />
            <input
              type="text"
              placeholder="Search apps..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 shadow-2xs font-medium"
            />
          </div>

          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-xs font-semibold text-zinc-100 dark:text-zinc-900 shadow-2xs transition-colors"
          >
            <Plus size={13} /> Connect Git App
          </button>
        </div>
      </div>

      {/* Grid of Git Applications */}
      {loading && apps.length === 0 ? (
        <div className="py-16 text-center text-xs text-zinc-500">Loading Git applications...</div>
      ) : filteredApps.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/30">
          <Rocket size={32} className="mx-auto text-zinc-400 mb-3" />
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            No Git Applications Connected
          </h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto mt-1 mb-4">
            Connect a GitHub, GitLab, or Git repository to enable automated builds, zero-downtime
            rolling releases, and 1-click rollbacks.
          </p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 text-xs font-semibold"
          >
            <Plus size={13} /> Connect Your First App
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {filteredApps.map((app) => (
            <div
              key={app.id}
              className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm flex flex-col justify-between hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      {app.name}
                    </h3>
                    <span className="text-[11px] font-mono text-zinc-500 truncate max-w-[200px] block mt-0.5">
                      {app.repoUrl}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      app.autoDeploy
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                    }`}
                  >
                    {app.autoDeploy ? 'Auto-Deploy ON' : 'Manual Deploy'}
                  </span>
                </div>

                {/* Commit & Branch Details */}
                <div className="mt-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-100 dark:border-zinc-800/60 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500 flex items-center gap-1">
                      <GitBranch size={12} className="text-sky-500" /> Branch:
                    </span>
                    <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
                      {app.branch}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500 flex items-center gap-1">
                      <Terminal size={12} className="text-purple-500" /> Commit:
                    </span>
                    <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">
                      {app.commitHash ? app.commitHash.slice(0, 7) : 'Pending Deploy'}
                    </span>
                  </div>
                  {app.commitMessage && (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate pt-1 border-t border-zinc-100 dark:border-zinc-800/60">
                      "{app.commitMessage}"
                    </p>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between">
                <button
                  onClick={() => onSelectApp(app.id)}
                  className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
                >
                  Console & History &rarr;
                </button>

                <button
                  onClick={() => handleTriggerDeploy(app.id)}
                  disabled={deployingAppId === app.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/50 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 text-xs font-semibold transition-colors"
                >
                  <Rocket size={12} className={deployingAppId === app.id ? 'animate-spin' : ''} />
                  {deployingAppId === app.id ? 'Queuing...' : 'Deploy Now'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Git Application Modal Wizard */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <GitBranch size={16} /> Connect New Git Application
              </h2>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateApp} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-medium mb-1">
                    Process Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. api-service"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-medium mb-1">
                    Target Cluster Node
                  </label>
                  <select
                    value={formData.nodeId}
                    onChange={(e) => setFormData({ ...formData, nodeId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.hostname} ({n.ipAddress})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-zinc-700 dark:text-zinc-300 font-medium mb-1">
                  Repository URL *
                </label>
                <input
                  type="text"
                  required
                  placeholder="https://github.com/org/my-app.git"
                  value={formData.repoUrl}
                  onChange={(e) => setFormData({ ...formData, repoUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-medium mb-1">
                    Branch
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="main"
                    value={formData.branch}
                    onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-medium mb-1">
                    Start Script
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="dist/index.js or server.js"
                    value={formData.startScript}
                    onChange={(e) => setFormData({ ...formData, startScript: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-medium mb-1">
                    Install Command
                  </label>
                  <input
                    type="text"
                    placeholder="npm ci || npm install"
                    value={formData.installCommand}
                    onChange={(e) => setFormData({ ...formData, installCommand: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-medium mb-1">
                    Build Command
                  </label>
                  <input
                    type="text"
                    placeholder="npm run build"
                    value={formData.buildCommand}
                    onChange={(e) => setFormData({ ...formData, buildCommand: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="autoDeploy"
                  checked={formData.autoDeploy}
                  onChange={(e) => setFormData({ ...formData, autoDeploy: e.target.checked })}
                  className="rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                />
                <label
                  htmlFor="autoDeploy"
                  className="text-zinc-700 dark:text-zinc-300 font-medium"
                >
                  Enable GitHub / GitLab Webhook Auto-Deploy on Git Push
                </label>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-zinc-100 dark:text-zinc-900 font-semibold shadow-sm transition-colors"
                >
                  Connect & Save Application
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
