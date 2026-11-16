// The one place where money is divided. Everything is integer paise here, and every
// split adds back up to the bill exactly: no paise invented, none lost.

export const toPaise = (value) => {
  const n = Math.round(Number(value) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const asIdSet = (memberIds) =>
  memberIds instanceof Set ? memberIds : new Set(Array.isArray(memberIds) ? memberIds : []);

// Participants of one entry: de-duplicated, restricted to people who still exist in
// the flat, and kept in the stored order so the same entry always splits the same way.
export function splitIds(expense, memberIds) {
  const known = asIdSet(memberIds);
  const raw = Array.isArray(expense?.split_with) ? expense.split_with : [];
  const seen = new Set();
  const ids = [];
  for (const value of raw) {
    if (!known.has(value) || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

// Divide paise into whole shares. The leftover paise (fewer than the number of people)
// go one each to the earliest participants, so the shares sum to the amount exactly.
export function allocate(amount, ids) {
  const total = toPaise(amount);
  const shares = new Map(ids.map((id) => [id, 0]));
  if (ids.length === 0 || total === 0) return shares;

  const base = Math.floor(total / ids.length);
  let rest = total - base * ids.length;
  for (const id of ids) {
    shares.set(id, base + (rest > 0 ? 1 : 0));
    if (rest > 0) rest -= 1;
  }
  return shares;
}

// What each person carries for one entry. An entry with no split list is a personal
// spend: the payer carries all of it.
export function sharesOf(expense, memberIds) {
  const known = asIdSet(memberIds);
  const ids = splitIds(expense, known);
  const amount = toPaise(expense?.amount);
  if (ids.length > 0) return allocate(amount, ids);

  const payer = expense?.paid_by;
  return new Map(known.has(payer) ? [[payer, amount]] : []);
}

export function shareFor(expense, memberId, memberIds) {
  if (!memberId) return 0;
  return sharesOf(expense, memberIds).get(memberId) || 0;
}

// Paid minus share, per person, over any set of entries. Because every entry is
// allocated exactly, the net amounts always add up to zero across the flat.
export function ledger(expenses, members) {
  const known = new Set(members.map((m) => m.id));
  const net = new Map(members.map((m) => [m.id, 0]));
  let ignoredPaise = 0;

  for (const expense of expenses) {
    if (!known.has(expense?.paid_by)) {
      // Nobody in the flat can be credited for this entry; leave it out instead of
      // inventing a debt that cancels against nothing.
      ignoredPaise += toPaise(expense?.amount);
      continue;
    }
    net.set(expense.paid_by, net.get(expense.paid_by) + toPaise(expense.amount));
    for (const [id, share] of sharesOf(expense, known)) {
      net.set(id, net.get(id) - share);
    }
  }

  return { net, ignoredPaise };
}

// Greedy settlement: biggest debtor pays biggest creditor until the ledger is flat.
// Works in paise, so the payments cover the debts to the last paisa.
export function settle(net, members) {
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const bySize = (a, b) => b.amount - a.amount || String(nameOf.get(a.id)).localeCompare(String(nameOf.get(b.id)));
  const creditors = [...net.entries()].filter(([, amount]) => amount > 0).map(([id, amount]) => ({ id, amount }));
  const debtors = [...net.entries()].filter(([, amount]) => amount < 0).map(([id, amount]) => ({ id, amount: -amount }));
  creditors.sort(bySize);
  debtors.sort(bySize);

  const settlements = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].amount, creditors[c].amount);
    if (amount > 0) {
      settlements.push({ from: debtors[d].id, to: creditors[c].id, amountPaise: amount });
    }
    debtors[d].amount -= amount;
    creditors[c].amount -= amount;
    if (debtors[d].amount === 0) d += 1;
    if (creditors[c].amount === 0) c += 1;
  }

  return settlements.map((s) => ({ from: nameOf.get(s.from), to: nameOf.get(s.to), amountPaise: s.amountPaise }));
}
