# Repath Multi-stage Dockerfile
#
# Stages:
#   builder     — compile Rust binaries (no cargo-chef; simpler and compatible)
#   evaluator   — Python evaluator image
#   gateway     — minimal gateway runtime image
#   controller  — minimal controller runtime image
#   dashboard   — Next.js production image

# ── Rust build ─────────────────────────────────────────────────────────────────

FROM rust:1.88-slim-bookworm AS builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
RUN cargo build --release --bin repath-gateway --bin repath-controller --bin repath

# ── Gateway runtime ────────────────────────────────────────────────────────────

FROM debian:bookworm-slim AS gateway
RUN apt-get update && apt-get install -y ca-certificates wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/repath-gateway /usr/local/bin/repath-gateway
COPY migrations/ /app/migrations/
EXPOSE 8080 9090
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
ENTRYPOINT ["repath-gateway"]

# ── Controller runtime ─────────────────────────────────────────────────────────

FROM debian:bookworm-slim AS controller
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/repath-controller /usr/local/bin/repath-controller
ENTRYPOINT ["repath-controller"]

# ── Evaluator (Python) ─────────────────────────────────────────────────────────

FROM python:3.12-slim-bookworm AS evaluator
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/evaluators
# Copy full evaluator source first, then install
COPY evaluators/ ./
RUN pip install --no-cache-dir .
ENTRYPOINT ["repath-evaluator"]

# ── Dashboard (Next.js) ────────────────────────────────────────────────────────

FROM node:22-alpine AS dashboard-deps
WORKDIR /app
COPY dashboard/package*.json ./
RUN npm ci --only=production

FROM node:22-alpine AS dashboard-builder
WORKDIR /app
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:22-alpine AS dashboard
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dashboard-deps /app/node_modules ./node_modules
COPY --from=dashboard-builder /app/.next ./.next
COPY --from=dashboard-builder /app/public ./public
COPY --from=dashboard-builder /app/package.json ./package.json
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s CMD wget -qO- http://localhost:3000 || exit 1
CMD ["node_modules/.bin/next", "start"]
