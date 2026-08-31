// Node & Connectivity Types
export type ConnectivityMode = 'direct' | 'relay' | 'unknown';
export type NodeStatus = 'online' | 'offline' | 'pending' | 'rejected' | 'revoked';

export interface NodeState {
  readonly id: string;
  readonly hostname: string;
  readonly ipAddress: string;
  readonly port: number;
  readonly publicKey: string; // Ed25519 public key base64/hex
  readonly connectivityMode: ConnectivityMode;
  readonly status: NodeStatus;
  readonly version: string;
  readonly enrolledAt: number;
  readonly lastSeenAt: number;
  readonly groupIds?: readonly string[];
}

export interface NodeGroup {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: number;
}

// PM2 & Process Types
export type ProcessStatus =
  'online' | 'stopping' | 'stopped' | 'launching' | 'errored' | 'one-launch-status';

export interface ProcessMonit {
  readonly memory: number; // bytes
  readonly cpu: number; // percentage
}

export interface ProcessEnv {
  readonly [key: string]: string | undefined;
}

export interface CustomProbeValue {
  readonly value: number | string;
  readonly unit?: string;
  readonly type?: string;
}

export interface ProcessGitInfo {
  readonly branch?: string;
  readonly commitHash?: string;
  readonly shortCommit?: string;
  readonly commitMessage?: string;
  readonly commitAuthor?: string;
  readonly commitDate?: number;
  readonly remoteUrl?: string;
  readonly isDirty?: boolean;
}

export interface ProcessInfo {
  readonly name: string;
  readonly pmId: number;
  readonly pid?: number;
  readonly status: ProcessStatus;
  readonly monit: ProcessMonit;
  readonly uptime?: number; // timestamp
  readonly restarts: number;
  readonly unstableRestarts: number;
  readonly execMode: 'fork_mode' | 'cluster_mode';
  readonly scriptPath?: string;
  readonly cwd?: string;
  readonly env?: ProcessEnv;
  readonly nodeVersion?: string;
  readonly createdAt?: number;
  // Advanced Telemetry (PM2.io Enterprise Metrics)
  readonly rps?: number; // requests per minute
  readonly latencyMs?: number; // HTTP mean latency in ms
  readonly eventLoopDelayMs?: number; // Event loop latency / lag in ms
  readonly heapUsedMb?: number; // V8 Heap used in MB
  readonly heapTotalMb?: number; // V8 Heap total in MB
  readonly activeHandles?: number;
  readonly activeRequests?: number;
  readonly instances?: number; // Number of cluster instances
  readonly availableActions?: readonly string[]; // Advertised custom axm actions
  readonly customProbes?: Record<string, CustomProbeValue>;
  // Auto-Detected Git Details
  readonly git?: ProcessGitInfo;
}

export type ProcessAction = 'start' | 'stop' | 'restart' | 'reload' | 'delete';

export interface ProcessActionRequest {
  readonly action: ProcessAction;
  readonly target: string | number; // process name or pm_id, or "all"
  readonly options?: {
    readonly env?: Record<string, string>;
    readonly instances?: number;
  };
}

export interface ProcessScaleRequest {
  readonly target: string | number; // process name or pm_id
  readonly instances: number; // 1 <= instances <= 32
}

export interface ProcessActionTriggerRequest {
  readonly target: string | number;
  readonly actionName: string;
  readonly params?: Record<string, unknown>;
}

// PM2 Plugins (Strictly Fixed Allow-List for Security)
export const ALLOWED_PM2_PLUGINS = [
  'pm2-logrotate',
  'pm2-server-monit',
  'pm2-sysmonit',
  'pm2-slack',
] as const;

export type AllowedPm2Plugin = (typeof ALLOWED_PM2_PLUGINS)[number];

export interface InstalledPluginInfo {
  readonly name: string;
  readonly version?: string;
  readonly status: 'online' | 'stopped' | 'errored' | 'uninstalled';
  readonly description?: string;
  readonly isAllowed: boolean;
}

// Metrics Types
export interface HostCpuMetrics {
  readonly usagePercent: number;
  readonly cores: number;
  readonly load1m: number;
  readonly load5m: number;
  readonly load15m: number;
}

export interface HostMemoryMetrics {
  readonly total: number;
  readonly used: number;
  readonly free: number;
  readonly swapTotal: number;
  readonly swapUsed: number;
}

export interface HostDiskMetrics {
  readonly total: number;
  readonly used: number;
  readonly free: number;
  readonly usagePercent: number;
}

export interface HostNetworkMetrics {
  readonly rxSec: number;
  readonly txSec: number;
}

