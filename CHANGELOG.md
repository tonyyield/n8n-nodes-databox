# Changelog

## 0.1.0 (unreleased)

- Databox API credential (API key, optional account ID) with a key-validation test
- Dataset: Push Records (batched, confirmed one batch at a time), Create, Get, Get Many
- Ingestion: Get, Get Many
- Push Records: validates records against the dataset schema before sending (on by default)
- Push Records: stops on rejected records by default; shows appended / overwritten / rejected counts per batch
- Databox's own error messages shown instead of generic HTTP errors
