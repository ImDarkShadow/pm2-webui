import os from 'node:os';
import path from 'node:path';

export interface AgentConfig {
  readonly agentId?: string;
  readonly hostname: string;
  readonly port: number;
  readonly masterWsUrl?: string;
  readonly joinToken?: string;
  readonly dbPath: string;
  readonly logDir: string;
  readonly appsDir: string;
  readonly metricsIntervalMs: number;
  readonly logRetentionDays: number;
  readonly metricsRetentionDays: number;
}

export const loadAgentConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => {
  const defaultDataDir =
    process.env.AGENT_DATA_DIR || path.join(os.homedir(), '.pm2-cluster', 'agent');

  return {
    agentId: process.env.AGENT_ID || overrides.agentId,
    hostname: process.env.AGENT_HOSTNAME || overrides.hostname || os.hostname(),
    port: Number(process.env.AGENT_PORT || overrides.port || 4321),
    masterWsUrl: process.env.MASTER_WS_URL || overrides.masterWsUrl,
    joinToken:
      process.env.JOIN_TOKEN ||
      process.env.CLUSTER_JOIN_TOKEN ||
      process.env.ENROLLMENT_TOKEN ||
      overrides.joinToken,
    dbPath: overrides.dbPath || path.join(defaultDataDir, 'agent.db'),
    logDir: overrides.logDir || path.join(defaultDataDir, 'logs'),
    appsDir: overrides.appsDir || path.join(defaultDataDir, 'apps'),
    metricsIntervalMs: Number(
      process.env.METRICS_INTERVAL_MS || overrides.metricsIntervalMs || 3000,
    ),
    logRetentionDays: Number(process.env.LOG_RETENTION_DAYS || overrides.logRetentionDays || 7),
    metricsRetentionDays: Number(
      process.env.METRICS_RETENTION_DAYS || overrides.metricsRetentionDays || 30,
    ),
  };
};
