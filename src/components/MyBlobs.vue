<script setup lang="ts">
import { ref, watch } from 'vue'
import type { OwnedBlob } from '@meddleware/walrus-client'
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import { getSuiClient } from '../wallet.js'
import type { Executor } from '../wallet.js'
import { NETWORK } from '../config.js'

const props = defineProps<{
  /** Connected wallet address whose owned blobs to list; `null` when no wallet is connected. */
  address: string | null
  /** Factory that builds a transaction {@link Executor} bound to the connected wallet (for extend). */
  buildExecutor: () => Promise<Executor>
}>()

const blobs = ref<OwnedBlob[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const currentEpoch = ref(0)
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

async function loadBlobs(): Promise<void> {
  if (!props.address) return
  loading.value = true
  error.value = null
  blobs.value = []
  try {
    const { createWalrusClient, fetchOwnedWalrusBlobs } = await import('@meddleware/walrus-client')
    const suiClient = getSuiClient(NETWORK)
    const walrusClient = createWalrusClient({ network: NETWORK, wasmUrl: walrusWasmUrl })
    const [sys, fetched] = await Promise.all([
      suiClient.getCurrentSystemState(),
      fetchOwnedWalrusBlobs(suiClient, walrusClient, props.address),
    ])
    currentEpoch.value = Number(sys.systemState.epoch)
    blobs.value = fetched.sort((a: OwnedBlob, b: OwnedBlob) => a.endEpoch - b.endEpoch)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
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
    await loadBlobs()
  } catch (e) {
    extendStatus.value = {
      ...extendStatus.value,
      [blob.objectId]: `Failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    extending.value = null
  }
}

watch(() => props.address, loadBlobs)
</script>

<template>
  <section class="my-blobs">
    <div class="toolbar">
      <h2>My Blobs</h2>
      <button type="button" :disabled="!address || loading" @click="loadBlobs">
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
          <td class="mono">{{ blob.blobId.slice(0, 12) }}…</td>
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
