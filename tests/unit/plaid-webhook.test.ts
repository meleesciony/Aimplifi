/**
 * Plaid webhook JWT verification (ROADMAP #1c). Tests the verification logic with
 * a real ES256 keypair and signed tokens — no Plaid credentials needed. Covers the
 * happy path and every rejection (wrong key, tampered body, stale, no key, missing).
 */
import { describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { sha256Hex, verifyPlaidWebhook } from '@/lib/plaid-webhook';

const BODY = JSON.stringify({ webhook_type: 'TRANSACTIONS', item_id: 'item-1' });

async function setup() {
  const signer = await generateKeyPair('ES256', { extractable: true });
  const other = await generateKeyPair('ES256', { extractable: true });
  const signerPubJwk = await exportJWK(signer.publicKey);
  const otherPubJwk = await exportJWK(other.publicKey);

  async function sign(opts: { body?: string; iatMs?: number; kid?: string } = {}) {
    const body = opts.body ?? BODY;
    const iatSec = Math.floor((opts.iatMs ?? Date.now()) / 1000);
    return new SignJWT({ request_body_sha256: sha256Hex(body) })
      .setProtectedHeader({ alg: 'ES256', kid: opts.kid ?? 'kid-1' })
      .setIssuedAt(iatSec)
      .sign(signer.privateKey);
  }
  const getKey = (jwk: JWK | null) => async () => jwk;
  return { sign, signerPubJwk, otherPubJwk, getKey };
}

describe('verifyPlaidWebhook', () => {
  it('accepts a correctly-signed, fresh token with a matching body hash', async () => {
    const { sign, signerPubJwk, getKey } = await setup();
    const token = await sign();
    expect(await verifyPlaidWebhook({ token, rawBody: BODY, getKey: getKey(signerPubJwk) })).toEqual({ ok: true });
  });

  it('rejects a token signed by a different key (bad signature)', async () => {
    const { sign, otherPubJwk, getKey } = await setup();
    const token = await sign();
    const r = await verifyPlaidWebhook({ token, rawBody: BODY, getKey: getKey(otherPubJwk) });
    expect(r).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects when the body was tampered with after signing', async () => {
    const { sign, signerPubJwk, getKey } = await setup();
    const token = await sign(); // signed for BODY
    const r = await verifyPlaidWebhook({ token, rawBody: BODY + ' ', getKey: getKey(signerPubJwk) });
    expect(r).toEqual({ ok: false, reason: 'body-mismatch' });
  });

  it('rejects a stale token (replay outside the freshness window)', async () => {
    const { sign, signerPubJwk, getKey } = await setup();
    const token = await sign({ iatMs: Date.now() - 10 * 60_000 }); // 10 min old
    const r = await verifyPlaidWebhook({ token, rawBody: BODY, getKey: getKey(signerPubJwk), maxAgeMs: 5 * 60_000 });
    expect(r).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects when the key cannot be resolved', async () => {
    const { sign, getKey } = await setup();
    const token = await sign();
    expect(await verifyPlaidWebhook({ token, rawBody: BODY, getKey: getKey(null) })).toEqual({ ok: false, reason: 'no-key' });
  });

  it('rejects a missing token', async () => {
    const { getKey, signerPubJwk } = await setup();
    expect(await verifyPlaidWebhook({ token: '', rawBody: BODY, getKey: getKey(signerPubJwk) })).toEqual({ ok: false, reason: 'missing-token' });
  });
});
