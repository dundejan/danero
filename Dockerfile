# Vlastní instance Danera. Návod: docs/16-selfhosting.md
# Build z kořene monorepa:  docker build -t danero .

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    # zapne `output: 'standalone'` — samostatný server.js se zabaleným node_modules
    NEXT_OUTPUT_STANDALONE=1
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# curl kvůli healthchecku v docker-compose.yml
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# standalone nese server.js i potřebné node_modules; statika a public se kopírují zvlášť
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
# migrace Postgresu (PGlite si migruje sám při startu)
COPY --from=builder --chown=node:node /app/apps/web/db/migrations ./apps/web/db/migrations

USER node
EXPOSE 3000
# aby se nezdravá instance poznala i bez docker-compose (orchestrátor, `docker run`)
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "apps/web/server.js"]
