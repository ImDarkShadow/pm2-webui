import { describe, it, expect } from 'vitest';
import {
  NodeStateSchema,
  ProcessActionRequestSchema,
  HostMetricsSchema,
  LoginRequestSchema,
} from './index.js';

describe('Shared Schemas Validation', () => {
  it('validates a valid NodeState', () => {
    const validNode = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      hostname: 'node-prod-01',
      ipAddress: '192.168.1.100',
      port: 4321,
      publicKey: 'dGVzdC1wdWJsaWMta2V5LTMyei1ieXRlcy1iYXNlNjQ=',
      connectivityMode: 'direct',
      status: 'online',
      version: '1.0.0',
      enrolledAt: Date.now(),
      lastSeenAt: Date.now(),
    };

    const parsed = NodeStateSchema.safeParse(validNode);
    expect(parsed.success).toBe(true);
  });

  it('rejects an invalid UUID in NodeState', () => {
    const invalidNode = {
      id: 'not-a-uuid',
      hostname: 'node-01',
      ipAddress: '192.168.1.100',
      port: 4321,
      publicKey: 'dGVzdC1wdWJsaWMta2V5LTMyei1ieXRlcy1iYXNlNjQ=',
      connectivityMode: 'direct',
      status: 'online',
      version: '1.0.0',
      enrolledAt: Date.now(),
      lastSeenAt: Date.now(),
    };

    const parsed = NodeStateSchema.safeParse(invalidNode);
    expect(parsed.success).toBe(false);
  });

  it('validates process action requests', () => {
    const req = {
      action: 'restart',
      target: 'api-service',
    };
    expect(ProcessActionRequestSchema.safeParse(req).success).toBe(true);

    const invalidReq = {
      action: 'destroy',
      target: 'api-service',
    };
    expect(ProcessActionRequestSchema.safeParse(invalidReq).success).toBe(false);
  });

  it('validates host metrics schema', () => {
    const metrics = {
      timestamp: Date.now(),
      cpu: {
        usagePercent: 45.5,
        cores: 8,
        load1m: 1.2,
        load5m: 1.0,
        load15m: 0.8,
      },
      memory: {
        total: 16000000000,
        used: 8000000000,
        free: 8000000000,
        swapTotal: 4000000000,
        swapUsed: 0,
      },
      disk: {
        total: 500000000000,
        used: 200000000000,
        free: 300000000000,
        usagePercent: 40,
      },
      network: {
        rxSec: 1024,
        txSec: 2048,
      },
    };

    expect(HostMetricsSchema.safeParse(metrics).success).toBe(true);
  });

  it('validates login request schema', () => {
    expect(
      LoginRequestSchema.safeParse({ username: 'admin', password: 'password123' }).success,
    ).toBe(true);
    expect(LoginRequestSchema.safeParse({ username: '', password: '123' }).success).toBe(false);
  });
});
