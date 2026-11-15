import { useCallback, useEffect, useState } from 'react';
import { api, monthLabel, shiftMonth, todayMonth } from './api';
import {
  AddScreen,
  LoginScreen,
  MonthScreen,
  SetupScreen,
  SettingsSheet,
  Splash,
  SplitScreen,
  YearScreen
} from './screens.jsx';

const TABS = [
  { id: 'month', label: 'Month', icon: '◔' },
  { id: 'add', label: 'Add', icon: '＋' },
  { id: 'year', label: 'Year', icon: '▤' },
  { id: 'split', label: 'Split', icon: '⇄' }
];

export default function App() {
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState('month');
  const [month, setMonth] = useState(todayMonth());
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [viewerId, setViewerId] = useState(() => {
    try {
      return window.localStorage.getItem('khoroch.viewer') || '';
    } catch {
      return '';
    }
  });

  const pickViewer = useCallback((id) => {
    setViewerId(id || '');
    try {
      if (id) window.localStorage.setItem('khoroch.viewer', id);
      else window.localStorage.removeItem('khoroch.viewer');
    } catch {
      /* private mode */
    }
  }, []);

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const data = await api.me();
      setMe(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBooting(false);
    }
  }, []);

  const loadMonth = useCallback(async (target) => {
    setLoading(true);
    try {
      const data = await api.summary(target, viewerId);
      setPayload(data);
      setAiEnabled(Boolean(data.ai));
    } catch (err) {
      if (err.status === 401) setMe((prev) => ({ setup: true, authed: false, ...(prev || {}) }));
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [viewerId]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (me?.authed) loadMonth(month);
  }, [me?.authed, month, loadMonth, viewerId]);

  const refresh = useCallback(() => loadMonth(month), [loadMonth, month]);

  const goToMonth = useCallback(
    (target) => {
      setMonth(target);
      setTab('month');
    },
    []
  );

  if (booting) return <Splash />;
  if (!me) return <Splash message="Could not reach the ledger." />;

  if (!me.setup) return <SetupScreen onDone={loadMe} />;
  if (!me.authed)
    return <LoginScreen household={me.household} onDone={loadMe} />;

  const members = payload?.members || me.members || [];
  const viewer = members.find((m) => m.id === viewerId) || null;
  const currentMonth = todayMonth();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">৳</span>
          <div>
            <strong>Khoroch</strong>
            <span className="brand-sub">{me.household?.name || 'Our flat'}</span>
          </div>
        </div>

        {tab === 'month' && (
          <div className="month-nav">
            <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
              ‹
            </button>
            <span>{monthLabel(month)}</span>
            <button
              className="icon-btn"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={month >= currentMonth}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        )}

        <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          ⚙
        </button>
      </header>

      <main className="main">
        {error && (
          <div className="banner error">
            {error}
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {tab === 'month' && (
          <MonthScreen
            payload={payload}
            loading={loading}
            month={month}
            members={members}
            viewer={viewer}
            onPickViewer={pickViewer}
            onDelete={async (id) => {
              await api.deleteExpense(id);
              notify('Entry removed');
              refresh();
            }}
            onGoAdd={() => setTab('add')}
          />
        )}

        {tab === 'add' && (
          <AddScreen
            members={members}
            aiEnabled={aiEnabled}
            defaultPayer={viewerId}
            defaultMonth={month}
            notify={notify}
            onSaved={(count) => {
              notify(`${count} ${count === 1 ? 'entry' : 'entries'} saved`);
              refresh();
              setTab('month');
            }}
          />
        )}

        {tab === 'year' && <YearScreen members={members} month={month} viewerId={viewerId} pickViewer={pickViewer} />}

        {tab === 'split' && <SplitScreen payload={payload} month={month} viewer={viewer} pickViewer={pickViewer} />}
      </main>

      <nav className="tabbar">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`tab ${tab === item.id ? 'active' : ''} ${item.id === 'add' ? 'tab-add' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <span className="tab-icon">{item.icon}</span>
            <span className="tab-label">{item.label}</span>
          </button>
        ))}
      </nav>

      {settingsOpen && (
        <SettingsSheet
          me={me}
          members={members}
          viewerId={viewerId}
          onPickViewer={pickViewer}
          onClose={() => setSettingsOpen(false)}
          onChanged={async () => {
            await loadMe();
            refresh();
          }}
          onLogout={async () => {
            await api.logout();
            setSettingsOpen(false);
            setPayload(null);
            loadMe();
          }}
          notify={notify}
        />
      )}

      {toast && <div className="toast">{toast}</div>}

      <button className="fab" onClick={() => setTab('add')} aria-label="Add expense">
        ＋
      </button>
    </div>
  );
}
