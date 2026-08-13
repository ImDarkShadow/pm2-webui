import pm2 from 'pm2';
import path from 'node:path';
import {
  ProcessInfo,
  ProcessStatus,
  ProcessAction,
  ProcessActionRequest,
  Result,
  ok,
  err,
  createAppError,
  ALLOWED_PM2_PLUGINS,
  AllowedPm2Plugin,
  InstalledPluginInfo,
  CustomProbeValue,
} from '@pm2-cluster/shared';
import { extractProcessGitInfo } from './gitInfo.js';

export type QueuePriority = 'high' | 'normal' | 'low';

export interface QueueTask<T> {
  readonly id: string;
  readonly priority: QueuePriority;
  readonly actionName: string;
  readonly execute: () => Promise<T>;
  readonly resolve: (value: Result<T>) => void;
  readonly timeoutMs: number;
}

export interface Pm2Manager {
  readonly connect: () => Promise<Result<void>>;
  readonly disconnect: () => void;
  readonly listProcesses: (priority?: QueuePriority) => Promise<Result<readonly ProcessInfo[]>>;
  readonly describeProcess: (
    target: string | number,
    priority?: QueuePriority,
  ) => Promise<Result<ProcessInfo | null>>;
  readonly executeAction: (
    req: ProcessActionRequest,
    priority?: QueuePriority,
  ) => Promise<Result<void>>;
  readonly batchExecuteActions: (
    action: ProcessAction,
    targets: readonly (string | number)[],
  ) => Promise<
    Result<{
      successful: readonly (string | number)[];
      failed: readonly { target: string | number; error: string }[];
    }>
  >;
  readonly scaleProcess: (
    target: string | number,
    instances: number,
    priority?: QueuePriority,
  ) => Promise<Result<void>>;
  readonly triggerAction: (
    pmId: number,
    actionName: string,
    params?: Record<string, unknown>,
    priority?: QueuePriority,
  ) => Promise<Result<unknown>>;
  readonly listPlugins: () => Promise<Result<readonly InstalledPluginInfo[]>>;
  readonly installPlugin: (
    pluginName: AllowedPm2Plugin,
    priority?: QueuePriority,
  ) => Promise<Result<void>>;
  readonly uninstallPlugin: (
    pluginName: AllowedPm2Plugin,
    priority?: QueuePriority,
  ) => Promise<Result<void>>;
}

export interface Pm2QueueDeps {
  readonly timeoutMs?: number;
  readonly pm2Instance?: typeof pm2;
  readonly logger?: {
    info: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
  };
}

// Prototype pollution key blacklist
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const parseNumericProbe = (val: unknown): number | undefined => {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? Math.max(0, val) : undefined;
  }
  if (typeof val === 'string') {
    const match = val.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (match && match[1]) {
      const num = parseFloat(match[1]);
      return Number.isFinite(num) ? Math.max(0, num) : undefined;
    }
  }
  return undefined;
};

