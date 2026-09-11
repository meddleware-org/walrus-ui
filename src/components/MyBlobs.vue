<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { CopyableAddress, ExplorerLink } from '@meddleware/ui'
import type { OwnedBlob } from '@meddleware/walrus-client'
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import type { Executor } from '../wallet.js'
import { NETWORK, walruscanBlobUrl } from '../config.js'
import { useOwnedBlobs } from '../composables/useOwnedBlobs.js'

const props = defineProps<{
  /** Connected wallet address whose owned blobs to list; `null` when no wallet is connected. */
  address: string | null
  /** Factory that builds a transaction {@link Executor} bound to the connected wallet (for extend). */
  buildExecutor: () => Promise<Executor>
}>()

// Shared, session-persistent cache (survives tab switches and inline re-mounts).
const { blobs, currentEpoch, loading, error, load } = useOwnedBlobs()
const extending = ref<string | null>(null)
const extendStatus = ref<Record<string, string>>({})

const EXPIRY_WARN_EPOCHS = 10
const EPOCHS_PER_DAY = 1 / 0.038 // ~1 Walrus epoch ≈ 38 minutes on testnet

function epochsToApproxDays(epochs: number): string {
  const days = Math.round(epochs * EPOCHS_PER_DAY)
  if (days <= 0) return 'expired'
  if (days < 2) return `${days} day`
  return `${days} days`
}

/** Force a fresh fetch (Refresh button + after an on-chain-affecting action). */
function refresh(): Promise<void> {
  return load(props.address, { force: true })
}

async function extendBlob(blob: OwnedBlob): Promise<void> {
  extending.value = blob.objectId
  extendStatus.value = { ...extendStatus.value, [blob.objectId]: 'Building transaction…' }
  try {
    const { createWalrusClient, extendBlobLifetimeTransaction } = await import('@meddleware/walrus-client')
    const walrusClient = createWalrusClient({ network: NETWORK, wasmUrl: walrusWasmUrl })
    const tx = await extendBlobLifetimeTransaction(walrusClient, blob.objectId, { epochs: 10 })
    const executor = await props.buildExecutor()
    extendStatus.value = { ...extendStatus.value, [blob.objectId]: 'Approve in wallet…' }
    const { digest } = await executor.signAndExecute(tx)
    await executor.waitForTransaction(digest)
    extendStatus.value = { ...extendStatus.value, [blob.objectId]: `Extended ✓ (${digest.slice(0, 8)}…)` }
    // Refresh the list so the new endEpoch is visible.
    await refresh()
  } catch (e) {
    extendStatus.value = {
      ...extendStatus.value,
      [blob.objectId]: `Failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    extending.value = null
  }
}

// Load on first open (fixes "nothing shows until Refresh") and whenever the address changes.
// The composable no-ops when the list is already cached for this address, so re-mounting is cheap.
onMounted(() => void load(props.address))
watch(() => props.address, (addr) => void load(addr))
</script>

<template>
  <section class="my-blobs">
    <div class="toolbar">
      <h2>My Blobs</h2>
      <button type="button" :disabled="!address || loading" @click="refresh">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
    </div>

    <p v-if="!address" class="hint">Connect your wallet to list your Walrus blobs.</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!loading && blobs.length === 0" class="hint">No Walrus blobs found for this address.</p>

    <table v-if="blobs.length" class="blob-table">
      <thead>
        <tr>
          <th>Blob ID</th>
          <th>Size</th>
          <th>Expires</th>
          <th>Certified</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="blob in blobs"
          :key="blob.objectId"
          :class="{ warn: blob.endEpoch - currentEpoch < EXPIRY_WARN_EPOCHS }"
        >
          <td>
            <CopyableAddress :address="blob.blobId" label="Copy blob ID">
              <ExplorerLink
                :href="walruscanBlobUrl(NETWORK, blob.blobId)"
                :value="blob.blobId"
                :chars="[8, 6]"
              />
            </CopyableAddress>
          </td>
          <td>{{ (blob.size / 1024).toFixed(1) }} KB</td>
          <td>
            epoch {{ blob.endEpoch }}
            <span class="approx">(≈{{ epochsToApproxDays(blob.endEpoch - currentEpoch) }})</span>
          </td>
          <td>{{ blob.certified ? '✓' : '—' }}</td>
          <td>
            <span v-if="extendStatus[blob.objectId]" class="ext-status">
              {{ extendStatus[blob.objectId] }}
            </span>
            <button
              v-else
              type="button"
              :disabled="extending === blob.objectId"
              @click="extendBlob(blob)"
            >
              +10 epochs
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.my-blobs {
  margin-top: 1.5rem;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.toolbar h2 {
  margin: 0;
  font-size: 1.2rem;
}
.hint {
  color: var(--mw-color-text-muted, #888);
  font-size: 0.9rem;
}
.err {
  color: var(--mw-color-danger, #c00);
  font-size: 0.9rem;
}
.blob-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.blob-table th,
.blob-table td {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--mw-color-border, #ddd);
}
.blob-table th {
  font-weight: 600;
  color: var(--mw-color-text-muted, #888);
}
.blob-table tr.warn td {
  background: color-mix(in srgb, var(--mw-color-warning, #f90) 8%, transparent);
}
.mono {
  font-family: monospace;
}
.approx {
  font-size: 0.8em;
  color: var(--mw-color-text-muted, #888);
}
.ext-status {
  font-size: 0.85rem;
  color: var(--mw-color-text-muted, #888);
}
</style>
