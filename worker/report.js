// All money is stored in paise (integer). Everything leaving this module is in rupees.
// Every per-person figure comes from the same allocator in money.js, so a person's
// share, the month total, and the "who owes whom" ledger always agree.
import { allocate, ledger, settle, shareFor, sharesOf, toPaise } from './money.js';

export const rs = (paise) => Math.round(paise) / 100;

const monthOf = (d) => (d || '').slice(0, 7);
const idsOf = (members) => new Set(members.map((m) => m.id));

// What one person actually carries for a single entry.
export function shareOfPaise(expense, memberId, memberIds = []) {
  return shareFor(expense, memberId, memberIds);
}

function bucket(map, key, share) {
  const entry = map.get(key) || { key, amount: 0, count: 0 };
  entry.amount += share;
  entry.count += 1;
  map.set(key, entry);
  return entry;
}

function personMonth(rows, member, dim, ids) {
  if (!member) return null;
  let paid = 0;
  let share = 0;
  let personal = 0;
  let shared = 0;
  let cash = 0;
  let count = 0;
  let smallCash = 0;
  const daily = new Array(dim).fill(0);
  const byCategory = new Map();

  for (const e of rows) {
    if (e.paid_by === member.id) paid += toPaise(e.amount);
    const mine = shareFor(e, member.id, ids);
    if (!mine) continue;
    count += 1;
    share += mine;
    if (Array.isArray(e.split_with) && e.split_with.length) shared += mine;
    else personal += mine;
    if (e.method === 'cash') {
      cash += mine;
      if (toPaise(e.amount) < 20000) smallCash += mine;
    }
    const day = Number((e.spent_on || '').slice(8, 10));
    if (day >= 1 && day <= dim) daily[day - 1] += mine;
    bucket(byCategory, e.category, mine);
  }

  return {
    id: member.id,
    name: member.name,
    paid: rs(paid),
    share: rs(share),
    personal: rs(personal),
    shared: rs(shared),
    cash: rs(cash),
    online: rs(share - cash),
    net: rs(paid - share),
    count,
    smallCash: rs(smallCash),
    daily: daily.map(rs),
    byCategory: [...byCategory.values()]
      .map((c) => ({ category: c.key, amount: rs(c.amount), count: c.count }))
      .sort((a, b) => b.amount - a.amount)
  };
}

const daysIn = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

// The flat is in India: "today" must be the IST date, not the UTC one, or a late-night
// entry lands on yesterday.
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function monthSummary(expenses, month, members, viewerId) {
  const ids = idsOf(members);
  const rows = expenses.filter((e) => monthOf(e.spent_on) === month);
  const total = rows.reduce((s, e) => s + toPaise(e.amount), 0);
  const cash = rows.filter((e) => e.method === 'cash').reduce((s, e) => s + toPaise(e.amount), 0);
  const online = total - cash;

  const byCategory = new Map();
  for (const e of rows) bucket(byCategory, e.category, toPaise(e.amount));

  const dim = daysIn(month);
  const nowMonth = todayISO().slice(0, 7);
  const isCurrent = month === nowMonth;
  const daysElapsed = isCurrent ? Math.max(1, Number(todayISO().slice(8, 10))) : dim;
  const daily = new Array(dim).fill(0);
  for (const e of rows) {
    const day = Number((e.spent_on || '').slice(8, 10));
    if (day >= 1 && day <= dim) daily[day - 1] += toPaise(e.amount);
  }

  const paid = members.map((m) => ({
    id: m.id,
    name: m.name,
    amount: rows.filter((e) => e.paid_by === m.id).reduce((s, e) => s + toPaise(e.amount), 0)
  }));

  const smallCash = rows
    .filter((e) => e.method === 'cash' && toPaise(e.amount) < 20000)
    .reduce((s, e) => s + toPaise(e.amount), 0);
  const onlineCount = rows.filter((e) => e.method === 'online').length;

  return {
    month,
    total: rs(total),
    cash: rs(cash),
    online: rs(online),
    count: rows.length,
    onlineCount,
    cashCount: rows.length - onlineCount,
    byCategory: [...byCategory.values()]
      .map((c) => ({ category: c.key, amount: rs(c.amount), count: c.count }))
      .sort((a, b) => b.amount - a.amount),
    daily: daily.map(rs),
    daysInMonth: dim,
    daysElapsed,
    projection: rs(isCurrent && daysElapsed > 0 ? Math.round((total / daysElapsed) * dim) : total),
    dailyAverage: rs(daysElapsed > 0 ? Math.round(total / daysElapsed) : 0),
    // What a perfectly even split across the flat would cost each person this month.
    perHead: rs(members.length ? Math.round(total / members.length) : 0),
    paid: paid.map((p) => ({ ...p, amount: rs(p.amount) })),
    smallCash: rs(smallCash),
    avgEntry: rs(rows.length ? Math.round(total / rows.length) : 0),
    viewer: personMonth(rows, members.find((m) => m.id === viewerId), dim, ids)
  };
}

