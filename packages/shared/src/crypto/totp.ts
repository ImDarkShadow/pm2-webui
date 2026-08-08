import crypto from 'node:crypto';

// Standard RFC 4648 Base32 alphabet
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32Encode = (buffer: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i] ?? 0;
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
};

export const base32Decode = (input: string): Buffer => {
  const cleanInput = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanInput.length; i++) {
    const char = cleanInput[i];
    if (!char) continue;
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
};

export interface GenerateTotpUriOptions {
  readonly secret: string;
  readonly username: string;
  readonly issuer?: string;
  readonly digits?: number;
  readonly period?: number;
}

/**
 * Generates a 20-byte cryptographically secure random secret in Base32.
 */
export const generateTotpSecret = (): string => {
  const randomBytes = crypto.randomBytes(20);
  return base32Encode(randomBytes);
};

/**
 * Generates standard `otpauth://totp/...` URI for authenticator apps.
 */
export const generateTotpUri = (options: GenerateTotpUriOptions): string => {
  const { secret, username, issuer = 'PM2 Cluster Manager', digits = 6, period = 30 } = options;

  const encodedIssuer = encodeURIComponent(issuer);
  const encodedUser = encodeURIComponent(username);
  return `otpauth://totp/${encodedIssuer}:${encodedUser}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${digits}&period=${period}`;
};

/**
 * Generates a 6-digit TOTP code for a given timestamp according to RFC 6238.
 */
export const generateTotpCode = (
  secret: string,
  timestamp: number = Date.now(),
  period: number = 30,
  digits: number = 6,
): string => {
  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / period);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();

  // Dynamic truncation (RFC 4226 Section 5.3)
  const lastByte = hmac[hmac.length - 1] ?? 0;
  const offset = lastByte & 0x0f;

  const b0 = hmac[offset] ?? 0;
  const b1 = hmac[offset + 1] ?? 0;
  const b2 = hmac[offset + 2] ?? 0;
  const b3 = hmac[offset + 3] ?? 0;

  const binaryCode = ((b0 & 0x7f) << 24) | ((b1 & 0xff) << 16) | ((b2 & 0xff) << 8) | (b3 & 0xff);

  const otp = binaryCode % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
};

/**
 * Verifies a 6-digit TOTP code with time drift window (default ±1 step = ±30s).
 */
export const verifyTotpCode = (
  secret: string,
  token: string,
  window: number = 1,
  timestamp: number = Date.now(),
  period: number = 30,
  digits: number = 6,
): boolean => {
  const cleanToken = token ? token.replace(/[\s-]+/g, '').trim() : '';
  if (!cleanToken || cleanToken.length !== digits || !/^\d+$/.test(cleanToken)) {
    return false;
  }

  const currentCounter = Math.floor(timestamp / 1000 / period);

  for (let i = -window; i <= window; i++) {
    const checkTime = (currentCounter + i) * period * 1000;
    const generated = generateTotpCode(secret, checkTime, period, digits);

    if (crypto.timingSafeEqual(Buffer.from(generated, 'utf8'), Buffer.from(cleanToken, 'utf8'))) {
      return true;
    }
  }

  return false;
};

/**
 * Generates single-use emergency backup recovery codes (e.g. `A7B2-C9D4-E1F8`).
 */
export const generateRecoveryCodes = (count: number = 8): readonly string[] => {
  const codes: string[] = [];
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude ambiguous 0/O, 1/I

  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(12);
    let code = '';
    for (let b = 0; b < 12; b++) {
      const byte = bytes[b] ?? 0;
      const char = chars[byte % chars.length] ?? 'X';
      code += char;
      if (b === 3 || b === 7) {
        code += '-';
      }
    }
    codes.push(code);
  }

  return codes;
};

/**
 * Normalizes and hashes an emergency recovery code with SHA-256 for secure storage.
 */
export const hashRecoveryCode = (code: string): string => {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
};
