// Money invariants for Khoroch. Run with: npm run test:money
// Every figure the app prints has to come from these rules, so this file checks the
// rules rather than a handful of spot numbers.
import assert from 'node:assert/strict';
import { allocate, ledger, settle, sharesOf, splitIds, toPaise } from '../worker/money.js';
import { balances, monthBalances, monthSummary, rs, todayISO, toCsv, yearData } from '../worker/report.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

const PAISE = (rupees) => Math.round(rupees * 100);
const sum = (list) => list.reduce((s, n) => s + n, 0);

// ------------------------------------------------------------------ fixtures

const MEMBERS = [
  { id: 'anshu', name: 'anshu' },
  { id: 'bhomla', name: 'bhomla' },
  { id: 'nirmalya', name: 'nirmalya' },
  { id: 'praloy', name: 'praloy' }
];
const ALL = MEMBERS.map((m) => m.id);

let seq = 0;
function entry(rupees, options = {}) {
  seq += 1;
  const {
    paid = 'anshu',
    split = ALL,
    month = '2026-11',
    day = '16',
    method = 'online',
    category = 'Other'
  } = options;
  return {
    id: `e${seq}`,
    amount: PAISE(rupees),
    category,
    method,
    note: '',
    spent_on: `${month}-${String(day).padStart(2, '0')}`,
    paid_by: paid,
    split_with: split
  };
}

// Deterministic pseudo random so a failure always reproduces.
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------- allocation

test('allocate splits a bill into shares that add back to the bill', () => {
  const shares = allocate(34300, ['anshu', 'bhomla', 'praloy']);
  assert.deepEqual([...shares.values()], [11434, 11433, 11433]);
  assert.equal(sum([...shares.values()]), 34300);
});

test('allocate handles a single person, zero, and one paisa', () => {
  assert.deepEqual([...allocate(5000, ['anshu']).values()], [5000]);
  assert.deepEqual([...allocate(0, ALL).values()], [0, 0, 0, 0]);
  assert.equal(sum([...allocate(1, ALL).values()]), 1);
  assert.equal(sum([...allocate(3, ALL).values()]), 3);
});

test('no two shares differ by more than one paisa, over 500 random bills', () => {
  const random = rng(20261116);
  for (let i = 0; i < 500; i += 1) {
    const people = ALL.slice(0, 1 + Math.floor(random() * 4));
    const amount = 1 + Math.floor(random() * 500000);
    const shares = [...allocate(amount, people).values()];
    assert.equal(sum(shares), amount, `amount ${amount} across ${people.length}`);
    assert.ok(Math.max(...shares) - Math.min(...shares) <= 1, `uneven spread for ${amount}`);
    assert.ok(shares.every((s) => s >= 0), 'negative share');
  }
});

test('split participants are de-duplicated and limited to real members', () => {
  assert.deepEqual(splitIds({ split_with: ['anshu', 'anshu', 'ghost', null] }, MEMBERS.map((m) => m.id)), ['anshu']);
});

test('an entry with no split list is personal to the payer', () => {
  const personal = entry(250, { paid: 'praloy', split: [] });
  assert.equal(sharesOf(personal, ALL).get('praloy'), 25000);
  assert.equal(sharesOf(personal, ALL).get('anshu'), undefined);
});

test('an entry paid by someone outside the flat carries no shares', () => {
  assert.equal(sharesOf(entry(100, { paid: 'ghost', split: [] }), ALL).size, 0);
});

test('toPaise keeps whole paise only', () => {
  assert.equal(toPaise('250'), 250);
  assert.equal(toPaise(1234.6), 1235);
  assert.equal(toPaise(-5), 0);
  assert.equal(toPaise(undefined), 0);
  assert.equal(toPaise(Number.NaN), 0);
});

// ------------------------------------------------------------- who owes whom

function checkLedgerBalances(expenses, members) {
  const { net } = ledger(expenses, members);
  assert.equal(sum([...net.values()]), 0, 'the flat ledger must sum to zero');

  for (const member of members) {
    const paid = expenses.filter((e) => e.paid_by === member.id).reduce((s, e) => s + e.amount, 0);
    const ids = new Set(members.map((m) => m.id));
    const share = expenses.reduce((s, e) => s + (sharesOf(e, ids).get(member.id) || 0), 0);
    assert.equal(net.get(member.id), paid - share, `net for ${member.name} must equal paid minus share`);
  }
  return net;
}

