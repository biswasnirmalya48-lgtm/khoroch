// All money is stored in paise (integer). Everything leaving this module is in rupees.
export const rs = (paise) => Math.round(paise) / 100;

const monthOf = (d) => (d || '').slice(0, 7);

// What one person actually carries for a single entry.
export function shareOfPaise(expense, memberId) {
  const amount = Number(expense.amount) || 0;
  if (!memberId) return 0;
  const split = Array.isArray(expense.split_with) ? expense.split_with : [];
  if (!split.length) return expense.paid_by === memberId ? amount : 0;
  if (!split.includes(memberId)) return 0;
  return Math.round(amount / split.length);
}

function personMonth(rows, member, dim) {
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
    if (e.paid_by === member.id) paid += e.amount;
    const mine = shareOfPaise(e, member.id);
    if (!mine) continue;
    count += 1;
    share += mine;
    if (Array.isArray(e.split_with) && e.split_with.length) shared += mine;
    else personal += mine;
    if (e.method === 'cash') {
      cash += mine;
      if (e.amount < 20000) smallCash += mine;
    }
    const day = Number((e.spent_on || '').slice(8, 10));
    if (day >= 1 && day <= dim) daily[day - 1] += mine;
    const cat = byCategory.get(e.category) || { category: e.category, amount: 0, count: 0 };
    cat.amount += mine;
    cat.count += 1;
    byCategory.set(e.category, cat);
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
    count,
    smallCash: rs(smallCash),
    daily: daily.map(rs),
    byCategory: [...byCategory.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((c) => ({ ...c, amount: rs(c.amount) }))
  };
}
const daysIn = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

export function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function monthSummary(expenses, month, members, viewerId) {
  const rows = expenses.filter((e) => monthOf(e.spent_on) === month);
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const cash = rows.filter((e) => e.method === 'cash').reduce((s, e) => s + e.amount, 0);
  const online = total - cash;

  const byCategory = new Map();
  for (const e of rows) {
    const entry = byCategory.get(e.category) || { category: e.category, amount: 0, count: 0 };
    entry.amount += e.amount;
    entry.count += 1;
    byCategory.set(e.category, entry);
  }

  const dim = daysIn(month);
  const nowMonth = todayISO().slice(0, 7);
  const isCurrent = month === nowMonth;
  const daysElapsed = isCurrent ? Math.max(1, Number(todayISO().slice(8, 10))) : dim;
  const daily = new Array(dim).fill(0);
  for (const e of rows) {
    const day = Number(e.spent_on.slice(8, 10));
    if (day >= 1 && day <= dim) daily[day - 1] += e.amount;
  }

  const paid = members.map((m) => ({
    id: m.id,
    name: m.name,
    amount: rows.filter((e) => e.paid_by === m.id).reduce((s, e) => s + e.amount, 0)
  }));

  const smallCash = rows.filter((e) => e.method === 'cash' && e.amount < 20000).reduce((s, e) => s + e.amount, 0);
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
      .sort((a, b) => b.amount - a.amount)
      .map((c) => ({ ...c, amount: rs(c.amount) })),
    daily: daily.map(rs),
    daysInMonth: dim,
    daysElapsed,
    projection: rs(isCurrent ? Math.round((total / daysElapsed) * dim) : total),
    dailyAverage: rs(Math.round(total / daysElapsed)),
    paid: paid.map((p) => ({ ...p, amount: rs(p.amount) })),
    smallCash: rs(smallCash),
    avgEntry: rs(rows.length ? Math.round(total / rows.length) : 0),
    viewer: personMonth(rows, members.find((m) => m.id === viewerId), dim)
  };
}

