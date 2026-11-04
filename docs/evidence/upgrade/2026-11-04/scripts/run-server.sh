#!/usr/bin/env bash
# Usage: run-server.sh <worktree-name> <full-sha> <log-file>. Starts the API in production mode on :8080 against the rehearsal DB and disk.
set -euo pipefail
R=/tmp/claude-0/-home-user-agency-content-grants/77b9b69c-03e2-5835-96d7-3cd9529f0629/scratchpad/rehearsal
cd "$R/$1/artifacts/api-server"
export NODE_ENV=production PORT=8080 GIT_COMMIT="$2"
export DATABASE_URL="postgresql://rehearsal:rehearsal@127.0.0.1:5432/rehearsal_upgrade"
export UPLOAD_DIR="$R/disk/uploads/images" SOURCE_UPLOAD_DIR="$R/disk/uploads/sources" EXPORT_DIR="$R/disk/exports"
export SESSION_SECRET="$(cat $R/secrets/session)" MFA_ENCRYPTION_KEY="$(cat $R/secrets/mfa)" ADMIN_PASSWORD="$(cat $R/secrets/admin)"
nohup node --enable-source-maps ./dist/index.mjs > "$3" 2>&1 &
echo $! > "$R/server.pid"