test('per person net equals paid minus share and the flat nets to zero', () => {
  const expenses = [
    entry(343, { paid: 'anshu' }),
    entry(232, { paid: 'praloy' }),
    entry(1200, { paid: 'nirmalya', category: 'Rent' }),
    entry(90, { paid: 'bhomla', method: 'cash', split: ['bhomla', 'anshu'] }),
    entry(500, { paid: 'anshu', split: [] })
  ];
  checkLedgerBalances(expenses, MEMBERS);
});

test('random ledgers still net to zero', () => {
  const random = rng(7);
  for (let round = 0; round < 120; round += 1) {
    const size = 1 + Math.floor(random() * 20);
    const expenses = [];
    for (let i = 0; i < size; i += 1) {
      const paid = ALL[Math.floor(random() * ALL.length)];
      const people = ALL.filter(() => random() > 0.35);
      expenses.push(
        entry(1 + Math.floor(random() * 4000), {
          paid,
          split: random() > 0.2 ? (people.length ? people : ALL) : [],
          method: random() > 0.5 ? 'cash' : 'online'
        })
      );
    }
    checkLedgerBalances(expenses, MEMBERS);
  }
});

test('expenses paid by a removed person are reported, not silently counted', () => {
  const expenses = [entry(100, { paid: 'anshu' }), entry(300, { paid: 'gone' })];
  const result = balances(expenses, MEMBERS);
  assert.equal(result.ignored, 300);
  assert.equal(sum(result.net.map((p) => Math.round(p.amount * 100))), 0);
});

test('a three-way bill leaves the odd paisa with one person, not in the air', () => {
  const expenses = [entry(343, { paid: 'anshu', split: ['anshu', 'bhomla', 'praloy'] })];
  const shares = ['anshu', 'bhomla', 'praloy'].map((id) => PAISE(monthSummary(expenses, '2026-11', MEMBERS, id).viewer.share));
  assert.equal(sum(shares), 34300);
  assert.deepEqual(shares, [11434, 11433, 11433]);
});

test('settlements clear every debt exactly', () => {
  const expenses = [
    entry(343, { paid: 'anshu' }),
    entry(232, { paid: 'praloy' }),
    entry(111, { paid: 'nirmalya', split: ['nirmalya', 'anshu', 'bhomla'] }),
    entry(77, { paid: 'bhomla', split: ['anshu', 'bhomla'] })
  ];
  const { net } = ledger(expenses, MEMBERS);
  const settlements = settle(net, MEMBERS);

  const after = new Map(net);
  for (const s of settlements) {
    const from = MEMBERS.find((m) => m.name === s.from).id;
    const to = MEMBERS.find((m) => m.name === s.to).id;
    assert.notEqual(from, to, 'a settlement must move money between two people');
    after.set(from, after.get(from) + s.amountPaise);
    after.set(to, after.get(to) - s.amountPaise);
  }
  for (const [id, amount] of after) assert.equal(amount, 0, `${id} still off by ${amount}`);

  const owed = [...net.values()].filter((n) => n > 0).reduce((s, n) => s + n, 0);
  assert.equal(sum(settlements.map((s) => s.amountPaise)), owed);
  assert.ok(settlements.length <= MEMBERS.length - 1, 'settlement count should stay small');
});

test('everyone square means no settlements at all', () => {
  const expenses = [entry(400, { paid: 'anshu', split: [] }), entry(400, { paid: 'praloy', split: [] })];
  const result = balances(expenses, MEMBERS);
  assert.equal(result.settlements.length, 0);
  assert.ok(result.net.every((p) => p.amount === 0));
});

// ------------------------------------------------------------- month figures

