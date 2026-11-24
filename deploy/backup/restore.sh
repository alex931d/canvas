#!/bin/sh
# Put a backup back. Everything now in the database is replaced by what's in
# the file, in one transaction: if the file can't be read or anything fails,
# nothing changes. Stop the app first (README: Backups), then from deploy/:
#
#   docker compose exec backup sh /backup/restore.sh /backups/canvas-2026-11-24-031700.dump
set -eu
file=${1:-}
if [ -z "$file" ] || [ ! -f "$file" ]; then
  # shellcheck disable=SC2012 # our own file names
  echo "Which backup? Pass a file, e.g. $(ls -1t "${BACKUP_DIR:-/backups}"/canvas-*.dump 2>/dev/null | head -1)" >&2
  exit 1
fi
echo "Restoring $file into the database \"$PGDATABASE\": its current contents will be replaced."

# A dump made with --schema=public creates the schema itself; a whole-database dump doesn't.
create_public="CREATE SCHEMA public;"
if pg_restore --list "$file" 2>/dev/null | grep -q " SCHEMA - public "; then create_public=""; fi

failed=$(mktemp)
trap 'rm -f "$failed"' EXIT
export PGOPTIONS="--client-min-messages=warning"
# COMMIT is only sent once the whole file has been read; without it, the
# transaction is rolled back when psql disconnects.
if ! {
  echo "BEGIN;"
  echo "DROP SCHEMA IF EXISTS drizzle CASCADE;"
  echo "DROP SCHEMA IF EXISTS public CASCADE;"
  echo "$create_public"
  if pg_restore --no-owner --no-acl --file=- "$file"; then
    echo "COMMIT;"
  else
    echo x >"$failed"
  fi
} | psql --quiet --set=ON_ERROR_STOP=1 --dbname="$PGDATABASE" >/dev/null; then
  echo "The restore stopped at the error above. Nothing was changed." >&2
  exit 1
fi
if [ -s "$failed" ]; then
  echo "That file couldn't be read as a backup. Nothing was changed." >&2
  exit 1
fi
echo "Restored. Start the app again: docker compose start app"
