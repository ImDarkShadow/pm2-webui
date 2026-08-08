import { describe, it, expect } from 'vitest';
import { canUserPerformAction } from './index.js';

describe('RBAC Permission Evaluator', () => {
  it('allows admin all actions across any scope', () => {
    const adminUser = { id: 'admin-1', roleName: 'admin' as const };
    expect(canUserPerformAction({ user: adminUser, action: 'process:manage' })).toBe(true);
    expect(canUserPerformAction({ user: adminUser, action: 'node:delete' })).toBe(true);
    expect(
      canUserPerformAction({
        user: adminUser,
        action: 'process:view_secrets',
        targetScope: 'node:node-1',
      }),
    ).toBe(true);
    expect(canUserPerformAction({ user: adminUser, action: 'settings:manage' })).toBe(true);
  });

  it('allows operator to restart processes and view logs, but denies settings:manage and process:view_secrets', () => {
    const operatorUser = { id: 'op-1', roleName: 'operator' as const };
    expect(canUserPerformAction({ user: operatorUser, action: 'process:manage' })).toBe(true);
    expect(canUserPerformAction({ user: operatorUser, action: 'log:view' })).toBe(true);
    expect(canUserPerformAction({ user: operatorUser, action: 'settings:manage' })).toBe(false);
    expect(canUserPerformAction({ user: operatorUser, action: 'node:delete' })).toBe(false);
    expect(canUserPerformAction({ user: operatorUser, action: 'process:view_secrets' })).toBe(
      false,
    );
  });

  it('allows viewer only read-only actions', () => {
    const viewerUser = { id: 'view-1', roleName: 'viewer' as const };
    expect(canUserPerformAction({ user: viewerUser, action: 'node:view' })).toBe(true);
    expect(canUserPerformAction({ user: viewerUser, action: 'process:view' })).toBe(true);
    expect(canUserPerformAction({ user: viewerUser, action: 'log:view' })).toBe(true);
    expect(canUserPerformAction({ user: viewerUser, action: 'process:manage' })).toBe(false);
    expect(canUserPerformAction({ user: viewerUser, action: 'settings:manage' })).toBe(false);
  });

  it('evaluates custom scoped permissions correctly', () => {
    const viewerUser = { id: 'view-1', roleName: 'viewer' as const };
    const customPermissions = [
      { action: 'process:manage' as const, resourceScope: 'node:special-node' as const },
    ];

    // Allowed on special-node
    expect(
      canUserPerformAction({
        user: viewerUser,
        action: 'process:manage',
        targetScope: 'node:special-node',
        customPermissions,
      }),
    ).toBe(true);

    // Denied on another node
    expect(
      canUserPerformAction({
        user: viewerUser,
        action: 'process:manage',
        targetScope: 'node:other-node',
        customPermissions,
      }),
    ).toBe(false);
  });
});
