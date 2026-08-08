import crypto from 'node:crypto';

/**
 * Derives a 32-byte key from a secret string using SHA-256.
 */
const deriveKey = (keySecret: string): Buffer => {
  return crypto.createHash('sha256').update(keySecret, 'utf8').digest();
};

/**
 * Encrypts plaintext using AES-256-GCM authenticated encryption.
 * Output format: `<iv_base64url>.<tag_base64url>.<ciphertext_base64url>`
 */
export const encryptSecret = (plaintext: string, keySecret: string): string => {
  const key = deriveKey(keySecret);
  const iv = crypto.randomBytes(12); // 96-bit standard IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const tag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
};

/**
 * Decrypts AES-256-GCM encrypted payload and verifies authentication tag.
 */
export const decryptSecret = (encryptedPayload: string, keySecret: string): string => {
  const parts = encryptedPayload.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Malformed encrypted payload format');
  }

  const [ivB64, tagB64, ciphertextB64] = parts;
  const key = deriveKey(keySecret);
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
};
