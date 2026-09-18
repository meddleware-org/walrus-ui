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
  dynamically inside `performUpload` in `WalrusView.vue` — not in the eagerly-loaded module graph.
  This keeps the initial bundle small and defers wasm loading until upload is triggered.
- **Wallet-agnostic + shared.** Wallet connections go through `src/wallet.ts`, a thin shim over
  the shared `@meddleware/wallet-adapter` singleton — not any specific wallet extension. The
  singleton means that when `WalrusView` is embedded in the dashboard alongside other tool views,
  they all share one connection. Do not hardcode a wallet; do not reintroduce a local
  wallet-standard implementation.
- **Commission enforcement is in the library.** `src/config.ts` reads `ACCESS_GATE_PACKAGE_ID`
  and `ACCESS_GATE_PLATFORM_CONFIG_ID` from `@meddleware/walrus-relay/constants` — these are
  hardcoded in the library to ensure commission routing. Do not override them here.

## Env var: uploadRelayMaxTipMist

`App.vue` reads `VITE_UPLOAD_RELAY_MAX_TIP_MIST` (baked in at build time) with a 500,000,000
MIST (0.5 SUI) fallback. This is a cap on the relay tip payment, not a fixed charge — the
relay asks for the minimum; this prevents overpayment. Set it via the Docker `--build-arg` to
give operators control over their tip ceiling.

## Key source files

| File | Purpose |
| --- | --- |
| `src/App.vue` | Standalone shell only: `AppHeader` (+ `TipConfigBadge`, `ColorModeControl`) + `<WalrusView>` + `AppFooter` |
| `src/components/WalrusView.vue` | Core tool UI (tabs, wallet section, gate state, upload orchestration, `MyBlobs`). Exported for inline embedding. |
| `src/index.ts` | Library entry — exports `WalrusView` for the dashboard to render inline |
| `src/config.ts` | Env var reading, relay hosts, access gate config parsing |
| `src/wallet.ts` | Thin shim over `@meddleware/wallet-adapter` binding walrus-ui's `RPC_URLS`; re-exports `useWallet` / `getSuiClient` / `buildExecutor` / `Executor` |
| `src/access-resume.ts` | Single-use consume persistence/resume: stores the `consumeDigest` in `localStorage` and reuses it on retry/reload so an interrupted upload never burns an NFT use (the gateway treats the digest as the one-time redemption token). Cleared on success; re-consumes only on a `409 redeemed`. |
| `src/components/MyBlobs.vue` | Owned blob listing and lifetime extension |

## Dual app + library

This package is **both** a standalone SPA (`App.vue` + `main.ts`, built with `vite build`) and a
library (`src/index.ts` exports `WalrusView`, resolved via `"exports"`). The dashboard imports
`WalrusView` and wraps it in its own shell + shared wallet. Keep the core UI in `WalrusView.vue`
(shell-free) so both consumers stay in sync; `App.vue` must remain a thin shell.

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

---

## Deferred documentation — NOT for the `docs.` website (planned here per Part 0.4)

> Captured for the future **`dev.meddleware.co.uk`** subdomain and white-label offering; excluded
> from the user-facing `docs.` site (which covers *what/how/when* for end users only).

### `dev.` — developer integration (to write later)

- **Embed `WalrusView`** in a host app (`import { WalrusView } from '@meddleware/walrus-ui'`) with the
  shared `@meddleware/wallet-adapter` context; the dual app+library contract and why the core UI stays
  shell-free. The SDK-level integration story lives in `@meddleware/walrus-client`.

### White-label operator path (to write later)

- Deploying walrus-ui against an operator's **own relay + tip ceiling**: the `VITE_*` build args
  (`VITE_UPLOAD_RELAY_MAX_TIP_MIST`, relay hosts, network) and the Docker `--build-arg` seams;
  branding via `@meddleware/design-tokens` + the `AppHeader` slot. Note that commission routing is
  fixed by `@meddleware/walrus-relay/constants` (access-gate `PlatformConfig`) and is not an operator
  knob here.
