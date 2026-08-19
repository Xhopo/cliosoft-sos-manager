# SOS Manager Extension

## 2026-08-19 Session: v0.47 Diff enhancements + release

- (2026-08-19) Multi-file Diff now resolves Explorer / Changed Files multi-selection and runs `soscmd diff -gui <file>` once per file. Different files are never passed as the two sides of one `soscmd diff`.
- (2026-08-19) Added **Diff Two SOS Revisions**: pick 1 history revision for workarea/checkout vs that revision, or pick 2 revisions and compare `file/#/rev1` vs `file/#/rev2`.
- (2026-08-19) Custom diff commands can use `${filePath}`, `${filePath1}`, `${filePath2}`, `${revision1}`, `${revision2}`.
- (2026-08-19) Official `soscmd help diff`: at most two pathnames, both revisions of the same file; revision/label via `path/#/`. Not a general two-file content comparer.
- (2026-08-19) User asked `/servu-upload` with “更新版本号，打包并上传到服务器”. Bumped `0.46.0` → `0.47.0`, packaged `cliosoft-sos-manager-0.47.0.vsix` (16 files, 175.95 KB), uploaded to `IC_Design_Public/haokai.xiong` (1/1). Do not print upload credentials.
- (2026-08-19) Working release tools: `vsce` at `/d/tool_env/node/vsce`; upload via `C:\Users\haokai.xiong\AppData\Local\Programs\Python\Python313\python.exe` + `.claude/skills/servu-upload/scripts/upload.py`.

## 2026-08-13 Session: v0.45 status/checkout UX fixes

- (2026-08-13) Added the `SOS create file` command/menu path for `soscmd create <file_path>` and documented it for v0.45.0.
- (2026-08-13) Fixed Changed Files full scan feedback: manual refresh now uses VS Code progress/notification and reports success/failure count.
- (2026-08-13) Corrected Changed Files global selector after user supplied `soscmd help select`: use `soscmd status * -sco -suco -sncm -sne -snt`. Do **not** use unsupported lowercase `-snr`.
- (2026-08-13) SOS command flags are case-sensitive. In particular, `-snt` means needs-update, while `-sNr` uses uppercase `N` and means non-recursive select.
- (2026-08-13) Checkout default command must remain `soscmd co -Nlock <file>`. A temporary change to split it as `-N lock` was wrong and was reverted after user confirmation.
- (2026-08-13) Diagnosed checkout “waits for tens of seconds” as often being post-command refresh work rather than `co` itself. User's good log showed `co -Nlock` completed in 184 ms, folder `status *` in 73 ms, while global `status * -sco -suco -sncm -sne -snt` took 2188 ms in one case and 16441 ms in another.
- (2026-08-13) Reduced debug log flooding in `src/soscmd.ts`: large stdout is summarized and per-status-line successful parse logging was removed. This prevents VS Code Output/UI from being overwhelmed by full workspace status results.
- (2026-08-13) Changed `src/fileStatusDecorator.ts` so single-file operations no longer automatically trigger full-workspace Changed Files scan. Checkout/checkin/discard/create refresh current folder and ancestors; users manually refresh Changed Files when they need a global sync.
- (2026-08-13) Built and uploaded `cliosoft-sos-manager-0.45.0.vsix` to the established Serv-U location during the v0.45 release flow. Do not print historical upload credentials in future responses.

## Lessons for future work

- Prefer local, targeted SOS status refresh after file operations. Full workspace scan is expensive on large SOS workareas and should be user-triggered with clear UI feedback.
- Do not guess SOS selectors or flag spelling. Use documented help output or user-provided logs; SOSCMD option case matters.
- When diagnosing slow commands, compare `SOS command success after ...` timings before changing command syntax. The perceived delay may come from extension refresh/rebuild/logging after the SOS command already succeeded.
- (2026-08-19) `soscmd diff` compares at most two pathnames of the same file. Multi-file UX is N independent diffs, never file A vs file B in one command.
- (2026-08-19) `/servu-upload` plus “更新版本号” means bump package/lock/changelog/README, `npm run compile`, `vsce package`, then upload. Do not wait for a second confirmation.

## 2026-08-17/18 Session: full-scan trigger audit

- (2026-08-18) Audited `performFullWorkspaceScan()` after the v0.46 changes. Its only direct call is inside `cliosoft-sos-manager.refreshFilteredStatus`.
- (2026-08-18, line numbers rechecked 2026-08-19) Direct call is in `src/extension.ts` around the `refreshFilteredStatus` registration; the remaining automatic trigger is `filteredTreeView.onDidChangeVisibility` (~985–987): when the Changed Files tree first becomes visible, is empty, and has no disk cache, it executes `refreshFilteredStatus`. Therefore the implementation is not yet strictly manual-only.
- (2026-08-18) No code change was made in this audit, and v0.47 did not change it either. To enforce “only manual refresh performs a full scan”, remove or replace that visibility listener's `executeCommand` call; the empty view can remain empty until the user clicks Refresh.
