// End-to-end money check against the running API and the local database.
// Run the preview server first (npm run preview:node), then: npm run test:api
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { makeSession, sessionCookie } from '../worker/auth.js';

const DB_FILE = process.env.PREVIEW_DB || '.tmp/preview.db';
const BASE = process.env.API_BASE || 'http://127.0.0.1:8791';

const p = (value) => Math.round(Number(value || 0) * 100);
const sum = (list) => list.reduce((a, b) => a + b, 0);

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

const client = createClient({ url: `file:${DB_FILE}` });
const household = (await client.execute('SELECT * FROM households LIMIT 1')).rows[0];
if (!household) {
  console.error(`No household in ${DB_FILE}`);
  process.exit(1);
}
const memberRows = [...(await client.execute('SELECT id, name FROM members')).rows];
const expenses = (
  await client.execute('SELECT amount, method, spent_on, paid_by, split_with FROM expenses')
).rows.map((row) => {
  let split = [];
  try {
    split = JSON.parse(row.split_with || '[]');
  } catch {
    split = [];
  }
  return { ...row, split_with: Array.isArray(split) ? split : [] };
});

const cookie = `${sessionCookie(await makeSession(household.session_secret, household.id)).split(';')[0]}`;
const get = async (path) => {
  const response = await fetch(`${BASE}${path}`, { headers: { cookie } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} → ${response.status} ${JSON.stringify(body)}`);
  return body;
};

const months = [...new Set(expenses.map((e) => String(e.spent_on).slice(0, 7)))].sort();
if (!months.length) months.push(new Date().toISOString().slice(0, 7));

for (const month of months) {
  const direct = expenses.filter((e) => String(e.spent_on).slice(0, 7) === month);
  const directTotal = sum(direct.map((e) => e.amount));
  const flat = await get(`/api/summary?month=${month}`);

  check(`${month}: flat total matches the database`, () => {
    assert.equal(p(flat.summary.total), directTotal);
    assert.equal(flat.summary.count, direct.length);
  });

  check(`${month}: cash and online add up to the total`, () => {
    assert.equal(p(flat.summary.cash) + p(flat.summary.online), p(flat.summary.total));
    assert.equal(
      p(sum(flat.summary.paid.map((x) => x.amount))),
      p(flat.summary.total),
      'the amount credited to payers must equal the month total'
    );
    assert.equal(p(sum(flat.summary.byCategory.map((c) => c.amount))), p(flat.summary.total));
    assert.equal(p(sum(flat.summary.daily)), p(flat.summary.total));
  });

  check(`${month}: the flat ledger nets to zero`, () => {
    assert.equal(p(sum(flat.monthBalances.net.map((x) => x.amount))), 0);
    const owed = sum(flat.monthBalances.net.filter((x) => x.amount > 0).map((x) => p(x.amount)));
    const paidOut = sum(flat.monthBalances.settlements.map((x) => p(x.amount)));
    assert.equal(paidOut, owed, 'settlements must cover exactly what is owed');
  });

  for (const member of memberRows) {
    const data = await get(`/api/summary?month=${month}&viewer=${member.id}`);
    const viewer = data.summary.viewer || null;
    const monthNet = data.monthBalances.net.find((x) => x.id === member.id)?.amount;
    const directShare = direct.reduce((total, entry) => {
      const split = entry.split_with.filter((id) => id === member.id).length ? entry.split_with : [];
      const ids = [...new Set(entry.split_with)];
      if (ids.includes(member.id)) {
        const base = Math.floor(entry.amount / ids.length);
        const rest = entry.amount - base * ids.length;
        return total + base + (ids.indexOf(member.id) < rest ? 1 : 0);
      }
      if (!split.length) return total + (entry.paid_by === member.id ? entry.amount : 0);
      return total;
    }, 0);
    const directPaid = sum(direct.filter((e) => e.paid_by === member.id).map((e) => e.amount));

    check(`${month}: ${member.name} figures add up`, () => {
      assert.ok(viewer, 'viewer block missing');
      assert.equal(p(viewer.paid), directPaid, 'paid');
      assert.equal(p(viewer.share), directShare, 'share from the allocator');
      assert.equal(p(viewer.paid) - p(viewer.share), p(viewer.net), 'paid minus share');
      assert.equal(p(monthNet), p(viewer.net), 'month ledger must equal the viewer net');
      assert.equal(p(viewer.cash) + p(viewer.online), p(viewer.share));
      assert.equal(p(sum(viewer.byCategory.map((c) => c.amount))), p(viewer.share));
      assert.equal(p(sum(viewer.daily)), p(viewer.share));
      assert.equal(p(viewer.shared) + p(viewer.personal), p(viewer.share));
    });
  }

  const views = [];
  for (const member of memberRows) views.push(await get(`/api/summary?month=${month}&viewer=${member.id}`));
  check(`${month}: everybody's shares cover the month once`, () => {
    const shares = views.reduce((total, data) => total + p(data.summary.viewer?.share || 0), 0);
    const nets = views.reduce((total, data) => total + p(data.summary.viewer?.net || 0), 0);
    assert.equal(shares, p(flat.summary.total), 'sum of member shares');
    assert.equal(nets, 0, 'sum of member nets');
  });
}

const year = String(new Date().getFullYear());
const yearly = await get(`/api/year?year=${year}`);
check(`${year}: months roll up to the year`, () => {
  assert.equal(p(sum(yearly.year.months.map((m) => m.total))), p(yearly.year.total));
  assert.equal(p(sum(yearly.year.paid.map((x) => x.amount))), p(yearly.year.total));
  assert.equal(p(sum(yearly.year.byCategory.map((c) => c.amount))), p(yearly.year.total));
});

for (const member of memberRows) {
  const data = await get(`/api/year?year=${year}&viewer=${member.id}`);
  check(`${year}: ${member.name} year figures add up`, () => {
    const viewer = data.year.viewer;
    assert.ok(viewer, 'year viewer missing');
    assert.equal(p(sum(viewer.months.map((m) => m.share))), p(viewer.share), 'month shares');
    assert.equal(p(viewer.paid) - p(viewer.share), p(viewer.net), 'paid minus share');
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`\n✗ ${failure}`);
  process.exit(1);
}
console.log(`Live ledger checks out across ${months.join(', ')}.\n`);
