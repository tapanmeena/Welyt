FROM node:24-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists
RUN npm install --global pnpm@12.18.0

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm --filter welyt-api... install --frozen-lockfile

COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
COPY apps/api/src/ ./apps/api/src/
COPY apps/api/drizzle/ ./apps/api/drizzle/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src/ ./packages/shared/src/
RUN pnpm run api:build \
    && pnpm --filter welyt-api deploy --legacy --prod --frozen-lockfile /out

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=/data/welyt.db

WORKDIR /app
COPY --from=build /out/ ./
COPY LICENSE ./LICENSE
RUN mkdir -p /data && chown node:node /data && chmod 700 /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/health', { signal: AbortSignal.timeout(3000) }); if (!response.ok) process.exit(1);"]
CMD ["node", "dist/server.js"]
