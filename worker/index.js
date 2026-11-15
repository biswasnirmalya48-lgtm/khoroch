import { ensureSchema } from './db.js';
import { hashPasscode, verifyPasscode, makeSession, readSession, sessionCookie, clearedCookie } from './auth.js';
import { aiConfigured, aiParse, aiInsight } from './ai.js';
import { monthSummary, yearData, balances, toCsv, todayISO, rs } from './report.js';

const viewerOf = (value, members) => resolveMember(value, members)?.id || null;

const CATEGORIES = ['Food', 'Groceries', 'Rent', 'Bills', 'Transport', 'Shopping', 'Health', 'Fun', 'Recharge', 'Other'];
const MAX_MEMBERS = 8;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });

const bad = (message, status = 400) => json({ error: message }, status);
const uid = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();
const safeArray = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const rate = new Map();
function allow(key, limit, windowMs) {
  const stamp = Date.now();
  const hits = (rate.get(key) || []).filter((t) => stamp - t < windowMs);
  if (hits.length >= limit) return false;
  hits.push(stamp);
  rate.set(key, hits);
  return true;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function loadHousehold(db) {
  return db.prepare('SELECT * FROM households LIMIT 1').first();
}

async function loadMembers(db, householdId) {
  const rows = await db.prepare('SELECT id, name FROM members WHERE household_id = ? ORDER BY created_at').bind(householdId).all();
  return rows.results || [];
}

async function loadExpenses(db, householdId) {
  const rows = await db
    .prepare('SELECT * FROM expenses WHERE household_id = ? ORDER BY spent_on DESC, created_at DESC')
    .bind(householdId)
    .all();
  return (rows.results || []).map((row) => ({ ...row, split_with: safeArray(row.split_with) }));
}

function resolveMember(value, members) {
  if (!value) return null;
  const raw = String(value).trim();
  const direct = members.find((m) => m.id === raw);
  if (direct) return direct;
  const lower = raw.toLowerCase();
  return members.find((m) => m.name.toLowerCase() === lower) || null;
}

function normalizeItem(raw, members, fallbackDate) {
  if (!raw || typeof raw !== 'object') return null;
  const amountPaise = Math.round(Number(raw.amount) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0 || amountPaise > 10000000000) return null;

  const category = CATEGORIES.includes(raw.category) ? raw.category : 'Other';
  const method = String(raw.method || '').toLowerCase() === 'cash' ? 'cash' : 'online';
  const note = String(raw.note || '').trim().slice(0, 120);
  const spentOn = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.spent_on || '')) ? raw.spent_on : fallbackDate;

  const payer = resolveMember(raw.paid_by, members);
  const splitSource = Array.isArray(raw.split_with) ? raw.split_with : [];
  const split = [...new Set(splitSource.map((v) => resolveMember(v, members)?.id).filter(Boolean))];

  return {
    id: uid(),
    amount: amountPaise,
    category,
    method,
    note,
    spent_on: spentOn,
    paid_by: payer?.id || members[0]?.id || null,
    split_with: split,
    created_at: nowISO()
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (!env.ASSETS) return new Response('Not found', { status: 404 });
      return env.ASSETS.fetch(request);
    }
    try {
      if (!env.DB) return bad('The database is not connected yet.', 500);
      await ensureSchema(env.DB);
      return await route(request, env, url);
    } catch (err) {
      console.error('api failure', err && err.stack ? err.stack : err);
      if (err && err.status) return bad(err.message || 'Request failed.', err.status);
      return bad('Something went wrong on the server.', 500);
    }
  }
};

