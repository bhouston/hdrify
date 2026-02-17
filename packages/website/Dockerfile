# syntax=docker/dockerfile:1.6
FROM --platform=linux/amd64 node:24-slim AS base

ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH" \
    NODE_ENV=production \
    PORT=8080 \
    CI=true

RUN npm install -g pnpm@latest-10

WORKDIR /app

# Copy dependency manifests first so this layer is cacheable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Fetch deps in container so optional deps (e.g. @tailwindcss/oxide-linux-x64-gnu) install for this platform
RUN pnpm fetch --reporter=silent

COPY . .

# Install links from store; @tailwindcss/oxide postinstall runs (onlyBuiltDependencies in root package.json)
RUN pnpm install --frozen-lockfile --prefer-offline

RUN pnpm build

EXPOSE 8080

CMD ["node", "/app/packages/website/.output/server/index.mjs"]
