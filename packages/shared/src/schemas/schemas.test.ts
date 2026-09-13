import { describe, it, expect } from 'vitest';
import {
  ProcessActionRequestSchema,
  ProcessScaleRequestSchema,
  LoginRequestSchema,
} from './index.js';

describe('Shared Schemas Validation', () => {
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

  it('validates process scale requests', () => {
    expect(
      ProcessScaleRequestSchema.safeParse({ target: 'api-service', instances: 4 }).success,
    ).toBe(true);
    expect(
      ProcessScaleRequestSchema.safeParse({ target: 'api-service', instances: 0 }).success,
    ).toBe(false);
  });

  it('validates login request schema', () => {
    expect(
      LoginRequestSchema.safeParse({ username: 'admin', password: 'password123' }).success,
    ).toBe(true);
    expect(LoginRequestSchema.safeParse({ username: '', password: '123' }).success).toBe(false);
  });
});