export interface HostMetrics {
  readonly timestamp: number;
  readonly cpu: HostCpuMetrics;
  readonly memory: HostMemoryMetrics;
  readonly disk: HostDiskMetrics;
  readonly network: HostNetworkMetrics;
  readonly clusterRps?: number;
  readonly avgLatencyMs?: number;
  readonly avgEventLoopDelayMs?: number;
}

export interface MetricFrame {
  readonly timestamp: number;
  readonly host: HostMetrics;
  readonly processes: readonly ProcessInfo[];
}

// Log & Crash Types
export type LogStreamType = 'stdout' | 'stderr' | 'both';
export type LogGranularity = '1s' | '10s' | '1m' | '10m' | '1h';

export interface LogLine {
  readonly timestamp: number;
  readonly processName: string;
  readonly stream: 'stdout' | 'stderr';
  readonly message: string;
  readonly lineIndex: number;
}

export interface LogSummaryBucket {
  readonly bucketTimestamp: number;
  readonly granularity: LogGranularity;
  readonly lineCount: number;
  readonly errorCount: number;
  readonly warnCount: number;
  readonly sampleText?: string;
}

export interface CrashEvent {
  readonly id: string;
  readonly processName: string;
  readonly pmId: number;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly crashedAt: number;
  readonly logsBefore: readonly LogLine[];
  readonly logsAfter: readonly LogLine[];
}

// User, RBAC & Auth Types
export type RoleName = 'admin' | 'operator' | 'viewer';

export type PermissionAction =
  | 'node:view'
  | 'node:enroll'
  | 'node:approve'
  | 'node:delete'
  | 'node:group_assign'
  | 'process:view'
  | 'process:manage' // restart, stop, reload, start, delete
  | 'process:scale' // scale instances
  | 'process:action_trigger' // custom action trigger
  | 'process:view_secrets' // unmask env vars
  | 'plugin:manage' // install/uninstall vetted plugins
  | 'deploy:view'
  | 'deploy:create'
  | 'deploy:update'
  | 'deploy:trigger'
  | 'deploy:rollback'
  | 'deploy:delete'
  | 'log:view'
  | 'metrics:view'
  | 'settings:view'
  | 'settings:manage'
  | 'audit:view'
  | 'auth:2fa_manage'
  | 'auth:sessions_manage'
  | 'auth:tokens_manage'
  | 'security:view'
  | 'security:manage';

export type ResourceScope = 'global' | `group:${string}` | `node:${string}`;

// Git Deployment Types
export type DeploymentStatus =
  'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'rolled_back';

export type DeploymentTriggerType = 'manual' | 'webhook' | 'rollback';

