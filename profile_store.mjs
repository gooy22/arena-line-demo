import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { get, list, put } from '@vercel/blob';

const PRIMARY_DIR = process.env.PROFILE_DIR || '/data/profiles';
const FALLBACK_DIR = '/tmp/arena-line-profiles';
const BLOB_PREFIX = 'arena-line/profiles/';
const blobEtags = new Map();
const hasBlobCredentials = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN));
const useBlobStorage = () => process.env.ARENA_PROFILE_STORE === 'blob' || hasBlobCredentials();
const blobPath = email => BLOB_PREFIX + fileName(email);
const isAccountId = value => {
  const id = String(value || '');
  return /^[1-9]\\d{8}$/.test(id) && new Set(id).size === 9;
};
function createAccountId(used = new Set()) {
  for (let attempt = 0; attempt < 128; attempt++) {
    const digits = Array.from({length:10},(_,digit)=>String(digit));
    for (let index = digits.length - 1; index > 0; index--) {
      const other = randomInt(index + 1);
      [digits[index],digits[other]] = [digits[other],digits[index]];
    }
    const id = digits.slice(0,9).join('');
    if (id[0] !== '0' && new Set(id).size === 9 && !used.has(id)) return id;
  }
  throw new Error('Unable to allocate a unique 9-digit account ID');
}
async function collectAccountIds(excludeEmail = '') {
  const ids = new Set();
  const excludedPath = excludeEmail ? blobPath(excludeEmail) : '';
  if (useBlobStorage()) {
    let cursor;
    do {
      const page = await list({prefix:BLOB_PREFIX,limit:1000,...(cursor ? {cursor} : {})});
      for (const blob of page.blobs || []) {
        if (blob.pathname === excludedPath) continue;
        const result = await get(blob.pathname,{access:'private',useCache:false});
        if (!result || result.statusCode !== 200) throw new Error('Unable to verify existing account IDs');
        const profile = JSON.parse(await new Response(result.stream).text());
        if (profile?.id != null) ids.add(String(profile.id));
      }
      cursor = page.cursor;
    } while (page.hasMore && cursor);
    return ids;
  }
  const directory = await ensureDir();
  const names = await readdir(directory);
  const excludedName = excludeEmail ? fileName(excludeEmail) : '';
  for (const name of names) {
    if (!name.endsWith('.json') || name === excludedName) continue;
    try {
      const profile = JSON.parse(await readFile(directory + '/' + name,'utf8'));
      if (profile?.id != null) ids.add(String(profile.id));
    } catch {
      throw new Error('Unable to verify existing account IDs');
    }
  }
  return ids;
}

let directory = PRIMARY_DIR;
let readyPromise = null;
const locks = new Map();

const clone = value => JSON.parse(JSON.stringify(value));
const safeEmail = value => String(value || '').trim().toLowerCase();

function fileName(email) {
  return createHash('sha256').update(safeEmail(email)).digest('hex').slice(0,32) + '.json';
}

function safeEqual(a,b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && timingSafeEqual(aa,bb);
}

async function ensureDir() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    try {
      await mkdir(PRIMARY_DIR,{recursive:true,mode:0o700});
      directory = PRIMARY_DIR;
    } catch {
      await mkdir(FALLBACK_DIR,{recursive:true,mode:0o700});
      directory = FALLBACK_DIR;
    }
    return directory;
  })();
  return readyPromise;
}

async function pathFor(email) {
  await ensureDir();
  return directory + '/' + fileName(email);
}

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Invalid profile');
  const email = safeEmail(profile.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid profile email');
  if (!/^[a-f0-9]{64}$/i.test(String(profile.hash || ''))) throw new Error('Invalid profile credential');
  if (!Number.isSafeInteger(profile.balance) || profile.balance < 0 || profile.balance > 999999999999) throw new Error('Invalid profile balance');
  if (!Array.isArray(profile.payments) || profile.payments.length > 10000) throw new Error('Invalid payments');
  if (!Array.isArray(profile.bets) || profile.bets.length > 10000) throw new Error('Invalid bets');

  const raw = JSON.stringify(profile);
  if (Buffer.byteLength(raw) > 2_000_000) throw new Error('Profile is too large');

  const clean = clone(profile);
  clean.email = email;
  clean.id = String(clean.id || '').slice(0,80);
  clean.firstName = String(clean.firstName || '').slice(0,100);
  clean.lastName = String(clean.lastName || '').slice(0,100);
  clean.profileRevision = Math.max(0,Number(clean.profileRevision || 0));
  clean.updatedAt = new Date(clean.updatedAt || Date.now()).toISOString();
  return clean;
}

