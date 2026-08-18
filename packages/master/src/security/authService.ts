import crypto from 'node:crypto';
import * as argon2 from '@node-rs/argon2';
import {
  User,
  RoleName,
  PermissionAction,
  Result,
  ok,
  err,
  createAppError,
  issueDelegationToken,
  Ed25519KeyPair,
} from '@pm2-cluster/shared';
import { UsersRepo } from '../db/repos/usersRepo.js';
import { LockoutService } from './lockoutService.js';
import { TwoFactorService } from './twoFactorService.js';
import { SessionService } from './sessionService.js';
import { SecurityAuditService } from './securityAuditService.js';

export interface AuthServiceDeps {
  readonly usersRepo: UsersRepo;
  readonly lockoutService: LockoutService;
  readonly twoFactorService: TwoFactorService;
  readonly sessionService: SessionService;
  readonly securityAuditService: SecurityAuditService;
  readonly masterKeyPair: Ed25519KeyPair;
  readonly jwtSecret: string;
  readonly logger?: {
    readonly info: (msg: string, ...args: unknown[]) => void;
    readonly error: (msg: string, ...args: unknown[]) => void;
  };
}

export type LoginResult =
  | {
      readonly requires2FA: false;
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly user: User;
    }
  | { readonly requires2FA: true; readonly tempToken: string; readonly userId: string };

export interface JwtUserPayload {
  readonly id: string;
  readonly sub: string; // userId
  readonly username: string;
  readonly roleId: string;
  readonly roleName: RoleName;
  readonly exp: number;
  readonly iat: number;
}

export interface AuthService {
  readonly hashPassword: (password: string) => Promise<string>;
  readonly verifyPassword: (hash: string, password: string) => Promise<boolean>;
  readonly ensureInitialAdmin: (options?: {
    username?: string;
    email?: string;
    password?: string;
  }) => Promise<Result<User | null>>;
  readonly login: (
    usernameOrEmail: string,
    password: string,
    ipAddress: string,
    userAgent?: string,
  ) => Promise<Result<LoginResult>>;
  readonly verify2FALogin: (
    tempToken: string,
    codeOrRecovery: string,
    ipAddress: string,
    userAgent?: string,
  ) => Promise<Result<{ accessToken: string; refreshToken: string; user: User }>>;
  readonly refresh: (
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ) => Promise<Result<{ accessToken: string; refreshToken: string }>>;
  readonly logout: (sessionId: string, userId?: string, ipAddress?: string) => Result<void>;
  readonly verifyAccessToken: (token: string) => Result<JwtUserPayload>;
  readonly issueDelegationTokenForNode: (
    userId: string,
    nodeId: string,
    permissions: readonly PermissionAction[],
  ) => Result<string>;
}

