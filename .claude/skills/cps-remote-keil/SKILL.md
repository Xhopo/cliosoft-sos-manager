---
name: cps-remote-keil
description: >-
  Use for remote CPS firmware workspace inspection and remote Keil build/HEX export through
  MyAgents when the needed code is not already available in the current workspace. This skill is
  for remote repository logic, remote source edits, and remote build packaging for CPS8610,
  CPS4050, CPS4041-style workspaces, and similar CPS firmware projects. Do not trigger for local
  repo code-reading or local firmware builds when clearly relevant local files already exist,
  unless the user explicitly asks to use remote Keil, a remote workspace, or build/export HEX from
  the remote pipeline.
argument-hint: <workspace or request>
---

# CPS Remote Keil

Query or modify remote CPS firmware workspaces through MyAgents' local management API. This skill reuses the existing CPS sign-in session from MyAgents. Never ask the user for a token and never hardcode a token.

## Trigger Rules

- Use this skill when the user needs remote CPS firmware workspace logic, remote source edits, remote Keil build verification, or remote HEX export.
- Do not use this skill first for code that is already present in the current workspace. Read local repos and local files first when they are clearly relevant.
- If the user explicitly asks for remote Keil, a remote workspace, remote build packaging, or a remote HEX, use this skill even if a local repo exists.

## Stable CLI Contract

Prefer Bun. Use Node only as fallback if Bun is unavailable. Always use `--json` so the agent can inspect machine-readable output.

```bash
bun --no-env-file --bun scripts/cps-remote-keil.js ask --question "..." --workspace 8610 --json
bun --no-env-file --bun scripts/cps-remote-keil.js edit_build --request "..." --workspace 4050 --json
bun --no-env-file --bun scripts/cps-remote-keil.js verify --workspace 8610 --json
```

Fallback only when Bun is unavailable:

```bash
node scripts/cps-remote-keil.js ask --question "..." --workspace 8610 --json
```

Use `status --json` only when debugging CPS auth or remote-pipeline availability.

## Trigger Examples

Should trigger:

- `Use remote Keil to explain the CPS8610 boot flow`
- `Modify remote workspace 4050 and export HEX`
- `Verify the remote 4041 pipeline and confirm the HEX was downloaded`

Should not trigger:

- `Explain this local CPS8610 repo`
- `Inspect src/... in the current workspace`
- `Build the firmware that is already in this local repo`

Explicit override:

- `Use remote Keil`
- `Use workspace 8610 remotely`
- `Build and export HEX from the remote pipeline`

## Minimal Workflow

1. Decide whether the task should stay local or must go to the remote workspace.
2. Infer the workspace from the request. If none is clear, ask once.
3. Use `ask` for read-only code understanding.
4. Use `edit_build` for remote source changes, rebuilds, and HEX export.
5. Use `verify` for end-to-end remote pipeline verification with a harmless change.
6. Do not claim success unless the returned build result and HEX fields support it.

Read [references/remote-workflow-playbook.md](references/remote-workflow-playbook.md) only when you need the detailed mode selection rules, workspace heuristics, output fields, or failure handling.

## Failure Routing

- Auth or management API issue:
  Run `status --json` once and report the CPS auth / remote pipeline problem.
- No concrete workspace:
  Ask once for the workspace number before calling the tool.
- `success == false` or `error` is present:
  Surface the returned error directly and stop pretending the remote action worked.
- Build result is not successful:
  Summarize the build failure and do not claim a HEX exists.
- `hex_local_path` is missing:
  Do not claim the HEX is ready locally.

## Answering Contract

- Answer from returned evidence, not memory.
- For `ask`, prefer `summary`, `final_answer`, `steps`, and `evidence`.
- For `edit_build` and `verify`, report changed files, build result, and HEX availability separately.
- If the remote backend says `No files changed`, do not pretend a rebuild/export happened unless the returned build output proves it.

Use this response structure for build-oriented tasks:

```markdown
修改概览
改动文件
构建结果
HEX 文件
风险/备注
```
