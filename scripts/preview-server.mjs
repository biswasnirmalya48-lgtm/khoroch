// Serves dist/ and the /api handler from one Node process, using a libSQL file database.
// Handy when wrangler dev is misbehaving, and for eyeballing the built UI.
// PREVIEW_LOGIN=1 signs requests in with a real session so the UI opens on the ledger
// instead of the passcode screen. This file is local tooling and never runs in production.
import http from 'node:http';
import { readFileSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createClient } from '@libsql/client';

// Wrangler reads .dev.vars itself; here the handler looks at process.env,
// so load the same file (plus the bare key file) before importing it.
function loadVars(file) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (value && !process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadVars('.dev.vars');
loadVars('.env');
if (!process.env.GROQ_API_KEY) {
  try {
    process.env.GROQ_API_KEY = readFileSync('.groq-key', 'utf8').trim();
  } catch {
    /* no key file */
  }
}

const { makeDb } = await import('../worker/db-libsql.js');
const { default: handler, setDb } = await import('../api/khoroch.js');
const { makeSession, sessionCookie } = await import('../worker/auth.js');

const dbFile = process.env.PREVIEW_DB || '.tmp/preview.db';
const port = Number(process.env.API_PORT) || 8791;

const client = createClient({ url: `file:${dbFile}` });
setDb(makeDb(client));

let previewCookie = null;
if (process.env.PREVIEW_LOGIN === '1') {
  const row = (await client.execute('SELECT id, session_secret FROM households LIMIT 1')).rows[0];
  if (row) {
    previewCookie = sessionCookie(await makeSession(row.session_secret, row.id)).split(';')[0];
    console.log('preview login: signing requests in');
  } else {
    console.log('preview login: no household in this database');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

const root = 'dist';

http
  .createServer((req, res) => {
    if (previewCookie) {
      const sent = req.headers.cookie || '';
      if (!sent.includes('kh_session=')) req.headers.cookie = `${sent ? `${sent}; ` : ''}${previewCookie}`;
    }

    if (req.url.startsWith('/api/')) {
      handler(req, res);
      return;
    }

    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = normalize(join(root, pathname));
    if (!file.startsWith(root)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');

    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`preview on http://127.0.0.1:${port} (db: ${dbFile})`);
  });
