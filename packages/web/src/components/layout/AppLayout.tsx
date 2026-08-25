import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Server,
  Layers,
  GitBranch,
  Terminal,
  Activity,
  Package,
  Shield,
  Settings,
  LogOut,
  ChevronDown,
  Search,
  Menu,
  X,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { useNodeStore } from '../../store/nodeStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { ThemeToggle } from '../ui/ThemeToggle.js';
import { CommandPalette } from '../ui/CommandPalette.js';
import { Logo } from '../ui/Logo.js';

export interface AppLayoutProps {
  readonly activeTab: string;
  readonly onTabChange: (tab: string) => void;
  readonly onSelectProcess?: (procName: string) => void;
  readonly children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  activeTab,
  onTabChange,
  onSelectProcess,
  children,
}) => {
  const { user, logout } = useAuthStore();
  const { nodes, selectedNodeId, setSelectedNodeId } = useNodeStore();
  const { sidebarCollapsed, setSidebarCollapsed, density, setDensity, loadPreferences } =
    usePreferencesStore();

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);

  useEffect(() => {
    loadPreferences();
  }, []);

  // Global Keyboard shortcuts: Cmd+K / Ctrl+K (search) and Cmd+B / Ctrl+B (sidebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    {
      id: 'nodes',
      label: 'Nodes',
      icon: Server,
      badge: nodes.filter((n) => n.status === 'pending').length,
    },
    { id: 'processes', label: 'Processes', icon: Layers },
    { id: 'deployments', label: 'Deployments', icon: GitBranch },
    { id: 'logs', label: 'Logs', icon: Terminal },
    { id: 'monitoring', label: 'Monitoring', icon: Activity },
    { id: 'plugins', label: 'Plugins', icon: Package },
    { id: 'audit', label: 'Audit Logs', icon: Shield },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const onlineNodesCount = nodes.filter((n) => n.status === 'online').length;

  const handleNavClick = (tabId: string) => {
    onTabChange(tabId);
    setMobileMenuOpen(false);
  };

  return (
    <div className="flex h-screen w-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none transition-colors duration-150">
      {/* Mobile Drawer Backdrop Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden animate-in fade-in duration-200"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 md:static flex flex-col justify-between border-r border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/60 backdrop-blur-md shadow-lg md:shadow-none transition-all duration-200 ease-in-out shrink-0 ${
          mobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0'
        } ${sidebarCollapsed ? 'md:w-16' : 'md:w-60'}`}
      >
        <div>
          {/* Brand Logo & Collapse Toggle Header */}
          <div className="h-14 px-3 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80">
            <div
              className={`flex items-center min-w-0 ${
                sidebarCollapsed && !mobileMenuOpen ? 'md:justify-center md:w-full' : 'px-1'
              }`}
            >
              <Logo
                size={sidebarCollapsed && !mobileMenuOpen ? 30 : 34}
                collapsed={sidebarCollapsed && !mobileMenuOpen}
                showWordmark={!sidebarCollapsed || mobileMenuOpen}
              />
            </div>

            {/* Mobile Close Button */}
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 md:hidden"
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="p-2 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const hasBadge = Boolean(item.badge && item.badge > 0);

              return (
                <div
                  key={item.id}
                  className="relative group"
                  onMouseEnter={() => setHoveredNav(item.id)}
                  onMouseLeave={() => setHoveredNav(null)}
                >
                  <button
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center rounded-lg text-xs font-medium transition-all ${
                      sidebarCollapsed
                        ? 'md:justify-center md:px-0 md:py-2.5 px-3 py-2'
                        : 'justify-between px-3 py-2'
                    } ${
                      isActive
                        ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 font-semibold shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon
                        size={17}
                        className={`shrink-0 ${
                          isActive
                            ? 'text-zinc-100 dark:text-zinc-950'
                            : 'text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200'
                        }`}
                      />
                      {(!sidebarCollapsed || mobileMenuOpen) && (
                        <span className="truncate">{item.label}</span>
                      )}
                    </div>

                    {/* Badge Count */}
                    {hasBadge && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold shrink-0 ${
                          sidebarCollapsed && !mobileMenuOpen
                            ? 'absolute top-1 right-1 h-2 w-2 p-0 bg-amber-500 rounded-full'
                            : 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {sidebarCollapsed && !mobileMenuOpen ? '' : item.badge}
                      </span>
                    )}
                  </button>

                  {/* Hover Floating Tooltip for Collapsed Sidebar */}
                  {sidebarCollapsed && !mobileMenuOpen && hoveredNav === item.id && (
                    <div className="fixed left-18 ml-1 z-50 px-2.5 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-800 text-white text-xs font-medium shadow-xl whitespace-nowrap border border-zinc-700 pointer-events-none animate-in fade-in zoom-in-95 duration-100 flex items-center gap-2">
                      <span>{item.label}</span>
                      {hasBadge && (
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Controls & User Profile */}
        <div className="p-2 border-t border-zinc-200 dark:border-zinc-800/80 space-y-2">
          {/* Desktop Sidebar Collapse Toggle Button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Expand Sidebar (⌘B)' : 'Collapse Sidebar (⌘B)'}
            className={`w-full hidden md:flex items-center gap-2 py-1.5 px-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors ${
              sidebarCollapsed ? 'justify-center' : 'justify-between'
            }`}
          >
            <div className="flex items-center gap-2">
              {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
              {!sidebarCollapsed && <span>Collapse Sidebar</span>}
            </div>
            {!sidebarCollapsed && (
              <kbd className="px-1 py-0.2 rounded bg-zinc-200 dark:bg-zinc-800 text-[10px] font-mono text-zinc-500">
                ⌘B
              </kbd>
            )}
          </button>

          {/* User Account Info */}
          <div
            className={`flex items-center justify-between p-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800/80 ${
              sidebarCollapsed && !mobileMenuOpen ? 'flex-col gap-2' : ''
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center justify-center shrink-0">
                {(user?.username || 'A')[0].toUpperCase()}
              </div>
              {(!sidebarCollapsed || mobileMenuOpen) && (
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                    {user?.username || 'Admin'}
                  </span>
                  <span className="text-[9px] text-zinc-500 uppercase tracking-wider">
                    {user?.roleName || 'Operator'}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={logout}
              title="Sign Out"
              className="p-1 rounded-md text-zinc-400 hover:text-rose-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shrink-0"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Sticky Top Header */}
        <header className="h-14 border-b border-zinc-200 dark:border-zinc-800/80 px-4 sm:px-6 flex items-center justify-between shrink-0 bg-white/90 dark:bg-zinc-950/80 backdrop-blur-md z-10">
          {/* Left: Mobile Menu & Active Node Switcher */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile Menu Trigger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 md:hidden"
              title="Open Navigation"
            >
              <Menu size={18} />
            </button>

            {/* Active Node Mesh Dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 hidden sm:inline font-medium">Node:</span>
              <div className="relative">
                <select
                  value={selectedNodeId || ''}
                  onChange={(e) => setSelectedNodeId(e.target.value)}
                  className="appearance-none bg-zinc-100 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 text-xs font-semibold rounded-lg pl-3 pr-8 py-1.5 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 cursor-pointer shadow-2xs hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.hostname} ({node.ipAddress}) {node.status === 'online' ? '●' : '○'}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-2.5 top-2.5 text-zinc-400 pointer-events-none"
                />
              </div>
            </div>

            {/* Node Status Pill */}
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>
                {onlineNodesCount}/{nodes.length} Online
              </span>
            </div>
          </div>

          {/* Right Toolbar Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Quick Command Palette (Cmd+K) */}
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900/90 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all shadow-2xs"
            >
              <Search size={13} />
              <span className="hidden md:inline">Command Palette</span>
              <kbd className="px-1.5 py-0.2 rounded bg-zinc-200 dark:bg-zinc-800 text-[10px] font-mono text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700 hidden sm:inline">
                ⌘K
              </kbd>
            </button>

            {/* Density Toggle (Comfortable vs Compact) */}
            <button
              onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
              title={`Switch Density Mode (Current: ${density})`}
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 transition-colors"
            >
              {density === 'compact' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              <span className="capitalize text-[11px] font-medium hidden xl:inline">{density}</span>
            </button>

            <ThemeToggle />
          </div>
        </header>

        {/* Dynamic Screen-Aware Page Content Viewport */}
        <main
          className={`flex-1 overflow-y-auto overflow-x-hidden ${
            density === 'compact' ? 'p-3 sm:p-4 lg:p-5' : 'p-4 sm:p-6 lg:p-7'
          }`}
        >
          {children}
        </main>
      </div>

      {/* Global Command Palette Modal */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={handleNavClick}
        onSelectProcess={onSelectProcess}
      />
    </div>
  );
};
