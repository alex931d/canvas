#!/bin/sh
# One dump of the whole database into /backups, then dumps older than
# BACKUP_KEEP_DAYS days (14 by default) are deleted. Connection settings
# come from PGHOST, PGUSER, PGPASSWORD and PGDATABASE.
#
#   docker compose exec backup sh /backup/backup.sh      (from deploy/)
set -eu
dir=${BACKUP_DIR:-/backups}
keep=${BACKUP_KEEP_DAYS:-14}
name="canvas-$(date -u +%Y-%m-%d-%H%M%S).dump"
mkdir -p "$dir"
# Written under a temporary name, so a half-written file never looks like a backup.
pg_dump --format=custom --file="$dir/.$name.part"
mv "$dir/.$name.part" "$dir/$name"
find "$dir" -maxdepth 1 -type f -name 'canvas-*.dump' -mtime +"$keep" -exec rm -f {} +
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup saved: $name ($(du -h "$dir/$name" | cut -f1))"
