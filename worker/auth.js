const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_COOKIE = 'kh_session';

export function toB64url(bytes) {
  const arr = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i += 1) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s.padEnd(Math.ceil(s.length / 4) * 4, '='));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Cloudflare's WebCrypto refuses PBKDF2 above 100,000 iterations ("Pbkdf2 failed:
// iteration counts above 100000 are not supported"), which used to throw during setup
// and sign-in on the deployed worker. Stay at the ceiling the edge accepts and record
// the count in the stored value so older hashes can still be read.
const MAX_ITERATIONS = 100000;
const LEGACY_ITERATIONS = 150000; // what earlier builds wrote
const PREFIX = 'pbkdf2';

async function derive(passcode, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toB64url(bits);
}

export async function hashPasscode(passcode, saltB64) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(passcode, salt, MAX_ITERATIONS);
  return { hash: `${PREFIX}$${MAX_ITERATIONS}$${hash}`, salt: toB64url(salt) };
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Accept both the versioned form (pbkdf2$100000$<hash>) and hashes written by older
// builds. A runtime that refuses an iteration count just skips that candidate.
function candidatesFor(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length === 3 && parts[0] === PREFIX && Number(parts[1]) > 0) {
    return [{ iterations: Number(parts[1]), hash: parts[2] }];
  }
  return [
    { iterations: MAX_ITERATIONS, hash: stored },
    { iterations: LEGACY_ITERATIONS, hash: stored }
  ];
}

export async function verifyPasscode(passcode, stored, salt) {
  if (!stored || !salt) return false;
  const parsedSalt = fromB64url(salt);
  for (const candidate of candidatesFor(stored)) {
    let computed;
    try {
      computed = await derive(passcode, parsedSalt, candidate.iterations);
    } catch {
      continue;
    }
    if (constantTimeEqual(computed, candidate.hash)) return true;
  }
  return false;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toB64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function makeSession(secret, householdId) {
  const payload = toB64url(
    enc.encode(JSON.stringify({ h: householdId, exp: Date.now() + 60 * 24 * 3600 * 1000 }))
  );
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function readSession(request, secret) {
  const header = request.headers.get('cookie') || '';
  const match = header.match(/(?:^|;\s*)kh_session=([^;]+)/);
  if (!match) return null;
  const [payload, sig] = match[1].split('.');
  if (!payload || !sig) return null;
  if ((await hmac(secret, payload)) !== sig) return null;
  try {
    const data = JSON.parse(dec.decode(fromB64url(payload)));
    if (!data || !data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 60}`;
}

export function clearedCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
