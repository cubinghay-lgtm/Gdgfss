#!/usr/bin/env bash
# motio background health check — confirms the app can function systematically
# with Supabase and the imagery backend, on the go. Reads tokens from .env.
#   ./scripts/health-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then echo "✗ no .env (copy .env.example -> .env)"; exit 1; fi
set -a; . ./.env; set +a

fail=0
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; fail=1; }

echo "motio health check"

# 1) Supabase REST reachable + hazards view readable with the publishable key.
code=$(curl -s -o /dev/null -w "%{http_code}" \
  "$SUPABASE_URL/rest/v1/hazards_scored?select=id&limit=1" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $SUPABASE_PUBLISHABLE_KEY")
[ "$code" = "200" ] && ok "Supabase REST + hazards_scored ($code)" || bad "Supabase REST returned $code"

# 2) Imagery edge function: elevation for downtown Novato returns a number.
ev=$(curl -s "$IMAGERY_ENDPOINT?kind=elevation&lat=38.1074&lng=-122.5697" | grep -o '"elevation":[0-9.]*' || true)
[ -n "$ev" ] && ok "Imagery edge function ($ev m)" || bad "Imagery edge function: no elevation"

# 3) Geofence guard still rejects out-of-area requests.
code=$(curl -s -o /dev/null -w "%{http_code}" "$IMAGERY_ENDPOINT?kind=elevation&lat=40.7&lng=-74.0")
[ "$code" = "400" ] && ok "Geofence rejects out-of-area ($code)" || bad "Geofence returned $code (expected 400)"

# 4) Front-end config matches .env (drift guard).
grep -q "$SUPABASE_URL" js/sync.js && ok "js/sync.js URL matches .env" || bad "js/sync.js URL drift vs .env"

[ "$fail" = "0" ] && echo "All systems go." || { echo "Problems found."; exit 1; }
