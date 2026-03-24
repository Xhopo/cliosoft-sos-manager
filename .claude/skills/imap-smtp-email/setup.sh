#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RUNNER=()
RUNNER_LABEL=""

if command -v bun >/dev/null 2>&1; then
  RUNNER=(bun --no-env-file --bun)
  RUNNER_LABEL="bun --no-env-file --bun"
elif command -v node >/dev/null 2>&1; then
  RUNNER=(node)
  RUNNER_LABEL="node"
else
  echo "Neither Bun nor Node.js is available."
  echo "Install Bun for the preferred path, or use Node.js as a fallback."
  exit 1
fi

echo "IMAP/SMTP Email Skill Setup"
echo
echo "Default path: CPS @convenientpower.com on NetEase 163 enterprise mail."
echo "You need:"
echo "  1. Full mailbox address"
echo "  2. 163 enterprise authorization code"
echo "  3. Optional mailbox folder (default: INBOX)"
echo
echo "Before continuing, enable IMAP/SMTP in 163 enterprise webmail."
echo "Use the authorization code, not the webmail login password."
echo

read -r -p "Full mailbox address: " EMAIL
if [ -z "$EMAIL" ]; then
  echo "Email address is required."
  exit 1
fi

read -r -s -p "163 enterprise authorization code: " AUTH_CODE
echo
if [ -z "$AUTH_CODE" ]; then
  echo "Authorization code is required."
  exit 1
fi

read -r -p "Mailbox folder [INBOX]: " MAILBOX
MAILBOX="${MAILBOX:-INBOX}"

PROVIDER=""
if [[ "$EMAIL" == *@convenientpower.com ]]; then
  PROVIDER="cps-163-enterprise"
else
  echo
  echo "Press Enter to let the skill infer the provider from the email address."
  echo "Common presets: cps-163-enterprise, 163-enterprise, gmail, outlook, qq"
  read -r -p "Provider preset [auto]: " PROVIDER
fi

read -r -p "Run IMAP/SMTP validation now? [Y/n]: " CHECK_NOW
CHECK_NOW="${CHECK_NOW:-Y}"

CMD=("${RUNNER[@]}" scripts/configure.js apply --email "$EMAIL" --auth-code "$AUTH_CODE" --mailbox "$MAILBOX")

if [ -n "$PROVIDER" ]; then
  CMD+=(--provider "$PROVIDER")
fi

case "$CHECK_NOW" in
  n|N)
    ;;
  *)
    CMD+=(--check)
    ;;
esac

echo
echo "Running via: $RUNNER_LABEL"
"${CMD[@]}"
echo
echo "Try these next commands:"
echo "  $RUNNER_LABEL scripts/imap.js check --limit 10 --unseen"
echo "  $RUNNER_LABEL scripts/imap.js search --recent 7d"
echo "  $RUNNER_LABEL scripts/smtp.js send --to teammate@example.com --subject Test --body Hello"
