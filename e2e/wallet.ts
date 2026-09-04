// Test wallet injection for the localnet upload e2e.
//
// The app (src/wallet.ts) discovers wallets via @mysten/wallet-standard and filters to those
// exposing `standard:connect` + `sui:signTransaction` (+ `sui:signPersonalMessage`). To drive a real
// upload we register a wallet-standard wallet, in the page context, backed by the funded localnet
// keypair (WALRUS_TEST_SECRET_KEY from `.env.localnet`).
//
// IMPLEMENTATION NOTE (remaining work — see upload.localnet.spec.ts):
// A page.addInitScript runs in the browser, so it cannot import Node modules. The signer must be
// bundled for the browser. The intended approach is either:
//   (a) build a tiny signing-wallet bundle (esbuild `@mysten/sui` + a wallet-standard registration
//       shim) and `page.addInitScript({ path })` it, seeding the key via an env-injected global; or
//   (b) expose the signer over `page.exposeFunction` (sign in the Node test process using
//       Ed25519Keypair.fromSecretKey) and have a thin in-page wallet delegate signing to it.
// Approach (b) keeps the secret in Node and needs no browser bundling — preferred.
import type { Page } from '@playwright/test'

/**
 * Register a wallet-standard test wallet in the page, backed by the funded localnet key. Currently a
 * documented stub — see the note above and upload.localnet.spec.ts (marked fixme until this lands).
 */
export async function installLocalnetWallet(_page: Page): Promise<void> {
  throw new Error(
    'installLocalnetWallet is not yet implemented — see the note in e2e/wallet.ts (approach b: ' +
      'exposeFunction-delegated signing). The localnet upload spec is marked fixme until then.',
  )
}
