# CLAUDE.md — @meddleware/walrus-ui

## What this app is

A standalone Vue 3 SPA for uploading blobs to Walrus decentralised storage and managing
owned blobs. Designed as an extensible shell for all Walrus-on-Sui user-facing functionality.

**Package name history:** Previously `@meddleware/walrus-relay-app` in the `walrus-relay-ui`
monorepo; extracted to its own repo `walrus-ui` v0.1.0. Consumes `@meddleware/walrus-relay`
(formerly `@meddleware/walrus-relay-ui`).

## Architectural invariants

- **One wallet-adapter in a host.** Declare `@meddleware/wallet-adapter` as a peerDependency (`>=0.0.12 <0.2.0`, plus a devDependency):
  the host's single copy must satisfy every embedded tool, or each gets its own connection.
- **Thin app.** No accounting logic, no chain state derivation, no financial calculations.
  The app is an orchestration shell. All pricing and economic truth lives on-chain.
- **Upload flow comes from `@meddleware/walrus-client/flow`.** `performUpload` in `WalrusView.vue`
  wires `runBlobUpload` (fresh register every attempt, certify retry, duplicate precheck) and, for a
  gated relay, `createGatedAccess` (the consume digest is persisted before the upload, reused after
  an interruption, re-consumed only on `409 redeemed`). The flow loads `@mysten/walrus` (wasm)
  lazily, so it stays out of the eager bundle; other `@meddleware/walrus-client` uses here are
  dynamic imports too.
- **One network source.** The network is wallet-adapter's shared `useNetwork()` selector (the
  standalone `main.ts` selects `VITE_NETWORK`). The relay hosts, the gate (one access-gate state per
  Walrus network), the owned-blobs cache (keyed `<network>|<address>`) and the resume keys all follow
  it. On a network without Walrus (localnet) the view shows a notice.
- **Wallet-agnostic + shared.** Wallet connections go through `src/wallet.ts`, a thin shim over
  the shared `@meddleware/wallet-adapter` singleton — not any specific wallet extension. The
  singleton means that when `WalrusView` is embedded in the dashboard alongside other tool views,
  they all share one connection. Do not hardcode a wallet; do not reintroduce a local
  wallet-standard implementation.
- **Commission enforcement is in the library.** `accessGate()` in `src/config.ts` builds the gate
  with `relayGateConfig` from `@meddleware/walrus-relay`, which takes the package and
  `PlatformConfig` from the published deployment. Operators set only the gate id, soulbound flag and
  price. Do not override the package or PlatformConfig here.

## Env var: uploadRelayMaxTipMist

`src/config.ts` reads `VITE_UPLOAD_RELAY_MAX_TIP_MIST` (baked in at build time) with a 50,000,000
MIST (0.05 SUI) fallback — the workspace-wide ceiling, ~8× the operator relay's worst-case tip. This is a cap on the relay tip payment, not a fixed charge — the
relay asks for the minimum; this prevents overpayment. Set it via the Docker `--build-arg` to
give operators control over their tip ceiling.

## Key source files

| File | Purpose |
| --- | --- |
| `src/App.vue` | Standalone shell only: `AppHeader` (+ `TipConfigBadge`, `ColorModeControl`) + `<WalrusView>` + `AppFooter` |
| `src/components/WalrusView.vue` | Core tool UI (tabs, wallet section, gate state, upload orchestration, `MyBlobs`). Exported for inline embedding. |
| `src/index.ts` | Library entry — exports `WalrusView` for the dashboard to render inline |
| `src/config.ts` | `network` / `walrusNetwork` (wallet-adapter selector), relay hosts, access gate config (`relayGateConfig`) |
| `src/wallet.ts` | Thin shim over `@meddleware/wallet-adapter` for the selected network; re-exports `useWallet` / `getSuiClient` / `buildExecutor` / `Executor` |
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

- Do not import `@mysten/walrus` or the `@meddleware/walrus-client` root at module top-level — only
  the `./flow` subpath statically, everything else through dynamic imports.
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
  fixed by `relayGateConfig` in `@meddleware/walrus-relay` (the published access-gate deployment) and is not an operator
  knob here.
