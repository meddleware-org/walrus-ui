# Security Audit — `walrus-ui`

**Classification:** Internal security review
**Project:** `repos/walrus-ui` — `@meddleware/walrus-ui`, Vue 3 SPA and library for uploading and managing Walrus blobs (`sui-walrus.meddleware.co.uk`; embedded in the dashboard)
**Project type:** Vue app + UI library
**Template:** AUDIT_TEMPLATE.md (2026-10-08) + AUDIT_TEMPLATE_VUE.md (2026-10-08) + AUDIT_TEMPLATE_TS.md (2026-10-08) + AUDIT_TEMPLATE_SUI_CLIENT.md (2026-10-08) + AUDIT_TEMPLATE_WALRUS.md (2026-09-30) + AUDIT_TEMPLATE_IMG.md (2026-10-08)
Not triggered: AUTH (the app holds no credential; the access proof is built and signed by walrus-client and nft-gate-client, and the persisted consume digest is a public transaction digest), SEAL, OPS (the integration workflow runs a browser smoke suite only and signs nothing on a real chain), PROXY, WORKERS, GO, RUST, SITE, PLATFORM (the cluster is audited with the workspace).
**Sui SDK:** `@mysten/sui ^2.33.2` (installed 2.35.0, one copy; `npm ls` single version)   **Transport:** gRPC through wallet-adapter; HTTPS to relays and aggregators
**Walrus SDK:** `@mysten/walrus ~1.2.32` (installed 1.2.34), `@mysten/walrus-wasm ~0.3.1`; uploads through `@meddleware/walrus-client/flow` 0.0.27 (lazy wasm); relay selection and the gate from `@meddleware/walrus-relay` 0.1.30
**Package config source:** SDK-bundled per network (`createWalrusClient({ network })`); no caller-supplied package ids; localnet shows a notice
**Upload relays:** operator `https://sui-walrus-relay-testnet.meddleware.co.uk` (build argument `VITE_WALRUS_RELAY_TESTNET`; mainnet unset) · public fallback `https://upload-relay.{testnet,mainnet}.walrus.space`
**Aggregator / publisher hosts:** none of the app's own; the result URL comes from walrus-client and is bound through `safeHref`; no publisher is used
**Tip ceiling:** `VITE_UPLOAD_RELAY_MAX_TIP_MIST`, default 50 000 000 MIST (0.05 SUI, D2), passed as `maxTipMist` to the flow   **Epoch default / maximum:** the widget defaults to the single-reservation maximum (53, `max_epochs_ahead`); longer lifetimes through Extend
**Deletable default:** permanent (D6): an explained, visible tick-box; a permanent blob cannot be removed by anyone before it expires. **Blob ownership:** the connected wallet owns the Blob on the relay path (it registers and certifies)
**Networks:** testnet (live); mainnet when Walrus and the gate are configured; localnet shows a notice
**On-chain packages consumed:** Walrus system objects (SDK); `access_gate` through `relayGateConfig` (access-gate-client 0.0.8 `deployments`: testnet `0xd7ddaa94…88c9`, PlatformConfig `0x3f81489d…e7b5`) with `VITE_ACCESS_GATE_ID_TESTNET` = relay gate `0x316f1bf9…faddc` (soulbound, 10 uses, 0.01 SUI; the old gate `0xfd6c3b…` is on the superseded, immutable package `0xa55789…`)
**Package manager / lockfile:** npm 11, committed (also copied into the image for SBOM tools)   **Module format / publish model:** ESM; ships source (library) + SPA image
**Runtime targets:** browser   **Peer dependencies:** `@meddleware/wallet-adapter >=0.0.12 <0.2.0`
**Build tool:** vite 8.3, `@vitejs/plugin-vue` 6.0.9, vue 3.5.43, vue-tsc 3.3.x, TypeScript 6.0.3, vitest 5.0.3
**Hosting:** container image on static-server (CSP and HSTS from the server); no static-host `_headers` file
**Embedding hosts:** the dashboard (`WalrusView`, no shell chrome; dashboard requires `^0.1.56`)
**VITE_\* inventory:** `VITE_NETWORK` (testnet|mainnet, baked, selects the network only), `VITE_WALRUS_RELAY_{TESTNET,MAINNET}` (operator relay host, baked, per network), `VITE_UPLOAD_RELAY_MAX_TIP_MIST` (tip ceiling), `VITE_ACCESS_GATE_{ID,SOULBOUND,PRICE_MIST}_{TESTNET,MAINNET}` (the operator's gate object, soulbound flag and price; the package and PlatformConfig are never configurable), `VITE_DOCS_URL` / `VITE_DEV_URL` (footer links); all public, none secret; all listed in `.env.example` (per-network names by template)
**Images:** `quay.io/meddleware-org/walrus-ui:0.1.57@sha256:631abc3a…3708` (Docker Hub mirror; cosign keyless, SPDX SBOM attestation, build provenance; verified 2026-10-09, `verify-digests.sh` 16/16)
**Base images:** build `node:24-slim@sha256:0e0ff40c…f9b6`; runtime `quay.io/meddleware-org/static-server:0.1.7@sha256:2e227311…2379` (Go 1.26.9)
**Runtime user:** `USER 65534:65534`   **Runtime FS:** read-only root, no writable mounts
**Deployed by:** `post-bootstrap/walrus/overlays/testnet` (base `post-bootstrap/walrus/base/ui`); digest from `config/images.yaml`
**Build args:** `CSP`, `VITE_NETWORK`, `VITE_WALRUS_RELAY_{TESTNET,MAINNET}`, `VITE_ACCESS_GATE_ID_{TESTNET,MAINNET}`, `VITE_ACCESS_GATE_SOULBOUND_TESTNET`, `VITE_ACCESS_GATE_PRICE_MIST_TESTNET`, `VITE_UPLOAD_RELAY_MAX_TIP_MIST` — none secret, none a test switch
**Deployment status:** npm v0.1.57 (2026-10-09); image `quay.io/meddleware-org/walrus-ui` serving `sui-walrus.meddleware.co.uk` at 0.1.57 (`sha256:631abc3a…`, deployed 2026-10-09; the live bundle carries `access_gate` `0xd7ddaa94…`, PlatformConfig `0x3f81489d…` and gate `0x316f1bf9…` only); embedded in dashboard 0.1.84 (requires `^0.1.56`)
**Review date:** 2026-09-18 (first pass) · re-verified 2026-10-02 · re-verified 2026-10-09
**Reviewer:** Internal review
**Severity ceiling:** Medium — the app drives paid uploads and pass purchases with the user's wallet; it holds no keys and decides nothing on its own.
**Status:** re-verified 2026-10-09

---

## Executive summary

A thin shell over the shared libraries: `WalrusView` (upload tab and **My Blobs**) wires the
wallet-adapter connection, walrus-relay's relay selection and gate, and walrus-client's upload flow
(fresh register per attempt, same-registration retry, certify retry, persisted consume). It holds no
keys and no on-chain logic of its own (the `suiBoundary` lint is clean). It has no `v-html`, no
`fetch` and no `eval`, and its only storage is walrus-client's `browserStorage()`.

All first-pass findings are resolved, accepted or adjudicated. Earlier passes found:

- **F8 (Low, RESOLVED 0.1.50)** — upload and My Blobs read `window.localStorage` directly; where
  storage is blocked that access throws and the flow failed. They now use walrus-client's
  `browserStorage()`, which falls back to memory for the page.

Re-verified 2026-10-09 (0.1.57; 17 unit tests, type-check and all three linters green, audit gate
1 allowlisted / 0 open; the live site `sui-walrus.meddleware.co.uk` and its bundle read the same day):

- **F9 (Low, RESOLVED 0.1.56)** — from walrus-client 0.0.23 the owned-blob listing dropped every real
  blob (a blob id is a u256, the strict parser capped it at 20 digits), so My Blobs, the duplicate-upload
  precheck and the pending-certify recovery saw nothing in 0.1.50–0.1.55. walrus-client 0.0.27 fixes it;
  this app's tests mock the listing, so they could not catch it (see C.1).
- **F10 (Low, RESOLVED 0.1.54–0.1.57)** — the image release now runs the full CI workflow, scans the
  published image before cosign signs it, ships the lockfile for SBOM tools, serves
  `/THIRD_PARTY_LICENSES` (HTTP 200 live), runs as an explicit `USER 65534:65534` on static-server 0.1.7,
  and the pod sets `automountServiceAccountToken: false`.
- The known CI gap found in the sibling web apps (the reusable `node-ci.yml` has no `npm test` step, so
  the release gate stops running the unit tests) is **not present here**: `node-ci.yml` runs `npm test`,
  the release `verify` job calls it, and the npm job runs the tests too (F6).
- The newly applicable lens checks found defects that are **not yet fixed** (code changes are outside
  this alignment; each is a small change for the next patch release):
  **F11 (Low, DEFERRED)** a slower owned-blob load can overwrite a newer one after an account or network
  switch; **F12 (Low, DEFERRED)** Extend signs the seeded default without showing its cost until the user
  edits the amount; **F13 (Low, DEFERRED)** My Blobs styles text with `--mw-color-*` custom properties
  that design-tokens does not define, so literal fallbacks that fail contrast in one theme each are
  used; **F14 (Info, DEFERRED)** `.gitignore` does not ignore `.env.local`; **F18 (Info, DEFERRED)**
  documentation drift (no `CHANGELOG.md`, a stale `SECURITY.md` sentence).
- The design-tokens F10 check (`color: var(--warning)` as text) is clean here: no `--warning` colour is
  used as text in `src/`; the tint on an expiring row is a background (F13).
- Accepted: **F15** blanket `connect-src https:`, **F16** the npm job's gate is a subset of CI, **F17**
  the cosign identity pins the repository not the workflow. **F7** (registry credential inventory) is a
  maintainer item.

Fixes in the libraries reach the app: the pending-purchase guard (walrus-relay F10), the bounded and
strict owned-blob listing (walrus-client F9), the read cap and validated storage (walrus-client F10, F11),
the challenge timeout (nft-gate-client F9), audience-bound `nft-gate:access:v2` proofs and the
same-registration upload retry (walrus-client 0.0.26, 0.1.52), and the republished `access_gate` with its
new relay gate (0.1.53). The paywall e2e passed 2026-10-09 against the live dashboard (pass bought on gate
`0x316f1bf9…`, consumed, upload through the Worker).

The severity ceiling stays Medium.

## Threat model / trust boundaries

| Actor | Holds / proves | Can do | Bounded by |
| --- | --- | --- | --- |
| User | wallet, passes, files | upload, extend, buy a pass | wallet confirmation; permanence choice visible (D6); on-chain checks |
| Relay (operator / public) | uploads, tip config; sees the plaintext blob | ask a tip; refuse; read the content | tip ceiling; selection rules (walrus-relay); content is public by design (nothing is encrypted here) |
| Aggregator | blob bytes | serve or not | strict consistency check; read cap |
| Full node | owned blobs, passes | lie or omit | display only; gateway re-verifies |
| Browser storage | consume digest, pending certifications | be tampered with or blocked | validated (walrus-client F11, 0.0.26); never throws (F8) |
| Static host / CDN | headers and served bytes | modify or strip them | digest-pinned image, CSP and HSTS from static-server (B.VUE-1) |
| Whoever controls the build environment | every `VITE_*` value (relay host, gate id, price, tip ceiling) | point the build at another relay or gate, raise the tip ceiling | public values; package and PlatformConfig are not configurable (I1); the gateway and the chain re-check |
| Embedding host (dashboard) | the page around `WalrusView`, the shared wallet | switch account or network under the view | account/network watchers (I3); `WalrusView` injects no chrome |
| Base-image publisher, registry, CI publish job | image layers, what is signed | ship altered bytes | digest pinning, Trivy before cosign, keyless signature, SBOM and provenance (F10) |

### On-chain dependency matrix

| Object / package | ID (original-id · published-at) | Sourced from | Used as | If stale, wrong or attacker-supplied | Fails open / closed |
| --- | --- | --- | --- | --- | --- |
| `access_gate` package, testnet | `0xd7ddaa94…88c9` · same (fresh publication 2026-10-09) | `deployments` of access-gate-client 0.0.8, via `relayGateConfig` | pass purchase and consume call target; `AccessNFT` type filter | calls old code or routes commission wrongly | closed: `relayGateConfig` throws; the UI then shows an ungated form and the gateway refuses unproven uploads (F4) |
| `PlatformConfig`, testnet | `0x3f81489d…e7b5` | same | argument of the purchase | wrong commission terms | closed (as above) |
| relay `Gate`, testnet | `0x316f1bf9…faddc` | `VITE_ACCESS_GATE_ID_TESTNET` (operator build argument) | purchase and ownership checks | a gate of another operator or a superseded package | the chain and gateway re-check; an unknown gate buys nothing the relay honours |
| Walrus system and staking objects | per network | `@mysten/walrus` (SDK-bundled) | register, certify, extend | SDK-owned | closed: no Walrus network on localnet |
| mainnet gate | none recorded | — | — | — | closed: no deployment ⇒ ungated notice path, no gate (F4) |

## Severity scale

Critical / High / Medium / Low / Info / Positive.

## Scope

- **In scope (0.1.57):** `src/**` (`App.vue`, `components/WalrusView.vue`, `components/MyBlobs.vue`,
  `config.ts`, `wallet.ts`, `blob-groups.ts`, `composables/useOwnedBlobs.ts`), `index.html`, `public/`,
  `Dockerfile`, `.dockerignore`, workflows, `.github/audit-gate.mjs`, `.github/dependabot.yml`,
  `scripts/third-party-licenses.mjs`, `SECURITY.md`; the manifests in `post-bootstrap/walrus/base/ui`
  and the testnet overlay (read-only).
- **Out of scope:** the libraries (own audits).
- **Environment (2026-10-09):** `npm test` 17/17 (3 files, vitest 5.0.3); `vue-tsc`; stylelint, eslint
  (+ vuejs-a11y), html-validate; production build; audit gate (1 allowlisted advisory, 0 open);
  `npm pack --dry-run` (16 files, source only); live headers and bundle of `sui-walrus.meddleware.co.uk`.
  The repository has no `CHANGELOG.md` (the `files` list names one); `git log` carries the release history.

## Findings

### F1 — Tip ceiling client-side only

**Severity:** Low   **Disposition:** RESOLVED — the ceiling is wired into the client
(`VITE_UPLOAD_RELAY_MAX_TIP_MIST`, D2); the relay's own enforcement is documented as the residual.
**Remediation / evidence (2026-10-09):** `config.ts` `uploadRelayMaxTipMist()` (non-positive or
unparseable values fall back to 50 000 000 MIST) is passed as `maxTipMist` to `runBlobUpload`
(`WalrusView.vue`); walrus-client 0.0.26 checks it is a positive safe integer before any wallet prompt.
Tested (`tests/config.test.ts`: default, override, fallback). `SECURITY.md` invariant 1 still says the
cap is passed to `createWalrusClient` (F18).

### F2 — Result URL bound without a scheme check

**Severity:** Low   **Disposition:** RESOLVED — `safeHref`.
**Remediation / evidence (2026-10-09):** the only dynamic `:href` on a native element is the result URL,
bound through `safeHref` (`WalrusView.vue`); the explorer links go through `ExplorerLink` with a
Walruscan URL built from the network and a blob id that walrus-client derives with `blobIdFromInt`
(base64url), and the `suiBoundary` lint enforces the helpers. No `v-html`, `innerHTML` or `eval` in `src/`.

### F3 — No dependency scan in CI

**Severity:** Low   **Disposition:** RESOLVED — `npm audit --audit-level=high`.
**Remediation / evidence (2026-10-09):** `.github/audit-gate.mjs` (one allowlisted advisory,
GHSA-vfj7-8cjw-p6xm, expiring 2027-01-01; 0 open) runs in `node-ci.yml` (and so in the image release,
F10) and in `npm-publish.yml`.

### F4 — Empty package id guarded

**Severity:** Positive — now through `relayGateConfig` (deployments). Corrected 2026-10-09: an unknown
network does not "throw" to the user. `relayGateConfig` throws; `accessGate()` in `config.ts` catches it,
logs a warning and returns `null`, so the UI shows an ungated form. That is safe because the control is
server-side: the operator relay sits behind the nft-gate gateway, which refuses an upload without a valid
proof. Pinned by `tests/config.test.ts` ("is ungated on a network without a recorded deployment"; the
package and PlatformConfig equal the recorded deployment). The live bundle carries only the new
`access_gate` and gate ids (no `0xa55789…`, no `0xfd6c3b…`).

### F5 — Stored tokens are non-secret and lifecycle-managed

**Severity:** Positive — the consume digest and pending certifications are not secrets; the gateway
and the chain re-verify them. Re-verified 2026-10-09: walrus-client 0.0.26 validates the stored consume
(`{ digest, nftId, savedAt }`; malformed, another pass's, over 4 days old or from the future is dropped)
and the keys are scoped by network, gate and address.

### F6 — Publish gated on tests

**Severity:** Low   **Disposition:** RESOLVED
**Remediation / evidence (2026-10-09):** `node-ci.yml` runs the audit gate, type-check, the three
linters, `npm test`, the build and the licence check; the image release `verify` job calls it
(`workflow_call`) and both build jobs `need` it; `npm-publish.yml` `verify` runs the audit gate,
type-check and tests. Read in full 2026-10-09: the sibling-app gap (no `npm test` in the reusable
workflow) does not exist here.

### F7 — Registry publish uses long-lived tokens

**Severity:** Info   **Disposition:** ACCEPTED-RISK — quay.io and Docker Hub robot tokens as GitHub
secrets (no OIDC on those registries); inventoried in B.2. The scope and rotation inventory is a
maintainer item (DEFERRED: `OPERATOR_TASKS.md` "Image registry credentials — record scope and
rotation").
**Remediation / evidence (2026-10-09):** the public publish path has no `continue-on-error`; only the
self-hosted mirror jobs do (best-effort, they fail without registry credentials and never sign). The
cluster pins digests and verifies signatures, so an unsigned tag would not run.

### F8 — Blocked browser storage broke uploads

**Severity:** Low   **Disposition:** RESOLVED (0.1.50, `0f74cc8`)
**Where:** `src/components/WalrusView.vue`, `src/components/MyBlobs.vue`
**Issue / impact:** `window.localStorage` was read directly; with site data blocked, the access
throws, so a gated upload and the pending-certify list failed.
**Remediation / evidence:** one `browserStorage()` instance per component (walrus-client 0.0.24,
tested there); values fall back to memory for the page. Re-verified 2026-10-09: no `localStorage`
reference remains in `src/`.

### F9 — The owned-blob listing dropped every real blob (walrus-client 0.0.23–0.0.26)

**Severity:** Low   **Disposition:** RESOLVED (0.1.56, `b6a8986`; walrus-client 0.0.27, `83521fc`)
**Where:** `src/composables/useOwnedBlobs.ts`, `WalrusView.vue` (`findExistingCopy`), `MyBlobs.vue`;
the parser is `fetchOwnedWalrusBlobs` in walrus-client
**Issue / impact:** walrus-client 0.0.23 made the listing's parsing strict and capped every integer at
u64's 20 digits, but a blob id is a u256 (up to 78 digits), so on a live network every blob was skipped.
In walrus-ui 0.1.50–0.1.55 My Blobs showed "No Walrus blobs found", the duplicate-upload precheck found
no existing copy (the user could pay to register a second copy), and a pending certification could not
be offered. Funds and access were not at risk; the failure was silent. It was caught by walrus-client's
daily localnet suite (red since 2026-10-02), not by a test here.
**Remediation / evidence:** 0.1.56 depends on walrus-client `^0.0.27` (the id accepts up to 78 digits and
nothing above u256::MAX; tested there, and the localnet suite passes again). Here the listing is
mocked (`tests/useOwnedBlobs.test.ts`), so no test in this repository pins a real-length id.

### F10 — Image release gate, scan, notices and runtime user

**Severity:** Low   **Disposition:** RESOLVED (0.1.54 `143aec3`, 0.1.56 `b6a8986`, 0.1.57 `ba75d9e`)
**Where:** `.github/workflows/docker-publish.yml`, `Dockerfile`, `scripts/third-party-licenses.mjs`, `post-bootstrap/walrus/base/ui/deployment.yaml`
**Issue:** the image release was gated by a subset of CI, the published image was not scanned before
signing, the lockfile was not in the image (the SBOM saw only the base), no third-party licence texts were
served with the bundled npm code, the runtime user was only inherited from the base, and the base carried
Go 1.26.7 stdlib advisories.
**Impact:** a tag could ship what CI would have refused; an SBOM that misses the bundled dependencies;
redistributed MIT/Apache code without its notices.
**Remediation / evidence:** `verify` calls `node-ci.yml` and the build jobs `need` it; the public job
runs Trivy on the pushed digest (CRITICAL/HIGH, fixable only, `exit-code: 1`) before `cosign sign`, then
an SPDX SBOM attestation and build provenance for quay.io and Docker Hub, with no `continue-on-error`;
the Dockerfile runs `npm run licenses` and copies `package-lock.json` to
`/usr/share/doc/walrus-ui/`; `/THIRD_PARTY_LICENSES` returns HTTP 200 on the live site and CI runs
`check:licenses`; the runtime base is static-server 0.1.7 (Go 1.26.9) with an explicit
`USER 65534:65534`; the pod sets `automountServiceAccountToken: false`, `runAsNonRoot` uid 65534,
read-only root, no privilege escalation, all capabilities dropped, `RuntimeDefault` seccomp, probes and
limits, and a NetworkPolicy exists; the digest is identical in `config/images.yaml` and the overlay; all
images cosign-verified 2026-10-09 (`verify-digests.sh`, 16/16). Not run: a Trivy *config* scan of the
Dockerfile and manifests (the image scan runs at release).

### F11 — A slower owned-blob load can overwrite a newer one after a switch

**Severity:** Low   **Disposition:** DEFERRED (next patch release; Section D pre-testnet "state invalidated on switch")
**Where:** `src/composables/useOwnedBlobs.ts` (`load`), `MyBlobs.vue` (watchers on address and network)
**Issue:** `load` captures its key (`<network>|<address>`) when it starts but, after the awaits,
assigns `blobs`, `currentEpoch` and `loadedFor` without checking that the key is still the wanted one,
and clears `loading` for whichever load finishes first. If the wallet account or the network changes
while a load is in flight, the earlier request can finish last and its list is shown, labelled as
loaded for the earlier key, for the new address. VUE lens *Shared-wallet state*: results that arrive
after a switch are discarded.
**Impact:** a stale list is displayed under the wrong account or network until the next refresh.
Display only: Extend and Certify build transactions for objects the connected wallet must own, so the
chain refuses a wrong one. The upload path is unaffected (the widget's own state is walrus-relay F16).
**Remediation / evidence:** keep a monotonically increasing request counter (or compare the key at the
end of `load`) and drop the result when it no longer matches. No test covers it
(`useOwnedBlobs.test.ts` covers the epoch source and a network change with sequential loads only).

### F12 — Extend signs the seeded default without showing its cost

**Severity:** Low   **Disposition:** DEFERRED (next patch release; Section D pre-testnet "signing UX")
**Where:** `src/components/MyBlobs.vue` (`setExtendAmount`, `extendBlob`)
**Issue:** each row's amount is seeded to +10 epochs (clamped) without pricing it; the WAL estimate is
fetched only when the user edits the amount or presses a preset. Pressing **Extend** straight away
opens the wallet with no cost shown in the app. VUE lens *Signing UX*: the amount is shown before every
wallet prompt. The Walrus system package's abort codes are not mapped either: a failed extension shows
the executor's generic "failed on-chain" text.
**Impact:** the user may approve a WAL payment they have not seen priced; the wallet still shows the
transaction and the chain enforces it, and the amount is small (storage only, no write cost).
**Remediation / evidence:** price the seeded amount when the row is shown (one client for all rows), or
estimate in `extendBlob` before opening the wallet. The estimate is already labelled `≈`.

### F13 — My Blobs styles text with custom properties design-tokens does not define

**Severity:** Low   **Disposition:** DEFERRED (next patch release; one-file change; Section D pre-testnet "colour")
**Where:** `src/components/MyBlobs.vue` (`.hint`, `.err`, `.blob-table th`, `.est`, `.at-max`, `.act-status`, borders, the `.warn` tint)
**Issue:** the component uses `--mw-color-text-muted`, `--mw-color-danger`, `--mw-color-border` and
`--mw-color-warning`. design-tokens 0.1.9 defines none of them (its roles are `--muted`, `--danger`,
`--border`, `--warning` / `--warning-text`), so the literal fallbacks `#888`, `#c00`, `#ddd` and `#f90`
are always used and the table ignores theme and season. Computed against the tokens' canvases: `#888`
is 3.24:1 on the light canvas (`#f7f4f1`) and `#c00` is 3.25:1 on the dark canvas (`#120e10`, the
standalone default), both below the 4.5:1 AA text minimum; `#ddd` borders are bright lines in the dark
theme. `WalrusView.vue` uses the real tokens (`--muted`, `--border`, `--surface`).
**Impact:** hint, helper and error text in My Blobs is hard to read for low-vision users in one theme
each. Information is also in the text; nothing is hidden. Not browser-checked per theme and season: the
`@meddleware/ui` gallery axe gate covers the shared components only.
**Remediation / evidence:** replace the four names with `--muted`, `--danger`, `--border` and
`--warning` (tint only); never `--warning` as text (use `--warning-text`). The design-tokens F10 check
is otherwise clean here: no `color: var(--warning)` in `src/`.

### F14 — `.env.local` is not git-ignored

**Severity:** Info   **Disposition:** DEFERRED (next patch release; one line)
**Where:** `.gitignore` (no `.env` pattern); `.env.example` says "Copy to .env.local … never commit"
**Issue:** only `.env.example` is tracked, but nothing prevents `git add` of a local `.env.local`.
`.dockerignore` excludes `.env*.local`, so the image build is safe.
**Impact:** every `VITE_*` value is public, so a committed file would leak nothing secret; it could
still pin a developer's local relay or gate into history.
**Remediation / evidence:** ignore `.env` and `.env.*` except `.env.example`, as access-gate-ui did.

### F15 — `connect-src` allows any https origin

**Severity:** Info   **Disposition:** ACCEPTED-RISK
**Where:** `Dockerfile` (`CSP` argument); live header read 2026-10-09
**Issue:** `connect-src 'self' https:` and `img-src 'self' data: blob: https:` are blanket allowances.
**Impact:** an injected script could send data to any https host. Script injection is the prerequisite,
and `script-src 'self' 'wasm-unsafe-eval' 'nonce-…'` with no inline script and no XSS sink (I4) is the
control on that.
**Remediation / evidence:** accepted: the RPC node, relays, aggregators and the operator relay are
operator- or user-configured per network, so the hosts cannot be enumerated in a white-label build.
`'wasm-unsafe-eval'` is needed by the Walrus wasm. Revisit when the hosts are fixed for mainnet.

### F16 — The npm publish gate is a subset of CI

**Severity:** Low   **Disposition:** ACCEPTED-RISK
**Where:** `.github/workflows/npm-publish.yml`
**Issue:** the npm job's `verify` runs `npm ci`, the audit gate, type-check and the unit tests, not the
full CI workflow (linters, licence check). The image release (F10) does run the full workflow on the
same tag.
**Impact:** a tag could publish the source package while the image job refuses the same commit. The
package is source only (`npm pack --dry-run` 2026-10-09: `src`, `index.html`, `vite.config.ts`,
`tsconfig.json`, README, LICENSE; no tests, fixtures or `.env*`).
**Remediation / evidence:** accepted: a source mirror for the dashboard, OIDC-published with provenance,
tag == version checked, idempotent, and opt-in through the `NPM_PUBLISH` variable. Calling `node-ci.yml`
from `npm-publish.yml` would close it.

### F17 — The cosign identity pins the repository, not the workflow

**Severity:** Info   **Disposition:** ACCEPTED-RISK
**Where:** `bootstrap/images/verify-digests.sh` (workspace); this repository publishes no verify command
**Issue:** the cluster check accepts any workflow identity of `github.com/meddleware-org/walrus-ui`.
**Impact:** a workflow added by someone with write access could sign an image the check would accept.
**Remediation / evidence:** the repository is the signing boundary; anchoring to
`docker-publish.yml@refs/tags/v*` is a `COSIGN_IDENTITY_REGEXP` override in the workspace script. The
deployed digest verified 2026-10-09 (16/16).

### F18 — Documentation drift

**Severity:** Info   **Disposition:** DEFERRED (next patch release; documentation)
**Where:** `package.json` `files`, `SECURITY.md`, `.github/workflows/npm-publish.yml`
**Issue:** `files` lists `CHANGELOG.md`, which does not exist (the tarball is clean, the entry matches
nothing); `SECURITY.md` invariant 1 says the tip cap is passed to `createWalrusClient`, but the app passes
`maxTipMist` to the flow's `runBlobUpload`; the npm workflow's skip message contains a stray word
("`--provenanceing`"); `@mysten/wallet-standard` is a dependency that nothing in `src/` or `tests/`
imports (comments only).
**Impact:** none on behaviour; reviewers are misled and every host installing the package gets the
unused dependency.
**Remediation / evidence:** add a `CHANGELOG.md` (or drop the `files` entry), correct the sentence,
fix the message, and drop the dependency.

## Section A — Invariant verification matrix

| # | Invariant | Enforced at | Proven by | Status |
| --- | --- | --- | --- | --- |
| I1 | No on-chain logic in the app; ids only from the recorded deployment and the operator's gate | components use the libraries; `relayGateConfig` fixes package and PlatformConfig | `suiBoundary` lint (eslint-config 0.0.2, clean 2026-10-09); `config.test.ts`; live bundle read 2026-10-09 | HOLDS |
| I2 | One wallet connection when embedded | wallet-adapter peer | dashboard | HOLDS |
| I3 | Gate and relay follow the network and account | per-network gate state; the gate watcher resets on address or network change | component logic (code-only) | HOLDS for the gate; GAP for the owned-blob list (F11) |
| I4 | Dynamic URLs through helpers | `safeHref`, `ExplorerLink` | lint trial; source | HOLDS |
| I5 | Permanence is a visible choice | upload form (D6, walrus-relay) | UI | HOLDS |
| I6 | Storage failures never break a flow | `browserStorage()` | walrus-client tests | HOLDS (F8) |
| I7 | The unit tests run on every change and every release | `node-ci.yml` `npm test`; release `verify` calls it | workflows read 2026-10-09 | HOLDS (F6) |
| I8 | A slower owned-blob load never overwrites a newer one | none | none | GAP — see F11 |
| I9 | The amount of every paid action is shown before the wallet opens | upload: cost line (walrus-relay); Extend: only after the amount is edited | source | GAP for Extend — see F12 |
| I10 | The owned-blob listing works on real blob ids | walrus-client 0.0.27 | walrus-client tests and localnet suite; not pinned here (mocked) | HOLDS (F9) |

### Lens categories

| Lens | Category | Status |
| --- | --- | --- |
| VUE | Untrusted rendering | HOLDS (I4); chain data (blob ids, object ids) renders as text; no on-chain image URL is rendered |
| VUE | Colour & links | GAP — My Blobs uses undefined tokens with failing fallbacks (F13); no `--warning` text; the result URL is a stand-alone link |
| VUE | Build-time configuration | HOLDS — public values only; every variable in `.env.example`; defaults match the Dockerfile and README; ids that route commission come from `deployments` (VUE-M2) |
| VUE | Test hooks | N/A — none; no test mode exists (`e2e/wallet.ts` is a documented stub, not in `src/`) |
| VUE | Signing UX | HOLDS for upload and purchase (cost and tip estimates, permanence chosen, credit notice; network named in the intro; the wallet shows each transaction; double submission blocked while busy); GAP for Extend's cost (F12); failure text is the executor's generic message |
| VUE | Shared-wallet state | HOLDS for the gate (I3); GAP for the owned-blob list (F11); the chain-id check and account-change events are wallet-adapter 0.0.17's (own audit) |
| VUE | Browser storage | HOLDS (I6) — keys scoped by network, gate and address; values validated by walrus-client |
| VUE | Lazy boundaries | HOLDS — `@mysten/walrus` loads through the flow; only the `./flow` subpath is imported statically |
| VUE | Dual app / library | HOLDS — `WalrusView` has no shell chrome |
| VUE | Estimates | HOLDS — storage cost is `≈` and labelled; the tip is a ceiling, not a charge |
| SUI_CLIENT | ABI mirroring, Funds in the PTB, Value encoding, Read parsing, Events, Signature verification, Dry-run, Client-side publish | N/A / through the libraries — the app builds no `moveCall`, splits no coin and parses no chain object; walrus-client, walrus-relay and access-gate-client own these (their audits) |
| SUI_CLIENT | Package-ID split, Network / chain binding | HOLDS — ids come from `deployments` (call target `publishedAt`, types `originalId`); the wallet-adapter selector selects ids, client and wallet chain together (the standalone build sets `VITE_NETWORK` once); empty or missing ids are ungated, never an invalid target |
| SUI_CLIENT | Capabilities & irreversible ops | HOLDS — no capability is held; a permanent blob is a visible choice |
| SUI_CLIENT | Execution result | HOLDS — wallet-adapter's executor throws on `FailedTransaction`; Extend and Certify await `waitForTransaction` before refreshing |
| SUI_CLIENT | Chain-access layering | HOLDS — `suiBoundary` forbids PTB and read logic outside `src/wallet.ts` |
| TS | Compiler strictness | HOLDS — `strict: true`, `vue-tsc --noEmit` in CI; `noUncheckedIndexedAccess` is not enabled (the app parses no untrusted data itself); `skipLibCheck: true` hides nothing in `src/` |
| TS | Assertions, validation, money, promises, network I/O, encoding, dynamic code | HOLDS — no `any`, `!` on untrusted data, `eval` or `fetch` in `src/`; the only casts are the build-time `import.meta.env` reads (`config.ts`, `main.ts`); the three `catch {}` blocks return a best-effort `null` on display and precheck paths, never before a dependent payment; dynamic imports have literal specifiers |
| TS | Caller-keyed lookups | HOLDS — the per-network records are keyed by the closed `WalrusNetwork` union; `accessGateDeployment` uses `Object.hasOwn` (client) |
| TS | Packaging, supply chain | HOLDS — `files` whitelist (`npm pack --dry-run` clean); `npm ci`; audit gate (F3); every test project that exists runs in CI (the Playwright suite is nightly, see C.1) |
| WALRUS | Payment bounds | HOLDS — client ceiling wired (F1); tip parsing and clamp are walrus-relay's (F1, F2 there) |
| WALRUS | Relay authentication | through walrus-client and nft-gate-client — audience-bound `nft-gate:access:v2` proof signed with the relay origin, gate and network; origin-only attachment is the library's; paywall e2e PASS 2026-10-09 |
| WALRUS | Relay selection | HOLDS with a stated limit — operator vs public host from `relayHosts`; selection is client-side only, and the gateway in front of the operator relay is the control (walrus-relay) |
| WALRUS | Epochs & lifetime | HOLDS — epochs clamped by the flow (integer 1..`max_epochs_ahead`); Extend clamps to `maxExtendableEpochs`; permanence is an explained default (D6) |
| WALRUS | Blob ownership | HOLDS — the connected wallet owns the Blob on the relay path |
| WALRUS | Content integrity on read | N/A — the app reads no blob bytes; it links to the result URL and to Walruscan |
| WALRUS | Confidentiality | HOLDS — all blobs are public; the notice says the relay sees the content; nothing sensitive is promised (encryption is seal-ui) |
| WALRUS | Flow resumability | through walrus-client — consume digest persisted before the upload and reused; same-registration retry (0.0.26); pending certification finished from My Blobs; listing fixed (F9) |
| WALRUS | Size limits, Pagination, Lazy loading, Network configuration | client limits are UX; the edge limit is the gateway's; listing pages through all results (walrus-client, bounded); wasm loads lazily; package config is SDK-bundled |
| IMG | Base images, build context, reproducible build, no secrets, runtime user, scan, SBOM and notices | HOLDS (F10) — digest-pinned `node:24-slim` and static-server 0.1.7; `.dockerignore` excludes `node_modules`, `dist`, `.git`, `.github`, `.env*.local`; `npm ci`; no secret in any `ARG`/`ENV`; Trivy before cosign; lockfile in the image; `/THIRD_PARTY_LICENSES` served |
| IMG | Verification command | GAP accepted — the identity pins the repository (F17) |
| IMG | Deployment pinning | HOLDS — digest in `config/images.yaml` and the overlay; the base manifest's tag label (`0.1.0`) is overridden by the overlay digest and is cosmetic |

## Section B — Supply-chain, publish-authority & capability matrix

### B.1 Dependency & CVE risk

| Dependency | Pinned version | Liveness dependency? | CVE / audit status | Notes |
| --- | --- | --- | --- | --- |
| `@meddleware/walrus-client` | `^0.0.27` (installed 0.0.27) | uploads, listing | `npm audit` gate clean 2026-10-09 | latest; 0.0.27 fixes F9 |
| `@meddleware/walrus-relay` | `^0.1.30` | selection, gate | clean | latest |
| `@meddleware/access-gate-client` | dev `^0.0.8` (type and deployments; installed 0.0.8) | gate reads | clean | latest |
| `@meddleware/wallet-adapter` | peer `>=0.0.12 <0.2.0`; dev `^0.0.17` | wallet | own audit | host's copy |
| `@meddleware/ui` / `design-tokens` / `eslint-config` | `^0.1.31` / `^0.1.9` / `^0.0.2` | UI | own audits | latest published |
| `@mysten/walrus` / `@mysten/walrus-wasm` / `@mysten/sui` | `~1.2.32` (1.2.34) / `~0.3.1` / `^2.33.2` (2.35.0) | uploads / reads | gate clean | one copy (`npm ls`); ADR-0001 baseline `^2.33.1` |
| `@mysten/wallet-standard` | `^0.21.0` | none | clean | declared, imported nowhere in `src/` or `tests/` (F18) |
| Vue / Vite / TypeScript / vitest | 3.5.43 / 8.3 / 6.0.3 / 5.0.3 (plugin-vue 6.0.9, vue-tsc 3.3.x) | build | clean | TypeScript 7 and vitest 5-major follow-ups declined (decision); Node 24 LTS |
| Sui full node; operator and public relays | public gRPC (wallet-adapter); relay hosts | listing; uploads | Mysten / operator | fail closed (no upload without a relay); operator relay down falls back to public |
| `static-server` / `node:24-slim` | 0.1.7 / digest-pinned | runtime / build | Trivy at release (F10); Go 1.26.9 | — |
| dev tooling | lockfile | no | GHSA-vfj7-8cjw-p6xm allowlisted to 2027-01-01 | `.github/audit-allowlist.json` |

Shared-dependency matrix (TS lens): `@mysten/sui` dep `^2.33.2` (baseline `^2.33.1`, within range);
`@mysten/walrus` dep `~1.2.32` and `@mysten/walrus-wasm` dep `~0.3.1` (the SDK's own tilde pins, as in the
baseline); `vue` dep `^3.5.43`; `typescript` dev `~6.0.0`; `vitest` dev `~5.0.2`; `@mysten/wallet-standard`
dep `^0.21.0`; `@mysten/seal` and `@mysten/bcs`: not used. First-party ranges are `^0.0.x` (exact) or
`^0.1.x`; no `~0.0.x`; the peer range for wallet-adapter is `>=0.0.12 <0.2.0`, no `legacy-peer-deps`.

Install-time code (TS B.TS-2): the lockfile has one lifecycle script, `fsevents` (dev, optional, macOS
only); no `allowScripts`, no `overrides`; no `prepare`/`postinstall` in `package.json`.

### B.2 Publish authority, capabilities & secret custody

| Authority / secret | Where held | Custody | Gates | Rotation |
| --- | --- | --- | --- | --- |
| npm publish | GitHub Actions | OIDC + provenance; opt-in `NPM_PUBLISH` | library | n/a |
| `QUAY_TOKEN`, `DOCKERHUB_TOKEN` | GitHub secrets | long-lived robot accounts (inventory: `OPERATOR_TASKS.md`) | image push | rotate on suspicion (F7) |
| image signing | GitHub Actions | cosign keyless | images | n/a |

CI & release integrity: actions pinned by SHA (workflows read 2026-10-09); explicit `permissions:` per
workflow and job (`id-token`/`attestations` only on the signing job, `id-token` only on the npm publish
job); OIDC publish with a tag == version check and an idempotent registry check; npm client pinned
(`npm@11.20.0`); image release = full CI via `workflow_call` + Trivy + cosign + SPDX SBOM attestation +
provenance, no `continue-on-error` on the public path (F10; the npm gate is a subset, F16); `npm ci`
everywhere; audit gate in CI and the npm job (F3); Dependabot weekly and grouped for npm, Docker and
Actions; no test-only build mode exists, so there is nothing to scan for; no job spends real funds (the
nightly `integration.yml` runs a browser smoke suite only).

### B.VUE-1 Hosting headers

Live headers on `sui-walrus.meddleware.co.uk`, read 2026-10-09: `Content-Security-Policy`
(`default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval' 'nonce-…'`, `style-src 'self' 'unsafe-inline'`,
`connect-src 'self' https:`, `img-src 'self' data: blob: https:`, `worker-src 'self' blob:`,
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`,
`upgrade-insecure-requests`), `Strict-Transport-Security` (1 year, includeSubDomains),
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy`, `X-Frame-Options: SAMEORIGIN`. The CSP is static-server's
(`CONTENT_SECURITY_POLICY` from the `CSP` build argument); there is no static host and no `_headers`
file. `'unsafe-inline'` is for styles only; the build emits no inline script. The blanket `https:` is F15.
Framing is `'self'` only; the dashboard embeds the view as a component, not a frame.

### B.VUE-2 Build inputs and artifacts / IMG

`node:24-slim@sha256:0e0ff40c…` builder and `static-server:0.1.7@sha256:2e227311…` runtime, both
digest-pinned (Dependabot Docker group); `npm ci`; `.dockerignore` excludes local installs, build output,
VCS data and every `.env*.local`; `npm run build && npm run licenses` run in the build stage; the runtime
stage copies `dist` and the lockfile only; `USER 65534:65534`; no secret in any `ARG`/`ENV` (the build
args are the public `VITE_*` values and the CSP); production sourcemaps are not emitted (Vite default);
the deployment is read-only root, `runAsNonRoot` uid 65534, no privilege escalation, all capabilities
dropped, `RuntimeDefault` seccomp, `automountServiceAccountToken: false`, readiness and liveness probes on
`/`, requests 5m/16Mi and limits 100m/48Mi; digest `sha256:631abc3a…` in both `config/images.yaml` and the
overlay; cosign signature verified 2026-10-09 (F17). Not run: a Trivy *config* scan of the Dockerfile and
manifests (F10).

### B.SC-1 ID-constant trace

| Location | Network | Value | original-id or published-at | Matches the latest on-chain version |
| --- | --- | --- | --- | --- |
| access-gate-client 0.0.8 `deployments` (resolved from npm at build; the only source of the package and PlatformConfig) | testnet | `access_gate` `0xd7ddaa94…88c9`, PlatformConfig `0x3f81489d…e7b5` | both (fresh publication 2026-10-09) | Y — access-gate-sui commit `7906954`; live bundle read 2026-10-09 |
| `VITE_ACCESS_GATE_ID_TESTNET` (operator build variable) | testnet | relay `Gate` `0x316f1bf9…faddc` | n/a (shared object) | Y — on the new package; present in the live bundle; the old gate `0xfd6c3b…` is not present |
| any `src/` literal, `.env.example` | any | none | — | Y — grep finds no 0x id in `src/` |
| mainnet, localnet | — | none recorded | — | n/a — no gate; the UI is ungated or shows the notice |

### B.SC-2 Coupling table

| Move function | Builder | Test asserting target + arguments |
| --- | --- | --- |
| gate purchase and consume | `useAccessGate` (`buildPurchase`, `buildConsume`) in walrus-relay over access-gate-client | their tests; the config here is pinned to the deployment (`config.test.ts`) |
| Walrus register / certify / extend | walrus-client over `@mysten/walrus` | walrus-client tests and localnet suite; the app only calls `extendBlobLifetimeTransaction` and `certifyBlobTransaction` |

## Section C — Test-coverage & hermetic/live split

### C.1 Coverage grade — B (17/17, 2026-10-09)

Vitest 5.0.3, 3 files: `blob-groups.test.ts`, `config.test.ts` (tip ceiling, relay hosts, gate config
fixed to the deployment), `useOwnedBlobs.test.ts` (epoch source, network keying). The flows themselves are
tested in walrus-client and walrus-relay. The listing is mocked here, so a parser regression such as F9
passes this suite; the component logic (Extend pricing, switch handling, F11, F12) has no tests. The
Playwright smoke suite (`e2e/app.smoke.spec.ts`) runs nightly in `integration.yml`, not on the PR path; the
localnet upload spec is `fixme` pending a signing wallet (`e2e/wallet.ts` is a stub). The unit suite runs
in `node-ci.yml` and so in the image release (F6). Gating variables: none.

### C.2 Hermetic vs. live paths

| Path | Hermetic? | Deferred to | Tracking |
| --- | --- | --- | --- |
| Config, grouping, composables | yes | — | `npm test` |
| Real upload, extend, gated relay | no | testnet | token-deployer-ui / dashboard `e2e:walrus` (shared flow); paywall e2e PASS 2026-10-09; walrus-client localnet suite PASS after 0.0.27 |
| Browser contrast (axe) of this app's own components | no | `@meddleware/ui` gallery covers shared components only | F13 |

## Section D — Deployment-readiness gates

### pre-localnet

- [x] builds; type-check, three linters, unit tests green (2026-10-09); no secrets

### pre-testnet

- [x] deployed with digest pinning; CSP and HSTS verified live 2026-10-09; gated relay live (paywall e2e PASS 2026-10-09)
- [x] `SECURITY.md` present
- [x] image: digest-pinned bases, non-root, restricted pod, probes and limits, deployed by digest, signed with SBOM and provenance, scanned before signing (F10)
- [x] consumed IDs are the latest on-chain version — live bundle carries `0xd7ddaa94…`, `0x3f81489d…` and gate `0x316f1bf9…` only (B.SC-1)
- [x] every test project that exists runs in CI (F6)
- [ ] state invalidated on switch in every view — owned-blob list (F11, next patch)
- [ ] signing UX shows the amount of every paid action — Extend (F12, next patch)
- [ ] colour: text meets AA in both themes — My Blobs tokens (F13, next patch)

### pre-mainnet

- [ ] mainnet gate arguments in the Dockerfile (`VITE_ACCESS_GATE_SOULBOUND_MAINNET`, `…_PRICE_MIST_MAINNET`) — mainnet-blocked (no `access_gate` mainnet deployment)
- [ ] mainnet relay and gate configured; gated e2e on mainnet — mainnet-blocked
- [x] CSP and HSTS on the one hosting path (B.VUE-1)
- [ ] registry credential inventory and rotation (F7) — `OPERATOR_TASKS.md` "Image registry credentials"
- [ ] external review — maintainer item (`OPERATOR_TASKS.md` "Funding, grants and an external audit")

## Cross-project themes

- **Supply chain & release integrity** — lockfile (also shipped in the image); first-party libraries at
  their latest versions; signed images with SBOM and provenance, Trivy before signing, SHA-pinned
  actions, grouped Dependabot; expiring audit allowlist; publish authority in B.2.
- **On-chain-truth boundary** — costs are estimates; payments are user-signed.
- **Wire-format coupling** — none here: proofs and the consume record are walrus-client's and
  nft-gate-client's.
- **Deployment readiness** — Section D.
- **Chain-access layering** — all chain logic in walrus-client, walrus-relay and access-gate-client; the
  `suiBoundary` lint enforces it. IDs consumed: B.SC-1.

## Normative requirements (MUST / MUST NOT)

- **VUE-M1–VUE-M9** — hold (VUE-M3 N/A: no test hooks); VUE-M4 holds for upload and purchase, with one
  gap for Extend's cost (F12); VUE-M6 holds for the gate, with one gap for the owned-blob list (F11);
  the *Colour & links* category has one open defect (F13).
- **SC-M1–SC-M10** — hold through the libraries (SC-M6 to SC-M9 are N/A: this app verifies no signature,
  binds no event, signs no dry-run PTB and extracts no created object). SC-M5: network, ids, client and
  wallet chain follow one selector.
- **TS-M1–TS-M9** — hold. TS-M9: `@mysten/sui` is a single copy; wallet-adapter is a peer.
- **WAL-M1–WAL-M9** — hold through the libraries (WAL-M6 N/A: no blob bytes are read here).
- **IMG-M1–IMG-M8** — hold; IMG-M8's verification command pins the repository only (F17).

## Implementation suggestions (SHOULD / MAY)

- SHOULD add the mainnet gate build arguments now, so the mainnet image is a configuration change.
- SHOULD add a request guard to `useOwnedBlobs.load` and a test with two overlapping loads (F11).
- SHOULD add a test that runs a realistic 78-digit blob id through the real listing parser, or a
  contract test against walrus-client's exported fixture, so a parser regression like F9 fails here.
- SHOULD drop the unused `@mysten/wallet-standard` dependency (F18).
- MAY run a Trivy configuration scan of the Dockerfile and manifests in CI.

## Open questions (`OQ#`)

None.

## Risks

- **Relay liveness** — when the operator relay is down, uploads fall back to the public relay.
- **Registry tokens** — long-lived robot tokens for image pushes (F7).
- **Silent library regressions** — a parser change in a dependency can empty a view without any test
  here failing (F9); the daily walrus-client localnet suite is the control.

## Re-verification log

- 2026-09-18 — first-pass baseline (F1–F7).
- 2026-09-30 — B5: upload flow from walrus-client; relay gate via `relayGateConfig`; D6 permanence.
- 2026-10-02 — re-verified under AUDIT_TEMPLATE.md + VUE + TS + SUI_CLIENT + WALRUS + IMG (Phase 7):
  front matter, lens sections and four-part closing added. F8 RESOLVED in 0.1.50 (walrus-client
  0.0.24, walrus-relay 0.1.25). Counts: 17/17.
- 2026-10-03 — consumer wave: 0.1.51 (walrus-client 0.0.25, walrus-relay 0.1.26, access-gate-client 0.0.4, ui 0.1.30, design-tokens 0.1.8); deployed; live sweep clean.
- 2026-10-08 — Lens dates reconciled with the registry (`check-template-dates.mjs`): base 2026-10-08, and SUI_CLIENT/GO 2026-10-08 and TS 2026-10-03 where cited. The changes (AUTH/PLATFORM/MCP/DB registered, the GO token row moved to AUTH, JSR in trusted publishing, layered injection guards) alter no disposition here.
- 2026-10-09 — re-verified at 0.1.57 (`ba75d9e`) against the code, the workflows, the manifests and the live site/bundle. Template dates now VUE/TS/IMG 2026-10-08 (the lens changes since the first citation are covered by the sections added below); front matter gains the Walrus, VUE, TS and IMG fields. F1–F8 re-checked (F1, F2, F3, F6, F8 RESOLVED with evidence; F4 corrected: `accessGate()` catches the throw and falls back to an ungated UI, the gateway is the control; F7 ACCEPTED-RISK, inventory a maintainer item). New: F9 RESOLVED (owned-blob regression fixed by walrus-client 0.0.27 / walrus-ui 0.1.56), F10 RESOLVED (image release gate, Trivy, notices, lockfile, `USER 65534`, static-server 0.1.7), F11–F14 and F18 DEFERRED (owned-blob race, Extend cost, undefined colour tokens, `.env.local`, documentation drift), F15–F17 ACCEPTED-RISK. The known `node-ci.yml` gap (no `npm test`) was checked and is absent here. Relay gate updated to `0x316f1bf9…` (live bundle confirms; `0xfd6c3b…` gone). Counts: 17/17, audit gate 1 allowlisted / 0 open. Section D gates ticked with evidence; unticked: three next-patch items (F11–F13) and the mainnet/maintainer items.
