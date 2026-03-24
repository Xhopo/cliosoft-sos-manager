# Retrieval Playbook

Load this file only when you need the detailed retrieval flow, dataset routing map, or evidence heuristics.

## Rewrite Hints

Default to a concise English retrieval query because the knowledge base is primarily English.
Preserve exact technical strings:

- protocol names and versions
- part numbers and chip models
- product names and dataset names
- API paths, register names, commands, and quoted text
- error messages, table names, IDs, and acronyms

Examples:

- `Qi 2.2.1 的改动有哪些` -> `Qi 2.2.1 changes`
- `CPW6410 datasheet 引脚定义` -> `CPW6410 datasheet pin definition`
- `UFCS 握手失败是什么原因` -> `UFCS handshake failure cause`
- `"Model Name is required" 是什么原因` -> `"Model Name is required" cause`

## Scope Selection

Start scoped when the domain is obvious.
Do not start with `datasets --json` unless:

- scope is genuinely ambiguous
- the user explicitly asks which datasets exist
- you need to resolve a non-curated dataset such as a dedicated datasheet dataset
- the named dataset may be newly added and you need a live catalog refresh

Use these flags only when needed:

- `--all-datasets`: search the full library after scoped retrieval stays weak, or when the user explicitly wants broad coverage
- `--refresh-datasets`: refresh the live dataset catalog before resolving names, for newly added datasets or suspected catalog drift
- `--include-raw`: include the full upstream Ragflow payload for debugging only
- `--page-size N` / `--top-k N`: broaden evidence volume only when the user explicitly wants more evidence or the current evidence is partial

## Dataset Routing Heuristics

Prefer these datasets when the user language clearly points to one area:

- `qi 1.3.2`, `qi 2.0`, `qi 2.2.1`, `wpc`, `mpp`, `bpp`, `epp` -> the matching Qi dataset
- `pd`, `ufcs`, `pps`, `type-c` -> `PD3.2/UFCS`
- `quickcharge`, `qc` -> `QuickCharge`
- `patent`, `claim` -> `WPT Patents`
- `issue`, `failure`, `debug`, `workaround`, `known issue` -> `CPS issues`
- `qi-id`, `certification`, `product table` -> `Qi ID Table`
- `datasheet`, `part number`, `chip model` -> prefer the dedicated datasheet dataset from the live catalog; do not auto-fallback to `cps-datasheet-whole`
- `supply chain`, `vendor`, `lead time` -> `CPS IC Supply Chain Infomation`
- `chargerlab`, `充电头网` -> `充电头网`

If two or three neighboring datasets are all plausible, pass 1-3 repeated `--dataset-id` flags before considering `--all-datasets`.

Curated fast-path dataset map:

| Dataset ID | Dataset Name |
| --- | --- |
| `0a5b29881d3311f184fc8144b17022b7` | `WPT Patents` |
| `25bad7be1b8a11f184fc8144b17022b7` | `Qi ID Table` |
| `04a20b56131f11f186abb9fce453b8c6` | `CPS issues` |
| `64976310089f11f186abb9fce453b8c6` | `CPS IC Supply Chain Infomation` |
| `ffdfd222080d11f186abb9fce453b8c6` | `QuickCharge` |
| `f69eb740080411f186abb9fce453b8c6` | `qi 2.0` |
| `502d6a5a080411f186abb9fce453b8c6` | `qi 1.3.2` |
| `971f392807cf11f186abb9fce453b8c6` | `充电头网` |
| `8ae4951c033911f1be4a0bb4759a82a5` | `PD3.2/UFCS` |
| `d4bfe4fc027111f1be4a0bb4759a82a5` | `qi 2.2.1` |

Datasheet family is intentionally not hard-coded in this table. Resolve it live with `datasets --json` when needed.

## Evidence Reading

`query --json` returns:

- `total`: upstream total hit count
- `returnedChunkCount`: actual chunk array length returned by Ragflow
- `returnedDocAggCount`: actual document aggregation count returned
- `responseHints`: the effective `page_size` and `top_k`, whether `raw` was included, and a reminder to read `topDocuments` / `topChunks` first
- `evidenceSignals`: concentration and spread hints, including `likelyWeakEvidence`
- `topDocuments`: first 10 normalized document aggregates
- `topChunks`: first 10 normalized chunks with dataset and document names filled in when possible
- `raw`: full upstream response, included only when `--include-raw` is explicitly set

This skill defaults to `page_size = 8` and `top_k = 100`.
Do not assume `top_k` equals `returnedChunkCount`.
Do not assume `total > 0` means the question is answered.
Do not use `--include-raw` unless you are actively debugging retrieval quality or schema drift.

Strong evidence:

- top hits concentrate in one or a few clearly relevant datasets
- chunks directly mention the asked entity, version, part number, or symptom
- multiple chunks or documents tell a consistent story

Weak evidence:

- hits are semantically nearby but do not answer the asked entity
- unrelated datasets dominate
- the only support is vague or isolated
- `evidenceSignals.likelyWeakEvidence == true`

When you do need `datasets --json`, keep the page size small: use `--page-size 2` to `--page-size 15`, defaulting to `7`.
