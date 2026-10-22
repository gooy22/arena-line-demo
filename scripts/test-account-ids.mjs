import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = await mkdtemp(join(tmpdir(),'arena-line-account-id-'));
process.env.PROFILE_DIR = directory;
process.env.ARENA_PROFILE_STORE = 'filesystem';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;
delete process.env.VERCEL_OIDC_TOKEN;

const { syncProfile, loginProfile } = await import('../profile_store.mjs');
const validId = value => /^[1-9]\d{8}$/.test(String(value || '')) && new Set(String(value)).size === 9;
const baseProfile = (email,hash,id,profileRevision=0) => ({
  id,email,hash,balance:0,payments:[],bets:[],profileRevision,updatedAt:new Date().toISOString()
});
const fileName = email => createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0,32) + '.json';

try {
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);
  const first = await syncProfile(baseProfile('first@example.invalid',hashA,'AL100001'),hashA);
  assert.ok(validId(first.id),'legacy IDs must be replaced with nine distinct digits');

  const updated = await syncProfile({...first,profileRevision:first.profileRevision + 1},hashA);
  assert.equal(updated.id,first.id,'the account ID must remain stable after profile sync');

  const second = await syncProfile(baseProfile('second@example.invalid',hashB,first.id),hashB);
  assert.ok(validId(second.id),'new accounts must receive nine distinct digits');
  assert.notEqual(second.id,first.id,'the server must reject an already-used ID');

  const legacyEmail = 'legacy@example.invalid';
  const legacyHash = 'c'.repeat(64);
  const legacy = baseProfile(legacyEmail,legacyHash,'AL100001',7);
  await writeFile(join(directory,fileName(legacyEmail)),JSON.stringify(legacy),'utf8');

  const migrated = await loginProfile(legacyEmail,legacyHash);
  assert.ok(validId(migrated.id),'legacy profiles must be migrated at login');
  assert.notEqual(migrated.id,first.id,'legacy migration must not reuse another account ID');
  const loggedInAgain = await loginProfile(legacyEmail,legacyHash);
  assert.equal(loggedInAgain.id,migrated.id,'the migrated ID must remain stable after login');

  console.log('PASS: 9-digit unique-digit IDs, server-side uniqueness, legacy migration, and stable persistence');
} finally {
  await rm(directory,{recursive:true,force:true});
}
