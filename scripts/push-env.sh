#!/usr/bin/env bash
# Copy apps/web/.env.local into Vercel, one variable at a time.
#
# YOU run this, not the assistant: it reads real credentials, and the values
# go straight from your disk to Vercel without being printed anywhere. Nothing
# here echoes a value — only the name of each variable as it is sent.
#
#   cd apps/web && bash ../../scripts/push-env.sh      # production
#   cd apps/web && bash ../../scripts/push-env.sh preview
set -euo pipefail

TARGET="${1:-production}"
ENV_FILE=".env.local"

[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here. Run this from apps/web."; exit 1; }

while IFS= read -r line || [ -n "$line" ]; do
  # skip blanks and comments
  case "$line" in ''|\#*) continue ;; esac
  name="${line%%=*}"
  value="${line#*=}"
  # strip surrounding quotes if present
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  [ -n "$name" ] || continue

  # Vercel's own CLI writes VERCEL_OIDC_TOKEN into this file when it links a
  # project. It is a short-lived local credential, it is regenerated on every
  # link, and pushing it back up would be both pointless and confusing.
  case "$name" in VERCEL_*) echo "  skip $name (written by the Vercel CLI)"; continue ;; esac

  echo "→ $name"
  # remove any existing copy first, so re-running is safe
  npx vercel env rm "$name" "$TARGET" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | npx vercel env add "$name" "$TARGET" >/dev/null
done < "$ENV_FILE"

echo
echo "Done. Variables now in Vercel ($TARGET):"
npx vercel env ls "$TARGET"
