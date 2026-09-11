# AI inference — where the model calls go and what they cost

_Decided 2026-09-12. Prices verified against the providers' own pages that day._

## Today

| Surface | Provider | Model(s) | Cost | Caps |
|---|---|---|---|---|
| Zen chat | Gemini API, free tier (unbilled project) | gemma-4-31b-it → gemma-4-26b-a4b-it | ₹0 (Gemma has no paid tier) | 6/min · 60/day per user, 24/min global |
| Plate scan | Gemini API, free tier | 3.6-flash → 3.5-flash → 3.5-flash-lite → 3.1-flash-lite → 3.7-flash | ₹0 | 10/day per user, per-model RPD in `api/_modelRouter.ts` |
| Plate scan **fallback** | OpenAI, prepaid $8 | gpt-5.6-luna | ≈ $0.001 per scan | runaway guard $2/day (`OPENAI_DAILY_USD_CAP`) |

Measured volume before this change: **31 scans in 14 days (~5/day)** across 23 users.
Expected at 50–100 users, most of them gym members scanning about once a day: **20–60 scans/day**.

## Why the cascade changed

Live probes on 2026-09-12: `gemini-3.8-flash` and `gemini-3.7-flash` answered
**503 "high demand"** every time; the fortnight's quota docs show them landing
0–3 scans a day while 3.6 did the work. Each miss cost 1–2 s (26 s on a
timeout) before the next model got a turn, which is why scans took 25 s.
The cascade now runs most-available-first, 3.8 is gone, 3.7 is last.

## Why OpenAI, and why Luna

The requirement is that a scan **always completes**. Whatever Gemini's free
tier does — 503, timeout, daily quota gone, garbled JSON — the request now
ends with one paid call rather than "Couldn't read that plate".

Per-scan cost by candidate (1024×768 JPEG, ~2.5K-token prompt served from
cache, ~600 tokens out). Image billing is the whole story: OpenAI charges
768 patches × a per-model multiplier; Gemini charges 3 tiles × 258; the old
gpt-4o-mini tile scheme charges **25,501 tokens per image** and is the one to
avoid.

| Model | $/M in · cached · out | Image tokens | ≈ $/scan | Scans per $8 |
|---|---|---|---|---|
| gpt-5-nano | 0.05 · 0.005 · 0.40 | 1,152 (×1.5) | 0.0003 | ~25,000 |
| gpt-4.1-nano | 0.10 · 0.025 · 0.40 | 1,889 (×2.46) | 0.0004 | ~21,000 |
| **gpt-5.6-luna** | 0.20 · 0.02 · 1.20 | 922 (×1.2) | **0.0010** | ~8,400 |
| gpt-5.4-nano | 0.20 · 0.02 · 1.25 | 922 | 0.0010 | ~8,000 |
| gpt-5-mini | 0.25 · 0.025 · 2.00 | 922 | 0.0015 | ~5,300 |
| Gemini 2.5 Flash-Lite (paid) | 0.10 · 0.01 · 0.40 | 774 | 0.00045 | — |
| Gemini 3.x Flash (paid) | 0.75 · 0.075 · 3.75 | 774 | 0.005 | ~1,600 |
| Claude Haiku 4.5 | 1.00 · — · 5.00 | ~1,000 | 0.005 | ~1,600 |

Luna over the nanos: independent benchmark aggregates put gpt-5.6-luna ahead
of gpt-5.4-nano on every shared test including **MMMU-Pro (vision)** at the
same price, and ahead of gpt-5-nano on 14 of 15. A fallback that misreads
the plate is not a fallback, and the 3× per-token difference against
gpt-5-nano is a few hundredths of a cent per scan.

### How long $8 lasts

OpenAI prepaid credit **expires 12 months after purchase**, so the target is
"covers the year", not "lasts forever".

| Scans/day | If OpenAI took **every** scan | If OpenAI takes the failed fraction (~20%) |
|---|---|---|
| 20 | 1.1 years | > expiry |
| 60 | 140 days | ~2 years (capped by expiry) |
| 150 | 56 days | 280 days |

Zen never goes to OpenAI: a Zen turn carries ~5K tokens of history and
context, and 200 turns/day would drain $8 in ~100 days.

### Request shape (api/_openaiScan.ts)

`POST /v1/responses` with `instructions` = the constant scan prompt (the
stable prefix OpenAI caches automatically past 1,024 tokens), the photo as an
`input_image` data URL plus the user's hint in `input`, `reasoning.effort:
"low"`, `text.format` = the plate JSON schema (non-strict; retried without it
on a 400), `max_output_tokens: 2400`, `store: false`. Per-call cost is
computed from `usage` and tallied on the day's `aiQuota` doc under `openai`.

Timing inside Vercel's 60 s `maxDuration`: Gemini attempts stop starting at
22 s, one Gemini timeout is 26 s, the OpenAI call has 20 s — worst case 46 s.
The client waits 75 s.

## Runbook

- **Enable the fallback:** `vercel env add OPENAI_API_KEY production` (paste
  the key from platform.openai.com — it never goes in the repo), then
  redeploy the API (any push to `main` does it). Without the variable the
  scanner behaves exactly as before.
- **Watch spend:** `aiQuota/{YYYY-MM-DD}.openai` = `{ calls, usd,
  inputTokens, outputTokens }`. The function logs a warning past 25% of the
  daily cap and stops falling back at the cap (`OPENAI_DAILY_USD_CAP`,
  default 2).
- **Change the model:** `OPENAI_SCAN_MODEL` env var; update
  `OPENAI_PRICES_USD` in `api/_openaiScan.ts` so the tally stays honest.
- **Prices move:** Gemini 3.x promotional pricing doubles on 2027-01-01;
  irrelevant while we stay on the free tier.

## Alternatives considered

- **Gemini paid, 2.5 Flash-Lite** — cheapest good vision at $0.00045/scan,
  but needs a Google-billed key. The Gemma key must stay in the unbilled
  project (billing pushed Gemma off the free tier once); a second key in the
  billed Firebase project would work, ≈ ₹70/month at 60 scans/day against a
  ₹100 cap already carrying Firestore. Kept in reserve.
- **OpenRouter** — one API with provider fallbacks; a $10 top-up unlocks
  1,000 free requests/day on `:free` models, three of which take images
  (Ling 3.0 Flash VL, Nex N2.5 mini/pro). Untested on Indian plates.
- **Groq** — no vision models on the free tier any more. **Cloudflare
  Workers AI** — free neurons, weak vision. **Anthropic Haiku 4.5** — 5× the
  cost of Luna; wrong tool for this budget.

Sources: OpenAI pricing and images guide, OpenAI model pages (gpt-5.6-luna,
gpt-5.4-nano), OpenAI service-credit terms, Gemini API pricing and image
understanding guide, Groq rate limits, OpenRouter models API, Artificial
Analysis / LLM-Stats model comparisons — all fetched 2026-09-12.
