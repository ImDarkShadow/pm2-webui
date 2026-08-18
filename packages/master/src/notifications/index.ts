import { SettingsRepo } from '../db/repos/settingsRepo.js';

export interface NotificationEngineDeps {
  readonly settingsRepo: SettingsRepo;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export type AlertEventType = 'crash' | 'high_cpu' | 'offline';

export interface AlertPayload {
  readonly event: AlertEventType;
  readonly title: string;
  readonly message: string;
  readonly nodeId?: string;
  readonly processName?: string;
  readonly timestamp: number;
}

export interface NotificationEngine {
  readonly dispatchAlert: (alert: AlertPayload) => Promise<void>;
}

export const createNotificationEngine = (deps: NotificationEngineDeps): NotificationEngine => {
  const { settingsRepo, logger } = deps;

  const dispatchAlert = async (alert: AlertPayload): Promise<void> => {
    const settingsRes = settingsRepo.getGlobalSettings();
    if (!settingsRes.ok) return;

    const webhooks = settingsRes.value.alertWebhooks || [];
    if (webhooks.length === 0) return;

    for (const webhook of webhooks) {
      if (!webhook.events.includes(alert.event)) continue;

      try {
        let body: any;
        if (webhook.type === 'slack') {
          body = {
            text: `*[PM2 Alert - ${alert.event.toUpperCase()}]* ${alert.title}\n${alert.message}`,
          };
        } else if (webhook.type === 'discord') {
          body = {
            content: `🚨 **[PM2 Alert - ${alert.event.toUpperCase()}]** ${alert.title}\n${alert.message}`,
          };
        } else {
          body = alert;
        }

        await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        logger?.info(`Dispatched alert ${alert.event} to webhook ${webhook.url}`);
      } catch (error) {
        logger?.error(`Failed to send alert to webhook ${webhook.url}`, error);
      }
    }
  };

  return {
    dispatchAlert,
  };
};
