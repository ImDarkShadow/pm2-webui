import { z } from 'zod';
import { ALLOWED_PM2_PLUGINS } from '../types/index.js';

// Common Schemas
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

// Node Schemas
export const ConnectivityModeSchema = z.enum(['direct', 'relay', 'unknown']);
export const NodeStatusSchema = z.enum(['online', 'offline', 'pending', 'rejected', 'revoked']);

export const NodeStateSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string().min(1),
  ipAddress: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  publicKey: z.string().min(32),
  connectivityMode: ConnectivityModeSchema,
  status: NodeStatusSchema,
  version: z.string(),
  enrolledAt: z.number(),
  lastSeenAt: z.number(),
  groupIds: z.array(z.string()).optional(),
});

export const NodeGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  createdAt: z.number(),
});

export const CreateNodeGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const AssignNodeGroupsSchema = z.object({
  groupIds: z.array(z.string().uuid()),
});

// Process Action & Scaling Schemas
export const ProcessActionSchema = z.enum(['start', 'stop', 'restart', 'reload', 'delete']);

export const ProcessActionRequestSchema = z.object({
  action: ProcessActionSchema,
  target: z.union([z.string().min(1), z.number().int()]),
  options: z
    .object({
      env: z.record(z.string()).optional(),
      instances: z.number().int().min(1).max(32).optional(),
    })
    .optional(),
});

export const BatchProcessActionSchema = z.object({
  action: ProcessActionSchema,
  targets: z.array(z.union([z.string().min(1), z.number().int()])).min(1),
});

export const ProcessScaleRequestSchema = z.object({
  target: z.union([z.string().min(1), z.number().int()]),
  instances: z
    .number()
    .int()
    .min(1, 'Instances must be at least 1')
    .max(32, 'Instances capped at 32 for safety'),
});

export const ProcessActionTriggerRequestSchema = z.object({
  target: z.union([z.string().min(1), z.number().int()]),
  actionName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_:-]+$/, 'Invalid action name format'),
  params: z.record(z.unknown()).optional(),
});

// PM2 Plugin Schemas (Strictly Allowed Fixed Whitelist)
export const PluginInstallRequestSchema = z.object({
  pluginName: z.enum(ALLOWED_PM2_PLUGINS, {
    errorMap: () => ({
      message: `Plugin must be one of the pre-approved plugins: ${ALLOWED_PM2_PLUGINS.join(', ')}`,
    }),
  }),
});

export const PluginUninstallRequestSchema = z.object({
  pluginName: z.enum(ALLOWED_PM2_PLUGINS, {
    errorMap: () => ({
      message: `Plugin must be one of the pre-approved plugins: ${ALLOWED_PM2_PLUGINS.join(', ')}`,
    }),
  }),
});

// Metrics Schemas
export const HostCpuMetricsSchema = z.object({
  usagePercent: z.number().min(0).max(100),
  cores: z.number().int().positive(),
  load1m: z.number().min(0),
  load5m: z.number().min(0),
  load15m: z.number().min(0),
});

export const HostMemoryMetricsSchema = z.object({
  total: z.number().nonnegative(),
  used: z.number().nonnegative(),
  free: z.number().nonnegative(),
  swapTotal: z.number().nonnegative(),
  swapUsed: z.number().nonnegative(),
});

export const HostDiskMetricsSchema = z.object({
  total: z.number().nonnegative(),
  used: z.number().nonnegative(),
  free: z.number().nonnegative(),
  usagePercent: z.number().min(0).max(100),
});

export const HostNetworkMetricsSchema = z.object({
  rxSec: z.number().nonnegative(),
  txSec: z.number().nonnegative(),
});

export const HostMetricsSchema = z.object({
  timestamp: z.number(),
  cpu: HostCpuMetricsSchema,
  memory: HostMemoryMetricsSchema,
  disk: HostDiskMetricsSchema,
  network: HostNetworkMetricsSchema,
  clusterRps: z.number().nonnegative().optional(),
  avgLatencyMs: z.number().nonnegative().optional(),
  avgEventLoopDelayMs: z.number().nonnegative().optional(),
});

export const BoundedMetricsQuerySchema = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(500),
});

// Log Schemas
export const LogGranularitySchema = z.enum(['1s', '10s', '1m', '10m', '1h']);
export const LogStreamTypeSchema = z.enum(['stdout', 'stderr', 'both']);

