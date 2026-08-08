import { describe, it, expect } from 'vitest';
import {
  generateEd25519KeyPair,
  signData,
  verifyData,
  generateChallenge,
  issueDelegationToken,
  verifyDelegationToken,
} from './index.js';

describe('Shared Cryptographic Engine', () => {
  it('generates a valid Ed25519 keypair', () => {
    const keyPair = generateEd25519KeyPair();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.publicKey.length).toBeGreaterThan(50);
  });

  it('signs data and successfully verifies signature with public key', () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const message = 'challenge-nonce-test-12345';

    const signResult = signData(message, privateKey);
    expect(signResult.ok).toBe(true);

    if (signResult.ok) {
      const isValid = verifyData(message, signResult.value, publicKey);
      expect(isValid).toBe(true);

      const isTamperedValid = verifyData('tampered-message', signResult.value, publicKey);
      expect(isTamperedValid).toBe(false);
    }
  });

  it('generates random challenges', () => {
    const challenge1 = generateChallenge();
    const challenge2 = generateChallenge();
    expect(challenge1).toHaveLength(64); // 32 bytes in hex
    expect(challenge1).not.toEqual(challenge2);
  });

  it('issues and verifies a delegation token signed by Master', () => {
    const masterKeys = generateEd25519KeyPair();
    const nodeId = 'node-uuid-001';
    const userId = 'user-uuid-admin';

    const tokenResult = issueDelegationToken({
      masterPrivateKey: masterKeys.privateKey,
      userId,
      nodeId,
      permissions: ['process:manage', 'log:view'],
      ttlSeconds: 60,
    });

    expect(tokenResult.ok).toBe(true);

    if (tokenResult.ok) {
      const verifyResult = verifyDelegationToken({
        token: tokenResult.value,
        masterPublicKey: masterKeys.publicKey,
        expectedNodeId: nodeId,
      });

      expect(verifyResult.ok).toBe(true);
      if (verifyResult.ok) {
        expect(verifyResult.value.sub).toBe(userId);
        expect(verifyResult.value.nodeId).toBe(nodeId);
        expect(verifyResult.value.permissions).toContain('process:manage');
      }

      // Reject on mismatched node
      const mismatchResult = verifyDelegationToken({
        token: tokenResult.value,
        masterPublicKey: masterKeys.publicKey,
        expectedNodeId: 'wrong-node-id',
      });
      expect(mismatchResult.ok).toBe(false);

      // Reject on wrong key
      const otherKeys = generateEd25519KeyPair();
      const wrongKeyResult = verifyDelegationToken({
        token: tokenResult.value,
        masterPublicKey: otherKeys.publicKey,
      });
      expect(wrongKeyResult.ok).toBe(false);
    }
  });

  it('rejects expired delegation tokens', () => {
    const masterKeys = generateEd25519KeyPair();
    const tokenResult = issueDelegationToken({
      masterPrivateKey: masterKeys.privateKey,
      userId: 'u1',
      nodeId: 'n1',
      permissions: ['node:view'],
      ttlSeconds: -10, // already expired
    });

    expect(tokenResult.ok).toBe(true);
    if (tokenResult.ok) {
      const verifyResult = verifyDelegationToken({
        token: tokenResult.value,
        masterPublicKey: masterKeys.publicKey,
      });
      expect(verifyResult.ok).toBe(false);
      if (!verifyResult.ok) {
        expect(verifyResult.error.code).toBe('UNAUTHORIZED');
      }
    }
  });
});
