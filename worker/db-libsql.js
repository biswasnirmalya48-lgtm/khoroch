// The API is written against Cloudflare D1's prepare/bind/first/all/run shape.
// libSQL (Turso) speaks the same SQLite dialect, so a thin adapter is enough to run
// the exact same worker code on Vercel instead of Cloudflare.

class Statement {
  constructor(client, sql, args) {
    this.client = client;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new Statement(this.client, this.sql, args);
  }

  async all() {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return { results: result.rows, success: true };
  }

  async first() {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return result.rows[0] ?? null;
  }

  async run() {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return { success: true, meta: { changes: result.rowsAffected } };
  }
}

export function makeDb(client) {
  return {
    prepare: (sql) => new Statement(client, sql, []),
    exec: (sql) => client.executeMultiple(sql),
    batch: (statements) => client.batch(statements.map((s) => ({ sql: s.sql, args: s.args })))
  };
}
