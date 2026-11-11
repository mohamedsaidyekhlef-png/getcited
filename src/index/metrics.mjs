// Metrics over the index. Every number can be traced back to observations, and every
// rate comes with its sample size and a Wilson 95% interval, because answer engines are
// stochastic: one answer is an anecdote, a rate over samples is a measurement.

export function wilson(k, n, z = 1.96) {
  if (!n) return { p: 0, lo: 0, hi: 0, n: 0 };
  const p = k / n, z2 = z * z;
  const c = (p + z2 / (2 * n)) / (1 + z2 / n);
  const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n, k };
}

function scope({ runId, engine, topic, promptId } = {}) {
  const w = [], a = [];
  if (runId != null) { w.push("o.run_id = ?"); a.push(runId); }
  if (engine) { w.push("o.engine = ?"); a.push(engine); }
  if (promptId != null) { w.push("o.prompt_id = ?"); a.push(promptId); }
  if (topic) { w.push("o.prompt_id in (select id from prompts where topic = ?)"); a.push(topic); }
  return { where: w.length ? "where " + w.join(" and ") : "", args: a };
}

/** Per brand: mention rate (± CI), average order of first mention, citation share of its domain. */
export function shareOfVoice(index, filter = {}) {
  const { where, args } = scope(filter);
  const total = index.get(`select count(*) n from observations o ${where}`, ...args).n;
  const allCites = index.get(`select count(*) n from citations c join observations o on o.id = c.observation_id ${where}`, ...args).n;
  const brands = index.brands();
  // Order of first mention among tracked brands within each answer.
  const order = index.all(`select m.brand, m.observation_id, m.first_offset from mentions m join observations o on o.id = m.observation_id ${where}`, ...args);
  const byObs = new Map();
  for (const r of order) { if (!byObs.has(r.observation_id)) byObs.set(r.observation_id, []); byObs.get(r.observation_id).push(r); }
  const ranks = {};
  for (const list of byObs.values()) list.sort((a, b) => a.first_offset - b.first_offset).forEach((r, i) => (ranks[r.brand] ||= []).push(i + 1));
  const byDomain = index.all(`select c.domain, count(*) n from citations c join observations o on o.id = c.observation_id ${where} group by c.domain`, ...args);
  return brands.map((b) => {
    const k = (ranks[b.name] || []).length;
    const cites = b.domain ? byDomain.filter((r) => r.domain === b.domain || r.domain.endsWith("." + b.domain)).reduce((x, r) => x + r.n, 0) : 0;
    return { brand: b.name, own: b.own, mentionRate: wilson(k, total), avgRank: k ? +(ranks[b.name].reduce((x, y) => x + y, 0) / k).toFixed(2) : null, citations: cites, citationShare: allCites ? cites / allCites : 0 };
  }).sort((a, b) => b.mentionRate.p - a.mentionRate.p || b.citationShare - a.citationShare);
}

/** Domains AI answers cite, with type, share and reach: the citation graph's nodes. */
export function citedDomains(index, filter = {}, limit = 25) {
  const { where, args } = scope(filter);
  const total = index.get(`select count(*) n from citations c join observations o on o.id = c.observation_id ${where}`, ...args).n || 1;
  return index.all(`select c.domain, min(c.source_type) type, count(*) citations, count(distinct o.id) answers,
      count(distinct o.prompt_id) prompts, count(distinct o.engine) engines
    from citations c join observations o on o.id = c.observation_id ${where}
    group by c.domain order by citations desc limit ?`, ...args, limit).map((r) => ({ ...r, share: r.citations / total }));
}

/** Herfindahl–Hirschman index of cited domains per prompt (0–10,000): how locked the answer is. */
export function difficulty(index, filter = {}) {
  const { where, args } = scope(filter);
  const rows = index.all(`select o.prompt_id, p.text, c.domain, count(*) n from citations c join observations o on o.id = c.observation_id join prompts p on p.id = o.prompt_id ${where} group by o.prompt_id, c.domain`, ...args);
  const by = new Map();
  for (const r of rows) { if (!by.has(r.prompt_id)) by.set(r.prompt_id, { promptId: r.prompt_id, prompt: r.text, d: [] }); by.get(r.prompt_id).d.push(r); }
  return [...by.values()].map((x) => {
    const tot = x.d.reduce((a, r) => a + r.n, 0);
    const hhi = Math.round(x.d.reduce((a, r) => a + ((r.n / tot) * 100) ** 2, 0));
    const top = x.d.sort((a, b) => b.n - a.n)[0];
    return { promptId: x.promptId, prompt: x.prompt, hhi, level: hhi >= 2500 ? "locked" : hhi >= 1500 ? "concentrated" : "open", sources: x.d.length, leader: top.domain, leaderShare: top.n / tot };
  }).sort((a, b) => b.hhi - a.hhi);
}

