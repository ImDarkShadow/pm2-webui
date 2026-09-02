import { Database as SQLiteDatabase } from 'better-sqlite3';
import {
  NodeState,
  NodeGroup,
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
  readonly list: (filters?: {
    status?: NodeStatus;
    groupId?: string;
  }) => Result<readonly NodeState[]>;
  readonly deleteNode: (id: string) => Result<void>;
  readonly assignGroups: (nodeId: string, groupIds: readonly string[]) => Result<void>;
  readonly listGroups: () => Result<readonly NodeGroup[]>;
  readonly createGroup: (group: NodeGroup) => Result<NodeGroup>;
}

export const createNodesRepo = (deps: NodesRepoDeps): NodesRepo => {
  const { db } = deps;

  const findByIdStmt = db.prepare(`
    SELECT id, public_key as publicKey, hostname, ip_address as ipAddress, port,
           connectivity_mode as connectivityMode, status, version,
           last_seen_at as lastSeenAt, enrolled_at as enrolledAt
    FROM nodes
    WHERE id = ?
  `);

  const findByPublicKeyStmt = db.prepare(`
    SELECT id, public_key as publicKey, hostname, ip_address as ipAddress, port,
           connectivity_mode as connectivityMode, status, version,
           last_seen_at as lastSeenAt, enrolled_at as enrolledAt
    FROM nodes
    WHERE public_key = ?
  `);

  const insertNodeStmt = db.prepare(`
    INSERT INTO nodes (id, public_key, hostname, ip_address, port, connectivity_mode, status, version, last_seen_at, enrolled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      hostname = excluded.hostname,
      ip_address = excluded.ip_address,
      port = excluded.port,
      connectivity_mode = excluded.connectivity_mode,
      version = excluded.version,
      last_seen_at = excluded.last_seen_at
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

  const getGroupsForNodeStmt = db.prepare(`
    SELECT group_id FROM node_group_members WHERE node_id = ?
  `);

  const deleteGroupsForNodeStmt = db.prepare(`
    DELETE FROM node_group_members WHERE node_id = ?
  `);

  const insertGroupMemberStmt = db.prepare(`
    INSERT INTO node_group_members (node_id, group_id) VALUES (?, ?)
  `);

  const listGroupsStmt = db.prepare(`
    SELECT id, name, description, created_at as createdAt FROM node_groups ORDER BY name ASC
  `);

  const insertGroupStmt = db.prepare(`
    INSERT INTO node_groups (id, name, description, created_at) VALUES (?, ?, ?, ?)
  `);

  const getNodeWithGroups = (baseNode: NodeState | undefined): NodeState | null => {
    if (!baseNode) return null;
    const groupRows = getGroupsForNodeStmt.all(baseNode.id) as { group_id: string }[];
    return {
      ...baseNode,
      groupIds: groupRows.map((r) => r.group_id),
    };
  };

  const findById = (id: string): Result<NodeState | null> => {
    try {
      const row = findByIdStmt.get(id) as NodeState | undefined;
      return ok(getNodeWithGroups(row));
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to find node by id', undefined, error));
    }
  };

  const findByPublicKey = (publicKey: string): Result<NodeState | null> => {
    try {
      const row = findByPublicKeyStmt.get(publicKey) as NodeState | undefined;
      return ok(getNodeWithGroups(row));
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
      );

      if (node.groupIds && node.groupIds.length > 0) {
        assignGroups(node.id, node.groupIds);
      }

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

  const list = (filters?: {
    status?: NodeStatus;
    groupId?: string;
  }): Result<readonly NodeState[]> => {
    try {
      let query = `
        SELECT DISTINCT n.id, n.public_key as publicKey, n.hostname, n.ip_address as ipAddress, n.port,
               n.connectivity_mode as connectivityMode, n.status, n.version,
               n.last_seen_at as lastSeenAt, n.enrolled_at as enrolledAt
        FROM nodes n
      `;
      const params: unknown[] = [];
      const whereClauses: string[] = [];

      if (filters?.groupId) {
        query += ` JOIN node_group_members ngm ON n.id = ngm.node_id`;
        whereClauses.push('ngm.group_id = ?');
        params.push(filters.groupId);
      }

      if (filters?.status) {
        whereClauses.push('n.status = ?');
        params.push(filters.status);
      }

      if (whereClauses.length > 0) {
        query += ` WHERE ` + whereClauses.join(' AND ');
      }

      query += ` ORDER BY n.last_seen_at DESC`;

      const stmt = db.prepare(query);
      const rows = stmt.all(...params) as NodeState[];
      const nodesWithGroups = rows.map((r) => getNodeWithGroups(r)!);
      return ok(nodesWithGroups);
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

  const assignGroups = (nodeId: string, groupIds: readonly string[]): Result<void> => {
    try {
      db.transaction(() => {
        deleteGroupsForNodeStmt.run(nodeId);
        for (const groupId of groupIds) {
          insertGroupMemberStmt.run(nodeId, groupId);
        }
      })();
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to assign node groups', undefined, error),
      );
    }
  };

  const listGroups = (): Result<readonly NodeGroup[]> => {
    try {
      const rows = listGroupsStmt.all() as NodeGroup[];
      return ok(rows);
    } catch (error) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to list node groups', undefined, error));
    }
  };

  const createGroup = (group: NodeGroup): Result<NodeGroup> => {
    try {
      insertGroupStmt.run(group.id, group.name, group.description ?? null, group.createdAt);
      return ok(group);
    } catch (error) {
      return err(createAppError('CONFLICT', 'Failed to create node group', undefined, error));
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
    assignGroups,
    listGroups,
    createGroup,
  };
};
