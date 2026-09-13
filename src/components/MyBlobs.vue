<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { CopyableAddress, ExplorerLink } from '@meddleware/ui'
import type { OwnedBlob } from '@meddleware/walrus-client'
import { MAX_SINGLE_RESERVATION_EPOCHS, formatCoinAmount } from '@meddleware/walrus-relay'
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import type { Executor } from '../wallet.js'
import { NETWORK, walruscanBlobUrl } from '../config.js'
import { useOwnedBlobs } from '../composables/useOwnedBlobs.js'
import { groupBlobs, expiryLabel, maxExtendableEpochs, type BlobGroup } from '../blob-groups.js'
import {
  pendingCertifyKey,
  loadPendingCertifies,
  clearPendingCertify,
  type PendingCertify,
} from '../certify-resume.js'

const props = defineProps<{
  /** Connected wallet address whose owned blobs to list; `null` when no wallet is connected. */
  address: string | null
  /** Factory that builds a transaction {@link Executor} bound to the connected wallet. */
  buildExecutor: () => Promise<Executor>
  /** When set, the matching group is expanded + scrolled into view (from the duplicate-upload flow). */
  highlightBlobId?: string | null
}>()

// Shared, session-persistent cache (survives tab switches and inline re-mounts).
const { blobs, currentEpoch, loading, error, load } = useOwnedBlobs()

// One row per blobId; re-uploads of the same content are collapsed into a group's `copies`.
const groups = computed(() => groupBlobs(blobs.value))
const expanded = ref<Set<string>>(new Set())

// Pending certifications (uploaded-but-not-certified copies we still hold a certificate for).
const pending = ref<Record<string, PendingCertify>>({})

// Per-object action state (keyed by Blob objectId), shared by Extend and Certify.
const busy = ref<string | null>(null)
const actionStatus = ref<Record<string, string>>({})
const extendAmount = ref<Record<string, number>>({})
const extendCostFrost = ref<Record<string, bigint | null>>({})

const MAX = MAX_SINGLE_RESERVATION_EPOCHS

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function maxAddable(endEpoch: number): number {
  return maxExtendableEpochs(endEpoch, currentEpoch.value, MAX)
}

/** The stored certificate for an uncertified copy, if we can certify it here. */
function pendingFor(objectId: string): PendingCertify | null {
  return pending.value[objectId] ?? null
}
/** The first pending (certifiable) copy in a group, if any. */
function groupPendingCopy(g: BlobGroup): OwnedBlob | null {
  return g.copies.find((c) => !c.certified && pending.value[c.objectId]) ?? null
}
/** Status shown in the Certified column for a group. */
function groupCertStatus(g: BlobGroup): 'certified' | 'pending' | 'none' {
  if (g.anyCertified) return 'certified'
  return groupPendingCopy(g) ? 'pending' : 'none'
}

function toggleExpand(blobId: string): void {
  const next = new Set(expanded.value)
  if (next.has(blobId)) next.delete(blobId)
  else next.add(blobId)
  expanded.value = next
}

function refresh(): Promise<void> {
  return load(props.address, { force: true })
}

/** Reload the pending map from storage, dropping entries whose blob is already certified. */
function refreshPending(): void {
  if (!props.address) {
    pending.value = {}
    return
  }
  const key = pendingCertifyKey(NETWORK, props.address)
  const map = loadPendingCertifies(window.localStorage, key)
  for (const blob of blobs.value) {
    if (blob.certified && blob.objectId in map) {
      clearPendingCertify(window.localStorage, key, blob.objectId)
      delete map[blob.objectId]
    }
  }
  pending.value = map
}

// ── Extend ──────────────────────────────────────────────────────────────────
let extendReq: Record<string, number> = {}

// User picked an amount → clamp and (re)price it. We estimate only on interaction, not for every row
// on load, to avoid spinning up a Walrus client per blob.
function setExtendAmount(blob: OwnedBlob, value: number | string): void {
  const max = maxAddable(blob.endEpoch)
  const v = Math.min(max, Math.max(1, Math.floor(Number(value) || 1)))
  extendAmount.value = { ...extendAmount.value, [blob.objectId]: v }
  void estimateExtend(blob, v)
}
async function estimateExtend(blob: OwnedBlob, epochs: number): Promise<void> {
  const id = blob.objectId
  const token = (extendReq[id] = (extendReq[id] ?? 0) + 1)
  try {
    const { createWalrusClient, estimateStorageCost } = await import('@meddleware/walrus-client')
    const walrusClient = createWalrusClient({ network: NETWORK, wasmUrl: walrusWasmUrl })
    // Extend adds storage only (no one-time write cost), so price the `storageCost` component.
    const cost = await estimateStorageCost(walrusClient, blob.size, epochs)
    if (extendReq[id] === token) {
      extendCostFrost.value = { ...extendCostFrost.value, [id]: cost.storageCost }
    }
  } catch {
    if (extendReq[id] === token) extendCostFrost.value = { ...extendCostFrost.value, [id]: null }
  }
}

