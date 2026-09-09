// Module-singleton cache of the connected wallet's owned Walrus blobs.
//
// State lives at module scope (not inside the composable factory) so it is shared across every
// `MyBlobs` mount in the session: switching the Upload/My-Blobs tabs — or navigating the whole
// tool view in and out inline in the dashboard — no longer loses the list or forces a refetch.
// `load()` is a no-op when the list is already loaded for the given address, unless `force` is set
// (used after an upload/extend, which can create or mutate on-chain blobs).
import { ref } from 'vue'
import type { OwnedBlob } from '@meddleware/walrus-client'
// Lightweight URL import — just the wasm asset URL (does not pull the walrus client eagerly).
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import { getSuiClient } from '../wallet.js'
import { NETWORK } from '../config.js'

const blobs = ref<OwnedBlob[]>([])
const currentEpoch = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
/** Address the current `blobs` were fetched for; `null` until a successful load. */
const loadedFor = ref<string | null>(null)

async function load(address: string | null, opts: { force?: boolean } = {}): Promise<void> {
  if (!address) {
    blobs.value = []
    loadedFor.value = null
    return
  }
  // Skip refetch when we already have this address's list and the last load succeeded.
  if (!opts.force && loadedFor.value === address && error.value === null) return

  loading.value = true
  error.value = null
  try {
    const { createWalrusClient, fetchOwnedWalrusBlobs } = await import('@meddleware/walrus-client')
    const suiClient = getSuiClient()
    const walrusClient = createWalrusClient({ network: NETWORK, wasmUrl: walrusWasmUrl })
    const [sys, fetched] = await Promise.all([
      suiClient.getCurrentSystemState(),
      fetchOwnedWalrusBlobs(suiClient, walrusClient, address),
    ])
    currentEpoch.value = Number(sys.systemState.epoch)
    blobs.value = fetched.sort((a: OwnedBlob, b: OwnedBlob) => a.endEpoch - b.endEpoch)
    loadedFor.value = address
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** Reactive access to the shared owned-blobs cache and its loader. */
export function useOwnedBlobs() {
  return { blobs, currentEpoch, loading, error, loadedFor, load }
}