export const LogQuerySchema = z.object({
  processName: z.string().min(1),
  stream: LogStreamTypeSchema.default('both'),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  search: z.string().optional(),
  isRegex: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().positive().max(5000).default(500),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const LogTreeQuerySchema = z.object({
  processName: z.string().min(1),
  granularity: LogGranularitySchema.default('1m'),
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
});

// Auth & User Schemas
export const RoleNameSchema = z.enum(['admin', 'operator', 'viewer']);

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6),
});

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

export const CreateUserSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(8),
  roleId: z.string().uuid(),
});

export const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  roleId: z.string().uuid().optional(),
});

// Settings Schema
export const GlobalSettingsSchema = z.object({
  logRetentionDays: z.number().int().positive().default(7),
  metricsRetentionDays: z.number().int().positive().default(30),
  logCompressionThresholdMb: z.number().int().positive().default(10),
  alertWebhooks: z
    .array(
      z.object({
        url: z.string().url(),
        type: z.enum(['slack', 'discord', 'generic']),
        events: z.array(z.enum(['crash', 'high_cpu', 'offline'])),
      }),
    )
    .optional(),
});

// Git Deployment Schemas
export const CreateGitAppSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_\-.]+$/, 'Invalid process name format'),
  nodeId: z.string().min(1),
  repoUrl: z.string().min(1),
  branch: z.string().min(1).default('main'),
  installCommand: z.string().max(500).optional(),
  buildCommand: z.string().max(500).optional(),
  startScript: z.string().min(1).max(500).default('index.js'),
  execMode: z.enum(['fork_mode', 'cluster_mode']).default('fork_mode'),
  instances: z.number().int().min(1).max(32).default(1),
  env: z.record(z.string()).optional(),
  autoDeploy: z.boolean().default(false),
});

export const UpdateGitAppSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_\-.]+$/, 'Invalid process name format')
    .optional(),
  nodeId: z.string().min(1).optional(),
  repoUrl: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  installCommand: z.string().max(500).optional(),
  buildCommand: z.string().max(500).optional(),
  startScript: z.string().min(1).max(500).optional(),
  execMode: z.enum(['fork_mode', 'cluster_mode']).optional(),
  instances: z.number().int().min(1).max(32).optional(),
  env: z.record(z.string()).optional(),
  autoDeploy: z.boolean().optional(),
});

export const DeployTriggerSchema = z.object({
  branch: z.string().min(1).optional(),
  commitHash: z.string().min(4).max(64).optional(),
});

export const RollbackSchema = z.object({
  targetDeploymentId: z.string().uuid(),
});

// Security, 2FA & PAT Schemas
export const Verify2FASchema = z.object({
  tempToken: z.string().min(1, 'Temporary token is required'),
  code: z.string().min(6, 'Verification code must be at least 6 characters').max(24),
});

export const Enable2FASchema = z.object({
  secret: z.string().min(16, 'Invalid 2FA secret'),
  code: z.string().min(6, 'TOTP code must be at least 6 characters').max(10),
  recoveryCodes: z.array(z.string()).min(1, 'Recovery codes are required'),
});

export const Disable2FASchema = z.object({
  password: z.string().min(1, 'Current password is required to disable 2FA'),
});

export const CreateApiTokenSchema = z.object({
  name: z.string().min(1, 'Token name is required').max(50),
  permissions: z.array(z.string()).min(1, 'At least one permission is required'),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// Cluster-Wide Multi-Node Schemas
export const ClusterDeploySchema = z.object({
  targetNodeIds: z.array(z.string()).optional(),
  branch: z.string().min(1).optional(),
  commitHash: z.string().min(4).max(64).optional(),
  strategy: z.enum(['parallel', 'rolling']).default('parallel'),
});

export const ClusterRollbackSchema = z.object({
  deployId: z.string().uuid(),
  targetNodeIds: z.array(z.string()).optional(),
});

export const CrossNodeBatchActionSchema = z.object({
  action: ProcessActionSchema,
  targets: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        pmId: z.union([z.string().min(1), z.number().int()]),
      }),
    )
    .min(1),
});

export const UserPreferencesSchema = z.object({
  processViewMode: z.enum(['cards', 'table']).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  visibleWidgets: z.array(z.string()).optional(),
  sidebarCollapsed: z.boolean().optional(),
  selectedNodeFilter: z.string().optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
});
