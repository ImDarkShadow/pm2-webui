import { Database as SQLiteDatabase } from 'better-sqlite3';
import { Result, ok, err, createAppError, Ed25519KeyPair } from '@pm2-webui/shared';

export interface AgentMetaRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface AgentMetaRepo {
  readonly get: (key: string) => Result<string | null>;
  readonly set: (key: string, value: string) => Result<void>;
  readonly getKeyPair: () => Result<Ed25519KeyPair | null>;
  readonly saveKeyPair: (keyPair: Ed25519KeyPair) => Result<void>;
  readonly getAgentId: () => Result<string | null>;
  readonly saveAgentId: (agentId: string) => Result<void>;
  readonly getMasterPublicKey: () => Result<string | null>;
  readonly saveMasterPublicKey: (masterPublicKey: string) => Result<void>;
}

export const createAgentMetaRepo = (deps: AgentMetaRepoDeps): AgentMetaRepo => {
  const { db } = deps;

  const getStmt = db.prepare('SELECT value FROM agent_meta WHERE key = ?');
  const setStmt = db.prepare(`
    INSERT INTO agent_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const get = (key: string): Result<string | null> => {
    try {
      const row = getStmt.get(key) as { value: string } | undefined;
      return ok(row ? row.value : null);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', `Failed to get agent_meta key ${key}`, undefined, error),
      );
    }
  };

  const set = (key: string, value: string): Result<void> => {
    try {
      setStmt.run(key, value);
      return ok(undefined);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', `Failed to set agent_meta key ${key}`, undefined, error),
      );
    }
  };

  const getKeyPair = (): Result<Ed25519KeyPair | null> => {
    const pubRes = get('public_key');
    const privRes = get('private_key');
    if (!pubRes.ok || !privRes.ok) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to retrieve agent keypair'));
    }
    if (!pubRes.value || !privRes.value) {
      return ok(null);
    }
    return ok({
      publicKey: pubRes.value,
      privateKey: privRes.value,
    });
  };

  const saveKeyPair = (keyPair: Ed25519KeyPair): Result<void> => {
    const pubRes = set('public_key', keyPair.publicKey);
    const privRes = set('private_key', keyPair.privateKey);
    if (!pubRes.ok || !privRes.ok) {
      return err(createAppError('INTERNAL_ERROR', 'Failed to save agent keypair'));
    }
    return ok(undefined);
  };

  const getAgentId = (): Result<string | null> => get('agent_id');
  const saveAgentId = (agentId: string): Result<void> => set('agent_id', agentId);

  const getMasterPublicKey = (): Result<string | null> => get('master_public_key');
  const saveMasterPublicKey = (masterPublicKey: string): Result<void> =>
    set('master_public_key', masterPublicKey);

  return {
    get,
    set,
    getKeyPair,
    saveKeyPair,
    getAgentId,
    saveAgentId,
    getMasterPublicKey,
    saveMasterPublicKey,
  };
};