export const createAuthService = (deps: AuthServiceDeps): AuthService => {
  const {
    usersRepo,
    lockoutService,
    twoFactorService,
    sessionService,
    securityAuditService,
    masterKeyPair,
    jwtSecret,
    logger,
  } = deps;

  const hashPassword = async (password: string): Promise<string> => {
    return argon2.hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });
  };

  const verifyPassword = async (hash: string, password: string): Promise<boolean> => {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  };

  const signJwt = (payload: Record<string, unknown>, expiresInSec: number): string => {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      ...payload,
      iat: now,
      exp: now + expiresInSec,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const unsigned = `${headerB64}.${payloadB64}`;

    const signature = crypto.createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
  };

  const verifyJwt = (token: string): Result<Record<string, any>> => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        return err(createAppError('UNAUTHORIZED', 'Invalid JWT structure'));
      }

      const [headerB64, payloadB64, sigB64] = parts;
      const expectedSig = crypto
        .createHmac('sha256', jwtSecret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

      if (sigB64 !== expectedSig) {
        return err(createAppError('UNAUTHORIZED', 'Invalid token signature'));
      }

      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return err(createAppError('UNAUTHORIZED', 'Token has expired'));
      }

      return ok(payload);
    } catch (error) {
      return err(createAppError('UNAUTHORIZED', 'Malformed token', undefined, error));
    }
  };

  const verifyAccessToken = (token: string): Result<JwtUserPayload> => {
    const jwtRes = verifyJwt(token);
    if (!jwtRes.ok) return jwtRes;

    const payload = jwtRes.value;
    if (payload.type === '2fa_challenge') {
      return err(
        createAppError(
          'UNAUTHORIZED',
          'Intermediate 2FA challenge token cannot access protected APIs',
        ),
      );
    }

    return ok({
      id: payload.sub || payload.id,
      sub: payload.sub,
      username: payload.username,
      roleId: payload.roleId,
      roleName: payload.roleName,
      exp: payload.exp,
      iat: payload.iat,
    });
  };

  const ensureInitialAdmin = async (options?: {
    username?: string;
    email?: string;
    password?: string;
  }): Promise<Result<User | null>> => {
    const countRes = usersRepo.count();
    if (!countRes.ok) return countRes;

    if (countRes.value > 0) {
      return ok(null);
    }

    const username = options?.username ?? 'admin';
    const email = options?.email ?? 'admin@pm2-cluster.local';
    const password = options?.password ?? 'adminpassword123';

    logger?.info?.(`Creating initial admin user '${username}'`);
    const passwordHash = await hashPassword(password);
    const adminId = crypto.randomUUID();

    const createRes = usersRepo.create({
      id: adminId,
      username,
      email,
      passwordHash,
      roleId: 'role-admin',
    });

    return createRes;
  };

  const login = async (
    usernameOrEmail: string,
    password: string,
    ipAddress: string,
    userAgent?: string,
  ): Promise<Result<LoginResult>> => {
    const lockout = lockoutService.checkLockout(ipAddress, usernameOrEmail);
    if (lockout.isLocked) {
      securityAuditService.logEvent({
        event: 'auth:lockout',
        username: usernameOrEmail,
        status: 'failure',
        ipAddress,
        details: { remainingSeconds: lockout.remainingSeconds },
      });
      return err(createAppError('FORBIDDEN', lockout.reason || 'Account temporarily locked'));
    }

    const byUserRes = usernameOrEmail.includes('@')
      ? usersRepo.findByEmail(usernameOrEmail)
      : usersRepo.findByUsername(usernameOrEmail);

    if (!byUserRes.ok) return byUserRes;
    const userWithHash = byUserRes.value;

    if (!userWithHash) {
      await lockoutService.recordFailure(ipAddress, usernameOrEmail);
      securityAuditService.logEvent({
        event: 'auth:login_failed',
        username: usernameOrEmail,
        status: 'failure',
        ipAddress,
        details: { reason: 'User not found' },
      });
      return err(createAppError('UNAUTHORIZED', 'Invalid username or password'));
    }

    const validPassword = await verifyPassword(userWithHash.passwordHash, password);
    if (!validPassword) {
      await lockoutService.recordFailure(ipAddress, userWithHash.username);
      securityAuditService.logEvent({
        event: 'auth:login_failed',
        userId: userWithHash.id,
        username: userWithHash.username,
        status: 'failure',
        ipAddress,
        details: { reason: 'Invalid password' },
      });
      return err(createAppError('UNAUTHORIZED', 'Invalid username or password'));
    }

    if (userWithHash.twoFactorEnabled) {
      const tempToken = signJwt(
        {
          sub: userWithHash.id,
          username: userWithHash.username,
          type: '2fa_challenge',
        },
        5 * 60,
      );

      return ok({
        requires2FA: true,
        tempToken,
        userId: userWithHash.id,
      });
    }

    await lockoutService.recordSuccess(ipAddress, userWithHash.username);

    const sessionRes = sessionService.createSession(userWithHash.id, ipAddress, userAgent);
    if (!sessionRes.ok) return sessionRes;

    const accessToken = signJwt(
      {
        sub: userWithHash.id,
        username: userWithHash.username,
        roleId: userWithHash.roleId,
        roleName: userWithHash.roleName,
      },
      15 * 60, // 15 minutes
    );

    const { passwordHash: _, twoFactorSecretEnc: __, ...user } = userWithHash;

    securityAuditService.logEvent({
      event: 'auth:login',
      userId: user.id,
      username: user.username,
      status: 'success',
      ipAddress,
      details: { method: 'password', sessionId: sessionRes.value.sessionId },
    });

    return ok({
      requires2FA: false,
      accessToken,
      refreshToken: sessionRes.value.fullRefreshToken,
      user,
    });
  };

  const verify2FALogin = async (
    tempToken: string,
    codeOrRecovery: string,
    ipAddress: string,
    userAgent?: string,
  ): Promise<Result<{ accessToken: string; refreshToken: string; user: User }>> => {
    // 1. Verify intermediate challenge token
    const jwtRes = verifyJwt(tempToken);
    if (!jwtRes.ok) return jwtRes as any;

    const payload = jwtRes.value;
    if (payload.type !== '2fa_challenge' || !payload.sub) {
      return err(createAppError('UNAUTHORIZED', 'Invalid 2FA challenge token'));
    }

    const userId = payload.sub as string;
    const userRes = usersRepo.findById(userId);
    if (!userRes.ok || !userRes.value) {
      return err(createAppError('UNAUTHORIZED', 'User not found'));
    }

    const userWithHash = userRes.value;

    // 2. Verify Code via TwoFactorService
    const verifyRes = await twoFactorService.verifyCodeOrRecovery(userId, codeOrRecovery);
    if (!verifyRes.ok || verifyRes.value !== true) {
      await lockoutService.recordFailure(ipAddress, userWithHash.username);
      securityAuditService.logEvent({
        event: 'auth:login_failed',
        userId: userWithHash.id,
        username: userWithHash.username,
        status: 'failure',
        ipAddress,
        details: { reason: 'Invalid 2FA verification code' },
      });
      return err(createAppError('UNAUTHORIZED', 'Invalid 2FA verification code or recovery code'));
    }

    // 3. Reset lockout on success
    await lockoutService.recordSuccess(ipAddress, userWithHash.username);

    // 4. Create Session
    const sessionRes = sessionService.createSession(userWithHash.id, ipAddress, userAgent);
    if (!sessionRes.ok) return sessionRes as any;

    const accessToken = signJwt(
      {
        sub: userWithHash.id,
        username: userWithHash.username,
        roleId: userWithHash.roleId,
        roleName: userWithHash.roleName,
      },
      15 * 60,
    );

    const { passwordHash: _, twoFactorSecretEnc: __, ...user } = userWithHash;

    securityAuditService.logEvent({
      event: 'auth:login',
      userId: user.id,
      username: user.username,
      status: 'success',
      ipAddress,
      details: { method: 'totp_2fa', sessionId: sessionRes.value.sessionId },
    });

    return ok({
      accessToken,
      refreshToken: sessionRes.value.fullRefreshToken,
      user,
    });
  };

  const refresh = async (
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Result<{ accessToken: string; refreshToken: string }>> => {
    // 1. Rotate refresh token with family replay detection
    const rotateRes = sessionService.rotateRefreshToken(refreshToken, ipAddress, userAgent);
    if (!rotateRes.ok) {
      if (
        rotateRes.error.message.includes('replay') ||
        rotateRes.error.message.includes('Security Alert')
      ) {
        securityAuditService.logEvent({
          event: 'auth:session_family_revoked',
          status: 'failure',
          ipAddress: ipAddress || 'unknown',
          details: { error: rotateRes.error.message },
        });
      }
      return rotateRes as any;
    }

    const { userId, fullRefreshToken } = rotateRes.value;

    const userRes = usersRepo.findById(userId);
    if (!userRes.ok || !userRes.value) {
      return err(createAppError('UNAUTHORIZED', 'User not found'));
    }

    const user = userRes.value;
    const newAccessToken = signJwt(
      {
        sub: user.id,
        username: user.username,
        roleId: user.roleId,
        roleName: user.roleName,
      },
      15 * 60,
    );

    return ok({
      accessToken: newAccessToken,
      refreshToken: fullRefreshToken,
    });
  };

  const logout = (sessionId: string, userId?: string, ipAddress?: string): Result<void> => {
    const revokeRes = sessionService.revokeSession(sessionId);
    if (revokeRes.ok) {
      securityAuditService.logEvent({
        event: 'auth:logout',
        userId: userId || 'anonymous',
        status: 'success',
        ipAddress: ipAddress || 'unknown',
        details: { sessionId },
      });
    }
    return revokeRes;
  };

  const issueDelegationTokenForNode = (
    userId: string,
    nodeId: string,
    permissions: readonly PermissionAction[],
  ): Result<string> => {
    return issueDelegationToken({
      masterPrivateKey: masterKeyPair.privateKey,
      userId,
      nodeId,
      permissions,
      ttlSeconds: 120, // 2 minutes
    });
  };

  return {
    hashPassword,
    verifyPassword,
    ensureInitialAdmin,
    login,
    verify2FALogin,
    refresh,
    logout,
    verifyAccessToken,
    issueDelegationTokenForNode,
  };
};
