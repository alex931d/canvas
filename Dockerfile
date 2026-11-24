# syntax=docker/dockerfile:1
#
# The app as one image: the Next.js standalone server, plus the database
# migrations it runs before starting. Built and run by deploy/compose.yml
# (README: Deploying to a VPS). Nothing secret goes into it: settings come
# from deploy/.env when the container starts, and .dockerignore keeps .env
# files out of the build.

ARG NODE_IMAGE=node:22-bookworm-slim

# ------------------------------------------------ dependencies
# Cached until package.json or package-lock.json change.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A new id for every deploy (deploy/deploy.sh passes the git commit): pages
# still open from the previous version reload instead of mixing versions.
ARG NEXT_DEPLOYMENT_ID=""
RUN mkdir -p public && NEXT_OUTPUT=standalone NEXT_DEPLOYMENT_ID="${NEXT_DEPLOYMENT_ID}" npm run build

# --------------------------------------------------------- run
FROM ${NODE_IMAGE} AS run
WORKDIR /app
# HOSTNAME: listen on every interface, not just the container's own name.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The server and only the files it needs (output: "standalone").
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Migrations: the SQL, the script, and the one package it needs that the
# server doesn't already bring (pg and @next/env are in the standalone output).
# Also the admin scripts, which need nothing more: from deploy/,
#   docker compose exec app node scripts/role.mjs set you@example.com admin
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.mjs /app/scripts/role.mjs /app/scripts/membership.mjs ./scripts/
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --chmod=755 deploy/app-start.sh /usr/local/bin/app-start

USER node
EXPOSE 3000
CMD ["app-start"]