async function extendBlob(blob: OwnedBlob): Promise<void> {
  const epochs = extendAmount.value[blob.objectId]
  if (!epochs || busy.value) return
  busy.value = blob.objectId
  actionStatus.value = { ...actionStatus.value, [blob.objectId]: 'Building transaction…' }
  try {
    const { createWalrusClient, extendBlobLifetimeTransaction } = await import('@meddleware/walrus-client')
    const walrusClient = createWalrusClient({ network: NETWORK, wasmUrl: walrusWasmUrl })
    const tx = await extendBlobLifetimeTransaction(walrusClient, blob.objectId, { epochs })
    const executor = await props.buildExecutor()
    actionStatus.value = { ...actionStatus.value, [blob.objectId]: 'Approve in wallet…' }
    const { digest } = await executor.signAndExecute(tx)
    await executor.waitForTransaction(digest)
    actionStatus.value = { ...actionStatus.value, [blob.objectId]: `Extended ✓ (${digest.slice(0, 8)}…)` }
    await refresh()
  } catch (e) {
    actionStatus.value = { ...actionStatus.value, [blob.objectId]: `Failed: ${msg(e)}` }
  } finally {
    busy.value = null
  }
}

// ── Certify (resume a pending upload from its stored certificate) ─────────────
async function certifyBlob(blob: OwnedBlob): Promise<void> {
  const entry = pendingFor(blob.objectId)
  if (!entry || !props.address || busy.value) return
  busy.value = blob.objectId
  actionStatus.value = { ...actionStatus.value, [blob.objectId]: 'Building transaction…' }
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
    actionStatus.value = { ...actionStatus.value, [blob.objectId]: 'Approve in wallet…' }
    const { digest } = await executor.signAndExecute(tx)
    await executor.waitForTransaction(digest)
    clearPendingCertify(window.localStorage, pendingCertifyKey(NETWORK, props.address), blob.objectId)
    actionStatus.value = { ...actionStatus.value, [blob.objectId]: `Certified ✓ (${digest.slice(0, 8)}…)` }
    await refresh()
  } catch (e) {
    actionStatus.value = { ...actionStatus.value, [blob.objectId]: `Failed: ${msg(e)}` }
  } finally {
    busy.value = null
  }
}

// Load on first open and whenever the address changes; re-derive pending on list/address changes.
onMounted(() => void load(props.address))
watch(() => props.address, (addr) => void load(addr))
watch(blobs, () => refreshPending())
watch(() => props.address, () => refreshPending())

// Seed each group's extend amount with a sensible default (+10, clamped) without pricing it — the
// estimate is fetched on the first user interaction.
watch(
  [groups, currentEpoch],
  () => {
    for (const g of groups.value) {
      const b = g.representative
      const max = maxAddable(b.endEpoch)
      if (max > 0 && extendAmount.value[b.objectId] === undefined) {
        extendAmount.value = { ...extendAmount.value, [b.objectId]: Math.min(10, max) }
      }
    }
  },
  { immediate: true },
)

