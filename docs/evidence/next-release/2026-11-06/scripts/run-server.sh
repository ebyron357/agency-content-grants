#!/usr/bin/env bash
# Usage: run-server.sh <worktree-name> <full-sha> <log-file>. Starts the API in production mode on :8080 against the rehearsal DB and disk.
set -euo pipefail
R=/tmp/claude-0/-home-user-agency-content-grants/e22c0b2c-46ea-5f5f-8bd2-a9d68e47f66f/scratchpad/rehearsal
cd "$R/$1/artifacts/api-server"
export NODE_ENV=production PORT=8080 GIT_COMMIT="$2"
export DATABASE_URL="postgresql://rehearsal:rehearsal@127.0.0.1:5434/rehearsal_upgrade"
export UPLOAD_DIR="$R/disk/uploads/images" SOURCE_UPLOAD_DIR="$R/disk/uploads/sources" EXPORT_DIR="$R/disk/exports"
export SESSION_SECRET="$(cat $R/secrets/session)" MFA_ENCRYPTION_KEY="$(cat $R/secrets/mfa)" ADMIN_PASSWORD="$(cat $R/secrets/admin)"
nohup node --enable-source-maps ./dist/index.mjs > "$3" 2>&1 &
echo $! > "$R/server.pid"
