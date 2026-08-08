import crypto from 'node:crypto';
import { Result, ok, err, createAppError } from '../errors/index.js';
import { PermissionAction } from '../types/index.js';

export interface Ed25519KeyPair {
  readonly publicKey: string; // Base64 encoded SPKI public key or raw public key
  readonly privateKey: string; // Base64 encoded PKCS8 private key
}

export const generateEd25519KeyPair = (): Ed25519KeyPair => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return {
    publicKey: Buffer.from(publicKey).toString('base64'),
    privateKey: Buffer.from(privateKey).toString('base64'),
  };
};

export const signData = (data: string | Uint8Array, privateKeyBase64: string): Result<string> => {
  try {
    const pem = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
    const privateKey = crypto.createPrivateKey({ key: pem, format: 'pem' });
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const signature = crypto.sign(null, buffer, privateKey);
    return ok(signature.toString('base64'));
  } catch (error) {
    return err(
      createAppError('CRYPTO_ERROR', 'Failed to sign data with Ed25519 key', undefined, error),
    );
  }
};

export const verifyData = (
  data: string | Uint8Array,
  signatureBase64: string,
  publicKeyBase64: string,
): boolean => {
  try {
    const pem = Buffer.from(publicKeyBase64, 'base64').toString('utf8');
    const publicKey = crypto.createPublicKey({ key: pem, format: 'pem' });
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const sigBuffer = Buffer.from(signatureBase64, 'base64');
    return crypto.verify(null, buffer, publicKey, sigBuffer);
  } catch {
    return false;
  }
};

export const generateChallenge = (bytes = 32): string => {
  return crypto.randomBytes(bytes).toString('hex');
};

// Delegation Access Token for Browser -> Direct Agent Access
export interface DelegationTokenPayload {
  readonly sub: string; // userId
  readonly nodeId: string;
  readonly permissions: readonly PermissionAction[];
  readonly exp: number; // unix timestamp in seconds
  readonly iat: number; // unix timestamp in seconds
}

export const issueDelegationToken = (options: {
  readonly masterPrivateKey: string;
  readonly userId: string;
  readonly nodeId: string;
  readonly permissions: readonly PermissionAction[];
  readonly ttlSeconds?: number;
}): Result<string> => {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (options.ttlSeconds ?? 120); // default 2 minutes

  const payload: DelegationTokenPayload = {
    sub: options.userId,
    nodeId: options.nodeId,
    permissions: options.permissions,
    iat,
    exp,
  };

  const header = { alg: 'EdDSA', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const sigResult = signData(unsignedToken, options.masterPrivateKey);
  if (!sigResult.ok) {
    return sigResult;
  }

  const base64urlSignature = Buffer.from(sigResult.value, 'base64').toString('base64url');
  return ok(`${unsignedToken}.${base64urlSignature}`);
};

export const verifyDelegationToken = (options: {
  readonly token: string;
  readonly masterPublicKey: string;
  readonly expectedNodeId?: string;
}): Result<DelegationTokenPayload> => {
  const parts = options.token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return err(createAppError('UNAUTHORIZED', 'Invalid delegation token format'));
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const unsignedToken = `${headerB64}.${payloadB64}`;
  const rawSignatureB64 = Buffer.from(signatureB64, 'base64url').toString('base64');

  const isValid = verifyData(unsignedToken, rawSignatureB64, options.masterPublicKey);
  if (!isValid) {
    return err(createAppError('UNAUTHORIZED', 'Invalid delegation token signature'));
  }

  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as DelegationTokenPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return err(createAppError('UNAUTHORIZED', 'Delegation token has expired'));
    }

    if (options.expectedNodeId && payload.nodeId !== options.expectedNodeId) {
      return err(createAppError('FORBIDDEN', 'Delegation token node mismatch'));
    }

    return ok(payload);
  } catch (error) {
    return err(
      createAppError('UNAUTHORIZED', 'Malformed delegation token payload', undefined, error),
    );
  }
};

export * from './totp.js';
export * from './aes.js';
