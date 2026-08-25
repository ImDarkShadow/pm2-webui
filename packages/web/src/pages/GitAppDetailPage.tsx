import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  ArrowLeft,
  Rocket,
  RotateCcw,
  Terminal,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client.js';

interface GitAppDetailPageProps {
  appId: string;
  onBack: () => void;
}

export const GitAppDetailPage: React.FC<GitAppDetailPageProps> = ({ appId, onBack }) => {
  const [app, setApp] = useState<any | null>(null);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'history' | 'terminal' | 'config'>('history');
  const [selectedDeployId, setSelectedDeployId] = useState<string | null>(null);
  const [selectedDeployLogs, setSelectedDeployLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  const loadData = async () => {
    try {
      const [appData, depsData] = await Promise.all([
        api.getGitApp(appId),
        api.getAppDeployments(appId),
      ]);
      setApp(appData);
      setDeployments(depsData || []);

      if (depsData && depsData.length > 0) {
        if (!selectedDeployId) {
          setSelectedDeployId(depsData[0].id);
          setSelectedDeployLogs(depsData[0].logs || '');
        } else {
          const current = depsData.find((d: any) => d.id === selectedDeployId);
          if (current) setSelectedDeployLogs(current.logs || '');
        }
      }
    } catch (err) {
      console.error('Failed to load git app console', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, [appId, selectedDeployId]);

  const handleTriggerDeploy = async () => {
    try {
      setIsDeploying(true);
      const res = await api.triggerDeploy(appId);
      if (res && res.id) {
        setSelectedDeployId(res.id);
        setActiveTab('terminal');
      }
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to trigger deployment');
    } finally {
      setTimeout(() => setIsDeploying(false), 1000);
    }
  };

  const handleRollback = async (deployId: string) => {
    if (!confirm('Are you sure you want to rollback to this release?')) return;
    try {
      const res = await api.rollbackDeploy(appId, deployId);
      if (res && res.id) {
        setSelectedDeployId(res.id);
        setActiveTab('terminal');
      }
      loadData();
    } catch (err: any) {
      alert(err.message || 'Rollback failed');
    }
  };

  const handleDeleteApp = async () => {
    if (!confirm('Are you sure you want to delete this Git application and stop its PM2 process?'))
      return;
    try {
      await api.deleteGitApp(appId);
      onBack();
    } catch (err: any) {
      alert(err.message || 'Failed to delete app');
    }
  };

  const copyToClipboard = (text: string, type: 'webhook' | 'secret') => {
    navigator.clipboard.writeText(text);
    if (type === 'webhook') {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } else {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  };

  if (loading && !app) {
    return (
      <div className="py-16 text-center text-xs text-zinc-500">Loading application details...</div>
    );
  }

  if (!app) {
    return (
      <div className="text-center py-16 text-xs text-zinc-500">
        Application not found.{' '}
        <button onClick={onBack} className="text-sky-500 underline ml-1">
          Go back
        </button>
      </div>
    );
  }

  const webhookUrl = `${window.location.origin}/api/v1/deploy/webhook/${app.id}`;

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Back Button & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors shadow-2xs"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
                {app.name}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                {app.branch}
              </span>
            </div>
            <p className="text-xs font-mono text-zinc-500">{app.repoUrl}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTriggerDeploy}
            disabled={isDeploying}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-zinc-100 dark:text-zinc-900 text-xs font-semibold shadow-sm transition-colors"
          >
            <Rocket size={13} className={isDeploying ? 'animate-spin' : ''} />
            {isDeploying ? 'Deploying...' : 'Deploy Latest Commit'}
          </button>
        </div>
      </div>

      {/* 3 Tabs Navigation */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 pb-2">
        <button
          onClick={() => setActiveTab('history')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === 'history'
              ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          Releases & Deployments ({deployments.length})
        </button>

        <button
          onClick={() => setActiveTab('terminal')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === 'terminal'
              ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          Live Build Logs
        </button>

        <button
          onClick={() => setActiveTab('config')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === 'config'
              ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          Webhooks & Settings
        </button>
      </div>

      {/* Tab 1: Releases & Deployments History */}
      {activeTab === 'history' && (
        <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Release Version Control Timeline
            </h2>
            <span className="text-xs text-zinc-500">Atomic releases with 1-Click Rollback</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-950/60 text-zinc-500 dark:text-zinc-400 font-medium border-b border-zinc-200 dark:border-zinc-800/60">
                <tr>
                  <th className="py-3 px-4">Release ID</th>
                  <th className="py-3 px-4">Commit</th>
                  <th className="py-3 px-4">Trigger / Author</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Deployed At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                {deployments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-400">
                      No deployments recorded yet. Click "Deploy Latest Commit" to create the first
                      release.
                    </td>
                  </tr>
                ) : (
                  deployments.map((d, index) => (
                    <tr
                      key={d.id}
                      onClick={() => {
                        setSelectedDeployId(d.id);
                        setSelectedDeployLogs(d.logs || '');
                      }}
                      className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-pointer ${
                        selectedDeployId === d.id ? 'bg-sky-50/50 dark:bg-sky-950/20' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                        {index === 0 && (
                          <span
                            className="w-2 h-2 rounded-full bg-emerald-500"
                            title="Active Release"
                          />
                        )}
                        {d.releaseId}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="font-mono text-[11px] text-zinc-800 dark:text-zinc-200 font-medium">
                            {d.commitHash?.slice(0, 7) || 'N/A'}
                          </span>
                          <span className="text-[10px] text-zinc-500 truncate max-w-[220px]">
                            {d.commitMessage || 'Manual trigger'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400">
                        {d.triggeredByUsername || d.commitAuthor || 'System'} ({d.triggerType})
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            d.status === 'success'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              : d.status === 'building' || d.status === 'deploying'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 animate-pulse'
                                : d.status === 'rolled_back'
                                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                          }`}
                        >
                          {d.status === 'success' && <CheckCircle2 size={10} />}
                          {d.status === 'failed' && <XCircle size={10} />}
                          {d.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-500">
                        {d.durationMs ? `${(d.durationMs / 1000).toFixed(1)}s` : '-'}
                      </td>
                      <td className="py-3 px-4 text-zinc-500">
                        {new Date(d.startedAt).toLocaleString([], {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDeployId(d.id);
                              setSelectedDeployLogs(d.logs || '');
                              setActiveTab('terminal');
                            }}
                            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
                            title="View Build Logs"
                          >
                            <Terminal size={13} />
                          </button>
                          {index !== 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRollback(d.id);
                              }}
                              className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[10px] font-semibold border border-zinc-200 dark:border-zinc-700"
                              title="Rollback to this release"
                            >
                              <RotateCcw size={10} /> Rollback
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Live Build Terminal */}
      {activeTab === 'terminal' && (
        <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs space-y-0">
          <div className="px-4 py-2.5 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
              <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400 ml-2">
                Build Log {selectedDeployId ? `(${selectedDeployId.slice(0, 8)})` : ''}
              </span>
            </div>
            <button
              onClick={() => copyToClipboard(selectedDeployLogs, 'secret')}
              className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 flex items-center gap-1 transition-colors"
            >
              <Copy size={11} /> Copy Log
            </button>
          </div>
          <pre className="p-4 text-[12px] font-mono text-zinc-800 dark:text-zinc-200 h-96 overflow-y-auto whitespace-pre-wrap select-text leading-relaxed bg-zinc-50 dark:bg-zinc-950">
            {selectedDeployLogs || 'No build logs generated for this deployment.'}
          </pre>
        </div>
      )}

      {/* Tab 3: Webhooks & Configuration */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* Webhook Configuration Card */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <GitBranch size={15} className="text-sky-500" /> GitHub / GitLab Webhook Integration
            </h2>
            <p className="text-xs text-zinc-500">
              Add this Webhook to your GitHub/GitLab repository settings. Every push to{' '}
              <code className="font-mono text-sky-500">{app.branch}</code> will automatically
              trigger a zero-downtime rolling build and deployment.
            </p>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Payload URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhookUrl}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono text-xs text-zinc-800 dark:text-zinc-200"
                  />
                  <button
                    onClick={() => copyToClipboard(webhookUrl, 'webhook')}
                    className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-1"
                  >
                    {copiedWebhook ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copiedWebhook ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Webhook Secret (HMAC SHA-256)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={app.webhookSecret}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono text-xs text-zinc-800 dark:text-zinc-200"
                  />
                  <button
                    onClick={() => copyToClipboard(app.webhookSecret, 'secret')}
                    className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-1"
                  >
                    {copiedSecret ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copiedSecret ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-5 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-rose-600 dark:text-rose-400">
                Delete Application
              </h3>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Permanently remove this application, its release folder, and stop the PM2 process.
              </p>
            </div>
            <button
              onClick={handleDeleteApp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <Trash2 size={12} /> Delete App
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
