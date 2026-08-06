# syntax=docker/dockerfile:1

# ---- Build stage -------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# The repo uses nub and ships nub.lock; there is no package-lock.json yet, so
# plain npm install resolves from package.json. If a package-lock.json is added
# later, switch this to `npm ci`.
COPY package.json ./
RUN npm install

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
RUN npm run build

# ---- Runtime stage -----------------------------------------------------------
# bookworm-slim (glibc) so argon2 uses prebuilt binaries without a toolchain.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

# Compiled src/db/migrate.ts resolves the migrations folder relative to its own
# module path (dist/db), so the SQL migration files must land at dist/db/migrations.
COPY src/db/migrations ./dist/db/migrations

USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
