#!/bin/zsh
set -euo pipefail

DIR="${0:A:h}"
NODE="${NODE:-/Users/mahmoudsultan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
CONFIG="${1:-$DIR/config.json}"
export NODE_PATH="${NODE_PATH:-/Users/mahmoudsultan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules}"

if [[ -z "${DISCORD_WEBHOOK_URL:-}" ]] && /usr/bin/grep -q '"discordWebhookUrl": ""' "$CONFIG"; then
  echo "Paste your Discord webhook URL, then press Enter."
  echo "Leave blank to run without Discord notifications."
  read -r DISCORD_WEBHOOK_URL
  export DISCORD_WEBHOOK_URL
fi

exec "$NODE" "$DIR/stock-tracker.mjs" "$CONFIG"
