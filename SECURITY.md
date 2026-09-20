# Security Policy

## Scope

This policy covers security issues in the `@meddleware/walrus-ui` application/library source
(`src/**`) — the upload/blob-management UI, the `WalrusView` library export, config wiring, and the
`access-resume` retry helper.

It does not cover:

- `@meddleware/wallet-adapter`, `@meddleware/walrus-relay`, `@meddleware/walrus-client`, or
  `@mysten/walrus` (see their own policies)
- The Walrus relay/aggregator or Sui RPC endpoints, or the wallet extension (which confirms every
  signature)

## Security model (invariants)

These invariants are load-bearing. A report demonstrating that any is violated is in scope and
treated as high severity:

1. **The authoritative upload-relay tip cap is wired.** `VITE_UPLOAD_RELAY_MAX_TIP_MIST` is passed to
   `createWalrusClient` so a malicious relay cannot induce an unbounded tip (the relay UI library has
   no clamp of its own).
2. **No secret is a `VITE_*` value.** All `VITE_*` config (network, relay URLs, docs URL, tip cap) is
   non-secret and is baked into the bundle at build time; no key or token is ever inlined.
3. **No dynamic HTML sinks.** Blob ids, relay-supplied strings, and filenames render as text; URLs use
   validated `href`.
4. **On-chain truth.** No accounting or authorization is decided in JS; previews are estimates. The
   `consumeDigest` persisted for retry is a public on-chain tx digest, not a credential.

## Supported versions

Only the latest published version receives security fixes.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities. Report by emailing
**<security@meddleware.co.uk>** with a description, reproduction/PoC if available, and the version or
commit SHA tested. You will receive an acknowledgement within **3 business days** and a resolution
plan within **14 days** for confirmed issues; Critical issues (CVSS ≥ 9.0) are prioritised for
same-day acknowledgement.

## Disclosure

Once a fix is released, a security advisory will be published on the GitHub repository. Reporters may
be credited by name unless they prefer to remain anonymous.
