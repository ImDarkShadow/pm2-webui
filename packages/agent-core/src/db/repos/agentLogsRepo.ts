import { Database as SQLiteDatabase } from 'better-sqlite3';
import {
  LogGranularity,
  LogSummaryBucket,
  Result,
  ok,
  err,
  createAppError,
} from '@pm2-cluster/shared';

export interface AgentLogsRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface StoredLogSegment {
  readonly id?: number;
  readonly processName: string;
  readonly stream: 'stdout' | 'stderr';
  readonly startTimestamp: number;
  readonly endTimestamp: number;
  readonly lineCount: number;
  readonly byteOffset: number;
  readonly compressedFilePath?: string;
}

export interface StoredLogSummary extends LogSummaryBucket {
  readonly processName: string;
}

export interface AgentLogsRepo {
  readonly insertSummary: (summary: StoredLogSummary) => Result<void>;
  readonly insertSegment: (segment: StoredLogSegment) => Result<number>;
  readonly querySummaries: (
    processName: string,
    granularity: LogGranularity,
    from: number,
    to: number,
  ) => Result<readonly LogSummaryBucket[]>;
  readonly querySegments: (
    processName: string,
    from: number,
    to: number,
  ) => Result<readonly StoredLogSegment[]>;
  readonly purgeOlderThan: (
    timestamp: number,
  ) => Result<{ summariesPurged: number; segmentsPurged: number }>;
}

export const createAgentLogsRepo = (deps: AgentLogsRepoDeps): AgentLogsRepo => {
  const { db } = deps;

  const insertSummaryStmt = db.prepare(`
    INSERT INTO log_summaries (process_name, granularity, bucket_timestamp, line_count, error_count, warn_count, sample_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSegmentStmt = db.prepare(`
    INSERT INTO log_segments (process_name, stream, start_timestamp, end_timestamp, line_count, byte_offset, compressed_file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const querySummariesStmt = db.prepare(`
    SELECT bucket_timestamp as bucketTimestamp, granularity, line_count as lineCount,
           error_count as errorCount, warn_count as warnCount, sample_text as sampleText
    FROM log_summaries
    WHERE process_name = ? AND granularity = ? AND bucket_timestamp >= ? AND bucket_timestamp <= ?
    ORDER BY bucket_timestamp ASC
  `);

  const querySegmentsStmt = db.prepare(`
    SELECT id, process_name as processName, stream, start_timestamp as startTimestamp,
           end_timestamp as endTimestamp, line_count as lineCount, byte_offset as byteOffset,
           compressed_file_path as compressedFilePath
    FROM log_segments
    WHERE process_name = ? AND end_timestamp >= ? AND start_timestamp <= ?
    ORDER BY start_timestamp ASC
  `);

  const purgeSummariesStmt = db.prepare('DELETE FROM log_summaries WHERE bucket_timestamp < ?');
  const purgeSegmentsStmt = db.prepare('DELETE FROM log_segments WHERE end_timestamp < ?');

  const insertSummary = (summary: StoredLogSummary): Result<void> => {
    try {
      insertSummaryStmt.run(
        summary.processName,
        summary.granularity,
        summary.bucketTimestamp,
        summary.lineCount,
        summary.errorCount,
        summary.warnCount,
        summary.sampleText ?? null,
      );
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to insert log summary', undefined, error),
      );
    }
  };

  const insertSegment = (segment: StoredLogSegment): Result<number> => {
    try {
      const info = insertSegmentStmt.run(
        segment.processName,
        segment.stream,
        segment.startTimestamp,
        segment.endTimestamp,
        segment.lineCount,
        segment.byteOffset,
        segment.compressedFilePath ?? null,
      );
      return ok(Number(info.lastInsertRowid));
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to insert log segment', undefined, error),
      );
    }
  };

  const querySummaries = (
    processName: string,
    granularity: LogGranularity,
    from: number,
    to: number,
  ): Result<readonly LogSummaryBucket[]> => {
    try {
      const rows = querySummariesStmt.all(processName, granularity, from, to) as LogSummaryBucket[];
      return ok(rows);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to query log summaries', undefined, error),
      );
    }
  };

  const querySegments = (
    processName: string,
    from: number,
    to: number,
  ): Result<readonly StoredLogSegment[]> => {
    try {
      const rows = querySegmentsStmt.all(processName, from, to) as StoredLogSegment[];
      return ok(rows);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to query log segments', undefined, error),
      );
    }
  };

  const purgeOlderThan = (
    timestamp: number,
  ): Result<{ summariesPurged: number; segmentsPurged: number }> => {
    try {
      const summariesInfo = purgeSummariesStmt.run(timestamp);
      const segmentsInfo = purgeSegmentsStmt.run(timestamp);
      return ok({
        summariesPurged: summariesInfo.changes,
        segmentsPurged: segmentsInfo.changes,
      });
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to purge logs', undefined, error));
    }
  };

  return {
    insertSummary,
    insertSegment,
    querySummaries,
    querySegments,
    purgeOlderThan,
  };
};