export function yearData(expenses, year, members, viewerId) {
  const rows = expenses.filter((e) => (e.spent_on || '').slice(0, 4) === String(year));
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const monthRows = rows.filter((e) => monthOf(e.spent_on) === key);
    const total = monthRows.reduce((s, e) => s + e.amount, 0);
    const cash = monthRows.filter((e) => e.method === 'cash').reduce((s, e) => s + e.amount, 0);
    months.push({ month: key, total: rs(total), cash: rs(cash), online: rs(total - cash), count: monthRows.length });
  }

  const byCategory = new Map();
  for (const e of rows) {
    const entry = byCategory.get(e.category) || { category: e.category, amount: 0, count: 0 };
    entry.amount += e.amount;
    entry.count += 1;
    byCategory.set(e.category, entry);
  }

  const total = rows.reduce((s, e) => s + e.amount, 0);
  const cash = rows.filter((e) => e.method === 'cash').reduce((s, e) => s + e.amount, 0);
  const paid = members.map((m) => ({
    id: m.id,
    name: m.name,
    amount: rs(rows.filter((e) => e.paid_by === m.id).reduce((s, e) => s + e.amount, 0))
  }));

  return {
    year: String(year),
    total: rs(total),
    cash: rs(cash),
    online: rs(total - cash),
    count: rows.length,
    months,
    byCategory: [...byCategory.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((c) => ({ ...c, amount: rs(c.amount) })),
    paid: paid.sort((a, b) => b.amount - a.amount),
    viewer: yearViewer(rows, members.find((m) => m.id === viewerId))
  };
}

function yearViewer(rows, member) {
  if (!member) return null;
  let paid = 0;
  let share = 0;
  let count = 0;
  const months = [];
  const byCategory = new Map();

  for (const e of rows) {
    const mine = shareOfPaise(e, member.id);
    if (e.paid_by === member.id) paid += e.amount;
    if (!mine) continue;
    count += 1;
    share += mine;
    const cat = byCategory.get(e.category) || { category: e.category, amount: 0, count: 0 };
    cat.amount += mine;
    cat.count += 1;
    byCategory.set(e.category, cat);
  }

  const monthKeys = [...new Set(rows.map((e) => monthOf(e.spent_on)))].sort();
  for (let m = 1; m <= 12; m += 1) {
    const key = `${(rows[0]?.spent_on || '').slice(0, 4)}-${String(m).padStart(2, '0')}`;
    months.push({ month: key, share: rs(rows.filter((e) => monthOf(e.spent_on) === key).reduce((s, e) => s + shareOfPaise(e, member.id), 0)) });
  }

  return {
    id: member.id,
    name: member.name,
    paid: rs(paid),
    share: rs(share),
    count,
    months,
    monthKeys,
    byCategory: [...byCategory.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((c) => ({ ...c, amount: rs(c.amount) }))
  };
}

export function balances(expenses, members) {
  const net = new Map(members.map((m) => [m.id, 0]));
  for (const e of expenses) {
    if (e.paid_by && net.has(e.paid_by)) net.set(e.paid_by, net.get(e.paid_by) + e.amount);
    const share = Array.isArray(e.split_with) ? e.split_with.filter((id) => net.has(id)) : [];
    if (!share.length) continue;
    const each = Math.floor(e.amount / share.length);
    let remainder = e.amount - each * share.length;
    for (const id of share) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      net.set(id, net.get(id) - each - extra);
    }
  }

  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const creditors = [...net.entries()].filter(([, amt]) => amt > 0).map(([id, amt]) => ({ id, amt }));
  const debtors = [...net.entries()].filter(([, amt]) => amt < 0).map(([id, amt]) => ({ id, amt: -amt }));
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const settlements = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) {
      settlements.push({ from: nameOf.get(debtors[i].id), to: nameOf.get(creditors[j].id), amount: rs(pay) });
    }
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt <= 0) i += 1;
    if (creditors[j].amt <= 0) j += 1;
  }

  return {
    net: members.map((m) => ({ id: m.id, name: m.name, amount: rs(net.get(m.id) || 0) })),
    settlements
  };
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
