---
name: cps-ragflow-query
description: >-
  Use for CPS enterprise knowledge-base retrieval when the answer depends on internal material not
  already present in the current workspace: Qi/WPC/PD/UFCS/QuickCharge spec interpretation,
  protocol or state-machine behavior, mode negotiation or fallback behavior, certification/Qi ID,
  datasheets, part numbers, patents, CPS issue history, supply-chain notes, Chargerlab archives,
  and private documentation. Do not trigger for repo-local implementation questions or when clearly
  relevant local files already exist, unless the user explicitly asks to use Ragflow, CPS
  knowledge base, a dataset lookup, or this skill.
argument-hint: <question or dataset scope>
---

# CPS Ragflow Query

Query the 易冲半导体 (CPS) enterprise knowledge base through MyAgents' local management API. This skill is read-only and evidence-first.

## Trigger Rules

- Use Ragflow when the answer likely lives outside the current repo: CPS internal documentation, spec interpretation, protocol or state-machine behavior, reset or power-cycle requirements, mode negotiation or fallback behavior, cross-project debug history, certification tables, patents, supply-chain notes, Chargerlab archives, or enterprise datasheet catalogs.
- Do not use Ragflow first for repo-local implementation questions, current-branch behavior, or when the user already pointed to a local file/path that should be read directly.
- If the question asks why a Qi/WPC/PD/UFCS mode transition, drop-out, renegotiation, restricted/full mode change, ping/reset sequence, or disconnect recovery behaves a certain way, and the workspace has no direct source, treat it as a Ragflow problem even if the topic sounds like a public standard.
- If the user explicitly asks for Ragflow, CPS knowledge base, dataset lookup, or names this skill, use Ragflow even if local files exist.

## Stable CLI Contract

Prefer Bun. Use Node only as fallback if Bun is unavailable. Always use `--json` so the agent can inspect stable machine-readable output.

```bash
bun --no-env-file --bun scripts/cps-ragflow.js query --question "..." --json
bun --no-env-file --bun scripts/cps-ragflow.js query \
  --question "What changed in Qi 2.2.1?" \
  --dataset-id "qi 2.2.1" \
  --json
```

Fallback only when Bun is unavailable:

```bash
node scripts/cps-ragflow.js query --question "What changed in Qi 2.2.1?" --json
```

Do not call `status --json` in normal retrieval flow. Use it only when the user is explicitly debugging CPS auth or Sidecar login.

## Trigger Examples

Should trigger:

- `Qi 2.2.1 changed what compared with Qi 2.0?`
- `For TX, why must power be removed before re-entering 360 kHz MPP Restricted Mode after MPP Full Mode drops?`
- `Use Ragflow to find CPS issue history for UFCS handshake failure`
- `Find CPS knowledge-base evidence for CPW6410 datasheet pin definition`

Should not trigger:

- `Explain the UFCS state machine in this repo`
- `Read this local datasheet PDF and summarize it`
- `Find the bug in src/server/...`

Explicit override:

- `Use Ragflow`
- `Check CPS knowledge base`
- `Search the dataset catalog`

## Minimal Workflow

1. Decide whether this is a Ragflow problem or a local-workspace problem.
2. Rewrite the user request into a concise English retrieval query.
3. Start scoped when the domain is obvious; do not jump to full-library retrieval first.
4. Read `topDocuments` and `topChunks`, not just `total`.
5. Retry only when you change something material: rewrite, dataset scope, live catalog refresh, or full-library fallback.
6. Answer only from retrieved evidence. Separate evidence from inference.

Read [references/retrieval-playbook.md](references/retrieval-playbook.md) only when you need the detailed dataset routing map, rewrite hints, evidence heuristics, or retry strategy.

## Failure Routing

- Management API unavailable or CPS auth looks broken:
  Run `status --json` once and report the auth / sidecar problem. Do not keep querying blindly.
- Unknown dataset or likely stale catalog:
  Run `datasets --json`, and use `--refresh-datasets` if the needed dataset may be newly added.
- `total == 0`:
  Treat this as "no evidence found", not a system error. Do not answer from memory.
- `evidenceSignals.likelyWeakEvidence == true`:
  Retry only with a materially different search shape. If that still stays weak, answer with uncertainty instead of over-claiming.

## Answering Contract

- Never answer from memory when retrieved support is absent or weak.
- Quote or paraphrase only from `topChunks` and `topDocuments`.
- If evidence is partial, answer the supported part first and label the uncertainty.
- If multiple datasets disagree, say so.
- For yes/no questions, answer yes, no, or unclear in the first sentence.
- Separate direct evidence from inference.

Use this response structure:

```markdown
## 结论
## 关键证据
## 命中文档
## 不确定性/下一步
```

## References

Read [references/cpsai-backend-ragflow.md](references/cpsai-backend-ragflow.md) only when you need the backend contract, live schema notes, dataset catalog behavior, or auth edge cases.