/** 1 − Jaccard of cited domain sets between the two latest runs, per prompt and engine. */
export function volatility(index) {
  const runs = index.all("select distinct run_id r from observations order by r desc limit 2").map((x) => x.r);
  if (runs.length < 2) return { runs, rows: [], note: "needs two runs" };
  const sets = (run) => {
    const m = new Map();
    for (const r of index.all("select o.prompt_id, o.engine, c.domain from observations o join citations c on c.observation_id = o.id where o.run_id = ?", run)) {
      const k = r.prompt_id + "|" + r.engine;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(r.domain);
    }
    return m;
  };
  const [cur, prev] = [sets(runs[0]), sets(runs[1])];
  const rows = [];
  for (const [k, a] of cur) {
    const b = prev.get(k);
    if (!b) continue;
    const inter = [...a].filter((x) => b.has(x)).length;
    const uni = new Set([...a, ...b]).size;
    const [promptId, engine] = k.split("|");
    rows.push({ promptId: +promptId, engine, volatility: +(1 - inter / uni).toFixed(3), gained: [...a].filter((x) => !b.has(x)), lost: [...b].filter((x) => !a.has(x)) });
  }
  return { runs, rows: rows.sort((x, y) => y.volatility - x.volatility), mean: rows.length ? +(rows.reduce((s, r) => s + r.volatility, 0) / rows.length).toFixed(3) : 0 };
}

/**
 * Placement opportunities: third-party pages cited in answers that name a competitor but
 * not your brand. Getting mentioned on these pages is how you enter those answers.
 */
export function opportunities(index, filter = {}, limit = 25) {
  const own = index.brands().filter((b) => b.own).map((b) => b.name);
  const comp = index.brands().filter((b) => !b.own).map((b) => b.name);
  if (!own.length || !comp.length) return [];
  const { where, args } = scope(filter);
  const q = (list) => list.map(() => "?").join(",");
  return index.all(`
    with gap as (
      select o.id, o.prompt_id, o.engine from observations o ${where}
      ${where ? "and" : "where"} exists (select 1 from mentions m where m.observation_id = o.id and m.brand in (${q(comp)}))
      and not exists (select 1 from mentions m where m.observation_id = o.id and m.brand in (${q(own)}))),
    gc as (
      select c.canon_url, c.observation_id, c.domain, c.source_type, c.title, g.prompt_id, g.engine
      from gap g join citations c on c.observation_id = g.id
      where c.source_type not in ('own', 'competitor'))
    select gc.canon_url url, min(gc.domain) domain, min(gc.source_type) type, max(gc.title) title,
      count(distinct gc.observation_id) answers, count(distinct gc.prompt_id) prompts, count(distinct gc.engine) engines,
      group_concat(distinct m.brand) competitors
    from gc left join mentions m on m.observation_id = gc.observation_id and m.brand in (${q(comp)})
    group by gc.canon_url order by answers desc, engines desc limit ?`, ...args, ...comp, ...own, ...comp, limit);
}

/** One-call summary used by the CLI, the API and the connector. */
export function summary(index, filter = {}) {
  const { where, args } = scope(filter);
  const o = index.get(`select count(*) answers, count(distinct prompt_id) prompts, count(distinct engine) engines, round(sum(cost_usd), 4) cost, min(collected_at) first, max(collected_at) last from observations o ${where}`, ...args);
  return { ...o, shareOfVoice: shareOfVoice(index, filter), domains: citedDomains(index, filter, 15), difficulty: difficulty(index, filter).slice(0, 10), opportunities: opportunities(index, filter, 15) };
}
