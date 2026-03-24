# CPSAI Backend Ragflow Notes

This skill talks to MyAgents' local management API, which proxies to `cpsai-backend`.

## Local Management API

- `GET /api/cps/auth/status`
- `GET /api/cps/ragflow/datasets`
- `POST /api/cps/ragflow/retrieval`

All three require the localhost bearer token injected into the Sidecar environment.

## Remote CPS Backend

The CPS backend exposes authenticated Ragflow routes:

- `GET /ragflow/datasets`
- `POST /ragflow/retrieval`

## Official Ragflow HTTP API Notes

From Ragflow's official HTTP API reference:

- `GET /api/v1/datasets` accepts `page`, `page_size`, `orderby`, `desc`, and `name`
- `POST /api/v1/retrieval` accepts `question`, `dataset_ids`, `document_ids`, `page`, `page_size`, `similarity_threshold`, `vector_similarity_weight`, `top_k`, `rerank_id`, and `cross_languages`
- `dataset_ids` is a list of dataset IDs, not names
- `cross_languages` is a list of language codes such as `["zh", "en"]`
- The local skill wrapper only sends `cross_languages` when the caller explicitly requests it
- `page_size` is the maximum number of chunks returned for the page; default documented value is `30`
- `top_k` controls the candidate pool used during retrieval; default documented value is `1024`
- Retrieval chunks may carry the dataset identifier as `kb_id` in official responses, so clients should tolerate both `kb_id` and `dataset_id`

Important behavior from `cpsai-backend/src/routes/ragflow.ts`:

- `retrieval` rejects requests without a non-empty `question`
- `dataset_ids` and `document_ids` must be arrays of non-empty strings
- if `top_k` is omitted, the backend applies its configured default
- if neither `dataset_ids` nor `document_ids` is provided, the backend expands the query to all available datasets using a cached catalog

## Dataset Catalog Cache

The backend dataset cache:

- refreshes every 10 minutes by default
- pages through `/api/v1/datasets` with `page` and `page_size`
- collects every dataset ID before expanding a full-library retrieval

The skill mirrors this with its own 10-minute `dataset_id -> dataset_name` cache so normalized chunks can include `datasetName`.

## Live Retrieval Schema

Live retrieval responses were observed in this shape:

```json
{
  "code": 0,
  "data": {
    "total": 90,
    "doc_aggs": [
      { "doc_id": "doc-1", "doc_name": "Qi 2.2.1 Overview", "count": 2 }
    ],
    "chunks": [
      {
        "id": "chunk-1",
        "dataset_id": "dataset-qi-221",
        "document_id": "doc-1",
        "document_keyword": "Qi 2.2.1 Overview",
        "content": "...",
        "highlight": "...",
        "similarity": 0.95,
        "term_similarity": 0.82,
        "vector_similarity": 0.91,
        "important_keywords": ["qi", "2.2.1"]
      }
    ]
  }
}
```

Notes:

- `chunks` do not reliably include `dataset_name`, so the skill must backfill it
- `document_keyword` is a useful fallback when `doc_aggs` does not contain a document name for that chunk
- `top_k` is not a safe proxy for returned chunk count
- `page_size` is the safer control for limiting returned chunk volume

## Error Handling

- The local management API automatically refreshes CPS auth once on upstream `401`
- If refresh fails, the local API returns the failure and clears the stored CPS session on hard auth expiry
- The skill should treat `total == 0` as "no evidence found", not as a system error
