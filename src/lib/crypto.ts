/**
 * AES-256-GCM encryption for provider access tokens at rest (Phase 4).
 * Key: 32 bytes, base64, from DATA_ENCRYPTION_KEY. Output format:
 * base64(iv).base64(ciphertext).base64(authTag). Never log tokens.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function loadKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error('DATA_ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function encryptToken(plaintext: string, key: Buffer = loadKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${ciphertext.toString('base64')}.${tag.toString('base64')}`;
}

export function decryptToken(encrypted: string, key: Buffer = loadKey()): string {
  const [ivB64, dataB64, tagB64] = encrypted.split('.');
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('Malformed encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