export async function readProfile(email) {
  const key = safeEmail(email);
  if (useBlobStorage()) {
    const result = await get(blobPath(key),{access:'private',useCache:false});
    if (!result || result.statusCode !== 200) {
      blobEtags.delete(key);
      return null;
    }
    blobEtags.set(key,String(result.blob?.etag || ''));
    return validateProfile(JSON.parse(await new Response(result.stream).text()));
  }

  const path = await pathFor(key);
  try {
    const value = JSON.parse(await readFile(path,'utf8'));
    return validateProfile(value);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(email, profile) {
  const key = safeEmail(email);
  if (useBlobStorage()) {
    const expectedEtag = blobEtags.get(key) || '';
    try {
      const result = await put(blobPath(key),JSON.stringify(profile,null,2),{
        access:'private',
        allowOverwrite:true,
        contentType:'application/json',
        cacheControlMaxAge:60,
        ...(expectedEtag ? {ifMatch:expectedEtag} : {})
      });
      blobEtags.set(key,String(result.etag || ''));
      return;
    } catch (error) {
      if (error?.name === 'BlobPreconditionFailedError' || error?.status === 412 || error?.statusCode === 412 || /precondition failed|etag mismatch/i.test(String(error?.message || error))) {
        const conflict = new Error('Profile conflict');
        conflict.statusCode = 409;
        conflict.profile = await readProfile(key).catch(() => null);
        throw conflict;
      }
      throw error;
    }
  }

  const path = await pathFor(key);
  const temp = path + '.tmp-' + process.pid + '-' + Date.now();
  await writeFile(temp,JSON.stringify(profile,null,2),{mode:0o600});
  await rename(temp,path);
}

function withLock(email, fn) {
  const key = safeEmail(email);
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn).finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  });
  locks.set(key,next);
  return next;
}

export async function loginProfile(email, hash) {
  return withLock(email,async () => {
    const profile = await readProfile(email);
    if (!profile || !safeEqual(profile.hash,hash)) return null;
    if (!isAccountId(profile.id)) {
      const used = await collectAccountIds(email);
      profile.id = createAccountId(used);
      profile.profileRevision = Math.max(0,Number(profile.profileRevision || 0)) + 1;
      profile.updatedAt = new Date().toISOString();
      await atomicWrite(email,profile);
    }
    return profile;
  });
}

export async function syncProfile(incoming, bearerHash) {
  const clean = validateProfile(incoming);
  if (!safeEqual(clean.hash,bearerHash)) {
    const error = new Error('Unauthorized');
    error.statusCode = 401;
    throw error;
  }

  return withLock(clean.email,async () => {
    const current = await readProfile(clean.email);
    if (current && !safeEqual(current.hash,bearerHash)) {
      const error = new Error('Unauthorized');
      error.statusCode = 401;
      throw error;
    }

    if (current) {
      if (!isAccountId(current.id)) {
        const used = await collectAccountIds(clean.email);
        current.id = createAccountId(used);
        current.profileRevision = Math.max(0,Number(current.profileRevision || 0)) + 1;
        current.updatedAt = new Date().toISOString();
        await atomicWrite(clean.email,current);
      }
      const currentRevision = Number(current.profileRevision || 0);
      const incomingRevision = Number(clean.profileRevision || 0);
      if (currentRevision > incomingRevision) {
        const error = new Error('Profile conflict');
        error.statusCode = 409;
        error.profile = current;
        throw error;
      }
      clean.id = current.id;
      clean.profileRevision = Math.max(currentRevision,incomingRevision) + 1;
    } else {
      const used = await collectAccountIds();
      if (!isAccountId(clean.id) || used.has(clean.id)) clean.id = createAccountId(used);
      clean.profileRevision = Math.max(1,Number(clean.profileRevision || 0));
    }

    clean.updatedAt = new Date().toISOString();
    await atomicWrite(clean.email,clean);
    return clean;
  });
}

export async function profileStorageStatus() {
  if (useBlobStorage()) {
    if (!hasBlobCredentials()) {
      return {directory:'vercel-blob:profiles',persistent:false,backend:'vercel-blob',error:'Vercel Blob credentials missing'};
    }
    try {
      await get('arena-line/health-probe.json',{access:'private',useCache:false});
      return {directory:'vercel-blob:profiles',persistent:true,backend:'vercel-blob'};
    } catch (error) {
      return {
        directory:'vercel-blob:profiles',
        persistent:false,
        backend:'vercel-blob',
        error:String(error?.message || error).slice(0,200)
      };
    }
  }
  await ensureDir();
  let persistent = false;
  try {
    const mounts = await readFile('/proc/mounts','utf8');
    persistent = mounts.split('\n').some(line => line.split(' ')[1] === '/data');
  } catch {}
  return {directory,persistent,backend:'filesystem'};
}


export async function changeProfilePassword(email, oldHash, newHash) {
  email = safeEmail(email);
  if (!/^[a-f0-9]{64}$/i.test(String(oldHash || '')) || !/^[a-f0-9]{64}$/i.test(String(newHash || ''))) {
    const error = new Error('Invalid credential');
    error.statusCode = 400;
    throw error;
  }
  return withLock(email, async () => {
    const current = await readProfile(email);
    if (!current) return null;
    if (!safeEqual(current.hash,oldHash)) {
      const error = new Error('Unauthorized');
      error.statusCode = 401;
      throw error;
    }
    current.hash = newHash;
    current.profileRevision = Math.max(0,Number(current.profileRevision || 0)) + 1;
    current.updatedAt = new Date().toISOString();
    await atomicWrite(email,current);
    return current;
  });
}
