# Remote Workflow Playbook

Load this file only when you need the detailed remote-workspace workflow.

## Workspace Heuristics

Infer the workspace from the user request when possible:

- `CPS8610`, `8610` -> `--workspace 8610`
- `CPS4050`, `4050` -> `--workspace 4050`
- `CPSxxxx` -> try `--workspace xxxx`
- Example: `CPS4041` -> `--workspace 4041`

If the user did not identify a concrete workspace number, ask once before calling the tool.

## Mode Selection

- `ask`: read-only remote code understanding
- `edit_build`: remote source changes, rebuilds, and HEX generation
- `verify`: harmless remote edit plus build and local HEX download verification

Prefer `verify` when the goal is pipeline verification rather than a meaningful source change.

## Ask Mode

Use for read-only code understanding. The response may include:

- `summary`
- `final_answer`
- `steps`
- `evidence[]` with `file`, `line_range`, `snippet`, `why_relevant`
- `uncertain`
- `quality_issues`

Answer from the returned evidence, not memory.

## Edit Build Mode

Use for code changes, rebuilds, and HEX generation. The response may include:

- `codex_summary`
- `changed_files[]`
- `build.success`
- `build.elapsed_sec`
- `hex_local_path`
- `hex_crc32`

If the request is only "rebuild and export HEX", the remote backend can return `No files changed`.
In that case, re-run with an explicit harmless edit request or use `verify`.

## Verify Mode

Use `verify` when you need proof that the whole remote pipeline is healthy.
It applies a harmless comment change, runs the build, downloads the HEX locally, and fails if the local HEX file is missing.

```bash
bun --no-env-file --bun scripts/cps-remote-keil.js verify --workspace 8610 --download-dir .tmp-remote-keil --json
```

## Common Commands

```bash
bun --no-env-file --bun scripts/cps-remote-keil.js ask --question "Qi power mode switch 在哪里切换？" --workspace 8610 --json
bun --no-env-file --bun scripts/cps-remote-keil.js ask --question "dummy load 的调用链是什么？" --workspace 4050 --json
bun --no-env-file --bun scripts/cps-remote-keil.js ask --question "CPS4041 的 boot 入口在哪里？" --workspace 4041 --json
bun --no-env-file --bun scripts/cps-remote-keil.js edit_build --request "不改逻辑，只重新构建当前工程并导出 HEX" --workspace 8610 --json
```

## Failure Handling

- If auth fails, tell the user to sign in to CPS from MyAgents first.
- If `success == false`, surface the `error` directly.
- If build fails, summarize the error and do not pretend a HEX exists.
