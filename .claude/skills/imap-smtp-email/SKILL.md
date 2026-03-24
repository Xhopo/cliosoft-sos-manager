---
name: imap-smtp-email
description: Use when the user needs to configure email, 163 enterprise mail, authorization code, @convenientpower.com mailbox, view new mail, check unread, search mail, download attachments, send mail, or reply mail. 支持配置邮箱、163 企业邮箱、授权码、@convenientpower.com、查看新邮件、检查未读、搜索邮件、下载附件、发送邮件、回复邮件。 Default to CPS @convenientpower.com mailboxes on NetEase 163 enterprise mail.
---

# IMAP/SMTP Email

Default to action-first behavior.

- If the user asks to check unread mail, search mail, fetch a message, download attachments, send mail, or reply, run the relevant command first.
- Do not start by explaining setup unless the user explicitly asks to configure email.
- If a direct action fails with `EMAIL_CONFIG_MISSING`, `EMAIL_SECRET_MISSING`, or another setup-related auth/config error, switch into the setup flow, complete it, and then retry the original action automatically.

## CPS Default

Treat CPS mailboxes as the primary path.

- For `@convenientpower.com`, assume NetEase 163 enterprise mail.
- Ask only for:
  - full mailbox address
  - 163 enterprise authorization code
  - optional mailbox folder, default `INBOX`
- Remind the user to enable `IMAP/SMTP` in 163 enterprise webmail first.
- Remind the user to use the authorization code, not the webmail login password.

Use these defaults for CPS and other 163 enterprise mailboxes:

- `EMAIL_PROVIDER=cps-163-enterprise`
- `imap.qiye.163.com:993`
- `smtp.qiye.163.com:465`
- `IMAP_TLS=true`
- `SMTP_SECURE=true`
- `SMTP_FROM=<full mailbox address>`

## Commands

Prefer Bun.

- Configure:
  - `bun --no-env-file --bun scripts/configure.js apply --provider cps-163-enterprise --email your.name@convenientpower.com --auth-code <163_authorization_code> --check`
- Diagnose current setup:
  - `bun --no-env-file --bun scripts/configure.js doctor`
  - Add `--probe` only when you need a live IMAP/SMTP connectivity check.
- Check unread or recent mail:
  - `bun --no-env-file --bun scripts/imap.js check --limit 10 --unseen`
- Search mail:
  - `bun --no-env-file --bun scripts/imap.js search --subject "invoice" --recent 7d`
- Fetch or download:
  - `bun --no-env-file --bun scripts/imap.js fetch <uid>`
  - `bun --no-env-file --bun scripts/imap.js download <uid> --dir <path>`
- Send or reply:
  - `bun --no-env-file --bun scripts/smtp.js send --to person@example.com --subject "Re: ..." --body-file reply.txt`

Use `node scripts/...` only as fallback if Bun is unavailable.

## Setup Flow

When the user explicitly asks to configure email, or a direct action fails because setup is incomplete:

1. Collect the minimum fields.
2. Run `scripts/configure.js apply`.
3. If setup was triggered by a failed action, retry the original action immediately after configuration succeeds.

Keep secrets out of `.env`.

- Non-sensitive settings go to `.env`.
- Authorization codes are stored through the MyAgents management API / OS keychain.

## Error Handling

Use the error code to decide the next step.

- `EMAIL_CONFIG_MISSING`: collect mailbox address, provider, and optional mailbox folder, then run `configure.js apply`.
- `EMAIL_SECRET_MISSING`: ask for the authorization code and run `configure.js apply` or `credentials.js set`.
- `EMAIL_AUTH_FAILED`: tell the user to confirm IMAP/SMTP is enabled in 163 enterprise webmail and that they used the authorization code instead of the login password.
- `EMAIL_CONNECTION_FAILED`: keep the CPS defaults, verify host/port/TLS, and only then try live probes.
