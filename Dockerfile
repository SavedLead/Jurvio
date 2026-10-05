# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build:jobs
RUN pnpm exec esbuild scripts/migrate.mjs --bundle --platform=node --format=esm --outfile=dist/migrate.mjs
RUN pnpm build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
WORKDIR /app

# poppler-utils supplies pdftotext (native text layer) and pdftoppm (rasterize a
# page to an image for OCR). tesseract-ocr + the English trained data read the
# image-only scans that have no text layer, which pdftotext alone cannot -- the
# ~7,500 appellate opinions otherwise parked as "ocr_required". tesseract is free
# and fully local, so this adds no per-page cost, only CPU time.
# lbzip2 decompresses one bz2 stream on every core (~5x bzip2 on the 2026-09-30
# CourtListener opinions export); the bulk loaders prefer it and fall back to bzip2.
RUN apk add --no-cache bzip2 lbzip2 poppler-utils tesseract-ocr tesseract-ocr-data-eng

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/db ./db
COPY --from=builder --chown=nextjs:nodejs /app/dist/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/dist/jobs ./jobs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/run-federal-bulk-production.sh ./scripts/run-federal-bulk-production.sh
RUN mkdir -p /var/lib/jurvio/artifacts && chown -R nextjs:nodejs /var/lib/jurvio

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "server.js"]
