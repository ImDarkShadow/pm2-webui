import { Database as SQLiteDatabase } from 'better-sqlite3';
import { GlobalSettings, Result, ok, err, createAppError } from '@pm2-webui/shared';

export interface SettingsRepoDeps {
  readonly db: SQLiteDatabase;
}

export interface SettingsRepo {
  readonly getGlobalSettings: () => Result<GlobalSettings>;
  readonly updateGlobalSettings: (settings: Partial<GlobalSettings>) => Result<GlobalSettings>;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  logRetentionDays: 7,
  metricsRetentionDays: 30,
  logCompressionThresholdMb: 10,
  alertWebhooks: [],
};

export const createSettingsRepo = (deps: SettingsRepoDeps): SettingsRepo => {
  const { db } = deps;

  const getStmt = db.prepare('SELECT value_json as valueJson FROM global_settings WHERE key = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO global_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `);

  const getGlobalSettings = (): Result<GlobalSettings> => {
    try {
      const row = getStmt.get('cluster_config') as { valueJson: string } | undefined;
      if (!row) {
        return ok(DEFAULT_SETTINGS);
      }
      const parsed = JSON.parse(row.valueJson) as GlobalSettings;
      return ok({ ...DEFAULT_SETTINGS, ...parsed });
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to read global settings', undefined, error),
      );
    }
  };

  const updateGlobalSettings = (settings: Partial<GlobalSettings>): Result<GlobalSettings> => {
    try {
      const currentRes = getGlobalSettings();
      const current = currentRes.ok ? currentRes.value : DEFAULT_SETTINGS;
      const updated: GlobalSettings = {
        ...current,
        ...settings,
      };

      upsertStmt.run('cluster_config', JSON.stringify(updated), Date.now());
      return ok(updated);
    } catch (error) {
      return err(
        createAppError('INTERNAL_ERROR', 'Failed to update global settings', undefined, error),
      );
    }
  };

  return {
    getGlobalSettings,
    updateGlobalSettings,
  };
};
