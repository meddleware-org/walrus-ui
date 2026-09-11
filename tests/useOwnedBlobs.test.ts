// Regression test for the "everything shows as expired" bug: the owned-blobs cache must compare
// blob end epochs against the WALRUS committee epoch, not the Sui system-state epoch (different
// clocks). A fake walrus-client is injected via vi.mock so no wasm/network is touched.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// getSuiClient is only used to fetch owned objects (via the mocked fetchOwnedWalrusBlobs), so a
// bare stub is enough — this also avoids pulling the real wallet-adapter into the test.
vi.mock('../src/wallet.js', () => ({ getSuiClient: () => ({ __sui: true }) }))

// The Walrus committee epoch (560) is intentionally far below the Sui epoch a fullnode would report
// (~1218). A blob ending at epoch 570 must therefore read as ~10 epochs remaining — NOT expired.
vi.mock('@meddleware/walrus-client', () => ({
  createWalrusClient: () => ({
    walrus: { systemState: async () => ({ committee: { epoch: 560 } }) },
  }),
  fetchOwnedWalrusBlobs: async () => [
    { objectId: '0x1', blobId: 'BLOB', size: 2048, endEpoch: 570, certified: true },
  ],
}))

import { useOwnedBlobs } from '../src/composables/useOwnedBlobs.js'

describe('useOwnedBlobs epoch source', () => {
  beforeEach(() => {
    // Reset the module-singleton cache between assertions.
    const s = useOwnedBlobs()
    s.blobs.value = []
    s.currentEpoch.value = 0
  })

  it('uses the Walrus committee epoch so a future-ending blob is not flagged expired', async () => {
    const { blobs, currentEpoch, load } = useOwnedBlobs()
    await load('0xowner', { force: true })
    expect(currentEpoch.value).toBe(560) // Walrus epoch, not the Sui system-state epoch
    expect(blobs.value).toHaveLength(1)
    // The display computes `endEpoch - currentEpoch`; must be positive (≈10), i.e. not expired.
    expect(blobs.value[0].endEpoch - currentEpoch.value).toBe(10)
  })
})
