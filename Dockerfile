# ─────────────────────────────────────────────────────────────
#  College Planner — Multi-stage Docker Build
#  Supports Apple Silicon (ARM64) and Intel Macs (AMD64)
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ─────────────────────────────
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
# Use `npm install` instead of `npm ci` so the build doesn't fail when
# devDependencies are added without a fresh lockfile commit. `npm ci` is
# stricter and better for CI, but for the dev/staging Docker workflow
# we'd rather not require contributors to regenerate the lockfile after
# every package.json edit. The standalone Next.js output strips dev
# dependencies from the runner stage anyway, so this only affects the
# build container.
RUN npm install --legacy-peer-deps

# ── Stage 2: Build the Next.js app ────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS
ENV NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=$NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS
# Dummy values for build time — real values injected by docker-compose at runtime
ENV POSTGRES_URL="postgresql://build:build@localhost:5432/build"
ENV NEXTAUTH_SECRET="build-time-placeholder-not-used-at-runtime"
ENV NEXTAUTH_URL="http://localhost:3000"

RUN npm run build

# ── Stage 3: Minimal production runner ────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public
COPY --from=builder --chown=nextjs:nodejs /app/data             ./data

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