test('month totals agree with entries, categories, days and payers', () => {
  const expenses = [
    entry(343.33, { paid: 'anshu', day: 2 }),
    entry(232.5, { paid: 'praloy', method: 'cash', day: 2 }),
    entry(99.99, { paid: 'bhomla', method: 'cash', day: 9 }),
    entry(10, { paid: 'nirmalya', split: [], day: 9 }),
    entry(50, { paid: 'anshu', month: '2026-10', day: 31 })
  ];
  const summary = monthSummary(expenses, '2026-11', MEMBERS, 'anshu');
  const rows = expenses.filter((e) => e.spent_on.startsWith('2026-11'));

  assert.equal(PAISE(summary.total), sum(rows.map((e) => e.amount)));
  assert.equal(PAISE(summary.cash + summary.online), PAISE(summary.total));
  assert.equal(PAISE(sum([...summary.byCategory.map((c) => c.amount)])), PAISE(summary.total));
  assert.equal(PAISE(sum(summary.daily)), PAISE(summary.total));
  assert.equal(PAISE(sum(summary.paid.map((p) => p.amount))), PAISE(summary.total));
  assert.equal(summary.count, rows.length);
  assert.equal(summary.cashCount + summary.onlineCount, rows.length);
});

test('viewer figures reconcile with the flat figures', () => {
  const expenses = [
    entry(343, { paid: 'anshu' }),
    entry(232, { paid: 'praloy' }),
    entry(111, { paid: 'nirmalya', split: ['nirmalya', 'anshu', 'bhomla'] }),
    entry(500, { paid: 'anshu', split: [] })
  ];
  const summary = monthSummary(expenses, '2026-11', MEMBERS, 'anshu');
  const mine = summary.viewer;

  assert.equal(PAISE(mine.paid), sum(expenses.filter((e) => e.paid_by === 'anshu').map((e) => e.amount)));
  assert.equal(PAISE(mine.share), PAISE(mine.shared + mine.personal));
  assert.equal(PAISE(mine.share), PAISE(mine.cash + mine.online));
  assert.equal(PAISE(mine.net), PAISE(mine.paid - mine.share));
  assert.equal(PAISE(sum(mine.daily)), PAISE(mine.share));
  assert.equal(PAISE(sum([...mine.byCategory.map((c) => c.amount)])), PAISE(mine.share));

  const monthNet = monthBalances(expenses, '2026-11', MEMBERS).net.find((p) => p.id === 'anshu');
  assert.equal(PAISE(monthNet.amount), PAISE(mine.net), 'month ledger and month viewer must agree');
});

test('every member viewing the month gets the same flat total', () => {
  const expenses = [
    entry(343, { paid: 'anshu' }),
    entry(232, { paid: 'praloy', split: ['praloy', 'bhomla'] }),
    entry(111, { paid: 'nirmalya', split: ['nirmalya', 'anshu', 'bhomla'] })
  ];
  const shares = MEMBERS.map((m) => monthSummary(expenses, '2026-11', MEMBERS, m.id).viewer);
  const total = PAISE(monthSummary(expenses, '2026-11', MEMBERS, '').total);

  assert.equal(sum([...shares.map((s) => PAISE(s.share))]), total, 'member shares must cover the flat total');
  assert.equal(sum([...shares.map((s) => PAISE(s.net))]), 0, 'member nets must cancel out');
});

test('per head is the even split of the flat total', () => {
  const expenses = [entry(100, { paid: 'anshu' }), entry(101, { paid: 'praloy' })];
  const summary = monthSummary(expenses, '2026-11', MEMBERS, '');
  assert.equal(PAISE(summary.perHead), Math.round(PAISE(summary.total) / MEMBERS.length));
});

// -------------------------------------------------------------- year figures

