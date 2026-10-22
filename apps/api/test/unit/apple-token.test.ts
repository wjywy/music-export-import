import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  verify as verifySignature,
} from 'node:crypto';
import {
  createDeveloperToken,
  decodeJwtPayload,
} from '../../src/apple/apple-token.service';

const keys = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

test('createDeveloperToken signs Apple ES256 claims with kid and team id', () => {
  const token = createDeveloperToken({
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    privateKey: keys.privateKey,
    now: 1_700_000_000,
    ttlSeconds: 3_600,
  });

  const [headerPart, payloadPart, signaturePart] = token.split('.');
  assert.equal(token.split('.').length, 3);
  const header = JSON.parse(
    Buffer.from(headerPart, 'base64url').toString('utf8'),
  ) as { alg: string; kid: string; typ: string };
  assert.deepEqual(header, {
    alg: 'ES256',
    kid: 'KEY1234567',
    typ: 'JWT',
  });

  const payload = decodeJwtPayload(token);
  assert.equal(payload?.iss, 'TEAM123456');
  assert.equal(payload?.iat, 1_700_000_000);
  assert.equal(payload?.exp, 1_700_003_600);

  const valid = verifySignature(
    'sha256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    { key: keys.publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signaturePart, 'base64url'),
  );
  assert.equal(valid, true);
});

test('createDeveloperToken clamps the lifetime to Apple limits', () => {
  const token = createDeveloperToken({
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    privateKey: keys.privateKey,
    now: 1_700_000_000,
    ttlSeconds: 99_999_999,
  });
  const payload = decodeJwtPayload(token);
  assert.equal(Number(payload?.exp) - Number(payload?.iat), 15_777_000);
});
