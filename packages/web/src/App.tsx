import React, { useEffect, useState } from 'react';
import { ThemeProvider } from './context/ThemeContext.js';
import { useAuthStore } from './store/authStore.js';
import { LoginPage } from './pages/LoginPage.js';
import { AppLayout } from './components/layout/AppLayout.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { NodesPage } from './pages/NodesPage.js';
import { ProcessesPage } from './pages/ProcessesPage.js';
import { ProcessDetailPage } from './pages/ProcessDetailPage.js';
import { LogsPage } from './pages/LogsPage.js';
import { MonitoringPage } from './pages/MonitoringPage.js';
import { PluginsPage } from './pages/PluginsPage.js';
import { DeploymentsPage } from './pages/DeploymentsPage.js';
import { GitAppDetailPage } from './pages/GitAppDetailPage.js';
import { AuditPage } from './pages/AuditPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

import { useNodeStore } from './store/nodeStore.js';
import { api } from './api/client.js';

export const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const { setNodes } = useNodeStore();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedProcessDetail, setSelectedProcessDetail] = useState<string | null>(null);
  const [selectedAppDetail, setSelectedAppDetail] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      api.getNodes().then(setNodes).catch(console.error);
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center text-xs text-zinc-500">
        Initializing PM2 Cluster Platform...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const handleSelectProcess = (procName: string) => {
    setSelectedProcessDetail(procName);
  };

  const handleSelectApp = (appId: string) => {
    setSelectedAppDetail(appId);
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSelectedProcessDetail(null);
    setSelectedAppDetail(null);
  };

  return (
    <AppLayout activeTab={activeTab} onTabChange={handleTabChange}>
      {activeTab === 'dashboard' && <DashboardPage onNavigate={handleTabChange} />}

      {activeTab === 'nodes' && <NodesPage />}

      {activeTab === 'processes' &&
        (selectedProcessDetail ? (
          <ProcessDetailPage
            processName={selectedProcessDetail}
            onBack={() => setSelectedProcessDetail(null)}
          />
        ) : (
          <ProcessesPage onSelectProcess={handleSelectProcess} />
        ))}

      {activeTab === 'deployments' &&
        (selectedAppDetail ? (
          <GitAppDetailPage appId={selectedAppDetail} onBack={() => setSelectedAppDetail(null)} />
        ) : (
          <DeploymentsPage onSelectApp={handleSelectApp} />
        ))}

      {activeTab === 'logs' && <LogsPage />}

      {activeTab === 'monitoring' && <MonitoringPage />}

      {activeTab === 'plugins' && <PluginsPage />}

      {activeTab === 'audit' && <AuditPage />}

      {activeTab === 'settings' && <SettingsPage />}
    </AppLayout>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
};
