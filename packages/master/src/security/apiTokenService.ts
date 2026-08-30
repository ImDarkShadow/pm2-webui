import crypto from 'node:crypto';
import { ApiTokensRepo } from '../db/repos/apiTokensRepo.js';
import { UsersRepo } from '../db/repos/usersRepo.js';
import {
  ApiTokenInfo,
  PermissionAction,
  Result,
  ok,
  err,
  createAppError,
  User,
} from '@pm2-webui/shared';

export interface ApiTokenServiceDeps {
  readonly apiTokensRepo: ApiTokensRepo;
  readonly usersRepo: UsersRepo;
  readonly tokenSecret: string;
}

export interface CreatedTokenResult {
  readonly tokenInfo: ApiTokenInfo;
  readonly rawToken: string; // Plaintext token displayed once
}

export interface VerifiedPat {
  readonly user: User;
  readonly permissions: readonly PermissionAction[];
}

export interface ApiTokenService {
  readonly createToken: (
    userId: string,
    name: string,
    permissions: readonly PermissionAction[],
    expiresInDays?: number,
  ) => Promise<Result<CreatedTokenResult>>;
  readonly listTokens: (userId: string) => Result<readonly ApiTokenInfo[]>;
  readonly revokeToken: (tokenId: string, userId?: string) => Result<void>;
  readonly verifyPat: (
    rawToken: string,
    requiredAction?: PermissionAction,
  ) => Promise<Result<VerifiedPat>>;
}

export const createApiTokenService = (deps: ApiTokenServiceDeps): ApiTokenService => {
  const { apiTokensRepo, usersRepo, tokenSecret } = deps;

  const hashToken = (token: string): string => {
    return crypto.createHmac('sha256', tokenSecret).update(token).digest('hex');
  };

  const createToken = async (
    userId: string,
    name: string,
    permissions: readonly PermissionAction[],
    expiresInDays?: number,
  ): Promise<Result<CreatedTokenResult>> => {
    const tokenId = crypto.randomUUID();
    const entropy = crypto.randomBytes(24).toString('base64url');
    const rawToken = `pm2_pat_${entropy}`;
    const tokenPrefix = rawToken.slice(0, 16);
    const tokenHash = hashToken(rawToken);

    const now = Date.now();
    const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : undefined;

    const createRes = apiTokensRepo.create({
      id: tokenId,
      userId,
      name,
      tokenHash,
      tokenPrefix,
      permissions,
      expiresAt,
    });

    if (!createRes.ok) {
      return createRes;
    }

    return ok({
      tokenInfo: createRes.value,
      rawToken,
    });
  };

  const listTokens = (userId: string): Result<readonly ApiTokenInfo[]> => {
    return apiTokensRepo.listByUser(userId);
  };

  const revokeToken = (tokenId: string, userId?: string): Result<void> => {
    return apiTokensRepo.deleteToken(tokenId, userId);
  };

  const verifyPat = async (
    rawToken: string,
    requiredAction?: PermissionAction,
  ): Promise<Result<VerifiedPat>> => {
    if (!rawToken.startsWith('pm2_pat_')) {
      return err(createAppError('UNAUTHORIZED', 'Invalid token format'));
    }

    const tokenHash = hashToken(rawToken);
    const tokenRowRes = apiTokensRepo.findByHash(tokenHash);
    if (!tokenRowRes.ok || !tokenRowRes.value) {
      return err(createAppError('UNAUTHORIZED', 'Invalid or revoked API token'));
    }

    const tokenRow = tokenRowRes.value;

    // Check expiration
    if (tokenRow.expiresAt && tokenRow.expiresAt < Date.now()) {
      return err(createAppError('UNAUTHORIZED', 'API token has expired'));
    }

    let permissions: PermissionAction[] = [];
    try {
      permissions = JSON.parse(tokenRow.permissionsJson || '[]');
    } catch {}

    // Check required action if specified
    if (requiredAction && !permissions.includes(requiredAction)) {
      return err(
        createAppError(
          'FORBIDDEN',
          `API Token does not have required permission [${requiredAction}]`,
        ),
      );
    }

    // Touch last used timestamp asynchronously
    apiTokensRepo.updateLastUsed(tokenRow.id);

    // Load owning user
    const userRes = usersRepo.findById(tokenRow.userId);
    if (!userRes.ok || !userRes.value) {
      return err(createAppError('UNAUTHORIZED', 'Token owner user not found'));
    }

    const { passwordHash: _, ...user } = userRes.value;

    return ok({
      user,
      permissions,
    });
  };

  return {
    createToken,
    listTokens,
    revokeToken,
    verifyPat,
  };
};
