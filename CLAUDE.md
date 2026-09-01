# CLAUDE.md — @meddleware/walrus-ui

## What this app is

A standalone Vue 3 SPA for uploading blobs to Walrus decentralised storage and managing
owned blobs. Designed as an extensible shell for all Walrus-on-Sui user-facing functionality.

**Package name history:** Previously `@meddleware/walrus-relay-app` in the `walrus-relay-ui`
monorepo; extracted to its own repo `walrus-ui` v0.1.0. Consumes `@meddleware/walrus-relay`
(formerly `@meddleware/walrus-relay-ui`).

## Architectural invariants

- **Thin app.** No accounting logic, no chain state derivation, no financial calculations.
  The app is an orchestration shell. All pricing and economic truth lives on-chain.
- **Upload flow is injected, not embedded.** `@mysten/walrus` (the wasm client) is imported
  dynamically inside `performUpload` in `App.vue` — not in the eagerly-loaded module graph.
  This keeps the initial bundle small and defers wasm loading until upload is triggered.
- **Wallet-agnostic.** Wallet connections go through `src/wallet.ts` (wallet-standard), not
  through any specific wallet adapter. Do not hardcode a wallet.
- **Commission enforcement is in the library.** `src/config.ts` reads `ACCESS_GATE_PACKAGE_ID`
  and `ACCESS_GATE_PLATFORM_CONFIG_ID` from `@meddleware/walrus-relay/constants` — these are
  hardcoded in the library to ensure commission routing. Do not override them here.

## Env var: uploadRelayMaxTipMist

`App.vue` reads `VITE_UPLOAD_RELAY_MAX_TIP_MIST` (baked in at build time) with a 50,000,000
MIST (0.05 SUI) fallback. This is a cap on the relay tip payment, not a fixed charge — the
relay asks for the minimum; this prevents overpayment. Set it via the Docker `--build-arg` to
give operators control over their tip ceiling. Do NOT hardcode 50_000_000 again.

## Key source files

| File | Purpose |
| --- | --- |
| `src/App.vue` | Main app: wallet connect, gate state, upload orchestration |
| `src/config.ts` | Env var reading, relay hosts, access gate config parsing |
| `src/wallet.ts` | Wallet-standard connect/disconnect, `signPersonalMessage`, `buildExecutor` |
| `src/components/MyBlobs.vue` | Owned blob listing and lifetime extension |

## Extension roadmap

`walrus-ui` is intended to grow into the full UI for all Walrus-on-Sui functionality:
- Blob listing and search across multiple owners
- Blob lifetime extension UI
- Token image upload (redirected from `token-deployer-sui`)
- Collection/gallery management

Keep each feature as a tab or route so the shell remains composable.

## What NOT to do

- Do not import `@mysten/walrus` at module top-level — keep it in the dynamic import
  inside `performUpload`.
- Do not derive exchange rates, fees, or NAV in this app.
- Do not add wallet-library-specific code outside `src/wallet.ts`.
- Do not hardcode `VITE_UPLOAD_RELAY_MAX_TIP_MIST` — read it from `import.meta.env`.
