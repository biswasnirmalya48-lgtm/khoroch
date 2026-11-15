// Vercel entrypoint. Static files are served by Vercel from dist/, this function
// only answers /api/*. Same worker code as the Cloudflare deployment, with libSQL
// standing in for D1.
import worker from '../worker/index.js';
import { createClient } from '@libsql/client/web';
import { makeDb } from '../worker/db-libsql.js';

let db = null;

export function setDb(instance) {
  db = instance;
}

function getDb() {
  if (db) return db;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set');
  db = makeDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined }));
  return db;
}

async function toWebRequest(req, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value !== undefined) headers.set(key, value);
  }

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    body = chunks.length ? Buffer.concat(chunks) : undefined;
  }

  return new Request(url, { method: req.method, headers, body });
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  if (!db && !process.env.TURSO_DATABASE_URL) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'No database yet. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel → Settings → Environment Variables.' }));
    return;
  }

  try {
    const request = await toWebRequest(req, url);
    const response = await worker.fetch(request, { ...process.env, DB: getDb() });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('vercel api failure', err && err.stack ? err.stack : err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
  }
}
