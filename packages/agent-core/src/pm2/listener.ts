import pm2 from 'pm2';
import crypto from 'node:crypto';
import { CrashEvent, LogLine, Result, ok, err, createAppError } from '@pm2-webui/shared';

export interface Pm2ListenerDeps {
  readonly pm2Instance?: typeof pm2;
  readonly onProcessEvent?: (event: {
    readonly event: string;
    readonly processName: string;
    readonly pmId: number;
    readonly timestamp: number;
  }) => void;
  readonly onLogLine?: (line: LogLine) => void;
  readonly onProcessCrash?: (crash: CrashEvent) => void;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly warn: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface Pm2Listener {
  readonly start: () => Promise<Result<void>>;
  readonly stop: () => void;
  readonly getRecentLogsForProcess: (processName: string, count?: number) => readonly LogLine[];
}

export const createPm2Listener = (deps: Pm2ListenerDeps = {}): Pm2Listener => {
  const { pm2Instance = pm2, onProcessEvent, onLogLine, onProcessCrash, logger } = deps;

  let busInstance: any = null;
  let isListening = false;
  let globalLineIndex = 0;

  // In-memory ring buffer of recent log lines per process (for crash context)
  const recentLogs = new Map<string, LogLine[]>();
  const MAX_RECENT_LOGS = 200;

  const pushRecentLog = (line: LogLine) => {
    let list = recentLogs.get(line.processName);
    if (!list) {
      list = [];
      recentLogs.set(line.processName, list);
    }
    list.push(line);
    if (list.length > MAX_RECENT_LOGS) {
      list.shift();
    }
  };

  const getRecentLogsForProcess = (processName: string, count = 50): readonly LogLine[] => {
    const list = recentLogs.get(processName) || [];
    return list.slice(-count);
  };

  const start = async (): Promise<Result<void>> => {
    if (isListening) return ok(undefined);

    return new Promise((resolve) => {
      pm2Instance.launchBus((error, bus) => {
        if (error) {
          logger?.error('Failed to launch PM2 bus', error);
          resolve(
            err(createAppError('PM2_ERROR', 'Failed to launch PM2 event bus', undefined, error)),
          );
          return;
        }

        busInstance = bus;
        isListening = true;
        logger?.info('PM2 Event Bus successfully connected');

        // Listen for stdout
        bus.on('log:out', (data: any) => {
          const processName = data.process?.name || `proc-${data.process?.pm_id ?? 0}`;
          const line: LogLine = {
            timestamp: Date.now(),
            processName,
            stream: 'stdout',
            message: data.data?.toString() || '',
            lineIndex: ++globalLineIndex,
          };
          pushRecentLog(line);
          onLogLine?.(line);
        });

        // Listen for stderr
        bus.on('log:err', (data: any) => {
          const processName = data.process?.name || `proc-${data.process?.pm_id ?? 0}`;
          const line: LogLine = {
            timestamp: Date.now(),
            processName,
            stream: 'stderr',
            message: data.data?.toString() || '',
            lineIndex: ++globalLineIndex,
          };
          pushRecentLog(line);
          onLogLine?.(line);
        });

        // Listen for process lifecycle events
        bus.on('process:event', (data: any) => {
          const processName = data.process?.name || `proc-${data.process?.pm_id ?? 0}`;
          const pmId = data.process?.pm_id ?? 0;
          const eventType = data.event || 'unknown';

          onProcessEvent?.({
            event: eventType,
            processName,
            pmId,
            timestamp: Date.now(),
          });

          // Handle crash/exception events
          if (eventType === 'exit' || eventType === 'error') {
            const logsBefore = getRecentLogsForProcess(processName, 50);
            const crashEvent: CrashEvent = {
              id: crypto.randomUUID(),
              processName,
              pmId,
              exitCode: data.process?.exit_code,
              signal: data.process?.signal,
              crashedAt: Date.now(),
              logsBefore,
              logsAfter: [],
            };
            onProcessCrash?.(crashEvent);
          }
        });

        resolve(ok(undefined));
      });
    });
  };

  const stop = (): void => {
    if (busInstance) {
      try {
        busInstance.close();
      } catch (error) {
        logger?.error('Error closing PM2 bus', error);
      }
      busInstance = null;
    }
    isListening = false;
  };

  return {
    start,
    stop,
    getRecentLogsForProcess,
  };
};
