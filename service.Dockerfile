# Shared template for every microservice — Compose passes a different
# SERVICE_NAME build arg per service (see docker-compose.yml), so this one
# file builds/runs whichever service each container needs, instead of 15
# near-identical Dockerfiles that would inevitably drift out of sync.
#
# Build context MUST be the repo root (where pnpm-workspace.yaml lives),
# not this docker/ folder — see the `context: .` in docker-compose.yml.

FROM node:22-slim AS build
ARG SERVICE_NAME
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app

# Copy workspace manifests first for better layer caching across services —
# this layer only invalidates when a dependency actually changes, not on
# every code edit.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile

# Generate the Prisma client once from the shared schema — every service
# resolves @prisma/client through pnpm's hoisted node_modules.
RUN pnpm exec prisma generate --schema=packages/config/prisma/schema.prisma

RUN pnpm --filter "${SERVICE_NAME}" run build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:22-slim
ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app

COPY --from=build /app /app

WORKDIR /app/services/${SERVICE_NAME}
CMD ["node", "dist/main.js"]
