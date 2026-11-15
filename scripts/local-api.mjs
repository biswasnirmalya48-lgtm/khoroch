// Runs the Vercel function locally against a real libSQL file database, so the
// database adapter and every route can be exercised without Turso or Vercel.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { makeDb } from '../worker/db-libsql.js';
import handler, { setDb } from '../api/khoroch.js';

const dbUrl = process.env.LOCAL_DB_URL || 'file:.tmp/khoroch-local.db';
setDb(makeDb(createClient({ url: dbUrl })));

try {
  const vars = readFileSync('.dev.vars', 'utf8');
  for (const line of vars.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  /* no local secrets */
}

const port = Number(process.env.API_PORT) || 8790;
http.createServer((req, res) => handler(req, res)).listen(port, '127.0.0.1', () => {
  console.log(`local api on http://127.0.0.1:${port} (db: ${dbUrl})`);
});
