// End-to-end check of the Google callback against a real database, with Google's
// token endpoint stubbed so the success path can be exercised without a browser.
import { rmSync } from 'node:fs';
import http from 'node:http';
import { createClient } from '@libsql/client';
import { makeDb } from '../worker/db-libsql.js';
import worker from '../worker/index.js';

const DB_PATH = '.tmp/google-test.db';
rmSync(DB_PATH, { force: true });

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const ALLOWED = 'nirmalya@example.com';

const env = {
  DB: makeDb(createClient({ url: `file:${DB_PATH}` })),
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_ALLOWED_EMAILS: ALLOWED
};

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const idToken = (email) =>
  [b64url({ alg: 'RS256', typ: 'JWT' }), b64url({ aud: CLIENT_ID, email, email_verified: true, name: 'Test' }), 'sig'].join('.');

let emailOnSuccess = ALLOWED;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input).includes('oauth2.googleapis.com/token')) {
    return new Response(JSON.stringify({ id_token: idToken(emailOnSuccess) }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  return realFetch(input, init);
};

const BASE = 'https://khoroch.test';
const call = (path, options = {}) => worker.fetch(new Request(`${BASE}${path}`, options), env);

const cookiesOf = (res) =>
  typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. household
const setup = await call('/api/setup', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Google Test Flat', passcode: 'test1234', members: ['Nirmalya', 'Praloy'] })
});
check('setup household', setup.status === 200, `status ${setup.status}`);

// 2. start → state cookie
const start = await call('/api/auth/google/start');
const startCookies = cookiesOf(start);
const stateCookie = startCookies.find((c) => c.startsWith('kh_oauth_state='));
const state = stateCookie?.split(';')[0].split('=')[1] || '';
const location = start.headers.get('location') || '';
check('start redirects to Google', start.status === 303 && location.startsWith('https://accounts.google.com/'), `status ${start.status}`);
check('start sets state cookie', Boolean(state), `${stateCookie?.split(';')[0] || 'none'}`);
check('state cookie is HttpOnly', /HttpOnly/i.test(stateCookie || ''));
check('start sends exactly one Set-Cookie', startCookies.length === 1, `${startCookies.length} header(s)`);

// 3. callback → session + cleared state, as two headers
const callback = await call(`/api/auth/google/callback?code=good&state=${state}`, {
  headers: { cookie: `kh_oauth_state=${state}` }
});
const cbCookies = cookiesOf(callback);
const sessionCookie = cbCookies.find((c) => c.startsWith('kh_session='));
const session = sessionCookie?.split(';')[0].slice('kh_session='.length) || '';
check('callback redirects with google=ok', (callback.headers.get('location') || '').includes('google=ok'), callback.headers.get('location') || '');
check('callback sends two separate Set-Cookie headers', cbCookies.length === 2, `${cbCookies.length} header(s)`);
check('session cookie present', Boolean(session));
check('state cookie cleared', cbCookies.some((c) => c.startsWith('kh_oauth_state=;')));
check('session cookie is HttpOnly + Secure', /HttpOnly/i.test(sessionCookie || '') && /Secure/i.test(sessionCookie || ''));

// 4. that session really works
const me = await call('/api/me', { headers: { cookie: `kh_session=${session}` } });
const meBody = await me.json();
check('session authenticates /api/me', meBody.authed === true, JSON.stringify(meBody));

// 5. an unlisted Gmail is refused
emailOnSuccess = 'stranger@example.com';
const start2 = await call('/api/auth/google/start');
const state2 = cookiesOf(start2).find((c) => c.startsWith('kh_oauth_state='))?.split(';')[0].split('=')[1] || '';
const denied = await call(`/api/auth/google/callback?code=good&state=${state2}`, {
  headers: { cookie: `kh_oauth_state=${state2}` }
});
const deniedCookies = cookiesOf(denied);
check('stranger is refused', (denied.headers.get('location') || '').includes('google=notallowed'), denied.headers.get('location') || '');
check('no session issued to stranger', !deniedCookies.some((c) => c.startsWith('kh_session=')));

// 6. same flow through the Vercel handler, checking the raw HTTP headers.
// This is the layer that has to keep two Set-Cookie lines apart.
emailOnSuccess = ALLOWED;
const vDb = '.tmp/google-vercel.db';
rmSync(vDb, { force: true });
process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_ALLOWED_EMAILS = ALLOWED;
const { default: vercelHandler, setDb } = await import('../api/khoroch.js');
const { resetSchemaCache } = await import('../worker/db.js');
setDb(makeDb(createClient({ url: `file:${vDb}` })));
resetSchemaCache(); // the first phase already memoised schema setup for its own database

const server = http.createServer((req, res) => vercelHandler(req, res));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const raw = (path, headers = {}, method = 'GET', body) =>
  new Promise((resolve, reject) => {
    const req = http.request(`${origin}${path}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, raw: res.rawHeaders, body: data, location: res.headers.location }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

const vSetup = await raw('/api/setup', { 'content-type': 'application/json' }, 'POST', JSON.stringify({ name: 'Vercel Flat', passcode: 'test1234', members: ['Nirmalya'] }));
check('vercel: setup', vSetup.status === 200, `status ${vSetup.status}`);

const vStart = await raw('/api/auth/google/start');
const vStateCookie = (vStart.raw || []).filter((_, i, arr) => arr[i - 1]?.toLowerCase() === 'set-cookie')[0] || '';
const vState = vStateCookie.split(';')[0].split('=')[1] || '';
check('vercel: start sets state cookie', Boolean(vState));

const vCallback = await raw(`/api/auth/google/callback?code=good&state=${vState}`, { cookie: `kh_oauth_state=${vState}` });
const vCookieHeaders = (vCallback.raw || []).filter((v, i, arr) => arr[i - 1]?.toLowerCase() === 'set-cookie');
check(
  'vercel: two separate Set-Cookie lines',
  vCookieHeaders.length === 2,
  `${vCookieHeaders.length} line(s)`
);
const vSession = (vCookieHeaders.find((c) => c.startsWith('kh_session=')) || '').split(';')[0].slice('kh_session='.length);
check('vercel: session cookie readable', Boolean(vSession));
const vMe = await raw('/api/me', { cookie: `kh_session=${vSession}` });
check('vercel: session authenticates', JSON.parse(vMe.body || '{}').authed === true, vMe.body.slice(0, 80));
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
