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
- `GET /models` (optional `?year=2026`, `?make=Toyota|Lexus`)
- `GET /models/:slug`
- `GET /trims` (filters: `?model=`, `?make=Toyota|Lexus`, `?year=`, `?powertrain=GAS|HYBRID|PHEV|BEV`, `?maxPrice=`)
- `GET /trims/:slug` — includes color availability for the trim
- `GET /trims/:slug/quote` — out-the-door price with HST breakdown. Optional `?color=<slug>` adds the configured premium for that color.
- `GET /powertrains`
- `GET /warranties` (filters: `?model=`, `?year=`)
- `GET /finance-products` (filter: `?category=EXTENDED_WARRANTY|TIRE_RIM|...`)
- `GET /rep-notes` (filters: `?scope=`, `?scopeId=`, `?tags=tag1,tag2`)
- `GET /colors` — catalog of body colors
- `GET /colors/trim/:trimId` — color availability for a trim
- `PUT /colors/trim` — upsert trim×color availability `{ trimId, bodyColorId, available, premiumChargeCad }`

### Search
- `POST /search` — filter by `make`, `year`, `bodyStyles[]`, `segments[]`, `powertrains[]`, `drivetrainContains`, `colorSlugs[]` (returns trims that have any of those colors available), `minHp/maxHp`, `maxComboL100`, `minElectricRangeKm`, `maxMsrpCad`, `maxTotalCad` (after HST), `hybridOnly`, `awdOnly`. Sort by `msrp | total | fuel_economy | horsepower | electric_range`.

### Payments
- `POST /payments/finance` — body `{ trimSlug?, amountFinancedCad?, aprPercent, termMonths, downPaymentCad?, tradeEquityCad?, includeFeesAndHst? }`. With `trimSlug`, the OTD (incl. HST) is computed and used as the financed amount unless overridden. Returns monthly before-tax + tax-in, total interest, total paid.
- `POST /payments/lease` — body `{ trimSlug?, msrpCad?, capCostCad?, residualPercent, moneyFactor, termMonths, downPaymentCad?, tradeEquityCad?, acquisitionFeeCad? }`. With `trimSlug`, MSRP and pre-tax cap cost (MSRP + all fees) are auto-populated. Returns adjusted cap cost, residual value, depreciation/mo, rent charge/mo, base monthly, HST in, effective APR.

### Comparison
- `POST /compare` — body `{ "trimSlugs": [...] }` (2–6 trims). Returns each trim's specs, quote (with HST), and the warranty rows that apply to each model-year.

### Scraper (admin)
- `POST /admin/scrape/run` — body `{ "models": ["rav4", ...] }` (optional). Spawns a Playwright child process. Returns `{ runId, status }`.
- `GET /admin/scrape/runs` — list recent runs.
- `GET /admin/scrape/runs/:id/diffs` — pending field-level diffs.
- `PATCH /admin/scrape/runs/:id/diffs` — body `{ "decisions": [{ "diffId": 1, "decision": "ACCEPT|REJECT" }, ...] }`.
- `POST /admin/scrape/runs/:id/apply` — apply accepted diffs in a transaction. Bumps `catalog_version`.

Scraper never writes directly to live tables — only to `scrape_diffs`. Manual curation is preserved until you explicitly accept a diff.

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
- `POST /ai/ask` — body `{ "question": "...", "model": "haiku" | "sonnet", "conversationId": 123 }`. Omit `conversationId` for a new conversation; pass it to continue an existing one (prior turns are sent to Claude as message history). Returns `{ answer, citations[], conversationId, model, cachedInputTokens, uncachedInputTokens, outputTokens, catalogVersion, scopedModels }`.
- `GET /ai/conversations` — list recent conversations with message counts.
- `GET /ai/conversations/:id` — full message history for one conversation.
- `DELETE /ai/conversations/:id` — discard.
- `GET /ai/health` — config + catalog version.
- `GET /ai/context-preview?question=...` — see exactly what would be sent to Claude.

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

- **AI Q&A** — multi-turn conversations with the catalog (Toyota + Lexus). Sidebar lists prior conversations; click to resume. Each reply records token usage (cached vs uncached) and citations. Color availability is included in the context block when a model is in scope.
- **Search** — budget+needs filter: make, max OTD, hybrid/AWD only, body style, fuel economy, electric range, horsepower, available colors. Sortable results.
- **Compare** — pick 2–4 trims, see a side-by-side spec + price + warranty table.
- **Payments** — finance and lease calculators side by side. Pick a trim, enter APR/term/down payment or residual/money factor, get the Ontario tax-in monthly payment.
- **Models / Trims / Powertrains / Warranties / F&I Products / Colors / Rep Notes** — list and edit. Trims tab includes a "fees" button to upsert the per-trim fee schedule. Colors tab includes a per-trim availability matrix (check the box, set premium upcharge, save per row).
- **Scraper** — trigger toyota.ca scrape, review field-level diffs against the live catalog, accept/reject each one before applying.

## Seed data accuracy

`src/db/seed-data.ts` contains hand-compiled approximations of 2025/2026 Ontario MSRPs and powertrain specs. **You will need to verify and edit these against toyota.ca and your dealer price book** before using output in front of customers. The admin UI is built for fast in-place edits.

Warranty baselines in `src/db/seed.ts` match Toyota Canada's published terms as of seed-authoring time. Double-check `toyota.ca/toyota/en/owners/maintenance/warranty` before relying on them.

## Tests

```bash
npm test
```

Currently covers pricing math (`tests/pricing.test.ts`). Add more as new logic accretes.

## Scraper usage

```bash
# Manual run from the CLI
npm run scrape                          # all models
npm run scrape -- --models rav4,camry   # subset

# Or via the admin endpoint (spawns the same process detached)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"models":["rav4"]}' \
  http://localhost:3000/api/v1/admin/scrape/run
# Then review and apply via the Scraper tab in the admin UI.
```

Playwright Chromium needs to be downloaded once: `npx playwright install chromium`.

Toyota.ca DOM selectors in `src/scraper/sources/toyota-ca.ts` are best-effort — expect to refine them as the site evolves.

## Catalog scope

The seed covers **30 models / 288 trims**:

- **Toyota Canada (20 models):** Corolla, GR Corolla, Camry, Corolla Cross, RAV4, Highlander, Grand Highlander, Crown, Crown Signia, 4Runner, Land Cruiser, Sequoia, Tacoma, Tundra, Sienna, GR86, GR Supra, Prius, Prius Prime, bZ4X.
- **Lexus Canada (10 models):** IS, ES, NX, RX, TX, GX, LX, RZ, LC, LS.

Each model has 2025 and 2026 trims. Lexus rep notes call out the complimentary maintenance differentiator (4 yr / 80,000 km free scheduled service) and competitor matchups against BMW, Audi, Mercedes, Acura, Genesis.

## Possible future work

- Toyota.ca + lexus.ca color-page scrapers to auto-populate `trim_colors`.
- Trade-in valuation entry on payments calculations (subtract trade equity from cap cost / amount financed — partial wiring already exists).
- Bulk apply colors form ("all 2026 RAV4 trims get these 6 colors").
- Service cost calculator (Toyota Express Maintenance schedule × labour rate + parts).