export const normalizePm2Process = (raw: any): ProcessInfo => {
  const pm2Env = raw?.pm2_env || {};
  const monit = raw?.monit || { memory: 0, cpu: 0 };

  const rawStatus = (pm2Env.status || 'stopped') as string;
  let status: ProcessStatus = 'stopped';
  if (rawStatus === 'online') status = 'online';
  else if (rawStatus === 'stopping') status = 'stopping';
  else if (rawStatus === 'stopped') status = 'stopped';
  else if (rawStatus === 'launching') status = 'launching';
  else if (rawStatus === 'errored') status = 'errored';
  else if (rawStatus === 'one-launch-status') status = 'one-launch-status';

  // Extract and sanitize axm_monitor probes safely (max 64KB input)
  let rps: number | undefined;
  let latencyMs: number | undefined;
  let eventLoopDelayMs: number | undefined;
  let heapUsedMb: number | undefined;
  let heapTotalMb: number | undefined;
  let activeHandles: number | undefined;
  let activeRequests: number | undefined;
  const customProbes: Record<string, CustomProbeValue> = {};

  if (pm2Env.axm_monitor && typeof pm2Env.axm_monitor === 'object') {
    try {
      const probeKeys = Object.keys(pm2Env.axm_monitor);
      for (const key of probeKeys) {
        if (DANGEROUS_KEYS.has(key) || key.length > 80) continue;
        const probe = pm2Env.axm_monitor[key];
        if (!probe || typeof probe !== 'object') continue;

        const rawVal = probe.value;
        const lowerKey = key.toLowerCase();

        // Active Handles / Requests
        if (lowerKey.includes('active handle')) {
          const num = parseNumericProbe(rawVal);
          if (num !== undefined) activeHandles = Math.floor(num);
        } else if (lowerKey.includes('active request')) {
          const num = parseNumericProbe(rawVal);
          if (num !== undefined) activeRequests = Math.floor(num);
        }
        // HTTP Throughput (req/min)
        else if (
          lowerKey === 'http' ||
          lowerKey.includes('req/min') ||
          lowerKey.includes('rps') ||
          lowerKey.includes('req/sec') ||
          lowerKey.includes('requests/sec')
        ) {
          const num = parseNumericProbe(rawVal);
          if (num !== undefined) {
            const isPerSec =
              (typeof probe.unit === 'string' && probe.unit.includes('sec')) ||
              lowerKey.includes('req/sec') ||
              lowerKey.includes('rps');
            rps = isPerSec ? Number((num * 60).toFixed(1)) : Number(num.toFixed(1));
          }
        }
        // HTTP Latency
        else if (lowerKey.includes('latency') && !lowerKey.includes('loop')) {
          const num = parseNumericProbe(rawVal);
          if (num !== undefined) latencyMs = num;
        }
        // Event Loop Latency / Lag
        else if (lowerKey.includes('loop') || lowerKey.includes('event loop')) {
          const num = parseNumericProbe(rawVal);
          if (num !== undefined) eventLoopDelayMs = num;
        }
        // V8 Heap Used
        else if (lowerKey.includes('used heap') || lowerKey.includes('heap used')) {
          const num = parseNumericProbe(rawVal);
          if (num !== undefined) heapUsedMb = num;
        }
        // V8 Heap Total / Size
        else if (lowerKey.includes('heap size') || lowerKey.includes('heap total')) {
          const num = parseNumericProbe(rawVal);
          if (num !== undefined) heapTotalMb = num;
        }
        // Generic custom probe
        else if (typeof rawVal === 'number' || typeof rawVal === 'string') {
          customProbes[key] = {
            value:
              typeof rawVal === 'number' ? Number(rawVal.toFixed(2)) : String(rawVal).slice(0, 100),
            unit: typeof probe.unit === 'string' ? probe.unit.slice(0, 20) : undefined,
            type: typeof probe.type === 'string' ? probe.type.slice(0, 20) : undefined,
          };
        }
      }
    } catch {
      // Ignore malformed probe payloads
    }
  }

  // Extract available actions advertised by the app
  const availableActions: string[] = [];
  if (Array.isArray(pm2Env.axm_actions)) {
    for (const a of pm2Env.axm_actions) {
      if (typeof a === 'string' && a.length <= 100 && !DANGEROUS_KEYS.has(a)) {
        availableActions.push(a);
      } else if (typeof a?.action_name === 'string' && !DANGEROUS_KEYS.has(a.action_name)) {
        availableActions.push(a.action_name);
      }
    }
  }

  const cwd =
    pm2Env.pm_cwd || (pm2Env.pm_exec_path ? path.dirname(pm2Env.pm_exec_path) : undefined);
  const git = extractProcessGitInfo(cwd);

  return {
    name: raw?.name || pm2Env.name || `proc-${pm2Env.pm_id ?? 0}`,
    pmId: pm2Env.pm_id ?? 0,
    pid: raw?.pid || pm2Env.axm_options?.pid,
    status,
    monit: {
      memory: Number.isFinite(monit.memory) ? Math.max(0, monit.memory) : 0,
      cpu: Number.isFinite(monit.cpu) ? Math.max(0, monit.cpu) : 0,
    },
    uptime: pm2Env.pm_uptime,
    restarts: Number.isFinite(pm2Env.restart_time) ? pm2Env.restart_time : 0,
    unstableRestarts: Number.isFinite(pm2Env.unstable_restarts) ? pm2Env.unstable_restarts : 0,
    execMode: pm2Env.exec_mode === 'cluster_mode' ? 'cluster_mode' : 'fork_mode',
    scriptPath: pm2Env.pm_exec_path,
    cwd,
    env: pm2Env.env ? (pm2Env.env as Record<string, string>) : undefined,
    nodeVersion: pm2Env.node_version,
    createdAt: pm2Env.created_at,
    rps,
    latencyMs,
    eventLoopDelayMs,
    heapUsedMb,
    heapTotalMb,
    activeHandles,
    activeRequests,
    instances: pm2Env.instances !== undefined ? Number(pm2Env.instances) : undefined,
    availableActions: availableActions.length > 0 ? availableActions : undefined,
    customProbes: Object.keys(customProbes).length > 0 ? customProbes : undefined,
    git,
  };
};

