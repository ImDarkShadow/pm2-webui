import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  encryptSecret,
  decryptSecret,
  Result,
  ok,
  err,
  createAppError,
  TwoFactorSetupResult,
  TwoFactorStatus,
} from '@pm2-webui/shared';
import { UsersRepo } from '../db/repos/usersRepo.js';
import { RecoveryCodesRepo } from '../db/repos/recoveryCodesRepo.js';

export interface TwoFactorServiceDeps {
  readonly usersRepo: UsersRepo;
  readonly recoveryCodesRepo: RecoveryCodesRepo;
  readonly encryptionKey: string;
}

export interface TwoFactorService {
  readonly getStatus: (userId: string) => Result<TwoFactorStatus>;
  readonly generateSetup: (userId: string, username: string) => Result<TwoFactorSetupResult>;
  readonly enable: (
    userId: string,
    secret: string,
    code: string,
    recoveryCodes: readonly string[],
  ) => Promise<Result<void>>;
  readonly disable: (userId: string) => Promise<Result<void>>;
  readonly verifyCodeOrRecovery: (
    userId: string,
    codeOrRecovery: string,
  ) => Promise<Result<boolean>>;
}

export const createTwoFactorService = (deps: TwoFactorServiceDeps): TwoFactorService => {
  const { usersRepo, recoveryCodesRepo, encryptionKey } = deps;

  const getStatus = (userId: string): Result<TwoFactorStatus> => {
    const userRes = usersRepo.findById(userId);
    if (!userRes.ok || !userRes.value) {
      return err(createAppError('NOT_FOUND', 'User not found'));
    }

    const countRes = recoveryCodesRepo.countUnused(userId);
    const count = countRes.ok ? countRes.value : 0;

    return ok({
      enabled: Boolean(userRes.value.twoFactorEnabled),
      hasRecoveryCodes: count > 0,
    });
  };

  const generateSetup = (userId: string, username: string): Result<TwoFactorSetupResult> => {
    const secret = generateTotpSecret();
    const otpauthUri = generateTotpUri({
      secret,
      username,
      issuer: 'PM2 Web UI',
    });
    const recoveryCodes = generateRecoveryCodes(8);

    return ok({
      secret,
      otpauthUri,
      recoveryCodes,
    });
  };

  const enable = async (
    userId: string,
    secret: string,
    code: string,
    recoveryCodes: readonly string[],
  ): Promise<Result<void>> => {
    const cleanCode = code.replace(/[\s-]+/g, '').trim();
    const isValid = verifyTotpCode(secret, cleanCode, 1);
    if (!isValid) {
      return err(createAppError('VALIDATION_ERROR', 'Invalid 6-digit authenticator code'));
    }

    let secretEnc: string;
    try {
      secretEnc = encryptSecret(secret, encryptionKey);
    } catch (error) {
      return err(
        createAppError('CRYPTO_ERROR', 'Failed to encrypt 2FA secret at rest', undefined, error),
      );
    }

    const hashedCodes = recoveryCodes.map(hashRecoveryCode);
    const storeRes = recoveryCodesRepo.createBatch(userId, hashedCodes);
    if (!storeRes.ok) {
      return storeRes;
    }

    const updateRes = usersRepo.set2FA(userId, true, secretEnc);
    if (!updateRes.ok) {
      return updateRes;
    }

    return ok(undefined);
  };

  const disable = async (userId: string): Promise<Result<void>> => {
    recoveryCodesRepo.deleteAllForUser(userId);
    const updateRes = usersRepo.set2FA(userId, false, undefined);
    if (!updateRes.ok) {
      return updateRes;
    }

    return ok(undefined);
  };

  const verifyCodeOrRecovery = async (
    userId: string,
    codeOrRecovery: string,
  ): Promise<Result<boolean>> => {
    const userRes = usersRepo.findById(userId);
    if (!userRes.ok || !userRes.value) {
      return err(createAppError('NOT_FOUND', 'User not found'));
    }

    const user = userRes.value;
    if (!user.twoFactorEnabled || !user.twoFactorSecretEnc) {
      return ok(true);
    }

    const cleanInput = codeOrRecovery.replace(/[\s-]+/g, '').trim();

    if (/^\d{6}$/.test(cleanInput)) {
      try {
        const plainSecret = decryptSecret(user.twoFactorSecretEnc, encryptionKey);
        const isTotpValid = verifyTotpCode(plainSecret, cleanInput, 1);
        if (isTotpValid) {
          return ok(true);
        }
      } catch (error) {
        return err(
          createAppError('CRYPTO_ERROR', 'Failed to decrypt 2FA secret', undefined, error),
        );
      }
    }

    const hashedAttempt = hashRecoveryCode(codeOrRecovery);
    const consumeRes = recoveryCodesRepo.consumeCode(userId, hashedAttempt);
    if (consumeRes.ok && consumeRes.value === true) {
      return ok(true);
    }

    return ok(false);
  };

  return {
    getStatus,
    generateSetup,
    enable,
    disable,
    verifyCodeOrRecovery,
  };
};
