#!/usr/bin/env bash
# Disposable PostgreSQL 16 cluster for the next-release rehearsal (port 5434, trust auth, localhost only).
set -euo pipefail
D=/var/tmp/nr-rehearsal-pg
B=/usr/lib/postgresql/16/bin
mkdir -p "$D"
chown postgres:postgres "$D"
if [[ ! -f "$D/data/PG_VERSION" ]]; then
  runuser -u postgres -- "$B/initdb" -D "$D/data" -U postgres --auth=trust -E UTF8 >/dev/null
fi
runuser -u postgres -- "$B/pg_ctl" -D "$D/data" -o "-p 5434 -k $D -c listen_addresses=127.0.0.1" -l "$D/pg.log" -w start
psql -h 127.0.0.1 -p 5434 -U postgres -tAc "select version()"
