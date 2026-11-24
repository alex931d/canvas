#!/bin/sh
# The backup container: a database dump every BACKUP_EVERY_HOURS hours
# (24 by default), the first one that long after the container starts.
# deploy/deploy.sh also takes one before every update.
set -u
hours=${BACKUP_EVERY_HOURS:-24}
echo "backups: every $hours h into /backups (deploy/backups on the server), kept ${BACKUP_KEEP_DAYS:-14} days"
while :; do
  sleep $((hours * 3600))
  sh /backup/backup.sh || echo "backup failed; trying again in $hours h" >&2
done
