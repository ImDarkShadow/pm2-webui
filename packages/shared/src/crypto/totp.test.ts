import { describe, it, expect } from 'vitest';
import {
  generateTotpSecret,
  generateTotpUri,
  generateTotpCode,
  verifyTotpCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  base32Encode,
  base32Decode,
} from './totp.js';

describe('RFC 6238 TOTP Cryptography', () => {
  it('encodes and decodes Base32 accurately', () => {
    const original = Buffer.from('Hello PM2 Cluster World!', 'utf8');
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(decoded.toString('utf8')).toBe('Hello PM2 Cluster World!');
  });

  it('generates a valid 20-byte Base32 secret', () => {
    const secret = generateTotpSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBe(32); // 20 bytes in Base32 = 32 chars
    const decoded = base32Decode(secret);
    expect(decoded.length).toBe(20);
  });

  it('generates a standard otpauth URI', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const uri = generateTotpUri({ secret, username: 'admin@pm2.local', issuer: 'PM2 Cluster' });
    expect(uri).toContain('otpauth://totp/PM2%20Cluster:admin%40pm2.local');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
  });

  it('conforms to standard RFC 6238 test vectors', () => {
    // RFC 6238 test secret "12345678901234567890" in Base32 is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(generateTotpCode(secret, 59 * 1000)).toBe('287082');
    expect(generateTotpCode(secret, 1111111109 * 1000)).toBe('081804');
    expect(generateTotpCode(secret, 1111111111 * 1000)).toBe('050471');
    expect(generateTotpCode(secret, 1234567890 * 1000)).toBe('005924');
    expect(generateTotpCode(secret, 2000000000 * 1000)).toBe('279037');
  });

  it('generates 6-digit TOTP code and verifies within drift window and handles user-formatted whitespace', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotpCode(secret, now);

    expect(code).toMatch(/^\d{6}$/);

    // Exact time match
    expect(verifyTotpCode(secret, code, 1, now)).toBe(true);

    // Formatted with spaces or dashes (e.g. "123 456" or "123-456")
    const formattedWithSpace = `${code.slice(0, 3)} ${code.slice(3)}`;
    const formattedWithDash = `${code.slice(0, 3)}-${code.slice(3)}`;
    expect(verifyTotpCode(secret, formattedWithSpace, 1, now)).toBe(true);
    expect(verifyTotpCode(secret, formattedWithDash, 1, now)).toBe(true);

    // Drift within 25 seconds (same/adjacent step)
    expect(verifyTotpCode(secret, code, 1, now + 25000)).toBe(true);
    expect(verifyTotpCode(secret, code, 1, now - 25000)).toBe(true);

    // Far in future (> 60s) outside window
    expect(verifyTotpCode(secret, code, 1, now + 90000)).toBe(false);

    // Wrong code
    expect(verifyTotpCode(secret, '000000', 1, now)).toBe(false);
  });

  it('generates 8 unique single-use recovery codes and hashes them with SHA-256', () => {
    const codes = generateRecoveryCodes(8);
    expect(codes.length).toBe(8);
    expect(new Set(codes).size).toBe(8);

    const first = codes[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      const hash1 = hashRecoveryCode(first);
      const hash2 = hashRecoveryCode(first.toLowerCase()); // Case-insensitive normalization
      const hash3 = hashRecoveryCode(first.replace(/-/g, '')); // Stripped dashes normalization
      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
    }
  });
});