// Highlight + expand the group routed from the duplicate-upload dialog.
watch(
  () => props.highlightBlobId,
  async (blobId) => {
    if (!blobId) return
    expanded.value = new Set(expanded.value).add(blobId)
    await nextTick()
    document.getElementById(`blob-row-${blobId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  },
  { immediate: true },
)
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
    <p v-else-if="!loading && groups.length === 0" class="hint">No Walrus blobs found for this address.</p>

    <table v-if="groups.length" class="blob-table">
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
        <template v-for="g in groups" :key="g.blobId">
          <tr
            :id="`blob-row-${g.blobId}`"
            :class="{ warn: g.maxEndEpoch - currentEpoch < 10, highlight: g.blobId === highlightBlobId }"
          >
            <td>
              <CopyableAddress :address="g.blobId" label="Copy blob ID">
                <ExplorerLink :href="walruscanBlobUrl(NETWORK, g.blobId)" :value="g.blobId" :chars="[8, 6]" />
              </CopyableAddress>
              <button
                v-if="g.copies.length > 1"
                type="button"
                class="copies-toggle"
                @click="toggleExpand(g.blobId)"
              >
                {{ expanded.has(g.blobId) ? '▾' : '▸' }} {{ g.copies.length }} copies
              </button>
            </td>
            <td>{{ (g.size / 1024).toFixed(1) }} KB</td>
            <td>{{ expiryLabel(g.maxEndEpoch, currentEpoch) }}</td>
            <td>
              <span v-if="groupCertStatus(g) === 'certified'">✓</span>
              <span v-else-if="groupCertStatus(g) === 'pending'" class="pending-badge" title="Uploaded but not certified">pending</span>
              <span v-else>—</span>
            </td>
            <td class="actions">
              <span v-if="actionStatus[g.representative.objectId]" class="act-status">
                {{ actionStatus[g.representative.objectId] }}
              </span>
              <template v-else>
                <button
                  v-if="groupPendingCopy(g)"
                  type="button"
                  class="certify-btn"
                  :disabled="!!busy"
                  @click="certifyBlob(groupPendingCopy(g)!)"
                >
                  Certify
                </button>
                <span v-if="maxAddable(g.representative.endEpoch) === 0" class="at-max">at max lifetime</span>
                <span v-else class="extend">
                  <input
                    type="number"
                    min="1"
                    :max="maxAddable(g.representative.endEpoch)"
                    :value="extendAmount[g.representative.objectId]"
                    aria-label="Epochs to add"
                    @input="setExtendAmount(g.representative, ($event.target as HTMLInputElement).value)"
                  />
                  <button type="button" class="preset" @click="setExtendAmount(g.representative, 10)">+10</button>
                  <button type="button" class="preset" @click="setExtendAmount(g.representative, 25)">+25</button>
                  <button
                    type="button"
                    class="preset"
                    @click="setExtendAmount(g.representative, maxAddable(g.representative.endEpoch))"
                  >
                    Max
                  </button>
                  <button type="button" :disabled="!!busy" @click="extendBlob(g.representative)">Extend</button>
                  <span v-if="extendCostFrost[g.representative.objectId] != null" class="est">
                    ≈{{ formatCoinAmount(extendCostFrost[g.representative.objectId]!, 'WAL') }}
                  </span>
                </span>
              </template>
            </td>
          </tr>

          <!-- Per-copy detail for grouped duplicates: certify a specific pending copy. -->
          <tr v-for="c in (expanded.has(g.blobId) ? g.copies : [])" :key="c.objectId" class="copy-row">
            <td class="copy-obj">
              <CopyableAddress :address="c.objectId" label="Copy object ID">
                <span class="mono">{{ c.objectId.slice(0, 10) }}…</span>
              </CopyableAddress>
            </td>
            <td></td>
            <td>{{ expiryLabel(c.endEpoch, currentEpoch) }}</td>
            <td>
              <span v-if="c.certified">✓</span>
              <span v-else-if="pendingFor(c.objectId)" class="pending-badge">pending</span>
              <span v-else>—</span>
            </td>
            <td class="actions">
              <span v-if="actionStatus[c.objectId]" class="act-status">{{ actionStatus[c.objectId] }}</span>
              <button
                v-else-if="pendingFor(c.objectId)"
                type="button"
                class="certify-btn"
                :disabled="!!busy"
                @click="certifyBlob(c)"
              >
                Certify
              </button>
            </td>
          </tr>
        </template>
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
  vertical-align: top;
}
.blob-table th {
  font-weight: 600;
  color: var(--mw-color-text-muted, #888);
}
.blob-table tr.warn td {
  background: color-mix(in srgb, var(--mw-color-warning, #f90) 8%, transparent);
}
.blob-table tr.highlight td {
  background: color-mix(in srgb, var(--accent, #6366f1) 14%, transparent);
}
.copy-row td {
  background: color-mix(in srgb, var(--mw-color-text-muted, #888) 6%, transparent);
  font-size: 0.82rem;
}
.copies-toggle {
  display: inline-block;
  margin-top: 0.25rem;
  font-size: 0.78rem;
  padding: 0.05rem 0.4rem;
}
.mono {
  font-family: monospace;
}
.actions {
  white-space: nowrap;
}
.extend {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.extend input {
  width: 4rem;
}
.preset {
  font-size: 0.75rem;
  padding: 0.1rem 0.4rem;
}
.est {
  font-size: 0.78rem;
  color: var(--mw-color-text-muted, #888);
}
.at-max {
  font-size: 0.8rem;
  color: var(--mw-color-text-muted, #888);
}
.act-status {
  font-size: 0.85rem;
  color: var(--mw-color-text-muted, #888);
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
