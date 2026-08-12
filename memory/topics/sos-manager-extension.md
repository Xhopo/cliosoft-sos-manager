# SOS Manager Extension

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
