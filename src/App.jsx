import { useCallback, useEffect, useRef, useState } from 'react';
import { api, monthLabel, shiftMonth, todayMonth } from './api';
import {
  AddScreen,
  LoginScreen,
  MonthScreen,
  SetupScreen,
  SettingsSheet,
  Splash,
  SplitScreen,
  WhoAreYou,
  YearScreen
} from './screens.jsx';

// The comic cover: drone footage of a Superman mural, dimmed under the app, with
// halftone dots and speed lines printed over it. Falls back to a still frame when
// someone asks for less motion.
function Stage() {
  const videoRef = useRef(null);
  const [motionOk, setMotionOk] = useState(true);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotionOk(!query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const sync = () => {
      if (document.hidden) video.pause();
      else video.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [motionOk]);

  return (
    <div className="stage" aria-hidden="true">
      {motionOk ? (
        <video
          ref={videoRef}
          className="stage-video"
          src="/superman-720.mp4"
          poster="/superman-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      ) : (
        <div className="stage-poster" />
      )}
      <div className="stage-scrim" />
      <div className="stage-halftone" />
      <div className="stage-lines" />
    </div>
  );
}

// A scrolling comic masthead so the page never sits still.
function Ticker({ text }) {
  const line = `★ ${text} ★`;
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        <span>{line}</span>
        <span>{line}</span>
        <span>{line}</span>
        <span>{line}</span>
      </div>
    </div>
  );
}

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
  // "flat" is a real choice too, so picking the whole flat must not re-open the name screen.
  const [whoChosen, setWhoChosen] = useState(() => {
    try {
      return window.localStorage.getItem('khoroch.who') !== null;
    } catch {
      return false;
    }
  });
  const [viewerId, setViewerId] = useState(() => {
    try {
      const stored = window.localStorage.getItem('khoroch.who');
      return stored && stored !== 'flat' ? stored : '';
    } catch {
      return '';
    }
  });

  const pickViewer = useCallback((id) => {
    setViewerId(id || '');
    setWhoChosen(true);
    try {
      window.localStorage.setItem('khoroch.who', id || 'flat');
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

  // A stored name can belong to a flat that was set up again; drop it instead of silently hiding the picker.
  useEffect(() => {
    if (!viewerId || !me?.authed) return;
    const list = payload?.members || me?.members || [];
    if (list.length > 0 && !list.some((m) => m.id === viewerId)) {
      setViewerId('');
      setWhoChosen(false);
      try {
        window.localStorage.removeItem('khoroch.who');
        window.localStorage.removeItem('khoroch.viewer');
      } catch {
        /* private mode */
      }
    }
  }, [viewerId, payload, me]);

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

  const shell = (content) => (
    <>
      <Stage />
      {content}
    </>
  );

  if (booting) return shell(<Splash />);
  if (!me) return shell(<Splash message="Could not reach the ledger." />);

  if (!me.setup) return shell(<SetupScreen onDone={loadMe} />);
  if (!me.authed)
    return shell(<LoginScreen household={me.household} google={me.google} onDone={loadMe} />);

  const members = payload?.members || me.members || [];
  const viewer = members.find((m) => m.id === viewerId) || null;
  const currentMonth = todayMonth();

  if (members.length > 1 && !whoChosen) {
    return shell(
      <WhoAreYou
        members={members}
        household={me.household}
        onPick={pickViewer}
        onSkip={() => pickViewer('')}
      />
    );
  }

  return shell(
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

      <Ticker text={`Khoroch · ${monthLabel(month)} · ${me.household?.name || 'our flat'} · cash vs online · who owes whom`} />

      <main className="main" key={tab}>
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
