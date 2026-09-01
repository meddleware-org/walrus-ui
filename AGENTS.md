# AGENTS.md — @meddleware/walrus-ui

## Package

`@meddleware/walrus-ui` — standalone Vue 3 SPA for Walrus decentralised storage.

## Key files

| File | Purpose |
| --- | --- |
| `src/App.vue` | Root component: wallet, gate state, upload flow, tab nav |
| `src/config.ts` | Build-time env var config (relay hosts, access gate) |
| `src/wallet.ts` | Wallet-standard integration (connect, sign, execute) |
| `src/components/MyBlobs.vue` | Owned blob listing + extend lifetime |
| `Dockerfile` | Multi-stage build (node:22-slim builder → static-server runtime) |
| `vite.config.ts` | Vite build config |

## Build and development commands

```bash
npm install
npm run dev           # local dev server
npm run build         # production build to dist/
npm run type-check    # vue-tsc type check
```

## Docker build (context = repo root)

```bash
docker build \
  --build-arg VITE_NETWORK=testnet \
  --build-arg VITE_WALRUS_RELAY_TESTNET=https://relay.example.com \
  -t walrus-ui:latest .
```

## Version

Current: `0.1.0` (reset on rename from `@meddleware/walrus-relay-app`).

## Relation to walrus-relay

Depends on `@meddleware/walrus-relay` (the component library). The library provides
`WalrusUpload`, `TipConfigBadge`, `AccessGateCta`, `useAccessGate`, `useWalrusRelay`.
This app wires them to the connected wallet and the Walrus client.
