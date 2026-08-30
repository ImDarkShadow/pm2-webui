import React, { useEffect, useState } from 'react';
import {
  Settings,
  Save,
  Plus,
  Trash2,
  Bell,
  Shield,
  ShieldCheck,
  KeyRound,
  Laptop,
  Smartphone,
  Copy,
  Check,
  Zap,
  LogOut,
} from 'lucide-react';
import { api } from '../api/client.js';
import { TwoFactorSetupModal } from '../components/security/TwoFactorSetupModal.js';

export const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'cluster' | 'security'>('cluster');

  // Cluster Policies
  const [settings, setSettings] = useState<any>({
    logRetentionDays: 7,
    metricsRetentionDays: 30,
    logCompressionThresholdMb: 10,
    alertWebhooks: [],
  });
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookType, setNewWebhookType] = useState<'slack' | 'discord' | 'generic'>('slack');

  // Security State
  const [twoFactorStatus, setTwoFactorStatus] = useState<{
    enabled: boolean;
    hasRecoveryCodes: boolean;
  }>({
    enabled: false,
    hasRecoveryCodes: false,
  });
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [isDisableModalOpen, setIsDisableModalOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);

  // Sessions & Tokens
  const [sessions, setSessions] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);

  // New PAT Form Modal
  const [isCreateTokenModalOpen, setIsCreateTokenModalOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenPerms, setNewTokenPerms] = useState<string[]>([
    'process:view',
    'process:manage',
    'deploy:view',
    'deploy:trigger',
  ]);
  const [newTokenExpiry, setNewTokenExpiry] = useState<number>(30);
  const [createdRawToken, setCreatedRawToken] = useState<string | null>(null);
  const [copiedRawToken, setCopiedRawToken] = useState(false);

  useEffect(() => {
    loadClusterSettings();
    loadSecurityData();
  }, []);

  const loadClusterSettings = () => {
    api.getSettings().then(setSettings).catch(console.error);
  };

  const loadSecurityData = () => {
    api.get2FAStatus().then(setTwoFactorStatus).catch(console.error);
    api.getSessions().then(setSessions).catch(console.error);
    api.getApiTokens().then(setTokens).catch(console.error);
  };

  const handleSaveClusterSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      setFeedback('Settings saved.');
    } catch (err: any) {
      setFeedback(`Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const addWebhook = () => {
    if (!newWebhookUrl) return;
    const updatedWebhooks = [
      ...(settings.alertWebhooks || []),
      {
        url: newWebhookUrl,
        type: newWebhookType,
        events: ['crash', 'high_cpu', 'offline'],
      },
    ];
    setSettings({ ...settings, alertWebhooks: updatedWebhooks });
    setNewWebhookUrl('');
  };

  const removeWebhook = (index: number) => {
    const updated = (settings.alertWebhooks || []).filter((_: any, i: number) => i !== index);
    setSettings({ ...settings, alertWebhooks: updated });
  };

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableError(null);
    try {
      await api.disable2FA(disablePassword);
      setIsDisableModalOpen(false);
      setDisablePassword('');
      loadSecurityData();
      setFeedback('2FA has been disabled.');
    } catch (err: any) {
      setDisableError(err.message || 'Failed to disable 2FA');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await api.revokeSession(sessionId);
      loadSecurityData();
    } catch (err: any) {
      alert(`Failed to revoke session: ${err.message}`);
    }
  };

  const handleRevokeAllOtherSessions = async () => {
    if (!confirm('Revoke all other active sessions across devices?')) return;
    try {
      await api.revokeAllOtherSessions();
      loadSecurityData();
      setFeedback('Logged out of other sessions.');
    } catch (err: any) {
      alert(`Failed to revoke other sessions: ${err.message}`);
    }
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.createApiToken(newTokenName, newTokenPerms, newTokenExpiry);
      setCreatedRawToken(res.rawToken);
      setNewTokenName('');
      loadSecurityData();
    } catch (err: any) {
      alert(`Failed to create API token: ${err.message}`);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    if (
      !confirm(
        'Are you sure you want to revoke this Personal Access Token? Any CI/CD pipelines using it will fail.',
      )
    )
      return;
    try {
      await api.revokeApiToken(tokenId);
      loadSecurityData();
    } catch (err: any) {
      alert(`Failed to revoke token: ${err.message}`);
    }
  };

  const toggleTokenPermission = (perm: string) => {
    if (newTokenPerms.includes(perm)) {
      setNewTokenPerms(newTokenPerms.filter((p) => p !== perm));
    } else {
      setNewTokenPerms([...newTokenPerms, perm]);
    }
  };

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
            <Settings size={18} className="text-emerald-500" /> Settings
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Configure cluster policies, two-factor authentication, active sessions, and personal
            access tokens
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium">
          <button
            onClick={() => setActiveTab('cluster')}
            className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'cluster'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Settings size={13} /> Cluster Settings
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'security'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Shield size={13} /> Security & 2FA
          </button>
        </div>
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

      {activeTab === 'cluster' ? (
        <form onSubmit={handleSaveClusterSettings} className="space-y-6">
          {/* Retention Policies Card */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 space-y-4 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Storage & Retention
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                  Log Retention (Days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={settings.logRetentionDays || 7}
                  onChange={(e) =>
                    setSettings({ ...settings, logRetentionDays: Number(e.target.value) })
                  }
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                  Metrics Retention (Days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={settings.metricsRetentionDays || 30}
                  onChange={(e) =>
                    setSettings({ ...settings, metricsRetentionDays: Number(e.target.value) })
                  }
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                  Gzip Threshold (MB)
                </label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={settings.logCompressionThresholdMb || 10}
                  onChange={(e) =>
                    setSettings({ ...settings, logCompressionThresholdMb: Number(e.target.value) })
                  }
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>
          </div>

          {/* Webhooks & Alerts Card */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Bell size={15} className="text-amber-500" /> Alert Webhooks
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Automatically fire webhook alerts when process crashes or high resource usage
                  occur
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {(settings.alertWebhooks || []).map((wh: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 text-xs font-mono"
                >
                  <div className="flex items-center gap-3">
                    <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                      {wh.type}
                    </span>
                    <span className="text-zinc-800 dark:text-zinc-300 truncate max-w-sm">
                      {wh.url}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeWebhook(idx)}
                    className="p-1 text-zinc-400 hover:text-rose-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Webhook Input */}
            <div className="flex items-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800/80">
              <select
                value={newWebhookType}
                onChange={(e) => setNewWebhookType(e.target.value as any)}
                className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-xs rounded-lg px-3 py-1.5 text-zinc-800 dark:text-zinc-200"
              >
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
                <option value="generic">Generic JSON</option>
              </select>
              <input
                type="url"
                placeholder="https://hooks.slack.com/services/..."
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
                className="flex-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-zinc-500 font-mono"
              />
              <button
                type="button"
                onClick={addWebhook}
                className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-medium flex items-center gap-1 border border-zinc-200 dark:border-zinc-700 shadow-sm"
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-zinc-100 dark:text-zinc-950 font-medium rounded-lg text-xs transition-colors shadow-sm disabled:opacity-50"
            >
              <Save size={14} />
              {loading ? 'Saving Changes...' : 'Save Settings'}
            </button>
          </div>
        </form>
      ) : (
        /* Security & 2FA Tab */
        <div className="space-y-6">
          {/* Two-Factor Authentication Card */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <KeyRound
                    size={17}
                    className={twoFactorStatus.enabled ? 'text-emerald-500' : 'text-zinc-400'}
                  />
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Two-Factor Authentication (TOTP - RFC 6238)
                  </h2>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      twoFactorStatus.enabled
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700'
                    }`}
                  >
                    {twoFactorStatus.enabled ? 'Enabled & Active' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  Protect your PM2 Web UI account with an extra layer of security using Google
                  Authenticator, 1Password, or Authy.
                </p>
              </div>

              {twoFactorStatus.enabled ? (
                <button
                  type="button"
                  onClick={() => setIsDisableModalOpen(true)}
                  className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-semibold rounded-lg transition-colors"
                >
                  Disable 2FA
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsSetupModalOpen(true)}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                >
                  Enable 2FA
                </button>
              )}
            </div>

            {twoFactorStatus.enabled && (
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-emerald-500" />
                  <span>
                    2FA is protecting your account against brute-force and credential stuffing.
                  </span>
                </div>
                <span className="text-[11px] text-zinc-500 font-mono">AES-256-GCM at rest</span>
              </div>
            )}
          </div>

          {/* Active Sessions Card */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Laptop size={16} className="text-blue-500" /> Active Devices & Sessions
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Track authenticated sessions across browsers and revoke access remotely.
                </p>
              </div>

              {sessions.length > 1 && (
                <button
                  type="button"
                  onClick={handleRevokeAllOtherSessions}
                  className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-zinc-700 dark:text-zinc-300 hover:text-rose-600 dark:hover:text-rose-300 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-medium transition-colors"
                >
                  Revoke All Other Sessions
                </button>
              )}
            </div>

            <div className="space-y-2">
              {sessions.map((s, idx) => (
                <div
                  key={s.id || idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
                      {s.userAgent?.includes('Mobile') ? (
                        <Smartphone size={16} />
                      ) : (
                        <Laptop size={16} />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono">
                          {s.ipAddress || '127.0.0.1'}
                        </span>
                        {s.isCurrent && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            Current Device
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate max-w-sm">
                        {s.userAgent || 'Web Browser'} • Active{' '}
                        {new Date(s.lastActiveAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {!s.isCurrent && (
                    <button
                      type="button"
                      onClick={() => handleRevokeSession(s.id)}
                      className="p-1.5 text-zinc-400 hover:text-rose-500 transition-colors"
                      title="Terminate Session"
                    >
                      <LogOut size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Scoped Personal Access Tokens (PATs) Card */}
          <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Zap size={16} className="text-amber-500" /> Scoped Personal Access Tokens (PATs)
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Generate HMAC-hashed tokens for automated CI/CD deployment pipelines with granular
                  RBAC permissions.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsCreateTokenModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-zinc-100 dark:text-zinc-950 rounded-lg text-xs font-semibold transition-colors"
              >
                <Plus size={13} /> Generate Token
              </button>
            </div>

            {tokens.length === 0 ? (
              <p className="text-xs text-zinc-500 py-2">No Personal Access Tokens created yet.</p>
            ) : (
              <div className="space-y-2">
                {tokens.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {t.name}
                        </span>
                        <code className="font-mono text-[11px] bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-600 dark:text-zinc-400">
                          {t.tokenPrefix}...
                        </code>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-zinc-500">
                          Scopes: {t.permissions.join(', ')}
                        </span>
                        {t.lastUsedAt && (
                          <span className="text-[11px] text-zinc-400">
                            • Last used {new Date(t.lastUsedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRevokeToken(t.id)}
                      className="p-1.5 text-zinc-400 hover:text-rose-500 transition-colors"
                      title="Revoke Token"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2FA Setup Modal */}
      <TwoFactorSetupModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        onEnabled={() => {
          loadSecurityData();
          setFeedback('Two-Factor Authentication has been successfully enabled.');
        }}
      />

      {/* Disable 2FA Modal */}
      {isDisableModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Disable Two-Factor Authentication
            </h3>
            <p className="text-xs text-zinc-500">
              Confirm your account password to disable two-factor authentication.
            </p>

            {disableError && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-600 dark:text-rose-300">
                {disableError}
              </div>
            )}

            <form onSubmit={handleDisable2FA} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  required
                  autoFocus
                  placeholder="••••••••"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDisableModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  Confirm Disable
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create PAT Modal */}
      {isCreateTokenModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Generate Personal Access Token (PAT)
            </h3>

            {createdRawToken ? (
              <div className="space-y-4">
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                  <strong>Copy your personal access token now.</strong> You won't be able to see it
                  again!
                </div>

                <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 font-mono text-xs text-zinc-900 dark:text-zinc-100 select-all break-all">
                  {createdRawToken}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(createdRawToken);
                      setCopiedRawToken(true);
                      setTimeout(() => setCopiedRawToken(false), 2000);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-700"
                  >
                    {copiedRawToken ? (
                      <Check size={13} className="text-emerald-500" />
                    ) : (
                      <Copy size={13} />
                    )}
                    {copiedRawToken ? 'Copied Token' : 'Copy Token'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCreatedRawToken(null);
                      setIsCreateTokenModalOpen(false);
                    }}
                    className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-950 rounded-lg text-xs font-semibold"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateToken} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    Token Name / Description
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. GitHub Actions CI Deploy"
                    value={newTokenName}
                    onChange={(e) => setNewTokenName(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    Expiration
                  </label>
                  <select
                    value={newTokenExpiry}
                    onChange={(e) => setNewTokenExpiry(Number(e.target.value))}
                    className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
                  >
                    <option value={30}>30 Days</option>
                    <option value={90}>90 Days</option>
                    <option value={365}>1 Year</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                    Select Scoped Permissions
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    {[
                      'process:view',
                      'process:manage',
                      'process:scale',
                      'deploy:view',
                      'deploy:trigger',
                      'deploy:rollback',
                      'log:view',
                      'metrics:view',
                    ].map((p) => (
                      <label
                        key={p}
                        className="flex items-center gap-2 p-1.5 bg-zinc-50 dark:bg-zinc-950 rounded border border-zinc-200 dark:border-zinc-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={newTokenPerms.includes(p)}
                          onChange={() => toggleTokenPermission(p)}
                          className="rounded text-zinc-900 focus:ring-0"
                        />
                        <span className="text-[11px] text-zinc-800 dark:text-zinc-200">{p}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setIsCreateTokenModalOpen(false)}
                    className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newTokenName || newTokenPerms.length === 0}
                    className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-zinc-100 dark:text-zinc-950 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    Generate Token
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