async function route(request, env, url) {
  const db = env.DB;
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, '') || '/api';

  // ---------- public ----------
  if (path === '/api/me' && method === 'GET') {
    const household = await loadHousehold(db);
    if (!household) return json({ setup: false });
    const session = await readSession(request, household.session_secret);
    if (!session || session.h !== household.id) return json({ setup: true, authed: false });
    const members = await loadMembers(db, household.id);
    return json({
      setup: true,
      authed: true,
      household: { id: household.id, name: household.name, currency: household.currency },
      members
    });
  }

  if (path === '/api/setup' && method === 'POST') {
    const existing = await loadHousehold(db);
    if (existing) return bad('This flat already has a ledger. Sign in instead.', 409);

    const body = await readJson(request);
    const name = String(body?.name || '').trim().slice(0, 60) || 'Our flat';
    const passcode = String(body?.passcode || '');
    const rawMembers = Array.isArray(body?.members) ? body.members : [];
    const memberNames = [...new Set(rawMembers.map((m) => String(m || '').trim()).filter(Boolean))].slice(0, MAX_MEMBERS);

    if (passcode.length < 4) return bad('Use a passcode with at least 4 characters.');
    if (passcode.length > 128) return bad('That passcode is too long.');
    if (memberNames.length < 1) return bad('Add at least one person.');

    const { hash, salt } = await hashPasscode(passcode);
    const householdId = uid();
    const secret = crypto.randomUUID() + crypto.randomUUID();
    const createdAt = nowISO();

    await db
      .prepare('INSERT INTO households (id, name, passcode_hash, passcode_salt, session_secret, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(householdId, name, hash, salt, secret, '₹', createdAt)
      .run();

    for (const memberName of memberNames) {
      await db
        .prepare('INSERT INTO members (id, household_id, name, created_at) VALUES (?, ?, ?, ?)')
        .bind(uid(), householdId, memberName.slice(0, 40), nowISO())
        .run();
    }

    const token = await makeSession(secret, householdId);
    const members = await loadMembers(db, householdId);
    return json(
      {
        setup: true,
        authed: true,
        household: { id: householdId, name, currency: '₹' },
        members
      },
      200,
      { 'set-cookie': sessionCookie(token) }
    );
  }

  if (path === '/api/login' && method === 'POST') {
    const household = await loadHousehold(db);
    if (!household) return bad('No ledger here yet. Set it up first.', 409);
    if (!allow(`login:${request.headers.get('cf-connecting-ip') || 'local'}`, 12, 10 * 60 * 1000)) {
      return bad('Too many attempts. Wait a few minutes.', 429);
    }
    const body = await readJson(request);
    const passcode = String(body?.passcode || '');
    const ok = await verifyPasscode(passcode, household.passcode_hash, household.passcode_salt);
    if (!ok) return bad('That passcode is not right.', 401);

    const token = await makeSession(household.session_secret, household.id);
    const members = await loadMembers(db, household.id);
    return json(
      {
        setup: true,
        authed: true,
        household: { id: household.id, name: household.name, currency: household.currency },
        members
      },
      200,
      { 'set-cookie': sessionCookie(token) }
    );
  }

  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearedCookie() });
  }

  // ---------- authenticated ----------
  const household = await loadHousehold(db);
  if (!household) return bad('Not set up yet.', 409);
  const session = await readSession(request, household.session_secret);
  if (!session || session.h !== household.id) return bad('Please sign in.', 401);
  const members = await loadMembers(db, household.id);

  if (path === '/api/config' && method === 'GET') {
    return json({ ai: aiConfigured(env), model: env.GROQ_MODEL || 'openai/gpt-oss-120b', today: todayISO() });
  }

  if (path === '/api/members' && method === 'POST') {
    const body = await readJson(request);
    const name = String(body?.name || '').trim().slice(0, 40);
    if (!name) return bad('Give the person a name.');
    if (members.length >= MAX_MEMBERS) return bad(`A flat can have at most ${MAX_MEMBERS} people here.`);
    if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) return bad('That name already exists.');
    const id = uid();
    await db.prepare('INSERT INTO members (id, household_id, name, created_at) VALUES (?, ?, ?, ?)').bind(id, household.id, name, nowISO()).run();
    return json({ id, name });
  }

  if (path.startsWith('/api/members/') && method === 'DELETE') {
    const id = path.split('/').pop();
    const remaining = members.filter((m) => m.id !== id);
    if (remaining.length === members.length) return bad('No such person.', 404);
    if (remaining.length === 0) return bad('Keep at least one person.');
    await db.prepare('DELETE FROM members WHERE id = ? AND household_id = ?').bind(id, household.id).run();
    await db
      .prepare("UPDATE expenses SET split_with = '[]' WHERE household_id = ? AND paid_by = ?")
      .bind(household.id, id)
      .run();
    const rows = await db.prepare('SELECT id, split_with FROM expenses WHERE household_id = ?').bind(household.id).all();
    for (const row of rows.results || []) {
      const current = safeArray(row.split_with);
      if (!current.includes(id)) continue;
      await db
        .prepare('UPDATE expenses SET split_with = ? WHERE id = ?')
        .bind(JSON.stringify(current.filter((x) => x !== id)), row.id)
        .run();
    }
    return json({ ok: true });
  }

  if (path === '/api/summary' && method === 'GET') {
    const month = (url.searchParams.get('month') || todayISO().slice(0, 7)).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return bad('Month must look like 2026-11.');
    const viewer = viewerOf(url.searchParams.get('viewer'), members);
    const expenses = await loadExpenses(db, household.id);
    return json({
      viewer,
      summary: monthSummary(expenses, month, members, viewer),
      balances: balances(expenses, members),
      expenses: expenses.filter((e) => (e.spent_on || '').slice(0, 7) === month).slice(0, 400).map(serialize),
      members,
      ai: aiConfigured(env)
    });
  }

  if (path === '/api/year' && method === 'GET') {
    const year = (url.searchParams.get('year') || todayISO().slice(0, 4)).slice(0, 4);
    if (!/^\d{4}$/.test(year)) return bad('Year must look like 2026.');
    const viewer = viewerOf(url.searchParams.get('viewer'), members);
    const expenses = await loadExpenses(db, household.id);
    return json({ viewer, year: yearData(expenses, year, members, viewer) });
  }

  if (path === '/api/expenses' && method === 'POST') {
    const body = await readJson(request);
    const rawItems = Array.isArray(body?.items) ? body.items : body ? [body] : [];
    if (!rawItems.length) return bad('Nothing to save.');
    if (rawItems.length > 50) return bad('Add at most 50 entries at once.');
    if (!allow(`write:${household.id}`, 120, 60 * 1000)) return bad('Slow down a little.', 429);

    const items = rawItems.map((item) => normalizeItem(item, members, todayISO())).filter(Boolean);
    if (!items.length) return bad('Every entry needs a positive amount.');

    for (const item of items) {
      await db
        .prepare(
          'INSERT INTO expenses (id, household_id, amount, category, method, note, spent_on, paid_by, split_with, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(item.id, household.id, item.amount, item.category, item.method, item.note, item.spent_on, item.paid_by, JSON.stringify(item.split_with), item.created_at)
        .run();
    }
    return json({ added: items.length });
  }

  if (path.startsWith('/api/expenses/') && (method === 'PATCH' || method === 'DELETE')) {
    const id = path.split('/').pop();
    const existing = await db.prepare('SELECT * FROM expenses WHERE id = ? AND household_id = ?').bind(id, household.id).first();
    if (!existing) return bad('No such entry.', 404);

    if (method === 'DELETE') {
      await db.prepare('DELETE FROM expenses WHERE id = ? AND household_id = ?').bind(id, household.id).run();
      return json({ ok: true });
    }

    const body = await readJson(request);
    const merged = normalizeItem(
      {
        amount: body?.amount ?? rs(existing.amount),
        category: body?.category ?? existing.category,
        method: body?.method ?? existing.method,
        note: body?.note ?? existing.note,
        spent_on: body?.spent_on ?? existing.spent_on,
        paid_by: body?.paid_by ?? existing.paid_by,
        split_with: body?.split_with ?? safeArray(existing.split_with)
      },
      members,
      existing.spent_on
    );
    if (!merged) return bad('That change is not valid.');

    await db
      .prepare('UPDATE expenses SET amount = ?, category = ?, method = ?, note = ?, spent_on = ?, paid_by = ?, split_with = ? WHERE id = ? AND household_id = ?')
      .bind(merged.amount, merged.category, merged.method, merged.note, merged.spent_on, merged.paid_by, JSON.stringify(merged.split_with), id, household.id)
      .run();
    return json({ ok: true });
  }

  if (path === '/api/export' && method === 'GET') {
    const year = url.searchParams.get('year');
    const expenses = await loadExpenses(db, household.id);
    const rows = year && /^\d{4}$/.test(year) ? expenses.filter((e) => e.spent_on.startsWith(year)) : expenses;
    return new Response(toCsv(rows, members), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="khoroch-${year || 'all'}.csv"`,
        'cache-control': 'no-store'
      }
    });
  }

  if (path === '/api/ai/parse' && method === 'POST') {
    if (!aiConfigured(env)) return bad('AI is not configured. Add the GROQ_API_KEY secret to switch it on.', 503);
    if (!allow(`ai:${household.id}`, 40, 60 * 60 * 1000)) return bad('AI is busy — try again in a bit.', 429);
    const body = await readJson(request);
    const text = String(body?.text || '').trim();
    if (text.length < 3) return bad('Type what you spent first.');
    if (text.length > 700) return bad('Keep the note under 700 characters.');
    const items = await aiParse(env, { text, members, today: todayISO() });
    return json({ items });
  }

  if (path === '/api/ai/insight' && method === 'POST') {
    if (!aiConfigured(env)) return bad('AI is not configured. Add the GROQ_API_KEY secret to switch it on.', 503);
    if (!allow(`insight:${household.id}`, 12, 60 * 60 * 1000)) return bad('You have asked for a lot of insights — try later.', 429);
    const body = await readJson(request);
    const month = String(body?.month || todayISO().slice(0, 7)).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return bad('Month must look like 2026-11.');
    const viewer = viewerOf(body?.viewer, members);
    const expenses = await loadExpenses(db, household.id);
    const summary = monthSummary(expenses, month, members, viewer);
    const previousMonth = shiftMonth(month, -1);
    const previousSummary = monthSummary(expenses, previousMonth, members, viewer);
    const insight = await aiInsight(env, {
      summary,
      members,
      previous: previousSummary.count ? (viewer ? previousSummary.viewer?.share : previousSummary.total) : null,
      householdName: household.name
    });
    return json(insight);
  }

  return bad('Not found.', 404);
}

function serialize(row) {
  return {
    id: row.id,
    amount: rs(row.amount),
    category: row.category,
    method: row.method,
    note: row.note,
    spent_on: row.spent_on,
    paid_by: row.paid_by,
    split_with: row.split_with
  };
}

function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, mon - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