export interface GitAppConfig {
  readonly id: string;
  readonly name: string; // PM2 process name
  readonly nodeId: string; // target node ID
  readonly repoUrl: string;
  readonly branch: string;
  readonly commitHash?: string;
  readonly commitMessage?: string;
  readonly commitAuthor?: string;
  readonly installCommand?: string;
  readonly buildCommand?: string;
  readonly startScript: string;
  readonly execMode?: 'fork_mode' | 'cluster_mode';
  readonly instances?: number;
  readonly env?: Record<string, string>;
  readonly autoDeploy: boolean;
  readonly webhookSecret: string;
  readonly deployPath?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DeploymentRecord {
  readonly id: string;
  readonly appId: string;
  readonly appName: string;
  readonly nodeId: string;
  readonly releaseId: string;
  readonly commitHash: string;
  readonly commitMessage?: string;
  readonly commitAuthor?: string;
  readonly branch: string;
  readonly status: DeploymentStatus;
  readonly triggerType: DeploymentTriggerType;
  readonly triggeredByUsername?: string;
  readonly logs: string;
  readonly durationMs?: number;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly errorMessage?: string;
}

export interface CreateGitAppRequest {
  readonly name: string;
  readonly nodeId: string;
  readonly repoUrl: string;
  readonly branch?: string;
  readonly installCommand?: string;
  readonly buildCommand?: string;
  readonly startScript: string;
  readonly execMode?: 'fork_mode' | 'cluster_mode';
  readonly instances?: number;
  readonly env?: Record<string, string>;
  readonly autoDeploy?: boolean;
}

export interface UpdateGitAppRequest {
  readonly name?: string;
  readonly nodeId?: string;
  readonly repoUrl?: string;
  readonly branch?: string;
  readonly installCommand?: string;
  readonly buildCommand?: string;
  readonly startScript?: string;
  readonly execMode?: 'fork_mode' | 'cluster_mode';
  readonly instances?: number;
  readonly env?: Record<string, string>;
  readonly autoDeploy?: boolean;
}

export interface DeployTriggerRequest {
  readonly branch?: string;
  readonly commitHash?: string;
}

export interface RollbackRequest {
  readonly targetDeploymentId: string;
}

export interface Permission {
  readonly id: string;
  readonly roleId: string;
  readonly action: PermissionAction;
  readonly resourceScope: ResourceScope;
}

export interface Role {
  readonly id: string;
  readonly name: RoleName;
  readonly description: string;
  readonly isSystem: boolean;
  readonly permissions: readonly PermissionAction[];
}

export interface User {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly roleId: string;
  readonly roleName: RoleName;
  readonly twoFactorEnabled: boolean;
  readonly mustChangePassword?: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly refreshTokenHash: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly expiresAt: number;
  readonly revokedAt?: number;
}

export interface SessionInfo {
  readonly id: string;
  readonly userId: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly expiresAt: number;
  readonly isCurrent?: boolean;
}

export interface ApiTokenInfo {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly tokenPrefix: string;
  readonly permissions: readonly PermissionAction[];
  readonly expiresAt?: number;
  readonly lastUsedAt?: number;
  readonly createdAt: number;
}

export interface TwoFactorSetupResult {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly recoveryCodes: readonly string[];
}

export interface TwoFactorStatus {
  readonly enabled: boolean;
  readonly hasRecoveryCodes: boolean;
}

// Audit Types
export interface AuditLog {
  readonly id: number;
  readonly timestamp: number;
  readonly userId: string;
  readonly username?: string;
  readonly nodeId?: string;
  readonly processName?: string;
  readonly action: string;
  readonly status: 'success' | 'failure';
  readonly ipAddress: string;
  readonly detailsJson?: string;
}

// Global Settings
export interface GlobalSettings {
  readonly logRetentionDays: number;
  readonly metricsRetentionDays: number;
  readonly logCompressionThresholdMb: number;
  readonly alertWebhooks?: readonly {
    readonly url: string;
    readonly type: 'slack' | 'discord' | 'generic';
    readonly events: readonly ('crash' | 'high_cpu' | 'offline')[];
  }[];
  readonly enforce2FA?: boolean;
  readonly maxFailedLoginAttempts?: number;
  readonly lockoutDurationMinutes?: number;
}

// Cross-Server Unified Process Types
export interface ClusterProcessInfo extends ProcessInfo {
  readonly nodeId: string;
  readonly nodeHostname: string;
  readonly nodeIp: string;
}

export type ProcessViewMode = 'cards' | 'table';
export type DensityMode = 'comfortable' | 'compact';

export interface UserPreferences {
  readonly processViewMode?: ProcessViewMode;
  readonly density?: DensityMode;
  readonly visibleWidgets?: readonly string[];
  readonly sidebarCollapsed?: boolean;
  readonly selectedNodeFilter?: string;
  readonly theme?: 'dark' | 'light' | 'system';
}

// Multi-Node Git Deployment Types
export interface ClusterDeployRequest {
  readonly targetNodeIds?: readonly string[]; // omitted or empty = all enrolled nodes
  readonly branch?: string;
  readonly commitHash?: string;
  readonly strategy?: 'parallel' | 'rolling';
}

export interface ClusterDeployResult {
  readonly appId: string;
  readonly successfulNodes: readonly string[];
  readonly failedNodes: readonly { readonly nodeId: string; readonly error: string }[];
  readonly durationMs: number;
  readonly commitHash?: string;
  readonly branch?: string;
}

export interface ClusterRollbackRequest {
  readonly deployId: string;
  readonly targetNodeIds?: readonly string[];
}

export interface ClusterRollbackResult {
  readonly appId: string;
  readonly targetDeployId: string;
  readonly successfulNodes: readonly string[];
  readonly failedNodes: readonly { readonly nodeId: string; readonly error: string }[];
}

export interface CrossNodeBatchActionRequest {
  readonly action: 'start' | 'stop' | 'restart' | 'reload' | 'delete';
  readonly targets: readonly {
    readonly nodeId: string;
    readonly pmId: number | string;
  }[];
}

// Operations Timeline Types
export interface OperationsTimelineEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly type:
    | 'deploy_start'
    | 'deploy_success'
    | 'deploy_failure'
    | 'rollback'
    | 'process_reload'
    | 'process_restart'
    | 'process_crash'
    | 'process_recovered'
    | 'node_online'
    | 'node_offline'
    | 'security_alert';
  readonly title: string;
  readonly description: string;
  readonly nodeId?: string;
  readonly nodeHostname?: string;
  readonly processName?: string;
  readonly appId?: string;
  readonly status: 'success' | 'warning' | 'error' | 'info';
}
