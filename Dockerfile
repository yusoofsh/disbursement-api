# syntax=docker/dockerfile:1

# ---- Build stage -------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Upstream builds use pnpm (repo ships pnpm-lock.yaml). Pin pnpm@11.
RUN npm install -g pnpm@11.20.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
RUN pnpm build

# ---- Runtime stage -----------------------------------------------------------
# bookworm-slim (glibc) so argon2 uses prebuilt binaries without a toolchain.
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist

# Compiled src/db/migrate.ts resolves the migrations folder relative to its own
# module path (dist/db), so the SQL migration files must land at dist/db/migrations.
COPY src/db/migrations ./dist/db/migrations

USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