test('year figures match the months and the ledger', () => {
  const expenses = [
    entry(343, { paid: 'anshu', month: '2026-01' }),
    entry(232, { paid: 'praloy', month: '2026-01' }),
    entry(500, { paid: 'nirmalya', month: '2026-07', split: ['nirmalya', 'anshu'] }),
    entry(90, { paid: 'bhomla', month: '2025-12' })
  ];
  const year = yearData(expenses, '2026', MEMBERS, 'anshu');
  const rows = expenses.filter((e) => e.spent_on.startsWith('2026'));

  assert.equal(PAISE(year.total), sum(rows.map((e) => e.amount)));
  assert.equal(PAISE(sum(year.months.map((m) => m.total))), PAISE(year.total));
  assert.equal(PAISE(sum([...year.byCategory.map((c) => c.amount)])), PAISE(year.total));
  assert.equal(PAISE(sum(year.paid.map((p) => p.amount))), PAISE(year.total));
  assert.equal(year.count, rows.length);

  const mine = year.viewer;
  assert.equal(PAISE(mine.net), PAISE(mine.paid - mine.share));
  assert.equal(PAISE(sum([...mine.months.map((m) => m.share)])), PAISE(mine.share));
});

test('a month viewed alone matches that month inside the year', () => {
  const expenses = [
    entry(343, { paid: 'anshu', month: '2026-03' }),
    entry(232, { paid: 'praloy', month: '2026-03' }),
    entry(111, { paid: 'nirmalya', month: '2026-08', split: ['nirmalya', 'bhomla'] })
  ];
  for (const month of ['2026-03', '2026-08']) {
    const monthShare = monthSummary(expenses, month, MEMBERS, 'bhomla').viewer.share;
    const yearShare = yearData(expenses, '2026', MEMBERS, 'bhomla').viewer.months.find((m) => m.month === month).share;
    assert.equal(PAISE(monthShare), PAISE(yearShare), `${month} viewer share`);
  }
});

test('all-time balances equal the sum of every month', () => {
  const expenses = [
    entry(343, { paid: 'anshu', month: '2026-01' }),
    entry(232, { paid: 'praloy', month: '2026-02' }),
    entry(111, { paid: 'nirmalya', month: '2026-02' }),
    entry(90, { paid: 'bhomla', month: '2025-12', method: 'cash' })
  ];
  const all = balances(expenses, MEMBERS);
  const months = ['2025-12', '2026-01', '2026-02'];
  for (const member of MEMBERS) {
    const fromMonths = months.reduce(
      (s, m) => s + PAISE(monthBalances(expenses, m, MEMBERS).net.find((p) => p.id === member.id).amount),
      0
    );
    const direct = PAISE(all.net.find((p) => p.id === member.id).amount);
    assert.equal(fromMonths, direct, `${member.name} all-time net`);
  }
});

// --------------------------------------------------------------- the reading

test('the numbers the month screen shows add up', () => {
  // The case that was wrong before: paid 343 and 232, split across four people.
  const expenses = [entry(343, { paid: 'anshu' }), entry(232, { paid: 'praloy' })];
  const mine = monthSummary(expenses, '2026-11', MEMBERS, 'anshu').viewer;

  assert.equal(mine.paid, 343);
  assert.equal(mine.share, 85.75 + 58); // 343/4 and 232/4, both exact
  assert.equal(mine.net, 199.25);
  const owed = balances(expenses, MEMBERS).net.find((p) => p.id === 'anshu').amount;
  assert.equal(owed, mine.net, 'the ledger must print the same number as paid minus share');
});

test('rupees keep their paise', () => {
  assert.equal(rs(11434), 114.34);
  assert.equal(rs(11433), 114.33);
  assert.equal(rs(2), 0.02);
  assert.equal(rs(0), 0);
});

test('csv writes the amounts as two decimals', () => {
  const csv = toCsv([entry(343.5, { paid: 'anshu', split: ['anshu', 'praloy'] })], MEMBERS);
  const line = csv.split('\n')[1].split(',');
  assert.equal(line[1], '343.50');
  assert.equal(line[5], 'anshu');
  assert.equal(line[6], 'anshu / praloy');
});

test('today is an IST date', () => {
  // 2026-11-16 19:30 UTC is already the 17th in Kolkata.
  assert.equal(todayISO(new Date('2026-11-16T19:30:00Z')), '2026-11-17');
  assert.equal(todayISO(new Date('2026-11-16T18:00:00Z')), '2026-11-16');
});

// ------------------------------------------------------------------ the report

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`\n✗ ${failure}`);
  process.exit(1);
}
console.log('Money math checks out.\n');
