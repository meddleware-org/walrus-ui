<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { CopyableAddress, ExplorerLink } from '@meddleware/ui'
import type { OwnedBlob } from '@meddleware/walrus-client'
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import type { Executor } from '../wallet.js'
import { NETWORK, walruscanBlobUrl } from '../config.js'
import { useOwnedBlobs } from '../composables/useOwnedBlobs.js'
import {
  pendingCertifyKey,
  loadPendingCertifies,
  clearPendingCertify,
  type PendingCertify,
} from '../certify-resume.js'

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

// Pending certifications: blobs uploaded + paid for but not yet certified (the certify prompt was
// dismissed). Persisted by the upload flow, keyed by blobObjectId; resumable here without re-upload.
const pending = ref<Record<string, PendingCertify>>({})
const certifying = ref<string | null>(null)
const certifyStatus = ref<Record<string, string>>({})

/** The pending-certify entry for a blob, if it's uncertified and we hold its certificate. */
function pendingFor(blob: OwnedBlob): PendingCertify | null {
  return !blob.certified ? (pending.value[blob.objectId] ?? null) : null
}

/** Reload the pending map from storage, dropping entries whose blob is already certified. */
function refreshPending(): void {
  if (!props.address) {
    pending.value = {}
    return
  }
  const key = pendingCertifyKey(NETWORK, props.address)
  const map = loadPendingCertifies(window.localStorage, key)
  // Housekeeping: a blob certified elsewhere no longer needs a stored certificate.
  for (const blob of blobs.value) {
    if (blob.certified && blob.objectId in map) {
      clearPendingCertify(window.localStorage, key, blob.objectId)
      delete map[blob.objectId]
    }
  }
  pending.value = map
}

async function certifyBlob(blob: OwnedBlob): Promise<void> {
  const entry = pendingFor(blob)
  if (!entry || !props.address) return
  certifying.value = blob.objectId
  certifyStatus.value = { ...certifyStatus.value, [blob.objectId]: 'Building transaction…' }
  try {
    const { createWalrusClient, certifyBlobTransaction } = await import('@meddleware/walrus-client')
    const walrusClient = createWalrusClient({ network: NETWORK, wasmUrl: walrusWasmUrl })
    const tx = certifyBlobTransaction(walrusClient, {
      blobId: entry.blobId,
      blobObjectId: entry.blobObjectId,
      certificate: entry.certificate,
      deletable: entry.deletable,
    })
    const executor = await props.buildExecutor()
    certifyStatus.value = { ...certifyStatus.value, [blob.objectId]: 'Approve in wallet…' }
    const { digest } = await executor.signAndExecute(tx)
    await executor.waitForTransaction(digest)
    clearPendingCertify(window.localStorage, pendingCertifyKey(NETWORK, props.address), blob.objectId)
    certifyStatus.value = { ...certifyStatus.value, [blob.objectId]: `Certified ✓ (${digest.slice(0, 8)}…)` }
    await refresh() // reflect certified = ✓
  } catch (e) {
    certifyStatus.value = {
      ...certifyStatus.value,
      [blob.objectId]: `Failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    certifying.value = null
  }
}

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
// Re-derive pending certifications whenever the list refreshes or the account changes.
watch(blobs, () => refreshPending())
watch(() => props.address, () => refreshPending())
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
          <td>
            <span v-if="blob.certified">✓</span>
            <span v-else-if="pendingFor(blob)" class="pending-badge" title="Uploaded but not certified">
              pending
            </span>
            <span v-else>—</span>
          </td>
          <td class="actions">
            <!-- Certify: the blob was uploaded + paid for but not certified; finish it (no re-upload). -->
            <template v-if="pendingFor(blob)">
              <span v-if="certifyStatus[blob.objectId]" class="ext-status">
                {{ certifyStatus[blob.objectId] }}
              </span>
              <button
                v-else
                type="button"
                class="certify-btn"
                :disabled="certifying === blob.objectId"
                @click="certifyBlob(blob)"
              >
                Certify
              </button>
            </template>

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
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
.certify-btn {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
}
.pending-badge {
  font-size: 0.78rem;
  color: var(--accent, #6366f1);
  font-weight: 600;
}
</style>
