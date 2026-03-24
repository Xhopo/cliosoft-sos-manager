# IMAP/SMTP Email Skill

This bundled skill is optimized for CPS mailboxes first and Bun first.

## CPS Quick Start

For `@convenientpower.com`, use NetEase 163 enterprise mail defaults:

- IMAP: `imap.qiye.163.com:993`
- SMTP: `smtp.qiye.163.com:465`
- `IMAP_TLS=true`
- `SMTP_SECURE=true`
- `SMTP_FROM=<full mailbox address>`

Before configuring, enable `IMAP/SMTP` in 163 enterprise webmail and generate a client authorization code. Use the authorization code, not the webmail login password.

Then run:

```bash
bun --no-env-file --bun scripts/configure.js apply \
  --provider cps-163-enterprise \
  --email your.name@convenientpower.com \
  --auth-code <163_authorization_code> \
  --check
```

If Bun is unavailable, fall back to:

```bash
node scripts/configure.js apply --provider cps-163-enterprise --email your.name@convenientpower.com --auth-code <163_authorization_code> --check
```

`setup.sh` is kept as a compatibility wrapper and calls the same flow.

## Action-First Workflow

After the mailbox is configured, call the mail action directly. Do not start with `doctor` unless you are diagnosing a problem.

```bash
bun --no-env-file --bun scripts/imap.js check --limit 10 --unseen
bun --no-env-file --bun scripts/imap.js search --recent 7d --subject "invoice"
bun --no-env-file --bun scripts/imap.js fetch <uid>
bun --no-env-file --bun scripts/imap.js download <uid> --dir ./attachments
bun --no-env-file --bun scripts/smtp.js send --to teammate@example.com --subject "Status" --body "Hello"
```

If a direct action fails with `EMAIL_CONFIG_MISSING` or `EMAIL_SECRET_MISSING`, run the configure flow and retry the original action.

## Diagnose Configuration

Use `doctor` when you need to know what is missing. Add `--probe` only for live connectivity checks.

```bash
bun --no-env-file --bun scripts/configure.js doctor
bun --no-env-file --bun scripts/configure.js doctor --probe
```

Typical states:

- `needs-config`: non-sensitive settings are incomplete
- `needs-secret`: `.env` is ready but the authorization code is missing
- `ready`: the mailbox is configured and the next step is to run the requested mail action

## Stored Configuration

`.env` stores only non-sensitive settings:

```bash
EMAIL_PROVIDER=cps-163-enterprise
IMAP_HOST=imap.qiye.163.com
IMAP_PORT=993
IMAP_USER=your.name@convenientpower.com
IMAP_TLS=true
IMAP_REJECT_UNAUTHORIZED=true
IMAP_MAILBOX=INBOX

SMTP_HOST=smtp.qiye.163.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your.name@convenientpower.com
SMTP_FROM=your.name@convenientpower.com
SMTP_REJECT_UNAUTHORIZED=true
```

Authorization codes are stored separately through the MyAgents management API / OS keychain:

```bash
bun --no-env-file --bun scripts/credentials.js set
```

## Other Providers

Other mailboxes still work. You can either set `EMAIL_PROVIDER` to a supported preset or provide explicit host settings.

Supported presets include:

- `cps-163-enterprise`
- `163-enterprise`
- `163.com`
- `vip.163.com`
- `126.com`
- `vip.126.com`
- `188.com`
- `vip.188.com`
- `yeah.net`
- `gmail`
- `outlook`
- `qq`

## Package Scripts

```bash
bun run configure -- --provider cps-163-enterprise --email your.name@convenientpower.com --auth-code <163_authorization_code> --check
bun run doctor
bun run check -- --limit 10 --unseen
bun run search -- --recent 7d
bun run send -- --to teammate@example.com --subject "Hi" --body "Hello"
bun run verify
bun test
```
