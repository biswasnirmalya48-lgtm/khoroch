async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (data && data.error) || 'Request failed.';
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  me: () => request('/me'),
  setup: (body) => request('/setup', { method: 'POST', body }),
  login: (body) => request('/login', { method: 'POST', body }),
  logout: () => request('/logout', { method: 'POST' }),
  config: () => request('/config'),
  addMember: (body) => request('/members', { method: 'POST', body }),
  removeMember: (id) => request(`/members/${id}`, { method: 'DELETE' }),
  summary: (month) => request(`/summary?month=${month}`),
  year: (year) => request(`/year?year=${year}`),
  addExpenses: (items) => request('/expenses', { method: 'POST', body: { items } }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: 'DELETE' }),
  aiParse: (text) => request('/ai/parse', { method: 'POST', body: { text } }),
  aiInsight: (month) => request('/ai/insight', { method: 'POST', body: { month } })
};

export const inr = (value, opts = {}) => {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    minimumFractionDigits: 0,
    ...opts
  }).format(n);
};

export const plain = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value) || 0);

export const monthLabel = (month) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const monthShort = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });

export const todayMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export const todayDate = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

export function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, mon - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export const CATEGORIES = [
  { name: 'Food', emoji: '🍲' },
  { name: 'Groceries', emoji: '🛒' },
  { name: 'Rent', emoji: '🏠' },
  { name: 'Bills', emoji: '💡' },
  { name: 'Transport', emoji: '🛺' },
  { name: 'Shopping', emoji: '🛍️' },
  { name: 'Health', emoji: '💊' },
  { name: 'Fun', emoji: '🎬' },
  { name: 'Recharge', emoji: '📱' },
  { name: 'Other', emoji: '🧾' }
];

export const emojiFor = (name) => CATEGORIES.find((c) => c.name === name)?.emoji || '🧾';

export const friendlyDate = (iso) => {
  if (!iso) return '';
  const today = todayDate();
  if (iso === today) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const offset = yesterday.getTimezoneOffset() * 60000;
  const y = new Date(yesterday.getTime() - offset).toISOString().slice(0, 10);
  if (iso === y) return 'Yesterday';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
