# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    TZ=Africa/Tunis
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates openssl tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app --create-home --home-dir /home/app app

# Install on Linux, including native optional packages. Never copy host modules
# or registry configuration. --omit=peer mirrors the project's .npmrc.
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --omit=peer --include=dev --include=optional \
    && npm cache clean --force

FROM deps AS build
ENV NODE_ENV=production
COPY . .
RUN mkdir -p public
# Module validation runs during compilation. These public dummy values are
# scoped to this command; production credentials are supplied only at runtime.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" \
    NEXTAUTH_URL="http://localhost:3000" \
    NEXTAUTH_SECRET="docker-build-placeholder-not-a-runtime-secret" \
    npm run build

# Explicit one-shot operations image. CLI, tsx and seed source never enter the
# application image. Its default command only displays help and changes no data.
FROM deps AS tools
ENV NODE_ENV=production \
    HOME=/home/app
COPY --chown=1001:1001 prisma ./prisma
COPY --chown=1001:1001 tsconfig.json ./
COPY --chown=1001:1001 scripts/docker/init-admin.mjs ./scripts/docker/init-admin.mjs
COPY --chown=1001:1001 src/lib/password.ts src/lib/business-error.ts ./src/lib/
COPY --chown=1001:1001 src/validations/auth.ts src/validations/locale.ts ./src/validations/
USER 1001:1001
CMD ["node", "node_modules/prisma/build/index.js", "--help"]

# Keep this last: an untargeted build produces only the production application.
FROM base AS runner
ENV NODE_ENV=production \
    HOME=/home/app \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=1001:1001 /app/.next/standalone ./
COPY --from=build --chown=1001:1001 /app/.next/static ./.next/static
COPY --from=build --chown=1001:1001 /app/public ./public
USER 1001:1001
# Fail packaging if a native runtime is missing or development tooling leaked.
RUN node -e "if (!require('sharp').versions.vips) process.exit(1); require('pg'); require('@prisma/client/runtime/client'); require.resolve('@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs')" \
    && test ! -e node_modules/prisma/build/index.js \
    && test ! -e node_modules/tsx/dist/cli.mjs \
    && test ! -e node_modules/vitest \
    && test ! -e node_modules/typescript \
    && test ! -e node_modules/eslint \
    && test ! -e node_modules/next/dist/bin/next \
    && test ! -e node_modules/next/dist/cli/next-dev.js \
    && test ! -e node_modules/next/dist/next-devtools
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health', { signal: AbortSignal.timeout(4000) }).then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.js"]
