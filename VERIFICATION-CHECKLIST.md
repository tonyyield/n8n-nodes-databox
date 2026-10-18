# Verification checklist (n8n Creator Portal)

Status as of 18 Oct 2026. Ticked items are done in this repo.

## Code and package
- [x] Scaffolded with the `n8n-node` CLI (programmatic template), strict mode on, cloud support enabled
- [x] TypeScript, no runtime dependencies
- [x] Builds with `npm run build`
- [x] Node and credential code pass `npm run lint`
- [x] API key field marked as password; no secrets in code or logs
- [x] Credential has a test request (`GET /v2/auth/validate-key`)
- [x] Resource / Operation pattern, "Return All" + "Limit" on Get Many, resource locator for datasets
- [x] README with operations and credentials
- [x] `package.json` author, homepage and repository filled in (tonyyield/n8n-nodes-databox, dev@yield-ai.ai); lint passes with no errors
- [ ] Replace the placeholder icons (`nodes/Databox/databox.svg`, `databox.dark.svg`) with the official Databox logo, with Databox's permission

## Testing
- [x] Run `npm run dev` (local n8n with the node loaded) - n8n 2.43.7 on Windows, 18 Oct 2026
- [x] Every operation tested against a throwaway dataset (5068381) on 18 Oct 2026: Create, Push, Get, Get Many (54 items, multi-page), Ingestion Get Many (11), dataset picker
- [x] Confirmed v2 ingestion detail returns `status: "success"` with `summary.ingestion` counts (dataset 5068381, 3 records, 18 Oct 2026). Failure value confirmed as `"failed"`.
- [ ] Confirm v1-era dataset IDs (UUIDs) work with the v2 endpoints (only matters for switching existing RT flows to this node)

- [x] Batching: 1,200 records pushed in 3 confirmed batches (500/500/200); dataset row count 1,203 (18 Oct 2026)
- [x] Primary-key upsert: same 1,200 rows re-sent; 500/500/200 overwritten, 0 appended, row count stayed 1,203
- [x] Bad data: a row with text in a number column makes Databox fail the WHOLE batch (`status: "failed"`), not reject one row; node stops correctly (18 Oct 2026)

- [x] Validate Records First: bad value stopped before sending, naming record 1, column "amount" (18 Oct 2026)
- [x] Unknown columns: Databox ACCEPTS them and silently adds a new column (columnCount 2 -> 3). Validator blocks them by default; Options > Unknown Columns > Allow to add on purpose (18 Oct 2026)

- [x] Missing columns: Databox fails the batch (`invalid_input`, "Column ... is required by schema") when a record omits any dataset column, including ones it auto-added. Validator now checks for this before sending (18 Oct 2026)
- [ ] Confirm a column sent as `null` counts as present

## Publish
- [ ] Create the GitHub repo and push
- [ ] npm: set up Trusted Publishing (OIDC) for `publish.yml`, or add an `NPM_TOKEN` secret
- [ ] `npm run release` locally: it lints, builds, tags and pushes; the tag triggers `publish.yml`, which publishes to npm with a provenance statement (required since 1 May 2026)
- [ ] Run `npx @n8n/scan-community-package n8n-nodes-databox` against the published package
- [ ] Submit in the n8n Creator Portal

## Open questions
1. **Ingestion status values.** The v2 docs don't list them. The node treats `success`/`succeeded`/`completed`/`complete`/`done` as confirmed, `failed`/`failure`/`error`/`rejected`/`cancelled`/`canceled` as failed, and anything else as still processing. Check against real v2 responses.
2. **v1 dataset IDs on v2.** The migration guide says the ID value is unchanged, but the v2 reference types the path `id` as an integer. The node sends it as a string.
3. **Batch size limit.** 500 is our tested default, not a documented Databox limit.
