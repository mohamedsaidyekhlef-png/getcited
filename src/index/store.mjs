// The index store: one SQLite file (WAL mode) per index, built-in to Node 22+.
// Observations are append-only; everything else is derived from them and can be rebuilt.

import { hash } from "./normalize.mjs";

const SCHEMA = `
pragma journal_mode = wal;
pragma synchronous = normal;
pragma foreign_keys = on;
pragma temp_store = memory;

create table if not exists prompts (
  id integer primary key, text text not null, topic text not null default 'General',
  market text not null default 'us-en', created_at text not null default (datetime('now')),
  unique (text, market));
create table if not exists brands (
  name text primary key, domain text, aliases text not null default '[]', own integer not null default 0);
create table if not exists runs (
  id integer primary key, started_at text not null default (datetime('now')), finished_at text,
  budget_usd real, spent_usd real not null default 0, status text not null default 'running', note text);
create table if not exists observations (
  id integer primary key, run_id integer not null references runs(id), prompt_id integer not null references prompts(id),
  engine text not null, model text not null, market text not null, sample integer not null default 0,
  job_key text not null unique, answer text not null, answer_hash text not null,
  latency_ms integer, cost_usd real, collected_at text not null default (datetime('now')), raw text);
create index if not exists obs_prompt on observations(prompt_id, engine, run_id);
create index if not exists obs_run on observations(run_id);
create table if not exists citations (
  observation_id integer not null references observations(id), position integer not null,
  url text not null, canon_url text not null, domain text not null, source_type text not null,
  title text, span_start integer, span_end integer, support_text text,
  primary key (observation_id, position));
create index if not exists cit_domain on citations(domain);
create index if not exists cit_canon on citations(canon_url);
create table if not exists mentions (
  observation_id integer not null references observations(id), brand text not null,
  first_offset integer not null, list_rank integer, count integer not null,
  primary key (observation_id, brand));
create index if not exists men_brand on mentions(brand);
create table if not exists pages (
  canon_url text primary key, final_url text, status integer, fetched_at text, content_hash text,
  title text, published text, words integer, error text);
create table if not exists passages (
  id integer primary key, canon_url text not null references pages(canon_url), ord integer not null,
  heading text, text text not null);
create index if not exists pas_url on passages(canon_url);
create virtual table if not exists passages_fts using fts5(heading, text, content='passages', content_rowid='id', tokenize='porter unicode61');
create trigger if not exists pas_ai after insert on passages begin
  insert into passages_fts(rowid, heading, text) values (new.id, new.heading, new.text); end;
create trigger if not exists pas_ad after delete on passages begin
  insert into passages_fts(passages_fts, rowid, heading, text) values ('delete', old.id, old.heading, old.text); end;
create table if not exists attributions (
  observation_id integer not null references observations(id), sentence_idx integer not null,
  sentence text not null, canon_url text, passage_id integer, score real, method text not null,
  label_url text,
  primary key (observation_id, sentence_idx, method));
`;

export async function openIndex(file = ":memory:") {
  // node:sqlite is still flagged experimental on Node 22; silence that one warning.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w).includes("SQLite") ? undefined : emit.call(process, w, ...a));
  const { DatabaseSync } = await import("node:sqlite");
  process.emitWarning = emit;
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return new Index(db);
}

export class Index {
  constructor(db) {
    this.db = db;
    this.q = {};
    const p = (k, sql) => (this.q[k] = db.prepare(sql));
    p("addPrompt", "insert into prompts(text, topic, market) values (?, ?, ?) on conflict(text, market) do update set topic = excluded.topic returning id");
    p("addBrand", "insert into brands(name, domain, aliases, own) values (?, ?, ?, ?) on conflict(name) do update set domain = excluded.domain, aliases = excluded.aliases, own = excluded.own");
    p("newRun", "insert into runs(budget_usd, note) values (?, ?) returning id");
    p("endRun", "update runs set finished_at = datetime('now'), status = ?, spent_usd = ? where id = ?");
    p("hasJob", "select id from observations where job_key = ?");
    p("addObs", `insert into observations(run_id, prompt_id, engine, model, market, sample, job_key, answer, answer_hash, latency_ms, cost_usd, raw)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`);
    p("addCit", "insert or replace into citations values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    p("addMen", "insert or replace into mentions values (?, ?, ?, ?, ?)");
  }

  tx(fn) {
    this.db.exec("begin");
    try { const r = fn(); this.db.exec("commit"); return r; } catch (e) { this.db.exec("rollback"); throw e; }
  }

  addPrompts(list, market = "us-en") {
    return this.tx(() => list.map((p) => (typeof p === "string" ? { text: p } : p)).map((p) => ({ ...p, id: this.q.addPrompt.get(p.text, p.topic || "General", p.market || market).id })));
  }

  setBrands(list) {
    this.tx(() => { for (const b of list) this.q.addBrand.run(b.name, b.domain || null, JSON.stringify(b.aliases || []), b.own ? 1 : 0); });
    this._brands = null;
  }

  brands() {
    return (this._brands ||= this.db.prepare("select * from brands").all().map((b) => ({ ...b, aliases: JSON.parse(b.aliases), own: Boolean(b.own) })));
  }

  prompts(filter = {}) {
    if (filter.topic) return this.db.prepare("select * from prompts where topic = ? order by id").all(filter.topic);
    return this.db.prepare("select * from prompts order by id").all();
  }

  startRun(budgetUsd = null, note = null) { return this.q.newRun.get(budgetUsd, note).id; }
  endRun(id, status, spent) { this.q.endRun.run(status, spent, id); }

  static jobKey({ runId, promptId, engine, model, market, sample }) { return hash([runId, promptId, engine, model, market, sample].join("\u0001")); }
  hasJob(key) { return Boolean(this.q.hasJob.get(key)); }

  /** Store one normalized observation with its citations and mentions, atomically. */
  addObservation(o) {
    return this.tx(() => {
      const id = this.q.addObs.get(o.runId, o.promptId, o.engine, o.model, o.market, o.sample, o.jobKey, o.answer, hash(o.answer), o.latencyMs ?? null, o.costUsd ?? null, o.raw ?? null).id;
      for (const c of o.citations) this.q.addCit.run(id, c.position, c.url, c.canonUrl, c.domain, c.sourceType, c.title ?? null, c.spanStart ?? null, c.spanEnd ?? null, c.support ?? null);
      for (const m of o.mentions) this.q.addMen.run(id, m.brand, m.firstOffset, m.listRank ?? null, m.count);
      return id;
    });
  }

  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  close() { this.db.close(); }
}
