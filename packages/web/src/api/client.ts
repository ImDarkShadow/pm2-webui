export interface UserSession {
  readonly id: string;
  readonly username: string;
  readonly roleName: 'admin' | 'operator' | 'viewer';
}

class ApiClient {
  private accessToken: string | null = localStorage.getItem('pm2_access_token');
  private refreshToken: string | null = localStorage.getItem('pm2_refresh_token');

  public setTokens(access: string, refresh: string) {
    this.accessToken = access;
    this.refreshToken = refresh;
    localStorage.setItem('pm2_access_token', access);
    localStorage.setItem('pm2_refresh_token', refresh);
  }

  public clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('pm2_access_token');
    localStorage.removeItem('pm2_refresh_token');
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  public async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    if (this.accessToken) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    if (options.body && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    let response = await fetch(url, { ...options, headers });

    // Handle Token Expiry & Automatic Refresh
    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        headers.set('Authorization', `Bearer ${this.accessToken}`);
        response = await fetch(url, { ...options, headers });
      } else {
        this.clearTokens();
        window.location.href = '/login';
      }
    }

    return response;
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (res.ok) {
        const data = await res.json();
        this.setTokens(data.accessToken, data.refreshToken);
        return true;
      }
    } catch {
      // Refresh failed
    }
    return false;
  }

  // REST API Methods
  public async login(username: string, password: string) {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Login failed' }));
      throw new Error(err.message || 'Login failed');
    }
    const data = await res.json();
    if (!data.requires2FA && data.accessToken && data.refreshToken) {
      this.setTokens(data.accessToken, data.refreshToken);
    }
    return data;
  }

  public async verify2FA(tempToken: string, code: string) {
    const res = await fetch('/api/v1/auth/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '2FA verification failed' }));
      throw new Error(err.message || 'Invalid verification code');
    }
    const data = await res.json();
    if (data.accessToken && data.refreshToken) {
      this.setTokens(data.accessToken, data.refreshToken);
    }
    return data;
  }

  public async get2FAStatus() {
    const res = await this.fetchWithAuth('/api/v1/auth/2fa/status');
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Failed to fetch 2FA status' }));
      throw new Error(err.message || 'Failed to fetch 2FA status');
    }
    return res.json();
  }

  public async setup2FA() {
    const res = await this.fetchWithAuth('/api/v1/auth/2fa/setup', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Failed to setup 2FA' }));
      throw new Error(err.message || 'Failed to setup 2FA');
    }
    return res.json();
  }

  public async enable2FA(secret: string, code: string, recoveryCodes: string[]) {
    const res = await this.fetchWithAuth('/api/v1/auth/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ secret, code, recoveryCodes }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Failed to enable 2FA' }));
      throw new Error(err.message || 'Failed to enable 2FA');
    }
    return res.json();
  }

  public async disable2FA(password: string) {
    const res = await this.fetchWithAuth('/api/v1/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Failed to disable 2FA' }));
      throw new Error(err.message || 'Invalid password');
    }
    return res.json();
  }

  public async getSessions() {
    const res = await this.fetchWithAuth('/api/v1/auth/sessions');
    if (!res.ok) throw new Error('Failed to fetch sessions');
    return res.json();
  }

  public async revokeSession(sessionId: string) {
    const res = await this.fetchWithAuth(`/api/v1/auth/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to revoke session');
    return res.json();
  }

  public async revokeAllOtherSessions() {
    const res = await this.fetchWithAuth('/api/v1/auth/sessions/revoke-all', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to revoke sessions');
    return res.json();
  }

  public async getApiTokens() {
    const res = await this.fetchWithAuth('/api/v1/auth/tokens');
    if (!res.ok) throw new Error('Failed to fetch API tokens');
    return res.json();
  }

  public async createApiToken(name: string, permissions: string[], expiresInDays?: number) {
    const res = await this.fetchWithAuth('/api/v1/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ name, permissions, expiresInDays }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Failed to create API token' }));
      throw new Error(err.message || 'Failed to create token');
    }
    return res.json();
  }

  public async revokeApiToken(tokenId: string) {
    const res = await this.fetchWithAuth(`/api/v1/auth/tokens/${tokenId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to revoke API token');
    return res.json();
  }

  public async getSecurityHealth() {
    const res = await this.fetchWithAuth('/api/v1/security/health');
    if (!res.ok) throw new Error('Failed to fetch security health');
    return res.json();
  }

  public async getMe() {
    const res = await this.fetchWithAuth('/api/v1/auth/me');
    if (!res.ok) throw new Error('Failed to fetch user profile');
    return res.json();
  }

  public async getNodes() {
    const res = await this.fetchWithAuth('/api/v1/nodes');
    if (!res.ok) throw new Error('Failed to fetch nodes');
    return res.json();
  }

  public async getNode(nodeId: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}`);
    if (!res.ok) throw new Error('Failed to fetch node');
    return res.json();
  }

  public async approveNode(nodeId: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/approve`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to approve node');
    return res.json();
  }

  public async rejectNode(nodeId: string, reason?: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error('Failed to reject node');
    return res.json();
  }

  public async getNodeDelegationToken(nodeId: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/token`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to get delegation token');
    return res.json();
  }

  public async getProcesses(nodeId: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/processes`);
    if (!res.ok) throw new Error('Failed to fetch processes');
    return res.json();
  }

  public async executeProcessAction(nodeId: string, action: string, target: string | number) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/processes/action`, {
      method: 'POST',
      body: JSON.stringify({ action, target }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Action failed' }));
      throw new Error(err.message || 'Action failed');
    }
    return res.json();
  }

  public async batchProcessAction(nodeId: string, action: string, targets: (string | number)[]) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/processes/batch`, {
      method: 'POST',
      body: JSON.stringify({ action, targets }),
    });
    if (!res.ok) throw new Error('Batch action failed');
    return res.json();
  }

  public async scaleProcess(nodeId: string, target: string | number, instances: number) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/processes/scale`, {
      method: 'POST',
      body: JSON.stringify({ target, instances }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Scale failed' }));
      throw new Error(err.message || 'Scale failed');
    }
    return res.json();
  }

  public async triggerProcessAction(
    nodeId: string,
    target: string | number,
    actionName: string,
    params?: Record<string, unknown>,
  ) {
    const res = await this.fetchWithAuth(
      `/api/v1/nodes/${nodeId}/processes/${target}/trigger-action`,
      {
        method: 'POST',
        body: JSON.stringify({ actionName, params }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Action trigger failed' }));
      throw new Error(err.message || 'Action trigger failed');
    }
    return res.json();
  }

  public async getProcessEnv(nodeId: string, target: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/processes/${target}/env`);
    if (!res.ok) throw new Error('Failed to fetch process environment');
    return res.json();
  }

  public async revealProcessEnvKey(nodeId: string, target: string, key: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/processes/${target}/reveal-env`, {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error('Failed to reveal environment secret');
    return res.json();
  }

  public async getMetrics(nodeId: string, from?: number, to?: number, limit = 500) {
    const params = new URLSearchParams();
    if (from) params.set('from', String(from));
    if (to) params.set('to', String(to));
    params.set('limit', String(limit));

    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/metrics?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch node metrics');
    return res.json();
  }

  public async getPlugins(nodeId: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/plugins`);
    if (!res.ok) throw new Error('Failed to fetch plugins');
    return res.json();
  }

  public async installPlugin(nodeId: string, pluginName: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/plugins/install`, {
      method: 'POST',
      body: JSON.stringify({ pluginName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Plugin install failed' }));
      throw new Error(err.message || 'Plugin install failed');
    }
    return res.json();
  }

  public async uninstallPlugin(nodeId: string, pluginName: string) {
    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/plugins/uninstall`, {
      method: 'POST',
      body: JSON.stringify({ pluginName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Plugin uninstall failed' }));
      throw new Error(err.message || 'Plugin uninstall failed');
    }
    return res.json();
  }

  public async getLogTree(
    nodeId: string,
    processName: string,
    granularity = '1m',
    from?: number,
    to?: number,
  ) {
    const now = Date.now();
    const fromTs = from ?? now - 60 * 60 * 1000;
    const toTs = to ?? now;
    const res = await this.fetchWithAuth(
      `/api/v1/nodes/${nodeId}/logs/tree?processName=${encodeURIComponent(processName)}&granularity=${granularity}&from=${fromTs}&to=${toTs}`,
    );
    if (!res.ok) throw new Error('Failed to fetch log tree');
    return res.json();
  }

  public async getRawLogs(
    nodeId: string,
    options: {
      processName: string;
      stream?: string;
      search?: string;
      isRegex?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    const params = new URLSearchParams();
    params.set('processName', options.processName);
    if (options.stream) params.set('stream', options.stream);
    if (options.search) params.set('search', options.search);
    if (options.isRegex) params.set('isRegex', 'true');
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));

    const res = await this.fetchWithAuth(`/api/v1/nodes/${nodeId}/logs/raw?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch logs');
    return res.json();
  }

  public async getLogs(
    nodeId: string,
    processName: string,
    options: { lines?: number; stream?: string } = {},
  ) {
    return this.getRawLogs(nodeId, {
      processName,
      limit: options.lines || 100,
      stream: options.stream,
    });
  }

  public async getAuditLogs(page = 1, limit = 50) {
    const res = await this.fetchWithAuth(`/api/v1/audit?page=${page}&limit=${limit}`);
    if (!res.ok) throw new Error('Failed to fetch audit logs');
    return res.json();
  }

  public async getSettings() {
    const res = await this.fetchWithAuth('/api/v1/settings');
    if (!res.ok) throw new Error('Failed to fetch settings');
    return res.json();
  }

  public async updateSettings(settings: any) {
    const res = await this.fetchWithAuth('/api/v1/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Failed to update settings');
    return res.json();
  }

  // Git Deployment API Methods
  public async getGitApps() {
    const res = await this.fetchWithAuth('/api/v1/deploy/apps');
    if (!res.ok) throw new Error('Failed to fetch git apps');
    return res.json();
  }

  public async createGitApp(payload: any) {
    const res = await this.fetchWithAuth('/api/v1/deploy/apps', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Failed to create git app' }));
      throw new Error(err.message || 'Failed to create git app');
    }
    return res.json();
  }

  public async getGitApp(appId: string) {
    const res = await this.fetchWithAuth(`/api/v1/deploy/apps/${appId}`);
    if (!res.ok) throw new Error('Failed to fetch git app details');
    return res.json();
  }

  public async updateGitApp(appId: string, payload: any) {
    const res = await this.fetchWithAuth(`/api/v1/deploy/apps/${appId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to update git app');
    return res.json();
  }

  public async deleteGitApp(appId: string) {
    const res = await this.fetchWithAuth(`/api/v1/deploy/apps/${appId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete git app');
    return res.json();
  }

  public async triggerDeploy(
    appId: string,
    options: { branch?: string; commitHash?: string } = {},
  ) {
    const res = await this.fetchWithAuth(`/api/v1/deploy/apps/${appId}/deploy`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
    if (!res.ok) throw new Error('Failed to trigger deployment');
    return res.json();
  }

  public async rollbackDeploy(appId: string, deployId: string) {
    const res = await this.fetchWithAuth(`/api/v1/deploy/apps/${appId}/rollback/${deployId}`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to rollback deployment');
    return res.json();
  }

  public async getAppDeployments(appId: string) {
    const res = await this.fetchWithAuth(`/api/v1/deploy/apps/${appId}/deployments`);
    if (!res.ok) throw new Error('Failed to fetch app deployments');
    return res.json();
  }

  public async getDeployment(deployId: string) {
    const res = await this.fetchWithAuth(`/api/v1/deploy/deployments/${deployId}`);
    if (!res.ok) throw new Error('Failed to fetch deployment details');
    return res.json();
  }

  public async getRecentDeployments() {
    const res = await this.fetchWithAuth('/api/v1/deploy/recent');
    if (!res.ok) throw new Error('Failed to fetch recent deployments');
    return res.json();
  }

  // Cross-Server Process APIs
  public async getAllProcesses() {
    const res = await this.fetchWithAuth('/api/v1/processes/all');
    if (!res.ok) throw new Error('Failed to fetch cluster processes');
    return res.json();
  }

  public async batchProcessActionCrossNode(
    action: 'start' | 'stop' | 'restart' | 'reload' | 'delete',
    targets: { nodeId: string; pmId: number | string }[],
  ) {
    const res = await this.fetchWithAuth('/api/v1/processes/batch-action', {
      method: 'POST',
      body: JSON.stringify({ action, targets }),
    });
    if (!res.ok) throw new Error('Failed to execute cross-node batch action');
    return res.json();
  }

  // Operations Timeline API
  public async getTimeline() {
    const res = await this.fetchWithAuth('/api/v1/timeline');
    if (!res.ok) throw new Error('Failed to fetch operations timeline');
    return res.json();
  }

  // Roaming User Preferences APIs
  public async getPreferences() {
    const res = await this.fetchWithAuth('/api/v1/users/preferences');
    if (!res.ok) throw new Error('Failed to fetch user preferences');
    return res.json();
  }

  public async updatePreferences(preferences: Record<string, any>) {
    const res = await this.fetchWithAuth('/api/v1/users/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
    if (!res.ok) throw new Error('Failed to update user preferences');
    return res.json();
  }

  // Multi-Node Cluster Deploy & Rollback APIs
  public async clusterDeploy(
    appId: string,
    options: {
      targetNodeIds?: string[];
      branch?: string;
      commitHash?: string;
      strategy?: 'parallel' | 'rolling';
    } = {},
  ) {
    const res = await this.fetchWithAuth(`/api/v1/deploy/apps/${appId}/cluster-deploy`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Cluster deploy failed' }));
      throw new Error(err.message || 'Cluster deploy failed');
    }
    return res.json();
  }

  public async clusterRollback(appId: string, deployId: string, targetNodeIds?: string[]) {
    const res = await this.fetchWithAuth(`/api/v1/deploy/apps/${appId}/cluster-rollback`, {
      method: 'POST',
      body: JSON.stringify({ deployId, targetNodeIds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Cluster rollback failed' }));
      throw new Error(err.message || 'Cluster rollback failed');
    }
    return res.json();
  }
}

export const api = new ApiClient();
