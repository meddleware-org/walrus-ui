// Full localnet upload e2e (connect → upload → aggregator read-back → MyBlobs lists it).
//
// This is scaffolded but marked `fixme` because it depends on two pieces that are deliberately NOT
// yet in place, each a small, well-scoped follow-up:
//
//   1. **A browser-injectable signing wallet.** wallet.ts requires a wallet-standard wallet exposing
//      standard:connect + sui:signTransaction + sui:signPersonalMessage. e2e/wallet.ts documents the
//      injection approach (page.addInitScript registering a wallet backed by the funded localnet key
//      WALRUS_TEST_SECRET_KEY). Wiring a real signer into the page context (bundling @mysten/sui for
//      the init script) is the remaining work.
//   2. **A localnet build target for the SPA.** App.vue builds its Walrus client from `NETWORK`
//      (testnet|mainnet). Targeting the localnet testbed needs config.ts to accept `localnet` and
//      thread `walrusPackageConfig` + `storageNodeUrlScheme:'http'` (the harvested WALRUS_* ids) into
//      createWalrusClient — mirroring the extension already added to @meddleware/walrus-client.
//
// Until both land, this spec self-skips (fixme). Once they do, remove `.fixme` and run it after
// `source ../walrus-client/localnet/.env.localnet` with the app built against localnet.
import { test, expect } from '@playwright/test'
import { installLocalnetWallet } from './wallet.js'

const READY = process.env.WALRUS_LOCALNET === '1' && !!process.env.WALRUS_TEST_SECRET_KEY

test.describe('walrus-ui localnet upload', () => {
  test.skip(!READY, 'requires a sourced .env.localnet (WALRUS_LOCALNET=1)')

  test.fixme('uploads a blob through the localnet relay and lists it in My Blobs', async ({ page }) => {
    await installLocalnetWallet(page)
    await page.goto('/')

    await page.getByRole('button', { name: 'Connect wallet' }).click()

    // Choose a tiny file and run the upload flow.
    const bytes = Buffer.from(`e2e-${Date.now()}`)
    await page.getByLabel(/file/i).setInputFiles({ name: 'e2e.txt', mimeType: 'text/plain', buffer: bytes })
    await page.getByRole('button', { name: /upload/i }).click()

    // The result panel shows the blob id + aggregator URL.
    const link = page.getByRole('link', { name: /\/v1\/blobs\// })
    await expect(link).toBeVisible({ timeout: 120_000 })
    const url = await link.getAttribute('href')
    expect(url).toBeTruthy()

    // Aggregator serves the exact bytes back.
    const served = await page.request.get(url!)
    expect(served.ok()).toBeTruthy()
    expect(Buffer.from(await served.body())).toEqual(bytes)

    // MyBlobs lists the freshly-certified blob.
    await page.getByRole('button', { name: 'My Blobs' }).click()
    await expect(page.getByText(/certified|epoch/i).first()).toBeVisible()
  })
})
