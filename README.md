# n8n-nodes-databox

An [n8n](https://n8n.io) community node for [Databox](https://databox.com). It pushes records into Databox datasets in batches and confirms each batch before sending the next. It can also create, get and list datasets, and check ingestions.

It uses the Databox API v2 (`https://api.databox.com/v2`).

## Operations

| Resource  | Operation    | What it does |
|-----------|--------------|--------------|
| Dataset   | Push Records | Splits records into batches (500 by default) and sends them one batch at a time. After each batch it checks the ingestion at 3s, 10s, then every 60s until Databox confirms it, up to a maximum wait (600s by default). If a batch fails or times out, it stops and the remaining batches are not sent. |
| Dataset   | Create       | Creates a dataset in a data source with a column schema and an optional primary key. |
| Dataset   | Get          | Gets one dataset. |
| Dataset   | Get Many     | Lists datasets, optionally filtered by data source or name. |
| Ingestion | Get          | Gets the status of one ingestion. |
| Ingestion | Get Many     | Lists a dataset's ingestions. |

Push Records also **checks every record against the dataset's column types before sending** (on by default; Options > Validate Records First). Databox fails a whole batch on one bad value without saying which record caused it, so the node stops before sending and names the exact record and column: text in a number column, an unparseable date, an empty primary key, an unknown column (Databox would otherwise silently add it as a new column; set Options > Unknown Columns to Allow to add columns on purpose), a column the dataset has but the record leaves out (Databox requires every column on every record), or a nested object. A batch where Databox rejects records also stops the node by default (Options > On Rejected Records).

Deliberately left out: **Purge** and **Delete dataset**. Use a primary key on the dataset so re-sent records update in place, rather than purging and reloading.

### Push Records: where the records come from

- **Each Input Item Is a Record:** all input items are sent together to one dataset. The dataset and options are read from the first item.
- **Array Field on Each Item:** each input item holds an array of records in a field (default `records`) and is pushed separately.

## Credentials

**Databox API**
- **API Key:** create one in Databox under Account Management > Profile > Password & Security > API key. Only Admin users can create keys.
- **Account ID** (optional): only for organizations with accounts enabled. It's sent as the `x-account-id` header.

The credential test calls `GET /v2/auth/validate-key`.

## Compatibility

Built with `@n8n/node-cli` 0.52.5 in strict mode, with no runtime dependencies, so it is eligible for n8n Cloud verification.

## Resources

- [Databox API reference](https://developers.databox.com/docs/api/api.databox.com)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

MIT
