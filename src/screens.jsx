import { useEffect, useMemo, useState } from 'react';
import {
  CATEGORIES,
  api,
  emojiFor,
  friendlyDate,
  inr,
  monthLabel,
  monthShort,
  plain,
  shiftMonth,
  todayDate,
  todayMonth
} from './api.js';

/* ------------------------------------------------------------------ splash */

export function Splash({ message }) {
  return (
    <div className="splash">
      <div className="splash-mark">৳</div>
      <h1>Khoroch</h1>
      <p>{message || 'Every rupee accounted for.'}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- auth */

export function SetupScreen({ onDone }) {
  const [household, setHousehold] = useState('');
  const [passcode, setPasscode] = useState('');
  const [names, setNames] = useState(['', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    const people = names.map((n) => n.trim()).filter(Boolean);
    if (people.length < 1) return setError('Add at least one person.');
    if (passcode.trim().length < 4) return setError('Passcode needs at least 4 characters.');
    setBusy(true);
    try {
      await api.setup({ name: household.trim(), passcode: passcode.trim(), members: people });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-head">
          <div className="splash-mark small">৳</div>
          <h1>Set up your flat</h1>
          <p>One ledger, one passcode. Everyone who lives with you shares this.</p>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            <span>Flat name</span>
            <input value={household} onChange={(e) => setHousehold(e.target.value)} placeholder="Amalapuram 3B" maxLength={60} />
          </label>

          <label className="field">
            <span>Passcode</span>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Something you all remember"
              autoComplete="new-password"
            />
          </label>

          <div className="field">
            <span>Who lives here</span>
            <div className="stack">
              {names.map((name, index) => (
                <input
                  key={index}
                  value={name}
                  onChange={(e) => {
                    const next = [...names];
                    next[index] = e.target.value;
                    setNames(next);
                  }}
                  placeholder={`Person ${index + 1}`}
                  maxLength={40}
                />
              ))}
            </div>
            <button type="button" className="ghost small" onClick={() => setNames([...names, ''])}>
              + Add another person
            </button>
          </div>

          {error && <p className="error-text">{error}</p>}
          <button className="primary wide" disabled={busy}>
            {busy ? 'Creating ledger…' : 'Start tracking'}
          </button>
        </form>
        <p className="fineprint">Data stays in your own database. No card, no subscription, no ads.</p>
      </div>
    </div>
  );
}

export function LoginScreen({ household, onDone }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login({ passcode: passcode.trim() });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-head">
          <div className="splash-mark small">৳</div>
          <h1>{household?.name || 'Your flat'}</h1>
          <p>Enter the passcode to open the ledger.</p>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            <span>Passcode</span>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="primary wide" disabled={busy}>
            {busy ? 'Checking…' : 'Open ledger'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ month */

export function MonthScreen({ payload, loading, month, members, viewer, onPickViewer, onDelete, onGoAdd }) {
  const [confirmId, setConfirmId] = useState(null);
  const summary = payload?.summary;
  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const viewerId = viewer?.id || '';

  if (!payload || !summary) {
    return (
      <div className="empty-state">
        <p>{loading ? 'Counting the month…' : 'No data yet.'}</p>
        <button className="primary" onClick={onGoAdd}>
          Add your first expense
        </button>
      </div>
    );
  }

  const mine = summary.viewer || null;
  const cats = mine ? mine.byCategory : summary.byCategory;
  const daily = mine ? mine.daily : summary.daily;
  const cash = mine ? mine.cash : summary.cash;
  const onlineTotal = mine ? mine.online : summary.online;
  const shown = mine ? mine.share : summary.total;
  const smallCash = mine ? mine.smallCash : summary.smallCash;
  const myNet = (payload.balances?.net || []).find((p) => p.id === viewerId)?.amount || 0;
  const maxCat = Math.max(...cats.map((c) => c.amount), 1);
  const maxDay = Math.max(...daily, 1);
  const cashPct = shown ? Math.round((cash / shown) * 100) : 0;
  const isCurrent = month === todayMonth();

  return (
    <div className="stack-lg">
      <section className="hero">
        <p className="eyebrow">
          {mine ? `Your share · ${monthLabel(month)}` : `${isCurrent ? 'Spent so far in' : 'Total for'} ${monthLabel(month)}`}
        </p>
        <h1 className="big-money">{inr(shown)}</h1>
        <div className="hero-meta">
          {mine ? (
            <>
              <span>you paid {inr(mine.paid)}</span>
              <span className="dot" />
              <span className="muted">flat {inr(summary.total)}</span>
              <span className="dot" />
              <span>{mine.count} {mine.count === 1 ? 'entry' : 'entries'}</span>
            </>
          ) : (
            <>
              <span>{summary.count} {summary.count === 1 ? 'entry' : 'entries'}</span>
              <span className="dot" />
              <span>{inr(summary.dailyAverage)}/day</span>
              {isCurrent && (
                <>
                  <span className="dot" />
                  <span className="muted">heading to {inr(summary.projection)}</span>
                </>
              )}
            </>
          )}
        </div>

        <div className="split-bar" aria-hidden="true">
          <div className="split-cash" style={{ width: `${cashPct}%` }} />
          <div className="split-online" style={{ width: `${100 - cashPct}%` }} />
        </div>
        <div className="legend">
          <span><i className="swatch cash" /> Cash {inr(cash)}</span>
          <span><i className="swatch online" /> Online {inr(onlineTotal)}</span>
        </div>
      </section>

      <section className="card viewer-card">
        <span className="label">Whose money</span>
        <div className="chips">
          <button className={`chip small ${mine ? '' : 'on'}`} onClick={() => onPickViewer('')}>
            Whole flat
          </button>
          {members.map((member) => (
            <button
              key={member.id}
              className={`chip small ${viewerId === member.id ? 'on' : ''}`}
              onClick={() => onPickViewer(member.id)}
            >
              {member.name}
            </button>
          ))}
        </div>
        {mine ? (
          <>
            <div className="stat-grid you-grid">
              <div className="stat">
                <span className="stat-label">You paid</span>
                <strong>{inr(mine.paid)}</strong>
              </div>
              <div className="stat">
                <span className="stat-label">Your share</span>
                <strong>{inr(mine.share)}</strong>
              </div>
              <div className="stat">
                <span className="stat-label">Of shared bills</span>
                <strong>{inr(mine.shared)}</strong>
              </div>
              <div className="stat">
                <span className="stat-label">Your own spends</span>
                <strong>{inr(mine.personal)}</strong>
              </div>
            </div>
            <p className={`net-line ${myNet > 0 ? 'pos' : myNet < 0 ? 'neg' : 'muted'}`}>
              {myNet > 0
                ? `The flat owes you ${inr(myNet)}`
                : myNet < 0
                  ? `You owe the flat ${inr(-myNet)}`
                  : 'You are square with the flat'}
            </p>
          </>
        ) : (
          <p className="fineprint">Pick your name to see only your share of every bill.</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Day by day</h2>
          <span className="muted small">{summary.daysElapsed} of {summary.daysInMonth} days</span>
        </div>
        <div className="daybars">
          {daily.map((value, index) => (
            <div key={index} className="daybar-wrap" title={`${index + 1}: ${inr(value)}`}>
              <div
                className={`daybar ${value > 0 ? 'filled' : ''}`}
                style={{ height: `${Math.max(3, (value / maxDay) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{mine ? `Where your ${inr(mine.share)} went` : 'Where it went'}</h2>
          <span className="muted small">{cats.length} categories</span>
        </div>
        {cats.length === 0 && <p className="muted small">Nothing recorded this month.</p>}
        <ul className="cat-list">
          {cats.map((cat) => (
            <li key={cat.category}>
              <div className="cat-row">
                <span className="cat-name">
                  <span className="cat-emoji">{emojiFor(cat.category)}</span>
                  {cat.category}
                </span>
                <span className="cat-amount">{inr(cat.amount)}</span>
              </div>
              <div className="cat-track">
                <div className="cat-fill" style={{ width: `${Math.max(3, (cat.amount / maxCat) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {smallCash > 0 && (
        <section className="card leak">
          <span className="leak-icon">🕳️</span>
          <div>
            <h3>Small cash leak</h3>
            <p>
              {inr(smallCash)} went out in {mine ? 'your ' : ''}cash spends under ₹200 — tea, auto, snacks. That is
              {' '}
              {shown ? Math.round((smallCash / shown) * 100) : 0}% of {mine ? 'your month' : 'the month'}.
            </p>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Who paid</h2>
        </div>
        <ul className="person-list">
          {summary.paid.map((person) => (
            <li key={person.id}>
              <span className="avatar" data-name={person.name.slice(0, 1).toUpperCase()}>
                {person.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="grow">{person.name}</span>
              <span className="mono">{inr(person.amount)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Recent</h2>
          <button className="ghost small" onClick={onGoAdd}>+ Add</button>
        </div>
        {payload.expenses.length === 0 && <p className="muted small">No entries yet this month.</p>}
        <ul className="expense-list">
          {payload.expenses.map((expense) => (
            <li key={expense.id} className="expense">
              <span className="cat-emoji">{emojiFor(expense.category)}</span>
              <div className="expense-main">
                <strong>{expense.note || expense.category}</strong>
                <span className="muted small">
                  {friendlyDate(expense.spent_on)} · {expense.method === 'cash' ? 'Cash' : 'Online'} ·{' '}
                  {expense.paid_by === viewerId ? 'You' : nameOf.get(expense.paid_by) || 'Someone'}
                  {expense.split_with.length > 0
                    ? ` · split ${expense.split_with.length}${
                        viewerId && expense.split_with.includes(viewerId)
                          ? ` · your ${inr(Math.round(expense.amount / expense.split_with.length))}`
                          : viewerId
                            ? ' · not yours'
                            : ''
                      }`
                    : ' · personal'}
                </span>
              </div>
              <span className="expense-amount">{inr(expense.amount)}</span>
              {confirmId === expense.id ? (
                <button
                  className="danger small"
                  onClick={() => {
                    setConfirmId(null);
                    onDelete(expense.id);
                  }}
                >
                  Sure?
                </button>
              ) : (
                <button className="icon-btn subtle" onClick={() => setConfirmId(expense.id)} aria-label="Delete entry">
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- add */

const blankDraft = (members, date, payer) => ({
  amount: '',
  category: 'Food',
  method: 'online',
  note: '',
  spent_on: date,
  paid_by: payer || members[0]?.id || '',
  split_with: members.map((m) => m.id)
});

export function AddScreen({ members, aiEnabled, defaultMonth, defaultPayer, onSaved }) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  const date = todayDate();
  const monthDate = defaultMonth === todayMonth() ? date : `${defaultMonth}-01`;

  const addBlank = () =>
    setDrafts((prev) => [blankDraft(members, monthDate, defaultPayer), ...prev]);

  const update = (index, patch) =>
    setDrafts((prev) => prev.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  const remove = (index) => setDrafts((prev) => prev.filter((_, i) => i !== index));

  const parse = async () => {
    setError('');
    setHint('');
    if (!text.trim()) return setError('Type what you spent.');
    setBusy(true);
    try {
      const data = await api.aiParse(text.trim());
      const byName = new Map(members.map((m) => [m.name.toLowerCase(), m.id]));
      const mapped = data.items.map((item) => ({
        amount: String(item.amount),
        category: item.category,
        method: item.method,
        note: item.note,
        spent_on: item.spent_on,
        paid_by: byName.get(String(item.paid_by || '').toLowerCase()) || defaultPayer || members[0]?.id || '',
        split_with: item.split_with
          .map((name) => byName.get(String(name).toLowerCase()))
          .filter(Boolean)
      }));
      if (!mapped.length) {
        setHint('No money found in that line. Try: "chai 30 cash, dinner 900 upi split with all".');
      } else {
        setDrafts((prev) => [...mapped, ...prev]);
        setText('');
        setHint(`Read ${mapped.length} ${mapped.length === 1 ? 'expense' : 'expenses'} — check and save.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError('');
    const valid = drafts.filter((draft) => Number(draft.amount) > 0);
    if (!valid.length) return setError('Add an amount before saving.');
    setSaving(true);
    try {
      await api.addExpenses(
        valid.map((draft) => ({
          amount: Number(draft.amount),
          category: draft.category,
          method: draft.method,
          note: draft.note.trim(),
          spent_on: draft.spent_on,
          paid_by: draft.paid_by,
          split_with: draft.split_with
        }))
      );
      setDrafts([]);
      onSaved(valid.length);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleSplit = (index, memberId) => {
    const draft = drafts[index];
    const has = draft.split_with.includes(memberId);
    update(index, {
      split_with: has ? draft.split_with.filter((id) => id !== memberId) : [...draft.split_with, memberId]
    });
  };

  const totalDrafts = drafts.reduce((sum, draft) => sum + (Number(draft.amount) || 0), 0);

  return (
    <div className="stack-lg">
      <section className="card ai-card">
        <div className="card-head">
          <h2>Just say what you spent</h2>
          <span className={`pill ${aiEnabled ? 'ok' : 'off'}`}>{aiEnabled ? 'AI on' : 'AI off'}</span>
        </div>
        <textarea
          className="ai-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'e.g. "auto 60 cash, dinner 900 gpay split with all, Ravi paid 250 for milk"'}
          maxLength={700}
        />
        <div className="row gap wrap">
          <button className="primary" onClick={parse} disabled={busy || !aiEnabled}>
            {busy ? 'Reading…' : 'Read it'}
          </button>
          <button className="ghost" onClick={addBlank}>Manual entry</button>
        </div>
        {!aiEnabled && (
          <p className="fineprint">
            Add the GROQ_API_KEY secret on the server to switch on natural-language entry. Manual entry works either way.
          </p>
        )}
        {hint && <p className="hint">{hint}</p>}
        {error && <p className="error-text">{error}</p>}
      </section>

      {drafts.length > 0 && (
        <section className="stack">
          <div className="draft-bar">
            <span>
              {drafts.length} {drafts.length === 1 ? 'entry' : 'entries'} · {inr(totalDrafts)}
            </span>
            <button className="primary small" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save all'}
            </button>
          </div>

          {drafts.map((draft, index) => (
            <article className="card draft" key={index}>
              <div className="draft-top">
                <div className="amount-wrap">
                  <span className="rupee">₹</span>
                  <input
                    className="amount-input"
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) => update(index, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                    placeholder="0"
                  />
                </div>
                <button className="icon-btn subtle" onClick={() => remove(index)} aria-label="Remove draft">
                  ×
                </button>
              </div>

              <input
                className="text-input"
                value={draft.note}
                onChange={(e) => update(index, { note: e.target.value })}
                placeholder="What was it for?"
                maxLength={120}
              />

              <div className="chips">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.name}
                    className={`chip ${draft.category === cat.name ? 'on' : ''}`}
                    onClick={() => update(index, { category: cat.name })}
                  >
                    {cat.emoji} {cat.name}
                  </button>
                ))}
              </div>

              <div className="row gap wrap">
                <div className="segment">
                  <button
                    className={draft.method === 'cash' ? 'on' : ''}
                    onClick={() => update(index, { method: 'cash' })}
                  >
                    Cash
                  </button>
                  <button
                    className={draft.method === 'online' ? 'on' : ''}
                    onClick={() => update(index, { method: 'online' })}
                  >
                    Online
                  </button>
                </div>
                <input
                  type="date"
                  className="date-input"
                  value={draft.spent_on}
                  onChange={(e) => update(index, { spent_on: e.target.value })}
                />
                <select
                  className="select"
                  value={draft.paid_by}
                  onChange={(e) => update(index, { paid_by: e.target.value })}
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} paid
                    </option>
                  ))}
                </select>
              </div>

              <div className="split-block">
                <span className="label">Split between</span>
                <div className="chips">
                  {members.map((m) => (
                    <button
                      key={m.id}
                      className={`chip small ${draft.split_with.includes(m.id) ? 'on' : ''}`}
                      onClick={() => toggleSplit(index, m.id)}
                    >
                      {m.name}
                    </button>
                  ))}
                  <button
                    className={`chip small ${draft.split_with.length === 0 ? 'on' : ''}`}
                    onClick={() => update(index, { split_with: [] })}
                  >
                    Just me
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {drafts.length === 0 && (
        <p className="fineprint center">Nothing pending. Type a line above, or tap Manual entry.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- year */

export function YearScreen({ members, viewerId, pickViewer }) {
  const [year, setYear] = useState(Number(todayMonth().slice(0, 4)));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .year(year, viewerId)
      .then((res) => alive && setData(res.year))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [year, viewerId]);

  const mine = data?.viewer || null;
  const bars = mine ? mine.months.map((m) => ({ month: m.month, total: m.share })) : data?.months || [];
  const maxMonth = Math.max(...bars.map((m) => m.total), 1);
  const best = bars.length ? [...bars].sort((a, b) => b.total - a.total)[0] : null;
  const total = mine ? mine.share : data?.total || 0;

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head">
          <h2>{year}</h2>
          <div className="row gap">
            <button className="icon-btn" onClick={() => setYear(year - 1)} aria-label="Previous year">‹</button>
            <button
              className="icon-btn"
              onClick={() => setYear(year + 1)}
              disabled={year >= Number(todayMonth().slice(0, 4))}
              aria-label="Next year"
            >
              ›
            </button>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        {!data && <p className="muted small">Loading…</p>}
        {data && (
          <>
            <p className="eyebrow">{mine ? `Your share · ${year}` : `Whole flat · ${year}`}</p>
            <h1 className="big-money">{inr(total)}</h1>
            <div className="hero-meta">
              {mine ? (
                <>
                  <span>you paid {inr(mine.paid)}</span>
                  <span className="dot" />
                  <span className="muted">flat {inr(data.total)}</span>
                  <span className="dot" />
                  <span>{plain(mine.count)} entries of yours</span>
                </>
              ) : (
                <>
                  <span>{plain(data.count)} entries</span>
                  <span className="dot" />
                  <span>Cash {inr(data.cash)}</span>
                  <span className="dot" />
                  <span>Online {inr(data.online)}</span>
                </>
              )}
            </div>
            <div className="chips year-chips">
              <button className={`chip small ${mine ? '' : 'on'}`} onClick={() => pickViewer('')}>
                Whole flat
              </button>
              {members.map((member) => (
                <button
                  key={member.id}
                  className={`chip small ${viewerId === member.id ? 'on' : ''}`}
                  onClick={() => pickViewer(member.id)}
                >
                  {member.name}
                </button>
              ))}
            </div>
            <div className="year-bars">
              {bars.map((month) => (
                <div className="year-bar-col" key={month.month} title={`${monthShort(month.month)}: ${inr(month.total)}`}>
                  <div className="year-bar-slot">
                    <div
                      className={`year-bar ${month.month === todayMonth() ? 'current' : ''}`}
                      style={{ height: `${Math.max(2, (month.total / maxMonth) * 100)}%` }}
                    />
                  </div>
                  <span>{monthShort(month.month)}</span>
                </div>
              ))}
            </div>
            {best && best.total > 0 && (
              <p className="fineprint">
                Heaviest month: {monthLabel(best.month)} at {inr(best.total)}.
              </p>
            )}
          </>
        )}
      </section>

      {data && (
        <section className="card">
          <div className="card-head">
            <h2>Categories in {year}</h2>
            <a className="ghost small" href={`/api/export?year=${year}`} download>
              Export CSV
            </a>
          </div>
          <ul className="cat-list">
            {(mine ? mine.byCategory : data.byCategory).map((cat, index, list) => (
              <li key={cat.category}>
                <div className="cat-row">
                  <span className="cat-name">
                    <span className="cat-emoji">{emojiFor(cat.category)}</span>
                    {cat.category}
                  </span>
                  <span className="cat-amount">{inr(cat.amount)}</span>
                </div>
                <div className="cat-track">
                  <div
                    className="cat-fill"
                    style={{ width: `${Math.max(3, (cat.amount / (list[0]?.amount || 1)) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          {(mine ? mine.byCategory : data.byCategory).length === 0 && (
            <p className="muted small">Nothing recorded in {year}.</p>
          )}
        </section>
      )}

      {data && (
        <section className="card">
          <div className="card-head">
            <h2>Paid by</h2>
          </div>
          <ul className="person-list">
            {data.paid.map((person) => (
              <li key={person.id}>
                <span className="avatar">{person.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow">{person.name}</span>
                <span className="mono">{inr(person.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ split */

export function SplitScreen({ payload, month, viewer }) {
  const [insight, setInsight] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!payload) return <p className="muted">Loading…</p>;
  const { balances, summary } = payload;
  const myNet = viewer ? balances.net.find((p) => p.id === viewer.id)?.amount || 0 : 0;
  const mySettlements = viewer
    ? balances.settlements.filter((s) => s.from === viewer.name || s.to === viewer.name)
    : [];

  const askAi = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.aiInsight(month, viewer?.id || '');
      setInsight(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      {viewer && (
        <section className="card you-card">
          <div className="card-head">
            <h2>Your part · {viewer.name}</h2>
            <span className={`pill ${myNet > 0 ? 'ok' : 'off'}`}>
              {myNet > 0 ? 'owed to you' : myNet < 0 ? 'you owe' : 'square'}
            </span>
          </div>
          <h1 className="big-money">{inr(Math.abs(myNet))}</h1>
          <p className="fineprint">
            {myNet > 0
              ? 'The flat is carrying this much of your spending. They pay you.'
              : myNet < 0
                ? 'You have spent less than your share. You pay this back.'
                : 'You have paid exactly your share. Nothing to settle.'}
          </p>
          <div className="settle">
            <h3>Just your payments</h3>
            {mySettlements.length === 0 && <p className="muted small">You are not in any pending settlement.</p>}
            {mySettlements.map((settle, index) => (
              <div className="settle-row" key={index}>
                <span>{settle.from === viewer.name ? 'You' : settle.from}</span>
                <span className="arrow">→</span>
                <span>{settle.to === viewer.name ? 'you' : settle.to}</span>
                <span className="mono">{inr(settle.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Who owes whom</h2>
          <span className="muted small">all time</span>
        </div>
        <ul className="person-list">
          {balances.net.map((person) => (
            <li key={person.id}>
              <span className="avatar">{person.name.slice(0, 1).toUpperCase()}</span>
              <span className="grow">{person.name}</span>
              <span className={`mono ${person.amount > 0 ? 'pos' : person.amount < 0 ? 'neg' : 'muted'}`}>
                {person.amount > 0 ? '+' : ''}
                {inr(person.amount)}
              </span>
            </li>
          ))}
        </ul>

        <div className="settle">
          <h3>Settle in {balances.settlements.length} payment{balances.settlements.length === 1 ? '' : 's'}</h3>
          {balances.settlements.length === 0 && <p className="muted small">Everyone is square. Nothing to settle.</p>}
          {balances.settlements.map((settle, index) => (
            <div className="settle-row" key={index}>
              <span>{settle.from}</span>
              <span className="arrow">→</span>
              <span>{settle.to}</span>
              <span className="mono">{inr(settle.amount)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>This month at a glance</h2>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">Total</span>
            <strong>{inr(summary.total)}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Cash</span>
            <strong>{inr(summary.cash)}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Average entry</span>
            <strong>{inr(summary.avgEntry)}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Projected</span>
            <strong>{inr(summary.projection)}</strong>
          </div>
        </div>
      </section>

      <section className="card insight-card">
        <div className="card-head">
          <h2>Money coach</h2>
          <button className="ghost small" onClick={askAi} disabled={busy}>
            {busy ? 'Thinking…' : insight ? 'Again' : 'Read my month'}
          </button>
        </div>
        {!insight && !error && (
          <p className="muted small">
            Ask the AI for a blunt read on {monthLabel(month)}: biggest category, cash habit, and one thing to
            change next month.
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        {insight && (
          <div className="insight">
            <p className="insight-headline">{insight.headline}</p>
            <ul>
              {insight.points.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
            <p className="insight-action">👉 {insight.action}</p>
          </div>
        )}
      </section>
    </div>
  );
}

/* --------------------------------------------------------------- settings */

export function SettingsSheet({ me, members, viewerId, onPickViewer, onClose, onChanged, onLogout, notify }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  const addMember = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.addMember({ name: name.trim() });
      setName('');
      await onChanged();
      notify('Person added');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (id) => {
    setBusy(true);
    setError('');
    try {
      await api.removeMember(id);
      setConfirmId(null);
      await onChanged();
      notify('Person removed');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{me.household?.name || 'Settings'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sheet-body">
          <h3>This phone is</h3>
          <div className="chips">
            <button className={`chip small ${viewerId ? '' : 'on'}`} onClick={() => onPickViewer('')}>
              Whole flat
            </button>
            {members.map((member) => (
              <button
                key={member.id}
                className={`chip small ${viewerId === member.id ? 'on' : ''}`}
                onClick={() => onPickViewer(member.id)}
              >
                {member.name}
              </button>
            ))}
          </div>

          <h3>People</h3>
          <ul className="person-list compact">
            {members.map((member) => (
              <li key={member.id}>
                <span className="avatar">{member.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow">{member.name}</span>
                {confirmId === member.id ? (
                  <button className="danger small" onClick={() => removeMember(member.id)} disabled={busy}>
                    Remove
                  </button>
                ) : (
                  <button
                    className="ghost small"
                    onClick={() => setConfirmId(member.id)}
                    disabled={members.length < 2}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>

          <form className="row gap" onSubmit={addMember}>
            <input
              className="text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Add a flatmate"
              maxLength={40}
            />
            <button className="primary small" disabled={busy || !name.trim()}>
              Add
            </button>
          </form>
          {error && <p className="error-text">{error}</p>}

          <h3>Data</h3>
          <a className="ghost wide center" href="/api/export" download>
            Download everything as CSV
          </a>
          <p className="fineprint">
            One household, one passcode. Everyone with the passcode sees and edits the same ledger.
          </p>

          <button className="ghost wide" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
