import { RoleName, PermissionAction, ResourceScope, User } from '../types/index.js';

export const SYSTEM_ROLE_PERMISSIONS: Record<RoleName, readonly PermissionAction[]> = {
  admin: [
    'node:view',
    'node:enroll',
    'node:approve',
    'node:delete',
    'node:group_assign',
    'process:view',
    'process:manage',
    'process:scale',
    'process:action_trigger',
    'process:view_secrets',
    'plugin:manage',
    'deploy:view',
    'deploy:create',
    'deploy:update',
    'deploy:trigger',
    'deploy:rollback',
    'deploy:delete',
    'log:view',
    'metrics:view',
    'settings:view',
    'settings:manage',
    'audit:view',
    'auth:2fa_manage',
    'auth:sessions_manage',
    'auth:tokens_manage',
    'security:view',
    'security:manage',
  ],
  operator: [
    'node:view',
    'process:view',
    'process:manage',
    'process:scale',
    'process:action_trigger',
    'deploy:view',
    'deploy:trigger',
    'deploy:rollback',
    'log:view',
    'metrics:view',
    'settings:view',
    'audit:view',
    'auth:2fa_manage',
    'auth:sessions_manage',
    'auth:tokens_manage',
    'security:view',
  ],
  viewer: [
    'node:view',
    'process:view',
    'deploy:view',
    'log:view',
    'metrics:view',
    'settings:view',
    'auth:2fa_manage',
    'auth:sessions_manage',
    'security:view',
  ],
};

export const getRolePermissions = (roleName: RoleName): readonly PermissionAction[] => {
  return SYSTEM_ROLE_PERMISSIONS[roleName] ?? [];
};

export interface CheckPermissionOptions {
  readonly user: Pick<User, 'id' | 'roleName'>;
  readonly action: PermissionAction;
  readonly targetScope?: ResourceScope;
  readonly customPermissions?: readonly {
    readonly action: PermissionAction;
    readonly resourceScope: ResourceScope;
  }[];
}

export const canUserPerformAction = (options: CheckPermissionOptions): boolean => {
  const { user, action, targetScope = 'global', customPermissions = [] } = options;

  // Admin role always has universal access
  if (user.roleName === 'admin') {
    return true;
  }

  // Check default system role permissions for global scope
  const rolePermissions = getRolePermissions(user.roleName);
  const hasRolePermission = rolePermissions.includes(action);

  if (hasRolePermission && targetScope === 'global') {
    return true;
  }

  // If action is in role permissions and target scope is a specific node/group, role allows it unless restricted
  if (hasRolePermission && (targetScope.startsWith('node:') || targetScope.startsWith('group:'))) {
    return true;
  }

  // Check explicit scoped permissions (e.g. granted for specific node/group)
  for (const perm of customPermissions) {
    if (perm.action === action) {
      if (perm.resourceScope === 'global') {
        return true;
      }
      if (perm.resourceScope === targetScope) {
        return true;
      }
      if (targetScope.startsWith('node:') && perm.resourceScope.startsWith('group:')) {
        return true;
      }
    }
  }

  return false;
};
