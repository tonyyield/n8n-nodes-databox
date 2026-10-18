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
- [ ] Test every operation against a **throwaway** Databox dataset, not a live RT one (Create, Push and dataset picker passed on 18 Oct; Get, Get Many and Ingestion Get/Get Many still to do)
- [x] Confirmed v2 ingestion detail returns `status: "success"` with `summary.ingestion` counts (dataset 5068381, 3 records, 18 Oct 2026). Failure value still unseen.
- [ ] Confirm v1-era dataset IDs (UUIDs) work with the v2 endpoints

- [x] Batching + primary-key upsert: 1,203 records (A1-A3 re-sent + 1,200 new) pushed in 3 confirmed batches; dataset row count 1,203, no duplicates (18 Oct 2026)

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
