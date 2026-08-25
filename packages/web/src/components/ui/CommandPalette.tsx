import React, { useState, useEffect, useRef } from 'react';
import { Search, Server, Zap, GitBranch, Shield, Activity, Layers, Terminal } from 'lucide-react';
import { api } from '../../api/client.js';
import { useNodeStore } from '../../store/nodeStore.js';

export interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onNavigate: (tab: string) => void;
  readonly onSelectProcess?: (name: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onSelectProcess,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [nodes, setNodes] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [gitApps, setGitApps] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setSelectedNodeId } = useNodeStore();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);

      // Fetch search index
      Promise.all([
        api.getNodes().catch(() => []),
        api.getAllProcesses().catch(() => []),
        api.getGitApps().catch(() => []),
      ]).then(([n, p, a]) => {
        setNodes(n || []);
        setProcesses(p || []);
        setGitApps(a || []);
      });
    }
  }, [isOpen]);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length),
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (!isOpen) return null;

  // Build searchable items
  const items: {
    id: string;
    category: 'Navigation' | 'Processes' | 'Nodes' | 'Git Apps' | 'Actions';
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    action: () => void;
  }[] = [
    // Navigation
    {
      id: 'nav-dashboard',
      category: 'Navigation',
      icon: <Activity size={14} className="text-emerald-500" />,
      title: 'Dashboard Overview',
      subtitle: 'Cluster command center & telemetry',
      action: () => {
        onNavigate('dashboard');
        onClose();
      },
    },
    {
      id: 'nav-processes',
      category: 'Navigation',
      icon: <Layers size={14} className="text-blue-500" />,
      title: 'Processes Manager',
      subtitle: 'View all cluster processes & controls',
      action: () => {
        onNavigate('processes');
        onClose();
      },
    },
    {
      id: 'nav-nodes',
      category: 'Navigation',
      icon: <Server size={14} className="text-purple-500" />,
      title: 'Nodes & Infrastructure',
      subtitle: 'Worker node topology and registration',
      action: () => {
        onNavigate('nodes');
        onClose();
      },
    },
    {
      id: 'nav-deployments',
      category: 'Navigation',
      icon: <GitBranch size={14} className="text-amber-500" />,
      title: 'Git Deployments & CI/CD',
      subtitle: 'Automated releases & multi-node deploy',
      action: () => {
        onNavigate('deployments');
        onClose();
      },
    },
    {
      id: 'nav-security',
      category: 'Navigation',
      icon: <Shield size={14} className="text-rose-500" />,
      title: 'Security, 2FA & Access Control',
      subtitle: 'TOTP, sessions, and PAT tokens',
      action: () => {
        onNavigate('settings');
        onClose();
      },
    },

    // Actions
    {
      id: 'act-reload-all',
      category: 'Actions',
      icon: <Zap size={14} className="text-amber-500" />,
      title: 'Graceful Reload All Online Processes',
      subtitle: 'Zero-downtime rolling reload across cluster',
      action: async () => {
        const targets = processes.map((p) => ({ nodeId: p.nodeId, pmId: p.pmId }));
        if (targets.length > 0) {
          await api.batchProcessActionCrossNode('reload', targets).catch(console.error);
        }
        onNavigate('processes');
        onClose();
      },
    },

    // Processes
    ...processes.map((proc) => ({
      id: `proc-${proc.nodeId}-${proc.pmId}`,
      category: 'Processes' as const,
      icon: <Terminal size={14} className="text-zinc-400" />,
      title: `${proc.name} (id: ${proc.pmId})`,
      subtitle: `Node: ${proc.nodeHostname || 'local'} • Status: ${proc.status} • CPU: ${proc.cpu || 0}%`,
      action: () => {
        if (onSelectProcess) onSelectProcess(proc.name);
        else onNavigate('processes');
        onClose();
      },
    })),

    // Nodes
    ...nodes.map((node) => ({
      id: `node-${node.id}`,
      category: 'Nodes' as const,
      icon: <Server size={14} className="text-emerald-400" />,
      title: `Node: ${node.hostname}`,
      subtitle: `${node.ipAddress}:${node.port} • Status: ${node.status}`,
      action: () => {
        setSelectedNodeId(node.id);
        onNavigate('processes');
        onClose();
      },
    })),

    // Git Apps
    ...gitApps.map((app) => ({
      id: `app-${app.id}`,
      category: 'Git Apps' as const,
      icon: <GitBranch size={14} className="text-amber-400" />,
      title: `App: ${app.name}`,
      subtitle: `${app.repoUrl} (${app.branch})`,
      action: () => {
        onNavigate('deployments');
        onClose();
      },
    })),
  ];

  const filteredItems = items.filter((item) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.subtitle?.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-start justify-center pt-24 p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Search Header */}
        <div className="p-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
          <Search size={17} className="text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command, search process, node, or jump to page..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-500 border border-zinc-200 dark:border-zinc-700">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No matching commands or resources found.
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between p-2.5 rounded-xl text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-6 h-6 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div className="text-[11px] text-zinc-500 truncate">{item.subtitle}</div>
                      )}
                    </div>
                  </div>

                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0 ml-2">
                    {item.category}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-2.5 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex items-center justify-between text-[11px] text-zinc-500">
          <div className="flex items-center gap-2">
            <span>↑↓ Navigate</span>
            <span>•</span>
            <span>↵ Select</span>
          </div>
          <span>PM2 Command Palette</span>
        </div>
      </div>
    </div>
  );
};
