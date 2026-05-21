# Toyota-backend

Personal reference + Q&A backend for a Toyota Ontario sales rep. Covers every 2025/2026 model and trim sold in Ontario — specs, MSRPs + Ontario fees, warranties, F&I/upsell products, and rep cheat-sheet notes. REST catalog + Claude-powered natural-language Q&A on top.

## Stack

- Node.js 20+ / TypeScript / Express
- PostgreSQL via Prisma
- Anthropic Claude (`claude-haiku-4-5` default, `claude-sonnet-4-6` opt-in)
- Vitest for unit tests
- Single-page vanilla-JS admin UI served at `/admin`

## Setup

```bash
# 1. Install deps
npm install

# 2. Provision Postgres locally (Docker shortcut)
docker run --name toyota-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16

# 3. Configure env
cp .env.example .env
# Edit .env — set DATABASE_URL, generate API_TOKEN (`openssl rand -hex 32`), set ANTHROPIC_API_KEY.

# 4. Migrate and seed
npm run prisma:migrate -- --name init
npm run db:seed

# 5. Run
npm run dev
# → http://localhost:3000
```

## Endpoints (all under `/api/v1`, all require `Authorization: Bearer $API_TOKEN`)

### Catalog reads
- `GET /models` (optional `?year=2026`)
- `GET /models/:slug`
- `GET /trims` (filters: `?model=`, `?year=`, `?powertrain=GAS|HYBRID|PHEV|BEV`, `?maxPrice=`)
- `GET /trims/:slug`
- `GET /trims/:slug/quote` — out-the-door price with HST breakdown
- `GET /powertrains`
- `GET /warranties` (filters: `?model=`, `?year=`)
- `GET /finance-products` (filter: `?category=EXTENDED_WARRANTY|TIRE_RIM|...`)
- `GET /rep-notes` (filters: `?scope=`, `?scopeId=`, `?tags=tag1,tag2`)

### Catalog writes (CRUD on each table)
- `POST /models` · `PATCH /models/:id` · `DELETE /models/:id`
- `POST /trims` · `PATCH /trims/:id` · `DELETE /trims/:id`
- `PUT /trims/:id/fees` — upsert fee schedule
- `POST /powertrains` · `PATCH /powertrains/:id` · `DELETE /powertrains/:id`
- `POST /warranties` · `PATCH /warranties/:id` · `DELETE /warranties/:id`
- `POST /finance-products` · `PATCH /finance-products/:id` · `DELETE /finance-products/:id`
- `POST /rep-notes` · `PATCH /rep-notes/:id` · `DELETE /rep-notes/:id`

Every write bumps `meta.catalog_version`, which invalidates the AI prompt cache.

### AI Q&A
- `POST /ai/ask` — body `{ "question": "...", "model": "haiku" | "sonnet" }`
  Returns `{ answer, citations[], model, cachedInputTokens, uncachedInputTokens, outputTokens, catalogVersion, scopedModels }`.

## Smoke-test commands

```bash
TOKEN=$(grep API_TOKEN .env | cut -d= -f2)

# Health
curl http://localhost:3000/health

# Auth check (expect 401 then 200)
curl -i http://localhost:3000/api/v1/models
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/models

# Filter trims
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/trims?model=rav4&year=2026&powertrain=HYBRID"

# Quote
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/trims/rav4-2026-xle-hybrid-awd/quote

# Warranties
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/warranties?model=rav4&year=2026"

# AI Q&A
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"Customer comparing 2026 RAV4 Hybrid XLE vs Highlander Hybrid LE — what should I emphasize on warranty and price?"}' \
  http://localhost:3000/api/v1/ai/ask | jq

# Repeat the AI call — `cachedInputTokens` should be > 0 the second time.
```

## Admin UI

Open `http://localhost:3000/admin` in a browser. Paste your API token (it's stored in localStorage). Tabs:

- **AI Q&A** — natural-language interface against the catalog.
- **Models / Trims / Powertrains / Warranties / F&I Products / Rep Notes** — list and edit. Trims tab includes a "fees" button to upsert the per-trim fee schedule.

## Seed data accuracy

`src/db/seed-data.ts` contains hand-compiled approximations of 2025/2026 Ontario MSRPs and powertrain specs. **You will need to verify and edit these against toyota.ca and your dealer price book** before using output in front of customers. The admin UI is built for fast in-place edits.

Warranty baselines in `src/db/seed.ts` match Toyota Canada's published terms as of seed-authoring time. Double-check `toyota.ca/toyota/en/owners/maintenance/warranty` before relying on them.

## Tests

```bash
npm test
```

Currently covers pricing math (`tests/pricing.test.ts`). Add more as new logic accretes.

## Phase 2 (deferred)

- Playwright scraper against toyota.ca with diff-review workflow (`src/scraper/` placeholder exists in the schema as `scrape_runs`/`scrape_diffs`).
- Multi-turn conversations for `/ai/ask`.
