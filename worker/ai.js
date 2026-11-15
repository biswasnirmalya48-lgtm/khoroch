const DEFAULT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const CATEGORIES = ['Food', 'Groceries', 'Rent', 'Bills', 'Transport', 'Shopping', 'Health', 'Fun', 'Recharge', 'Other'];

export function aiConfigured(env) {
  return Boolean(env.GROQ_API_KEY);
}

async function chat(env, system, user, maxTokens = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(env.GROQ_API_URL || DEFAULT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: env.GROQ_MODEL || DEFAULT_MODEL,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('groq error', res.status, body.slice(0, 400));
      const err = new Error(res.status === 401 ? 'The AI key was rejected by the provider.' : 'The AI provider is not responding right now.');
      err.status = res.status === 429 ? 429 : 502;
      throw err;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('The AI answer was not valid JSON.');
  }
}

const SYSTEM_PARSE = `You convert messy money notes into structured expense JSON. Output JSON only, no prose.
Rules:
- Split one sentence into several expenses when several separate amounts are mentioned.
- "amount" is a positive number in rupees, digits only (250, 99.5).
- "category" must be one of: ${CATEGORIES.join(', ')}.
- "method" is "cash" when the note says cash, "handed over", "notes", "change", or similar; otherwise "online" (UPI, GPay, PhonePe, Paytm, card, bank).
- "paid_by" is the name of the member who paid. If unclear, use the first member listed.
- "split_with" lists members sharing the cost. split / share / together / everyone / for the flat / all of us means every member. "just me", "personal", "only me" means an empty array. Mentioning specific names means only those members.
- "spent_on" is YYYY-MM-DD, using the reference date for "today" or relative words like yesterday.
- "note" is a short human label, at most 6 words.
Return {"items":[{"amount":0,"category":"","method":"","note":"","paid_by":"","split_with":[],"spent_on":"YYYY-MM-DD"}]}
If the text contains no money at all, return {"items":[]}.`;

export async function aiParse(env, { text, members, today }) {
  const names = members.map((m) => m.name);
  const system = `${SYSTEM_PARSE}
Reference date: ${today}.
Members: ${names.join(', ')}. Use these exact names in paid_by and split_with.`;
  const raw = await chat(env, system, text);
  const parsed = parseJson(raw);
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  const byName = new Map(names.map((n) => [n.toLowerCase(), n]));
  const pick = (value) => {
    if (!value) return null;
    const key = String(value).trim().toLowerCase();
    if (byName.has(key)) return byName.get(key);
    const loose = names.find((n) => n.toLowerCase().startsWith(key) || key.startsWith(n.toLowerCase()));
    return loose || null;
  };

  return items
    .map((item) => {
      const amount = Number(item.amount);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const method = String(item.method || '').toLowerCase() === 'cash' ? 'cash' : 'online';
      const category = CATEGORIES.includes(item.category) ? item.category : 'Other';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(item.spent_on)) ? item.spent_on : today;
      const split = Array.isArray(item.split_with) ? item.split_with.map(pick).filter(Boolean) : [];
      return {
        amount: Math.round(amount * 100) / 100,
        category,
        method,
        note: String(item.note || '').slice(0, 120),
        spent_on: date,
        paid_by: pick(item.paid_by) || names[0] || null,
        split_with: [...new Set(split)]
      };
    })
    .filter(Boolean)
    .slice(0, 25);
}

const SYSTEM_INSIGHT = `You are a blunt but warm money coach for a shared flat in India. You get one month of spending data.
Reply with JSON only: {"headline":"...","points":["..."],"action":"..."}
- headline: one short sentence about the month, under 16 words.
- points: 2 to 3 observations, each under 20 words, each backed by a number from the data. Point out the biggest category, cash vs online behaviour, small cash spends, or how this month compares to the previous one if data is given.
- action: one concrete, doable saving suggestion for next month, under 20 words.
Never invent numbers that are not in the data. If spending is low and healthy, say so plainly.`;

export async function aiInsight(env, { summary, members, previous, householdName }) {
  const payload = {
    flat: householdName,
    members: members.map((m) => m.name),
    month: summary.month,
    total_rupees: summary.total,
    cash_rupees: summary.cash,
    online_rupees: summary.online,
    entries: summary.count,
    average_per_entry: summary.avgEntry,
    daily_average: summary.dailyAverage,
    projected_month_total: summary.projection,
    small_cash_spends_under_200: summary.smallCash,
    by_category: summary.byCategory.map((c) => ({ category: c.category, rupees: c.amount, entries: c.count })),
    previous_month_total: previous ?? null
  };
  const raw = await chat(env, SYSTEM_INSIGHT, JSON.stringify(payload), 600);
  const parsed = parseJson(raw);
  return {
    headline: String(parsed.headline || '').slice(0, 200),
    points: Array.isArray(parsed.points) ? parsed.points.slice(0, 4).map((p) => String(p).slice(0, 240)) : [],
    action: String(parsed.action || '').slice(0, 240)
  };
}
