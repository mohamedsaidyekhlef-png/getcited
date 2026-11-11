# getcited AI Answer Index

The index is a continuously refreshed record of what AI answer engines actually say:
for each prompt, engine and market, the answer text, the brands it names and in what
order, every URL it cites, and the passage on each cited page that the answer was
built from. Every explorer, metric and alert in getcited is a query over this index.

```
prompts ──▶ scheduler ──▶ collectors ──▶ normalizer ──▶ store (SQLite, WAL)
             (budget,       perplexity      URL canon,     observations
              rate limit,   openai          source type,   citations
              retries,      gemini          mentions       mentions
              idempotency)  anthropic                         │
                            mock                              ▼
                                         crawler ──▶ pages + passages (FTS5)
                                                              │
                                         attribution ◀────────┘
                                         (answer sentence → cited passage)
                                                              │
                                         metrics ◀────────────┘
                                         share of voice ± CI, difficulty (HHI),
                                         volatility, citation graph, opportunities
```

## Design rules

1. **Observations are immutable.** A collection is never updated in place. Re-asking the
   same prompt creates a new observation in a new run, so history and volatility come
   for free and every number can be traced to the answer text that produced it.
2. **Idempotent collection.** Each job has a key of engine, model, prompt, market, sample
   and run. A crashed run resumes without paying for answers it already has.
3. **Engines are sampled, not trusted once.** Answers vary between calls. Metrics are
   reported with Wilson 95% intervals over samples, and the sample count is shown.
4. **Spend is bounded before it happens.** The scheduler prices each job up front and
   stops at the run's budget; cost is recorded per observation from reported usage.
5. **Evidence over inference.** Where an engine states which text supports which source
   (Gemini grounding supports, Claude `cited_text`, OpenAI citation spans), that is
   stored as ground truth and used to measure the attribution model's accuracy.
6. **Zero dependencies.** Node 22+, `node:sqlite` with FTS5. One file per index; it can
   be copied, versioned or sharded by vertical.

## Engines

| Engine | Endpoint | Citations | Ground truth for attribution |
|---|---|---|---|
| Perplexity | `POST /v1/agent` (Agent API; Sonar chat completions retired Sept 2026) | `search_results` + inline `[n]` markers | marker positions |
| OpenAI | Responses API, `web_search` tool | `url_citation` annotations with character spans | cited span text |
| Gemini | `generateContent` with `google_search` | `groundingChunks` (redirect URIs, resolved by the crawler) | `groundingSupports` segment → chunks |
| Anthropic | Messages API, `web_search_20250305` | `web_search_result_location` | `cited_text` (≤150 chars of the source) |
| Mock | in-process | deterministic | fixture labels (tests, benchmarks) |

Keys come from the user's environment (bring your own) or from the hosted service on
paid plans. Google AI Overviews require a SERP data provider and plug in as a collector
with the same output shape.

## Schema (abridged)

- `prompts(id, text, topic, market, created_at)`
- `runs(id, started_at, finished_at, budget_usd, spent_usd, status)`
- `observations(id, run_id, prompt_id, engine, model, market, sample, answer, answer_hash, latency_ms, cost_usd, collected_at, raw)` with a unique job key
- `citations(observation_id, position, url, canon_url, domain, source_type, title, span_start, span_end, support_text)`
- `mentions(observation_id, brand, first_offset, list_rank, count)`
- `brands(name, domain, aliases, own)`
- `pages(canon_url, status, fetched_at, content_hash, title, published, words)`
- `passages(id, canon_url, heading, text)` + `passages_fts`
- `attributions(observation_id, sentence_idx, sentence, canon_url, passage_id, score, method)`

## Metrics

- **Mention rate** per brand and engine: share of answers naming the brand, Wilson 95% CI.
- **Citation share**: share of all citations pointing at a domain.
- **Average position**: mean first-mention rank when named.
- **Prompt difficulty**: Herfindahl–Hirschman index of cited domains (0–10,000). High means
  a few sources own the answer.
- **Volatility**: 1 − Jaccard similarity of cited domain sets between consecutive runs.
- **Opportunities**: third-party pages cited in answers that name a competitor but not you,
  ranked by how many such answers cite them. These are the outreach and placement targets.

## Benchmarks (Node 22, 2 vCPU cloud container, one SQLite file)

`node bench/index.bench.mjs --pages 20000 --prompts 10000 --samples 3`, synthetic vertical:

| Stage | Volume | Throughput |
|---|---|---|
| Collect + normalize + store | 30,000 answers, 120,000 citations | ~2,000 answers/s |
| Ingest cited pages | 19,944 pages → 119,664 passages | ~1,070 pages/s |
| Attribution | 132,187 answer sentences | ~7,200 sentences/s |
| Share of voice, all prompts | 30,000 answers | p50 179 ms |
| Share of voice, one topic | 1,500 answers | p50 9 ms |
| Prompt difficulty (HHI) | 10,000 prompts | p50 198 ms |
| Placement opportunities | 30,000 answers | p50 889 ms |
| Index size | | 135 MB |

Collection throughput above excludes engine latency; in production it is bounded by the
engines' rate limits and cost, not by the pipeline. Attribution on the synthetic corpus is
not a meaningful accuracy figure (its facts are unique, so it scores near 100%; with recycled
passages it scored 91–94%). The accuracy that counts is measured on real answers against
engine-provided labels (`getcited index report`), and will be published from the first real runs.

Optimizations so far: attribution scores only the passages of pages each answer cites
(16× faster than full-text search over the whole index); share of voice aggregates citations
by domain in one pass; the opportunity finder joins a materialized gap set.
Next: incremental materialized rollups per run for sub-50 ms dashboards at 1M+ answers,
and sharding one SQLite file per vertical and market.
