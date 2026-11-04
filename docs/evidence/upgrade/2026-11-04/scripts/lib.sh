# Shared helpers for the rehearsal scripts. All data is synthetic and prefixed [REHEARSAL].
R=/tmp/claude-0/-home-user-agency-content-grants/77b9b69c-03e2-5835-96d7-3cd9529f0629/scratchpad/rehearsal
API=https://localhost:8443/api
ADMIN_PASSWORD="$(cat $R/secrets/admin)"
PSQL="psql postgresql://rehearsal:rehearsal@127.0.0.1:5432/rehearsal_upgrade -tAq"
# c <jar> <curl args...>: JSON request with a cookie jar; prints body.
c() { local jar="$1"; shift; curl -sk --max-time 30 -H 'Content-Type: application/json' -b "$R/$jar.jar" -c "$R/$jar.jar" "$@"; }
# code <jar> <curl args...>: prints the HTTP status only.
code() { local jar="$1"; shift; curl -sk --max-time 30 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -b "$R/$jar.jar" -c "$R/$jar.jar" "$@"; }
pass=0; fail=0
check() { if [[ "$2" == "$3" ]]; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi; }
# Wait until a new 30-second TOTP step starts, so a fresh code is never refused as reused.
fresh_step() { local s=$(( $(date +%s) % 30 )); sleep $(( 31 - s )); }
totp() { node "$R/scripts/totp.mjs" "$1" "${2:-0}"; }
