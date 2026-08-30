import React, { useState } from 'react';
import { Terminal, Copy, Check, ShieldCheck, Cpu, Layers, FileCode } from 'lucide-react';
import { Modal } from '../ui/Modal.js';

interface ConnectWorkerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectWorkerModal: React.FC<ConnectWorkerModalProps> = ({ isOpen, onClose }) => {
  const defaultMaster =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3005';
  const [masterUrl, setMasterUrl] = useState(defaultMaster);
  const [joinToken, setJoinToken] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [activeTab, setActiveTab] = useState<'curl' | 'npx' | 'docker' | 'systemd'>('curl');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const cleanMasterUrl = masterUrl.trim() || defaultMaster;
  const cleanToken = joinToken.trim();
  const cleanName = workerName.trim();

  // Generate Snippets
  const curlCommand =
    cleanToken || cleanName
      ? `curl -fsSL ${cleanMasterUrl}/install.sh | bash -s -- --master="${cleanMasterUrl}"${
          cleanToken ? ` --token="${cleanToken}"` : ''
        }${cleanName ? ` --name="${cleanName}"` : ''}`
      : `curl -fsSL ${cleanMasterUrl}/install.sh | bash`;

  const npxCommand = `MASTER_WS_URL="${cleanMasterUrl}"${
    cleanToken ? ` JOIN_TOKEN="${cleanToken}"` : ''
  }${cleanName ? ` AGENT_HOSTNAME="${cleanName}"` : ''} npx @pm2-cluster/agent-core`;

  const dockerCommand = `docker run -d \\
  --name pm2-worker \\
  --restart always \\
  -e MASTER_WS_URL="${cleanMasterUrl}" \\${
    cleanToken ? `\n  -e JOIN_TOKEN="${cleanToken}" \\` : ''
  }${cleanName ? `\n  -e AGENT_HOSTNAME="${cleanName}" \\` : ''}
  -v ~/.pm2:/root/.pm2 \\
  ghcr.io/imdarkshadow/pm2-agent:latest`;

  const systemdService = `[Unit]
Description=PM2 Cluster Worker Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/pm2-cluster-agent
Environment="MASTER_WS_URL=${cleanMasterUrl}"${
    cleanToken ? `\nEnvironment="JOIN_TOKEN=${cleanToken}"` : ''
  }${cleanName ? `\nEnvironment="AGENT_HOSTNAME=${cleanName}"` : ''}
Environment="NODE_ENV=production"
ExecStart=/usr/bin/npx @pm2-cluster/agent-core
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Connect Worker Node" maxWidth="max-w-2xl">
      <div className="space-y-5">
        {/* Intro */}
        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Install the worker agent on any server running PM2 to securely attach it to this cluster.
          Telemetry and process controls will synchronize automatically.
        </p>

        {/* Configuration Parameter Bar */}
        <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Cluster Connection Parameters
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Master Server URL
              </label>
              <input
                type="text"
                value={masterUrl}
                onChange={(e) => setMasterUrl(e.target.value)}
                placeholder="http://master-ip:3005"
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Join Token <span className="text-zinc-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={joinToken}
                onChange={(e) => setJoinToken(e.target.value)}
                placeholder="Auto-join secret"
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Worker Hostname <span className="text-zinc-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={workerName}
                onChange={(e) => setWorkerName(e.target.value)}
                placeholder="worker-01"
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Method Tabs */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 border-b border-zinc-200 dark:border-zinc-800 pb-2">
            <button
              onClick={() => setActiveTab('curl')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'curl'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Terminal size={13} /> One-Line Script
            </button>
            <button
              onClick={() => setActiveTab('npx')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'npx'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Cpu size={13} /> NPX / CLI
            </button>
            <button
              onClick={() => setActiveTab('docker')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'docker'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Layers size={13} /> Docker
            </button>
            <button
              onClick={() => setActiveTab('systemd')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'systemd'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <FileCode size={13} /> Systemd Service
            </button>
          </div>

          {/* Tab 1: One-Line Curl */}
          {activeTab === 'curl' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Run this command on your remote Linux server:</span>
                <button
                  onClick={() => copyToClipboard(curlCommand, 'curl')}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  {copiedKey === 'curl' ? (
                    <>
                      <Check size={12} /> Copied to Clipboard
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> Copy Command
                    </>
                  )}
                </button>
              </div>
              <div className="relative group">
                <pre className="p-3.5 bg-zinc-950 text-zinc-100 rounded-xl font-mono text-xs overflow-x-auto select-all border border-zinc-800 leading-relaxed">
                  {curlCommand}
                </pre>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                ⚡ This installer will check for Node.js, install PM2, configure the agent, and
                register a background systemd service.
              </p>
            </div>
          )}

          {/* Tab 2: NPX */}
          {activeTab === 'npx' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Execute directly with NPX or Node:</span>
                <button
                  onClick={() => copyToClipboard(npxCommand, 'npx')}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  {copiedKey === 'npx' ? (
                    <>
                      <Check size={12} /> Copied to Clipboard
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> Copy Command
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3.5 bg-zinc-950 text-zinc-100 rounded-xl font-mono text-xs overflow-x-auto select-all border border-zinc-800 leading-relaxed">
                {npxCommand}
              </pre>
            </div>
          )}

          {/* Tab 3: Docker */}
          {activeTab === 'docker' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Run container with PM2 socket mounted:</span>
                <button
                  onClick={() => copyToClipboard(dockerCommand, 'docker')}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  {copiedKey === 'docker' ? (
                    <>
                      <Check size={12} /> Copied to Clipboard
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> Copy Docker Command
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3.5 bg-zinc-950 text-zinc-100 rounded-xl font-mono text-xs overflow-x-auto select-all border border-zinc-800 leading-relaxed">
                {dockerCommand}
              </pre>
            </div>
          )}

          {/* Tab 4: Systemd */}
          {activeTab === 'systemd' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>
                  Save to{' '}
                  <code className="text-xs font-mono">/etc/systemd/system/pm2-agent.service</code>:
                </span>
                <button
                  onClick={() => copyToClipboard(systemdService, 'systemd')}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  {copiedKey === 'systemd' ? (
                    <>
                      <Check size={12} /> Copied to Clipboard
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> Copy Service Unit
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3.5 bg-zinc-950 text-zinc-100 rounded-xl font-mono text-[11px] overflow-x-auto select-all border border-zinc-800 leading-relaxed max-h-48">
                {systemdService}
              </pre>
            </div>
          )}
        </div>

        {/* Enrollment Flow Info */}
        <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs text-zinc-700 dark:text-zinc-300 space-y-1">
          <div className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <ShieldCheck size={14} /> Node Enrollment & Approval
          </div>
          <p className="text-[11px] leading-relaxed">
            • <strong>Manual Approval:</strong> When a new worker connects without a join token, it
            will appear with status{' '}
            <span className="font-mono text-amber-600 dark:text-amber-400">pending</span>. Click{' '}
            <strong>Review Request</strong> on the Nodes page to approve it.
            <br />• <strong>Automated Join:</strong> When configured with a matching{' '}
            <span className="font-mono text-emerald-600 dark:text-emerald-400">JOIN_TOKEN</span>,
            the node is approved immediately.
          </p>
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
