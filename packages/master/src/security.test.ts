import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { generateEd25519KeyPair } from '@pm2-webui/shared';
import {
  MASTER_INIT_SQL,
  createUsersRepo,
  createSessionsRepo,
  createAuditRepo,
  createRecoveryCodesRepo,
  createApiTokensRepo,
} from './db/index.js';
import {
  createLockoutService,
  createTwoFactorService,
  createSessionService,
  createApiTokenService,
  createSecurityAuditService,
  createAuthService,
} from './security/index.js';

describe('Security services', () => {
  let db: any;
  let usersRepo: any;
  let sessionsRepo: any;
  let auditRepo: any;
  let recoveryCodesRepo: any;
  let apiTokensRepo: any;
  let securityAuditService: any;
  let lockoutService: any;
  let twoFactorService: any;
  let sessionService: any;
  let apiTokenService: any;
  let authService: any;
  const jwtSecret = 'test-jwt-secret-key-32-chars-long-abc';
  const masterKeyPair = generateEd25519KeyPair();

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(MASTER_INIT_SQL);

    usersRepo = createUsersRepo({ db });
    sessionsRepo = createSessionsRepo({ db });
    auditRepo = createAuditRepo({ db });
    recoveryCodesRepo = createRecoveryCodesRepo({ db });
    apiTokensRepo = createApiTokensRepo({ db });

    securityAuditService = createSecurityAuditService({ auditRepo });
    lockoutService = createLockoutService({ usersRepo, maxAttempts: 3, lockoutDurationMs: 60000 });
    twoFactorService = createTwoFactorService({
      usersRepo,
      recoveryCodesRepo,
      encryptionKey: jwtSecret,
    });
    sessionService = createSessionService({ sessionsRepo, jwtSecret });
    apiTokenService = createApiTokenService({ apiTokensRepo, usersRepo, tokenSecret: jwtSecret });
    authService = createAuthService({
      usersRepo,
      lockoutService,
      twoFactorService,
      sessionService,
      securityAuditService,
      masterKeyPair,
      jwtSecret,
    });

    await authService.ensureInitialAdmin({
      username: 'admin',
      email: 'admin@pm2.local',
      password: 'password123',
    });
  });

  describe('LockoutService & Brute-Force Defense', () => {
    it('locks out after max failed attempts and enforces cooldown', async () => {
      const ip = '192.168.1.100';
      const username = 'admin';

      expect(lockoutService.checkLockout(ip, username).isLocked).toBe(false);

      await lockoutService.recordFailure(ip, username);
      await lockoutService.recordFailure(ip, username);
      expect(lockoutService.checkLockout(ip, username).isLocked).toBe(false);

      await lockoutService.recordFailure(ip, username); // 3rd failure (maxAttempts = 3)
      const status = lockoutService.checkLockout(ip, username);
      expect(status.isLocked).toBe(true);
      expect(status.remainingSeconds).toBeGreaterThan(0);

      // Login attempt should now be rejected by AuthService
      const loginRes = await authService.login(username, 'wrong-password', ip);
      expect(loginRes.ok).toBe(false);
      expect(loginRes.error.code).toBe('FORBIDDEN');
    });

    it('resets failed attempts upon successful login', async () => {
      const ip = '192.168.1.101';
      const username = 'admin';

      await lockoutService.recordFailure(ip, username);
      await lockoutService.recordSuccess(ip, username);

      expect(lockoutService.checkLockout(ip, username).isLocked).toBe(false);
    });
  });

  describe('TwoFactorService & At-Rest Encryption', () => {
    it('sets up, encrypts secret at rest, verifies TOTP and single-use recovery codes', async () => {
      const userRes = usersRepo.findByUsername('admin');
      const userId = userRes.value.id;

      // 1. Generate setup
      const setupRes = twoFactorService.generateSetup(userId, 'admin');
      expect(setupRes.ok).toBe(true);
      const { secret, recoveryCodes } = setupRes.value;

      // 2. Enable 2FA with generated secret & valid code (formatted with space)
      const { generateTotpCode } = await import('@pm2-webui/shared');
      const validCode = generateTotpCode(secret);
      const formattedCode = `${validCode.slice(0, 3)} ${validCode.slice(3)}`;

      const enableRes = await twoFactorService.enable(userId, secret, formattedCode, recoveryCodes);
      expect(enableRes.ok).toBe(true);

      // Check DB: secret must NOT be plaintext
      const dbUser = usersRepo.findById(userId).value;
      expect(dbUser.twoFactorEnabled).toBe(true);
      expect(dbUser.twoFactorSecretEnc).toBeDefined();
      expect(dbUser.twoFactorSecretEnc).not.toBe(secret); // Encrypted via AES-256-GCM

      // 3. Verify TOTP code (both raw and formatted)
      const verifyTotpRes = await twoFactorService.verifyCodeOrRecovery(userId, formattedCode);
      expect(verifyTotpRes.ok).toBe(true);
      expect(verifyTotpRes.value).toBe(true);

      // 4. Verify Single-Use Recovery Code
      const recoveryCode1 = recoveryCodes[0];
      const verifyRec1 = await twoFactorService.verifyCodeOrRecovery(userId, recoveryCode1);
      expect(verifyRec1.ok).toBe(true);
      expect(verifyRec1.value).toBe(true);

      // 5. Consuming the SAME recovery code twice must FAIL
      const verifyRec1Again = await twoFactorService.verifyCodeOrRecovery(userId, recoveryCode1);
      expect(verifyRec1Again.ok).toBe(true);
      expect(verifyRec1Again.value).toBe(false);

      // 6. Test AuthService End-to-End 2FA Login Challenge & Verification
      const loginRes = await authService.login('admin', 'password123', '127.0.0.1');
      expect(loginRes.ok).toBe(true);
      expect(loginRes.value.requires2FA).toBe(true);
      if (loginRes.value.requires2FA) {
        const tempToken = loginRes.value.tempToken;
        expect(tempToken).toBeDefined();

        // 6a. Attempt with invalid code fails
        const badVerify = await authService.verify2FALogin(tempToken, '000000', '127.0.0.1');
        expect(badVerify.ok).toBe(false);
        expect(badVerify.error.code).toBe('UNAUTHORIZED');

        // 6b. Attempt with valid TOTP code succeeds and returns access tokens
        const currentCode = generateTotpCode(secret);
        const goodVerify = await authService.verify2FALogin(
          tempToken,
          `${currentCode.slice(0, 3)} ${currentCode.slice(3)}`,
          '127.0.0.1',
        );
        expect(goodVerify.ok).toBe(true);
        expect(goodVerify.value.accessToken).toBeDefined();
        expect(goodVerify.value.user.username).toBe('admin');
      }

      // 7. Disable 2FA
      const disableRes = await twoFactorService.disable(userId);
      expect(disableRes.ok).toBe(true);
      const disabledUser = usersRepo.findById(userId).value;
      expect(disabledUser.twoFactorEnabled).toBe(false);
    });
  });

  describe('SessionService & Family Token Rotation with Replay Detection', () => {
    it('rotates refresh token and revokes entire family on replay attack', () => {
      const userRes = usersRepo.findByUsername('admin');
      const userId = userRes.value.id;
      const ip = '127.0.0.1';

      // 1. Create Session
      const sessionRes = sessionService.createSession(userId, ip);
      expect(sessionRes.ok).toBe(true);
      const initialToken = sessionRes.value.fullRefreshToken;

      // 2. Rotate Token
      const rotate1 = sessionService.rotateRefreshToken(initialToken, ip);
      expect(rotate1.ok).toBe(true);
      const secondToken = rotate1.value.fullRefreshToken;
      expect(secondToken).not.toBe(initialToken);

      // 3. REPLAY ATTACK: Attacker presents the old initialToken
      const replayAttempt = sessionService.rotateRefreshToken(initialToken, ip);
      expect(replayAttempt.ok).toBe(false);
      expect(replayAttempt.error.message.toLowerCase()).toContain('reused');

      // 4. Legitimate user's secondToken must also now be revoked because family was compromised!
      const legitAttempt = sessionService.rotateRefreshToken(secondToken, ip);
      expect(legitAttempt.ok).toBe(false);
      expect(legitAttempt.error.message.toLowerCase()).toContain('reused');
    });
  });

  describe('ApiTokenService (Scoped Personal Access Tokens)', () => {
    it('creates, lists, validates scoped permissions and revokes PATs', async () => {
      const userRes = usersRepo.findByUsername('admin');
      const userId = userRes.value.id;

      // 1. Create scoped PAT
      const createRes = await apiTokenService.createToken(
        userId,
        'CI/CD Deploy Token',
        ['deploy:trigger', 'deploy:view'],
        30,
      );
      expect(createRes.ok).toBe(true);
      const { tokenInfo, rawToken } = createRes.value;
      expect(rawToken.startsWith('pm2_pat_')).toBe(true);

      // 2. Verify with allowed permission
      const verifyAllowed = await apiTokenService.verifyPat(rawToken, 'deploy:trigger');
      expect(verifyAllowed.ok).toBe(true);
      expect(verifyAllowed.value.user.id).toBe(userId);

      // 3. Verify with forbidden permission
      const verifyForbidden = await apiTokenService.verifyPat(rawToken, 'process:manage');
      expect(verifyForbidden.ok).toBe(false);
      expect(verifyForbidden.error.code).toBe('FORBIDDEN');

      // 4. Revoke token
      const revokeRes = apiTokenService.revokeToken(tokenInfo.id, userId);
      expect(revokeRes.ok).toBe(true);

      // 5. Verify revoked token fails
      const verifyRevoked = await apiTokenService.verifyPat(rawToken);
      expect(verifyRevoked.ok).toBe(false);
      expect(verifyRevoked.error.code).toBe('UNAUTHORIZED');
    });
  });
});
