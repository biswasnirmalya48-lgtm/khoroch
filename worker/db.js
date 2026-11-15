const SCHEMA = `
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  passcode_hash TEXT NOT NULL,
  passcode_salt TEXT NOT NULL,
  session_secret TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '\u20b9',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  category TEXT NOT NULL,
  method TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  spent_on TEXT NOT NULL,
  paid_by TEXT,
  split_with TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_household_date ON expenses(household_id, spent_on);
`;

let ready = null;

export async function ensureSchema(db) {
  if (!ready) {
    ready = (async () => {
      await db.exec(SCHEMA.replace(/\n/g, ' '));
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
