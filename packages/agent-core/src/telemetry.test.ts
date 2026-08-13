import { describe, it, expect } from 'vitest';
import { normalizePm2Process, createPm2Manager } from './pm2/index.js';

describe('PM2 Telemetry Normalization & Security Ingestion', () => {
  it('safely parses axm_monitor probes and clamps numeric values', () => {
    const raw = {
      name: 'api-service',
      pm2_env: {
        pm_id: 1,
        status: 'online',
        axm_monitor: {
          'HTTP req/min': { value: '120 req/min' },
          'HTTP Mean Latency': { value: '15.4ms' },
          'Event Loop Latency': { value: '1.25ms' },
          'Heap Size': { value: '128.5 MB' },
          'Heap Used': { value: '64.2 MB' },
          'Active handles': { value: 24 },
          'Active requests': { value: 5 },
          'Custom Metric': { value: 'Active', unit: 'state' },
        },
        axm_actions: ['km:heapdump', 'clear:cache'],
        instances: 4,
      },
      monit: { cpu: 15, memory: 104857600 },
    };

    const proc = normalizePm2Process(raw);
    expect(proc.name).toBe('api-service');
    expect(proc.rps).toBe(120); // 120 req/min
    expect(proc.latencyMs).toBe(15.4);
    expect(proc.eventLoopDelayMs).toBe(1.25);
    expect(proc.heapTotalMb).toBe(128.5);
    expect(proc.heapUsedMb).toBe(64.2);
    expect(proc.activeHandles).toBe(24);
    expect(proc.activeRequests).toBe(5);
    expect(proc.instances).toBe(4);
    expect(proc.availableActions).toEqual(['km:heapdump', 'clear:cache']);
    expect(proc.customProbes?.['Custom Metric']?.value).toBe('Active');
  });

  it('prevents prototype pollution when parsing malicious axm_monitor payloads', () => {
    const maliciousPayload = JSON.parse(`{
      "name": "attacker-proc",
      "pm2_env": {
        "pm_id": 2,
        "status": "online",
        "axm_monitor": {
          "__proto__": { "polluted": true },
          "constructor": { "prototype": { "polluted": true } },
          "HTTP": { "value": "10 req/min" }
        }
      }
    }`);

    const proc = normalizePm2Process(maliciousPayload);
    expect(proc.name).toBe('attacker-proc');
    expect((proc as any).polluted).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
  });

  it('enforces bounds on scaling requests in Pm2Manager', async () => {
    const mockPm2: any = {
      connect: (cb: any) => cb(null),
      disconnect: () => {},
      scale: (target: any, instances: any, cb: any) => cb(null),
    };

    const manager = createPm2Manager({ pm2Instance: mockPm2 });

    // Invalid instances: 0
    const resZero = await manager.scaleProcess('api-service', 0);
    expect(resZero.ok).toBe(false);

    // Invalid instances: 100 (> 32)
    const resTooHigh = await manager.scaleProcess('api-service', 100);
    expect(resTooHigh.ok).toBe(false);

    // Valid instances: 4
    const resValid = await manager.scaleProcess('api-service', 4);
    expect(resValid.ok).toBe(true);
  });

  it('rejects custom action triggers for unadvertised action names', async () => {
    const mockPm2: any = {
      connect: (cb: any) => cb(null),
      disconnect: () => {},
      describe: (target: any, cb: any) =>
        cb(null, [
          {
            name: 'api-service',
            pm2_env: {
              pm_id: 1,
              status: 'online',
              axm_actions: ['km:heapdump'],
            },
          },
        ]),
      trigger: (pmId: any, actionName: any, params: any, cb: any) => cb(null, { status: 'ok' }),
    };

    const manager = createPm2Manager({ pm2Instance: mockPm2 });

    // Unadvertised action
    const unadvertisedRes = await manager.triggerAction(1, 'rm_rf_slash');
    expect(unadvertisedRes.ok).toBe(false);
    if (!unadvertisedRes.ok) {
      expect(unadvertisedRes.error.code).toBe('VALIDATION_ERROR');
    }

    // Advertised action
    const validRes = await manager.triggerAction(1, 'km:heapdump');
    expect(validRes.ok).toBe(true);
  });

  it('enforces whitelist for PM2 plugins', async () => {
    const mockPm2: any = {
      connect: (cb: any) => cb(null),
      disconnect: () => {},
      install: (plugin: any, cb: any) => cb(null),
    };

    const manager = createPm2Manager({ pm2Instance: mockPm2 });

    // Untrusted plugin
    const untrustedRes = await manager.installPlugin('evil-package' as any);
    expect(untrustedRes.ok).toBe(false);

    // Allowlisted plugin
    const allowedRes = await manager.installPlugin('pm2-logrotate');
    expect(allowedRes.ok).toBe(true);
  });
});
