# ── build stage ───────────────────────────────────────────────────────────────
# Standalone build — the Docker context is this repo root. All @meddleware/*
# dependencies (including @meddleware/walrus-relay) resolve from the npm registry,
# so the library must be published before this image is built.
#
#   docker build \
#     --build-arg VITE_NETWORK=testnet \
#     --build-arg VITE_WALRUS_RELAY_TESTNET=https://sui-walrus-relay-testnet.meddleware.co.uk \
#     --build-arg VITE_ACCESS_GATE_ID_TESTNET=0x... \
#     --build-arg VITE_ACCESS_GATE_SOULBOUND_TESTNET=true \
#     -t walrus-ui:<tag> .
#
# Build args (VITE_* are baked into the static bundle at build time):
#   VITE_NETWORK                       — "testnet" | "mainnet"  (default: testnet)
#   VITE_WALRUS_RELAY_TESTNET          — operator relay URL for testnet
#   VITE_WALRUS_RELAY_MAINNET          — operator relay URL for mainnet (optional)
#   VITE_RPC_TESTNET / VITE_RPC_MAINNET — override default Sui RPC URLs (optional)
#   VITE_ACCESS_GATE_ID_{NET}          — operator's Gate shared object ID (from create_gate)
#   VITE_ACCESS_GATE_SOULBOUND_{NET}   — "true" if soulbound (optional, default false)
#   VITE_ACCESS_GATE_PRICE_MIST_{NET}  — purchase price in MIST (optional, default 0)
#   VITE_UPLOAD_RELAY_MAX_TIP_MIST     — max relay tip cap in MIST (optional, default 50000000)
# packageId and platformConfigId are hardcoded in @meddleware/walrus-relay constants.
# Content-Security-Policy served by static-server (verified 2026-09-30: production build loaded in
# Chromium under this policy with zero violations). script-src stays 'self' plus 'wasm-unsafe-eval' (Walrus / Move bytecode WebAssembly); connect-src allows
# any https origin because RPC, relay, aggregator and Seal key-server hosts are partly operator- or
# chain-configured; img-src allows https:/data:/blob: for on-chain images and local previews.
ARG CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests"

FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

WORKDIR /app

# Copy the manifest first for layer-cache efficiency.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_NETWORK=testnet
ARG VITE_WALRUS_RELAY_TESTNET
ARG VITE_WALRUS_RELAY_MAINNET
ARG VITE_RPC_TESTNET
ARG VITE_RPC_MAINNET
ARG VITE_ACCESS_GATE_ID_TESTNET
ARG VITE_ACCESS_GATE_SOULBOUND_TESTNET
ARG VITE_ACCESS_GATE_PRICE_MIST_TESTNET
ARG VITE_ACCESS_GATE_ID_MAINNET
ARG VITE_UPLOAD_RELAY_MAX_TIP_MIST

ENV VITE_NETWORK=${VITE_NETWORK} \
    VITE_WALRUS_RELAY_TESTNET=${VITE_WALRUS_RELAY_TESTNET} \
    VITE_WALRUS_RELAY_MAINNET=${VITE_WALRUS_RELAY_MAINNET} \
    VITE_RPC_TESTNET=${VITE_RPC_TESTNET} \
    VITE_RPC_MAINNET=${VITE_RPC_MAINNET} \
    VITE_ACCESS_GATE_ID_TESTNET=${VITE_ACCESS_GATE_ID_TESTNET} \
    VITE_ACCESS_GATE_SOULBOUND_TESTNET=${VITE_ACCESS_GATE_SOULBOUND_TESTNET} \
    VITE_ACCESS_GATE_PRICE_MIST_TESTNET=${VITE_ACCESS_GATE_PRICE_MIST_TESTNET} \
    VITE_ACCESS_GATE_ID_MAINNET=${VITE_ACCESS_GATE_ID_MAINNET} \
    VITE_UPLOAD_RELAY_MAX_TIP_MIST=${VITE_UPLOAD_RELAY_MAX_TIP_MIST}

RUN npm run build

# ── runtime stage ─────────────────────────────────────────────────────────────
# static-server is a minimal Go binary image — no shell, no package manager.
# SPA_FALLBACK serves index.html for any extensionless path (Vue Router history mode).
# CACHE_IMMUTABLE_PREFIX matches the /assets/ directory Vite emits with content hashes.
FROM quay.io/meddleware-org/static-server:0.1.2@sha256:87fb66d451e5846ea3af24266cc82546fa465afab5494d00261eeda6a70195b1
ARG CSP
ENV CONTENT_SECURITY_POLICY="${CSP}"

COPY --from=build /app/dist /app/public

ENV SERVE_DIR=/app/public \
    SPA_FALLBACK=true \
    CACHE_IMMUTABLE_PREFIX=/assets/

EXPOSE 8080
