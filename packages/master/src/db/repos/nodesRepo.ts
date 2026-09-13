import { Database as SQLiteDatabase } from 'better-sqlite3';
import {
  NodeState,
  NodeStatus,
  ConnectivityMode,
  Result,
  ok,
  err,
  createAppError,
} from '@pm2-webui/shared';

export interface NodesRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface NodesRepo {
  readonly findById: (id: string) => Result<NodeState | null>;
  readonly findByPublicKey: (publicKey: string) => Result<NodeState | null>;
  readonly create: (node: NodeState) => Result<NodeState>;
  readonly updateStatus: (
    id: string,
    status: NodeStatus,
    connectivityMode?: ConnectivityMode,
  ) => Result<void>;
  readonly updateLastSeen: (id: string, timestamp?: number) => Result<void>;
  readonly list: (filters?: { status?: NodeStatus }) => Result<readonly NodeState[]>;
  readonly deleteNode: (id: string) => Result<void>;
}

export const createNodesRepo = (deps: NodesRepoDeps): NodesRepo => {
  const { db } = deps;

  const findByIdStmt = db.prepare(`
    SELECT id, public_key as publicKey, hostname, ip_address as ipAddress, port,
           connectivity_mode as connectivityMode, status, version,
           last_seen_at as lastSeenAt, enrolled_at as enrolledAt,
           cpu_cores as cpuCores
    FROM nodes
    WHERE id = ?
  `);

  const findByPublicKeyStmt = db.prepare(`
    SELECT id, public_key as publicKey, hostname, ip_address as ipAddress, port,
           connectivity_mode as connectivityMode, status, version,
           last_seen_at as lastSeenAt, enrolled_at as enrolledAt,
           cpu_cores as cpuCores
    FROM nodes
    WHERE public_key = ?
  `);

  const insertNodeStmt = db.prepare(`
    INSERT INTO nodes (id, public_key, hostname, ip_address, port, connectivity_mode, status, version, last_seen_at, enrolled_at, cpu_cores)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      hostname = excluded.hostname,
      ip_address = excluded.ip_address,
      port = excluded.port,
      connectivity_mode = excluded.connectivity_mode,
      version = excluded.version,
      last_seen_at = excluded.last_seen_at,
      cpu_cores = COALESCE(excluded.cpu_cores, nodes.cpu_cores)
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE nodes
    SET status = ?, connectivity_mode = COALESCE(?, connectivity_mode), last_seen_at = ?
    WHERE id = ?
  `);

  const updateLastSeenStmt = db.prepare(`
    UPDATE nodes
    SET last_seen_at = ?
    WHERE id = ?
  `);

  const deleteNodeStmt = db.prepare('DELETE FROM nodes WHERE id = ?');

  const findById = (id: string): Result<NodeState | null> => {
    try {
      const row = (findByIdStmt.get(id) as NodeState | undefined) ?? null;
      return ok(row);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to find node by id', undefined, error));
    }
  };

  const findByPublicKey = (publicKey: string): Result<NodeState | null> => {
    try {
      const row = (findByPublicKeyStmt.get(publicKey) as NodeState | undefined) ?? null;
      return ok(row);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to find node by public key', undefined, error),
      );
    }
  };

  const create = (node: NodeState): Result<NodeState> => {
    try {
      insertNodeStmt.run(
        node.id,
        node.publicKey,
        node.hostname,
        node.ipAddress,
        node.port,
        node.connectivityMode,
        node.status,
        node.version,
        node.lastSeenAt,
        node.enrolledAt,
        node.cpuCores ?? null,
      );

      const freshRes = findById(node.id);
      if (!freshRes.ok || !freshRes.value) {
        return ok(node);
      }
      return ok(freshRes.value);
    } catch (error) {
      return err(createAppError('CONFLICT', 'Failed to create or upsert node', undefined, error));
    }
  };

  const updateStatus = (
    id: string,
    status: NodeStatus,
    connectivityMode?: ConnectivityMode,
  ): Result<void> => {
    try {
      updateStatusStmt.run(status, connectivityMode ?? null, Date.now(), id);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to update node status', undefined, error),
      );
    }
  };

  const updateLastSeen = (id: string, timestamp = Date.now()): Result<void> => {
    try {
      updateLastSeenStmt.run(timestamp, id);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to update node last seen', undefined, error),
      );
    }
  };

  const list = (filters?: { status?: NodeStatus }): Result<readonly NodeState[]> => {
    try {
      let query = `
        SELECT id, public_key as publicKey, hostname, ip_address as ipAddress, port,
               connectivity_mode as connectivityMode, status, version,
               last_seen_at as lastSeenAt, enrolled_at as enrolledAt,
               cpu_cores as cpuCores
        FROM nodes
      `;
      const params: unknown[] = [];

      if (filters?.status) {
        query += ` WHERE status = ?`;
        params.push(filters.status);
      }

      query += ` ORDER BY last_seen_at DESC`;

      const stmt = db.prepare(query);
      const rows = stmt.all(...params) as NodeState[];
      return ok(rows);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to list nodes', undefined, error));
    }
  };

  const deleteNode = (id: string): Result<void> => {
    try {
      deleteNodeStmt.run(id);
      return ok(undefined);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to delete node', undefined, error));
    }
  };

  return {
    findById,
    findByPublicKey,
    create,
    updateStatus,
    updateLastSeen,
    list,
    deleteNode,
  };
};
