import { LogLine, ErrorTraceItem } from '@pm2-webui/shared';
import { AgentErrorTraceRepo } from '../db/repos/agentErrorTraceRepo.js';

export interface ErrorTraceExtractorDeps {
  readonly errorTraceRepo: AgentErrorTraceRepo;
  readonly onErrorTrace?: (trace: ErrorTraceItem) => void;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly warn: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface ErrorTraceExtractor {
  readonly processLogLine: (line: LogLine, getSurroundingLogs?: () => readonly LogLine[]) => void;
  readonly flushPending: () => void;
}

interface PendingErrorBuffer {
  readonly processName: string;
  readonly errorName: string;
  readonly message: string;
  readonly firstTimestamp: number;
  readonly stackLines: string[];
  lastLineTime: number;
}

const ERROR_HEADER_REGEX = /(?:^|\s)(?:([A-Z]\w*(?:Error|Exception|Rejection|Failure))|UnhandledPromiseRejection(?:Warning)?):\s*(.+)$/;
const STACK_FRAME_REGEX = /^\s*at\s+(?:.+?\s+\()?(.+?)(?::\d+:\d+)?\)?$/;

export const createErrorTraceExtractor = (deps: ErrorTraceExtractorDeps): ErrorTraceExtractor => {
  const { errorTraceRepo, onErrorTrace, logger } = deps;

  const pendingMap = new Map<string, PendingErrorBuffer>();

  const commitPending = (procName: string, getSurroundingLogs?: () => readonly LogLine[]) => {
    const pending = pendingMap.get(procName);
    if (!pending) return;

    pendingMap.delete(procName);

    const fullStack = [
      `${pending.errorName}: ${pending.message}`,
      ...pending.stackLines,
    ].join('\n');

    const contextLogs = getSurroundingLogs ? getSurroundingLogs() : undefined;

    const res = errorTraceRepo.ingest({
      processName: pending.processName,
      pmId: 0,
      errorName: pending.errorName,
      message: pending.message,
      stackTrace: fullStack,
      timestamp: pending.firstTimestamp,
      contextLogs,
    });

    if (res.ok) {
      logger?.info(`Ingested error trace for ${pending.processName}: ${pending.errorName}`);
      onErrorTrace?.(res.value);
    } else {
      logger?.warn(`Failed to ingest error trace: ${res.error.message}`);
    }
  };

  const processLogLine = (line: LogLine, getSurroundingLogs?: () => readonly LogLine[]) => {
    const msg = line.message.trim();
    if (!msg) return;

    const proc = line.processName;
    const currentPending = pendingMap.get(proc);

    // 1. Check if line is a stack frame line (e.g. "at app.js:42:15")
    if (STACK_FRAME_REGEX.test(msg) || (msg.startsWith('at ') && currentPending)) {
      if (currentPending) {
        currentPending.stackLines.push(msg);
        currentPending.lastLineTime = line.timestamp;
        // Cap stack frames at 25 lines
        if (currentPending.stackLines.length >= 25) {
          commitPending(proc, getSurroundingLogs);
        }
        return;
      }
    }

    // 2. If we had a pending error and hit a non-stack line, commit previous error
    if (currentPending) {
      commitPending(proc, getSurroundingLogs);
    }

    // 3. Check if line starts a new Error
    const match = msg.match(ERROR_HEADER_REGEX);
    if (match) {
      const errorName = match[1] || 'Error';
      const message = (match[2] || '').trim();

      pendingMap.set(proc, {
        processName: proc,
        errorName,
        message,
        firstTimestamp: line.timestamp,
        stackLines: [],
        lastLineTime: line.timestamp,
      });
      return;
    }

    // Check for standard unadorned "Error: <msg>"
    if (msg.startsWith('Error: ') || msg === 'Error') {
      pendingMap.set(proc, {
        processName: proc,
        errorName: 'Error',
        message: msg.slice(7).trim() || 'Generic error',
        firstTimestamp: line.timestamp,
        stackLines: [],
        lastLineTime: line.timestamp,
      });
    }
  };

  const flushPending = () => {
    for (const proc of pendingMap.keys()) {
      commitPending(proc);
    }
  };

  return {
    processLogLine,
    flushPending,
  };
};
