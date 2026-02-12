# syntax=docker/dockerfile:1.6
FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH" \
    NODE_ENV=production \
    PORT=8080

RUN npm install -g pnpm@latest-10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline

COPY . .
RUN pnpm build

EXPOSE 8080

CMD ["node", "/demos/web-converter/.output/server/index.mjs"]