export function yearData(expenses, year, members, viewerId) {
  const ids = idsOf(members);
  const rows = expenses.filter((e) => (e.spent_on || '').slice(0, 4) === String(year));
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const monthRows = rows.filter((e) => monthOf(e.spent_on) === key);
    const total = monthRows.reduce((s, e) => s + toPaise(e.amount), 0);
    const cash = monthRows.filter((e) => e.method === 'cash').reduce((s, e) => s + toPaise(e.amount), 0);
    months.push({ month: key, total: rs(total), cash: rs(cash), online: rs(total - cash), count: monthRows.length });
  }

  const byCategory = new Map();
  for (const e of rows) bucket(byCategory, e.category, toPaise(e.amount));

  const total = rows.reduce((s, e) => s + toPaise(e.amount), 0);
  const cash = rows.filter((e) => e.method === 'cash').reduce((s, e) => s + toPaise(e.amount), 0);
  const paid = members.map((m) => ({
    id: m.id,
    name: m.name,
    amount: rs(rows.filter((e) => e.paid_by === m.id).reduce((s, e) => s + toPaise(e.amount), 0))
  }));

  return {
    year: String(year),
    total: rs(total),
    cash: rs(cash),
    online: rs(total - cash),
    count: rows.length,
    months,
    byCategory: [...byCategory.values()]
      .map((c) => ({ category: c.key, amount: rs(c.amount), count: c.count }))
      .sort((a, b) => b.amount - a.amount),
    paid: paid.sort((a, b) => b.amount - a.amount),
    viewer: yearViewer(rows, members.find((m) => m.id === viewerId), ids)
  };
}

function yearViewer(rows, member, ids) {
  if (!member) return null;
  let paid = 0;
  let share = 0;
  let count = 0;
  const byCategory = new Map();
  const monthShares = new Map();

  for (const e of rows) {
    if (e.paid_by === member.id) paid += toPaise(e.amount);
    const mine = shareFor(e, member.id, ids);
    if (!mine) continue;
    count += 1;
    share += mine;
    bucket(byCategory, e.category, mine);
    const key = monthOf(e.spent_on);
    monthShares.set(key, (monthShares.get(key) || 0) + mine);
  }

  const yearLabel = (rows[0]?.spent_on || '').slice(0, 4) || String(new Date().getFullYear());
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const key = `${yearLabel}-${String(m).padStart(2, '0')}`;
    months.push({ month: key, share: rs(monthShares.get(key) || 0) });
  }

  return {
    id: member.id,
    name: member.name,
    paid: rs(paid),
    share: rs(share),
    net: rs(paid - share),
    count,
    months,
    monthKeys: [...monthShares.keys()].sort(),
    byCategory: [...byCategory.values()]
      .map((c) => ({ category: c.key, amount: rs(c.amount), count: c.count }))
      .sort((a, b) => b.amount - a.amount)
  };
}

// Paid minus share, all time, per person, plus the shortest way to settle up.
export function balances(expenses, members) {
  const { net, ignoredPaise } = ledger(expenses, members);
  return {
    net: members.map((m) => ({ id: m.id, name: m.name, amount: rs(net.get(m.id) || 0) })),
    settlements: settle(net, members).map((s) => ({ from: s.from, to: s.to, amount: rs(s.amountPaise) })),
    ignored: rs(ignoredPaise)
  };
}

// Same ledger restricted to one month, for the month screen.
export function monthBalances(expenses, month, members) {
  return balances(expenses.filter((e) => monthOf(e.spent_on) === month), members);
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(expenses, members) {
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const head = ['date', 'amount', 'category', 'method', 'note', 'paid_by', 'split_between'];
  const lines = [head.join(',')];
  for (const e of expenses) {
    const split = (e.split_with || []).map((id) => nameOf.get(id) || id).join(' / ');
    lines.push(
      [
        e.spent_on,
        rs(e.amount).toFixed(2),
        e.category,
        e.method,
        e.note,
        nameOf.get(e.paid_by) || '',
        split
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

export { allocate, sharesOf };
