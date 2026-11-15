// Google OAuth 2.0 authorization-code flow, no dependencies.
// Only the id_token Google hands back over TLS is read, so no extra crypto library is needed:
// the token is received directly from Google in the server-to-server exchange below.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const STATE_COOKIE = 'kh_oauth_state';

export function googleConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(env, { redirectUri, state }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

function base64UrlDecode(value) {
  const s = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s.padEnd(Math.ceil(s.length / 4) * 4, '='));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function readIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Bad id token');
  return JSON.parse(base64UrlDecode(parts[1]));
}

export async function googleAccount(env, { code, redirectUri }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error('google token exchange failed', res.status, detail.slice(0, 300));
    throw new Error('Google rejected the sign-in.');
  }

  const data = await res.json();
  const claims = readIdToken(data.id_token);
  if (String(claims.aud) !== String(env.GOOGLE_CLIENT_ID)) throw new Error('Wrong Google audience.');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('Google email is not verified.');
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) throw new Error('Google did not return an email.');
  return { email, name: String(claims.name || ''), picture: String(claims.picture || '') };
}

export function allowedEmails(env) {
  return String(env.GOOGLE_ALLOWED_EMAILS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function emailAllowed(env, email) {
  const allowed = allowedEmails(env);
  return allowed.includes(String(email || '').trim().toLowerCase());
}

export function stateCookie(state) {
  return `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function clearedStateCookie() {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
