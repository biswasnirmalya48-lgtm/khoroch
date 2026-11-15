# Khoroch — খরচ

A shared flat expense tracker for cash **and** online spends, built for four people living together.
One ledger, one passcode, month-by-month and year-by-year totals, and an AI that types your expenses
for you.

```
browser ──► Cloudflare Worker ──► D1 (SQLite)
                 │
                 └──► Groq API  (server-side key only)
```

## What it does

- **Cash and online, side by side.** Every entry records how you paid, so you can see the split. A
  "small cash leak" card totals the under-₹200 cash spends most trackers hide.
- **Flatmate aware.** Each expense knows who paid and who shares it. Balances carry over months and
  settle-up gives the **minimum number of transfers** to make everyone square.
- **Month view.** Big total, per-day average, end-of-month projection, day-by-day bars, category
  breakdown, who paid what, and the latest entries with delete.
- **Year view.** Twelve monthly bars, category totals for the year, who paid the most, CSV export.
- **AI quick add (Groq).** Type a line in plain English, Hindi, Bengali or Hinglish:

  ```
  auto 60 cash, dinner 900 gpay split with all, Ravi paid 250 for milk
  ```

  It becomes three editable entries. Nothing is saved until you press **Save all**.
- **AI money coach.** A blunt monthly read: biggest category, cash habit, comparison with last month,
  and one concrete thing to change.
- **Private by default.** Data lives in your own D1 database. No accounts, no analytics, no ads.

## Signing in

Two ways in, both free:

- **Google sign-in.** A "Continue with Google" button opens Google's consent screen and returns to
  `/api/auth/google/callback`. The server exchanges the code, reads the verified email from the
  `id_token` Google returns, checks it against `GOOGLE_ALLOWED_EMAILS`, then issues the same
  `HttpOnly` session cookie the passcode uses. No library, no paid service.
- **The flat passcode.** Still there, below the Google button, so nothing can lock you out.

Setup (about five minutes, free):

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application**.
2. Authorised redirect URI — exactly one of these, matching where you run it:
   - `https://<your-vercel-domain>/api/auth/google/callback`
   - `http://localhost:8787/api/auth/google/callback` (local, for testing)
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_ALLOWED_EMAILS` (comma separated Gmails).

Without those variables the button is hidden and the passcode works exactly as before.

## Access model

One household per deployment. The first visitor sets the flat name, a passcode and the flatmates.
Everyone with the passcode opens the same ledger from any device; the session is an HMAC-signed,
`HttpOnly` cookie (30 days). Passcodes are stored as PBKDF2-SHA256 (150k iterations) with a random
salt.

## Run locally

```bash
npm install
npm run build                 # client → dist/, worker → worker-build/worker.js
npx wrangler dev --port 8787  # serves dist/ and /api on http://127.0.0.1:8787
```

For client hot reload, in a second terminal:

```bash
npm run dev                   # Vite on :5173, proxies /api to :8787
```

Local data lives in `.wrangler/state` (a real SQLite file). Delete that folder to start over.

### Switching on the AI

The Groq key is only ever read inside the Worker:

```bash
echo 'GROQ_API_KEY=your_key_here' > .dev.vars   # git-ignored
```

Optional: `GROQ_MODEL` (default `openai/gpt-oss-120b`), `GROQ_API_URL`.

## Whose money

Tap a name under **Whose money** on the Month tab (or in Settings → *This phone is*) and the whole app
switches to that person: your share of every bill, what you paid out of pocket, what you owe or are owed,
and your own categories. A ₹500 fan split 4 ways counts as ₹125 for you. Choose **Whole flat** to go back to
the shared totals. The same choice applies on the Year tab and to the AI coach, which then talks about your
share instead of the flat's.

Without a key the app works fully — only the natural-language box and the coach are disabled, and both
say so plainly.

## Deploy on Vercel (auto-deploy from GitHub)

The API is written against D1's API shape, and `worker/db-libsql.js` adapts a libSQL client to that same
shape, so this repository deploys to Vercel unchanged: `api/khoroch.js` runs the worker code as a Node
function, and everything under `/api/*` is rewritten to it.

```
GitHub push ──► Vercel builds ──► static dist/  +  api/khoroch.js ──► Turso (libSQL)
```

1. Create a free database at [turso.tech](https://turso.tech) and copy two values:

   ```bash
   turso db create khoroch
   turso db show khoroch --url          # → TURSO_DATABASE_URL
   turso db tokens create khoroch       # → TURSO_AUTH_TOKEN
   ```

2. In Vercel: **Add New → Project → import this GitHub repository**. Framework is detected as Vite;
   `vercel.json` sets the build command, output directory and the `/api` rewrite.
3. Add environment variables in **Vercel → Settings → Environment Variables**:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GROQ_API_KEY` (see `.env.example`).
4. **Deploy.** After that every `git push` to `main` builds and publishes automatically.

The schema creates itself on the first request. Without `TURSO_DATABASE_URL` the API answers `503` with
that instruction instead of failing silently.

### Test the Vercel API locally

```bash
npm run api:local    # same handler + a real libSQL file DB on http://127.0.0.1:8790
```

It reads `GROQ_API_KEY` from `.dev.vars` and keeps data in `.tmp/khoroch-local.db` (git-ignored).

## Deploy on Freebuff Sites

```bash
npm run build
```

Then deploy `manifest.json` (entrypoint `worker-build/worker.js`, assets `dist/`), add a **D1** binding
named `DB`, and set the `GROQ_API_KEY` secret in **Sites → Secrets**. Deploy once before adding the
secret so the binding attaches.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/me` | Setup state + session check |
| `POST` | `/api/setup` | Create the household (name, passcode, members) |
| `POST` | `/api/login` · `/api/logout` | Passcode session |
| `GET` | `/api/summary?month=YYYY-MM` | Month totals, categories, daily series, balances, entries |
| `GET` | `/api/year?year=YYYY` | Twelve months + category totals |
| `POST` | `/api/expenses` | Add one or many entries |
| `PATCH`/`DELETE` | `/api/expenses/:id` | Edit or remove an entry |
| `POST` | `/api/members` · `DELETE /api/members/:id` | Manage flatmates |
| `GET` | `/api/export?year=YYYY` | CSV download |
| `POST` | `/api/ai/parse` | Natural language → structured entries |
| `POST` | `/api/ai/insight` | Monthly coaching note |

Money is stored as integer paise, so totals never drift from rounding. Amounts in the API are rupees.

## Layout

```
worker/
  index.js      routing, auth checks, validation
  db.js         schema
  report.js     month/year maths, balances, CSV
  ai.js         Groq prompts for parsing and insights
  auth.js       PBKDF2 passcodes + HMAC sessions
src/
  App.jsx       shell, tabs, data loading
  screens.jsx   auth, month, add, year, split, settings
  api.js        fetch client + INR formatting
  styles.css
```
