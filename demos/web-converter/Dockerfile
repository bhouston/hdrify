# syntax=docker/dockerfile:1.6
FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH" \
    NODE_ENV=production \
    PORT=8080

RUN npm install -g pnpm@latest-10

WORKDIR /app

FROM base AS build

# Copy workspace config and lockfile (from repo root)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package sources (needed for workspace: resolutions)
COPY packages ./packages
COPY demos ./demos

# Install all dependencies
RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline

# Build hdrify package first (web-converter dependency)
RUN pnpm build

# Build web-converter (TanStack Start + Nitro)
RUN pnpm --filter web-converter build

FROM node:24-slim AS runtime

WORKDIR /app

# Copy Nitro output from web-converter
COPY --from=build /app/demos/web-converter/.output ./.output

EXPOSE 8080

CMD ["node", ".output/server/index.mjs"]
