import { UsersRepo } from '../db/repos/usersRepo.js';

export interface LockoutServiceDeps {
  readonly usersRepo: UsersRepo;
  readonly maxAttempts?: number;
  readonly lockoutDurationMs?: number;
}

interface AttemptTracker {
  count: number;
  lastAttemptAt: number;
  lockedUntil?: number;
}

export interface LockoutStatus {
  readonly isLocked: boolean;
  readonly remainingSeconds?: number;
  readonly reason?: string;
}

export interface LockoutService {
  readonly checkLockout: (ip: string, username?: string) => LockoutStatus;
  readonly recordFailure: (ip: string, username?: string) => Promise<void>;
  readonly recordSuccess: (ip: string, username?: string) => Promise<void>;
  readonly getDelayMs: (ip: string, username?: string) => number;
}

export const createLockoutService = (deps: LockoutServiceDeps): LockoutService => {
  const {
    usersRepo,
    maxAttempts = 5,
    lockoutDurationMs = 15 * 60 * 1000, // 15 minutes
  } = deps;

  // In-memory rate limiting map for IPs and compounds
  const ipAttempts = new Map<string, AttemptTracker>();
  const compoundAttempts = new Map<string, AttemptTracker>();

  const getCompoundKey = (ip: string, username: string) => `${username.toLowerCase()}:${ip}`;

  const checkTracker = (tracker?: AttemptTracker): LockoutStatus => {
    if (!tracker) return { isLocked: false };
    const now = Date.now();

    if (tracker.lockedUntil && tracker.lockedUntil > now) {
      const remainingSeconds = Math.ceil((tracker.lockedUntil - now) / 1000);
      return {
        isLocked: true,
        remainingSeconds,
        reason: `Too many failed attempts. Try again in ${remainingSeconds}s.`,
      };
    }

    return { isLocked: false };
  };

  const checkLockout = (ip: string, username?: string): LockoutStatus => {
    const now = Date.now();

    // 1. Check IP tracker
    const ipStatus = checkTracker(ipAttempts.get(ip));
    if (ipStatus.isLocked) return ipStatus;

    // 2. Check compound (username+IP) tracker
    if (username) {
      const compoundStatus = checkTracker(compoundAttempts.get(getCompoundKey(ip, username)));
      if (compoundStatus.isLocked) return compoundStatus;

      // 3. Check persistent User account lockout in database
      const userRes = username.includes('@')
        ? usersRepo.findByEmail(username)
        : usersRepo.findByUsername(username);

      if (userRes.ok && userRes.value && userRes.value.lockedUntil) {
        if (userRes.value.lockedUntil > now) {
          const remainingSeconds = Math.ceil((userRes.value.lockedUntil - now) / 1000);
          return {
            isLocked: true,
            remainingSeconds,
            reason: `Account temporarily locked due to multiple failed logins. Try again in ${remainingSeconds}s.`,
          };
        }
      }
    }

    return { isLocked: false };
  };

  const updateTracker = (map: Map<string, AttemptTracker>, key: string, limit: number) => {
    const now = Date.now();
    const current = map.get(key) || { count: 0, lastAttemptAt: now };
    current.count += 1;
    current.lastAttemptAt = now;

    if (current.count >= limit) {
      current.lockedUntil = now + lockoutDurationMs;
    }

    map.set(key, current);
  };

  const recordFailure = async (ip: string, username?: string): Promise<void> => {
    const now = Date.now();

    // 1. Update IP Tracker (Higher threshold, e.g. 15 attempts to prevent blocking whole networks)
    updateTracker(ipAttempts, ip, maxAttempts * 3);

    if (username) {
      // 2. Update Compound Tracker (5 attempts)
      const compoundKey = getCompoundKey(ip, username);
      updateTracker(compoundAttempts, compoundKey, maxAttempts);

      // 3. Update Database User Record
      const userRes = username.includes('@')
        ? usersRepo.findByEmail(username)
        : usersRepo.findByUsername(username);

      if (userRes.ok && userRes.value) {
        const user = userRes.value;
        const newCount = user.failedAttempts + 1;
        let lockUntil: number | undefined;

        if (newCount >= maxAttempts) {
          lockUntil = now + lockoutDurationMs;
        }

        usersRepo.recordFailedAttempt(user.id, lockUntil);
      }
    }
  };

  const recordSuccess = async (ip: string, username?: string): Promise<void> => {
    ipAttempts.delete(ip);
    if (username) {
      compoundAttempts.delete(getCompoundKey(ip, username));
      const userRes = username.includes('@')
        ? usersRepo.findByEmail(username)
        : usersRepo.findByUsername(username);

      if (userRes.ok && userRes.value) {
        usersRepo.resetFailedAttempts(userRes.value.id);
      }
    }
  };

  const getDelayMs = (ip: string, username?: string): number => {
    const compound = username ? compoundAttempts.get(getCompoundKey(ip, username)) : undefined;
    const ipTrack = ipAttempts.get(ip);
    const count = Math.max(compound?.count || 0, ipTrack?.count || 0);

    if (count <= 1) return 0;
    // Progressive backoff: 2nd attempt -> 200ms, 3rd -> 500ms, 4th -> 1000ms
    return Math.min(1500, Math.pow(2, count - 1) * 100);
  };

  return {
    checkLockout,
    recordFailure,
    recordSuccess,
    getDelayMs,
  };
};
