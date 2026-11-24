#!/bin/sh
# How the app container starts: bring the database up to date (applies any
# new migrations, does nothing otherwise), then serve. If the migrations
# fail, the app doesn't start and Docker tries again a few seconds later.
set -e
node scripts/migrate.mjs
exec node server.js