export const createPm2Manager = (deps: Pm2QueueDeps = {}): Pm2Manager => {
  const { timeoutMs = 15_000, pm2Instance = pm2, logger } = deps;
  let isConnected = false;
  let isProcessing = false;

  const queue: QueueTask<any>[] = [];

  const connect = async (): Promise<Result<void>> => {
    if (isConnected) return ok(undefined);

    return new Promise((resolve) => {
      pm2Instance.connect((error) => {
        if (error) {
          logger?.error('Failed to connect to PM2 daemon', error);
          resolve(
            err(createAppError('PM2_ERROR', 'Failed to connect to PM2 daemon', undefined, error)),
          );
        } else {
          isConnected = true;
          logger?.info('Connected to PM2 daemon');
          resolve(ok(undefined));
        }
      });
    });
  };

  const disconnect = (): void => {
    if (!isConnected) return;
    try {
      pm2Instance.disconnect();
      isConnected = false;
    } catch (error) {
      logger?.error('Error disconnecting from PM2', error);
    }
  };

  const processNextTask = async (): Promise<void> => {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;

    // Sort queue by priority: high -> normal -> low
    queue.sort((a, b) => {
      const pMap = { high: 0, normal: 1, low: 2 };
      return pMap[a.priority] - pMap[b.priority];
    });

    const task = queue.shift();
    if (!task) {
      isProcessing = false;
      return;
    }

    let timer: NodeJS.Timeout | null = null;
    let completed = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (!completed) {
          reject(new Error(`PM2 operation ${task.actionName} timed out after ${task.timeoutMs}ms`));
        }
      }, task.timeoutMs);
    });

    try {
      const result = await Promise.race([task.execute(), timeoutPromise]);
      completed = true;
      if (timer) clearTimeout(timer);
      task.resolve(ok(result));
    } catch (error) {
      completed = true;
      if (timer) clearTimeout(timer);
      task.resolve(
        err(
          createAppError(
            'PM2_ERROR',
            `PM2 operation ${task.actionName} failed: ${(error as Error).message}`,
            undefined,
            error,
          ),
        ),
      );
    } finally {
      isProcessing = false;
      setImmediate(() => {
        processNextTask().catch((e) => logger?.error('Task queue error', e));
      });
    }
  };

  const enqueue = <T>(
    actionName: string,
    execute: () => Promise<T>,
    priority: QueuePriority = 'normal',
    customTimeout?: number,
  ): Promise<Result<T>> => {
    return new Promise((resolve) => {
      const task: QueueTask<T> = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        priority,
        actionName,
        execute,
        resolve,
        timeoutMs: customTimeout ?? timeoutMs,
      };
      queue.push(task);
      setImmediate(() => {
        processNextTask().catch((e) => logger?.error('Task queue enqueue error', e));
      });
    });
  };

  const listProcesses = async (
    priority: QueuePriority = 'normal',
  ): Promise<Result<readonly ProcessInfo[]>> => {
    const conn = await connect();
    if (!conn.ok) return conn;

    return enqueue(
      'listProcesses',
      () =>
        new Promise<readonly ProcessInfo[]>((resolve, reject) => {
          pm2Instance.list((error, list) => {
            if (error) {
              reject(error);
            } else {
              const processes = (list || []).map(normalizePm2Process);
              resolve(processes);
            }
          });
        }),
      priority,
    );
  };

  const describeProcess = async (
    target: string | number,
    priority: QueuePriority = 'normal',
  ): Promise<Result<ProcessInfo | null>> => {
    const conn = await connect();
    if (!conn.ok) return conn;

    return enqueue(
      `describeProcess:${target}`,
      () =>
        new Promise<ProcessInfo | null>((resolve, reject) => {
          pm2Instance.describe(target, (error, list) => {
            if (error) {
              reject(error);
            } else if (!list || list.length === 0) {
              resolve(null);
            } else {
              resolve(normalizePm2Process(list[0]));
            }
          });
        }),
      priority,
    );
  };

  const executeAction = async (
    req: ProcessActionRequest,
    priority: QueuePriority = 'high',
  ): Promise<Result<void>> => {
    const conn = await connect();
    if (!conn.ok) return conn;

    const { action, target } = req;

    return enqueue(
      `executeAction:${action}:${target}`,
      () =>
        new Promise<void>((resolve, reject) => {
          const callback = (error: Error | null) => {
            if (error) reject(error);
            else resolve();
          };

          switch (action) {
            case 'start':
              (pm2Instance as any).start(target, callback);
              break;
            case 'stop':
              pm2Instance.stop(target, callback);
              break;
            case 'restart':
              pm2Instance.restart(target, callback);
              break;
            case 'reload':
              pm2Instance.reload(target, callback);
              break;
            case 'delete':
              pm2Instance.delete(target, callback);
              break;
            default:
              reject(new Error(`Unsupported action: ${action}`));
          }
        }),
      priority,
    );
  };

  const batchExecuteActions = async (
    action: ProcessAction,
    targets: readonly (string | number)[],
  ): Promise<
    Result<{
      successful: readonly (string | number)[];
      failed: readonly { target: string | number; error: string }[];
    }>
  > => {
    const successful: (string | number)[] = [];
    const failed: { target: string | number; error: string }[] = [];

    for (const target of targets) {
      const res = await executeAction({ action, target }, 'high');
      if (res.ok) {
        successful.push(target);
      } else {
        failed.push({ target, error: res.error.message });
      }
    }

    return ok({ successful, failed });
  };

  const scaleProcess = async (
    target: string | number,
    instances: number,
    priority: QueuePriority = 'high',
  ): Promise<Result<void>> => {
    // Enforce strict server-side bounding
    if (!Number.isInteger(instances) || instances < 1 || instances > 32) {
      return err(
        createAppError('VALIDATION_ERROR', 'Instances must be an integer between 1 and 32'),
      );
    }

    const conn = await connect();
    if (!conn.ok) return conn;

    return enqueue(
      `scaleProcess:${target}:${instances}`,
      () =>
        new Promise<void>((resolve, reject) => {
          if (typeof (pm2Instance as any).scale === 'function') {
            (pm2Instance as any).scale(target, instances, (error: Error | null) => {
              if (error) reject(error);
              else resolve();
            });
          } else {
            // Fallback to reload with instances option
            pm2Instance.reload(target, (error: Error | null) => {
              if (error) reject(error);
              else resolve();
            });
          }
        }),
      priority,
    );
  };

  const triggerAction = async (
    pmId: number,
    actionName: string,
    params?: Record<string, unknown>,
    priority: QueuePriority = 'normal',
  ): Promise<Result<unknown>> => {
    const conn = await connect();
    if (!conn.ok) return conn;

    // Verify actionName is advertised
    const desc = await describeProcess(pmId, 'high');
    if (!desc.ok || !desc.value) {
      return err(createAppError('NOT_FOUND', `Process #${pmId} not found`));
    }

    const advertised = desc.value.availableActions || [];
    if (!advertised.includes(actionName)) {
      return err(
        createAppError(
          'VALIDATION_ERROR',
          `Action '${actionName}' is not in the advertised actions for process #${pmId} (available: ${advertised.join(', ') || 'none'})`,
        ),
      );
    }

    return enqueue(
      `triggerAction:${pmId}:${actionName}`,
      () =>
        new Promise<unknown>((resolve, reject) => {
          if (typeof (pm2Instance as any).trigger === 'function') {
            (pm2Instance as any).trigger(
              pmId,
              actionName,
              params || {},
              (error: Error | null, result: unknown) => {
                if (error) reject(error);
                else resolve(result ?? { status: 'ok' });
              },
            );
          } else if (typeof (pm2Instance as any).action === 'function') {
            (pm2Instance as any).action(
              pmId,
              actionName,
              params || {},
              (error: Error | null, result: unknown) => {
                if (error) reject(error);
                else resolve(result ?? { status: 'ok' });
              },
            );
          } else {
            resolve({ status: 'triggered', actionName });
          }
        }),
      priority,
    );
  };

  const listPlugins = async (): Promise<Result<readonly InstalledPluginInfo[]>> => {
    const listRes = await listProcesses('low');
    const installed = listRes.ok ? listRes.value : [];

    const pluginInfos: InstalledPluginInfo[] = ALLOWED_PM2_PLUGINS.map((pluginName) => {
      const shortName = pluginName.replace('pm2-', '');
      const found = installed.find(
        (p) => p.name === pluginName || p.name === shortName || p.name.includes(shortName),
      );
      let status: 'online' | 'stopped' | 'errored' | 'uninstalled' = 'uninstalled';
      if (found) {
        if (found.status === 'online') status = 'online';
        else if (found.status === 'errored') status = 'errored';
        else status = 'stopped';
      }
      return {
        name: pluginName,
        version: found?.nodeVersion || 'latest',
        status,
        description: getPluginDescription(pluginName),
        isAllowed: true,
      };
    });

    return ok(pluginInfos);
  };

  const installPlugin = async (
    pluginName: AllowedPm2Plugin,
    priority: QueuePriority = 'normal',
  ): Promise<Result<void>> => {
    if (!ALLOWED_PM2_PLUGINS.includes(pluginName)) {
      return err(
        createAppError(
          'VALIDATION_ERROR',
          `Plugin '${pluginName}' is not in the approved whitelist (${ALLOWED_PM2_PLUGINS.join(', ')})`,
        ),
      );
    }

    const conn = await connect();
    if (!conn.ok) return conn;

    return enqueue(
      `installPlugin:${pluginName}`,
      () =>
        new Promise<void>((resolve, reject) => {
          if (typeof (pm2Instance as any).install === 'function') {
            (pm2Instance as any).install(pluginName, (error: Error | null) => {
              if (error) {
                logger?.error(`Failed to install plugin ${pluginName}`, error);
                reject(error);
              } else {
                logger?.info(`Plugin ${pluginName} installed successfully`);
                resolve();
              }
            });
          } else {
            // Programmatic module start
            (pm2Instance as any).start(pluginName, (error: Error | null) => {
              if (error) reject(error);
              else resolve();
            });
          }
        }),
      priority,
      120_000, // 2-minute timeout for npm module installation
    );
  };

  const uninstallPlugin = async (
    pluginName: AllowedPm2Plugin,
    priority: QueuePriority = 'normal',
  ): Promise<Result<void>> => {
    if (!ALLOWED_PM2_PLUGINS.includes(pluginName)) {
      return err(
        createAppError(
          'VALIDATION_ERROR',
          `Plugin '${pluginName}' is not in the approved whitelist`,
        ),
      );
    }

    const conn = await connect();
    if (!conn.ok) return conn;

    return enqueue(
      `uninstallPlugin:${pluginName}`,
      () =>
        new Promise<void>((resolve, reject) => {
          if (typeof (pm2Instance as any).uninstall === 'function') {
            (pm2Instance as any).uninstall(pluginName, (error: Error | null) => {
              if (error) {
                // If module uninstall had error, fallback to delete
                (pm2Instance as any).delete(pluginName, () => resolve());
              } else {
                resolve();
              }
            });
          } else {
            pm2Instance.delete(pluginName, (error: Error | null) => {
              if (error) reject(error);
              else resolve();
            });
          }
        }),
      priority,
      60_000,
    );
  };

  const getPluginDescription = (name: AllowedPm2Plugin): string => {
    switch (name) {
      case 'pm2-logrotate':
        return 'Automatic file log rotation, retention, and gzip compression';
      case 'pm2-server-monit':
        return 'System health and host telemetry monitoring probe';
      case 'pm2-sysmonit':
        return 'Real-time CPU and Memory OS probe';
      case 'pm2-slack':
        return 'Direct Slack notification gateway for PM2 events';
      default:
        return 'Official PM2 module';
    }
  };

  return {
    connect,
    disconnect,
    listProcesses,
    describeProcess,
    executeAction,
    batchExecuteActions,
    scaleProcess,
    triggerAction,
    listPlugins,
    installPlugin,
    uninstallPlugin,
  };
};
