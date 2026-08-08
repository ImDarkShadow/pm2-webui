import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from './aes.js';

describe('AES-256-GCM Symmetric Encryption at Rest', () => {
  const masterKey = 'super-secret-master-key-32-chars-long';

  it('encrypts and decrypts secret strings faithfully', () => {
    const original = 'JBSWY3DPEHPK3PXP-TOTP-SECRET-12345';
    const encrypted = encryptSecret(original, masterKey);

    expect(encrypted).not.toBe(original);
    expect(encrypted.split('.').length).toBe(3); // iv.tag.ciphertext

    const decrypted = decryptSecret(encrypted, masterKey);
    expect(decrypted).toBe(original);
  });

  it('fails decryption if ciphertext or tag is tampered with', () => {
    const original = 'sensitive-data';
    const encrypted = encryptSecret(original, masterKey);
    const parts = encrypted.split('.');
    const iv = parts[0] ?? '';
    const tag = parts[1] ?? '';
    const ciphertext = parts[2] ?? '';

    // Tamper with ciphertext
    const tampered = `${iv}.${tag}.${ciphertext.slice(0, -2)}AA`;
    expect(() => decryptSecret(tampered, masterKey)).toThrow();

    // Wrong master key
    expect(() => decryptSecret(encrypted, 'wrong-key-secret')).toThrow();
  });
});
