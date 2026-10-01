<script setup lang="ts">
// Core Walrus tool UI (upload + owned-blob management), free of any app shell (header/footer).
// Rendered standalone by walrus-ui's App.vue and inline by the dashboard. Wallet state comes
// from the shared @meddleware/wallet-adapter singleton (via ./wallet.js), so connecting here or
// in any other inline tool view reflects everywhere.
import { computed, ref, watch } from 'vue'
import {
  WalrusUpload,
  AccessGateCta,
  useAccessGate,
} from '@meddleware/walrus-relay'
import { AppTabNav, CopyableAddress, ExplorerLink, UiNotice, UiTabPanel, UiToolIntro, suiExplorerUrl, safeHref, type AppTab } from '@meddleware/ui'
// Lightweight URL import — just the wasm asset URL (does not pull the walrus client).
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import { WalletGuard } from '@meddleware/wallet-adapter'
import { useWallet, getSuiClient } from '../wallet.js'
import { network, walrusNetwork, relayHosts, accessGate, uploadRelayMaxTipMist, walruscanBlobUrl } from '../config.js'
import {
  runBlobUpload,
  createGatedAccess,
  consumeStorageKey,
  pendingCertifyKey,
  savePendingCertify,
  clearPendingCertify,
  loadPendingCertifies,
  type BlobUploadResult as UploadResult,
  type ExistingCopy,
  type UploadProgress,
} from '@meddleware/walrus-client/flow'
import { useOwnedBlobs } from '../composables/useOwnedBlobs.js'
import MyBlobs from './MyBlobs.vue'

const TABS: AppTab[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'blobs', label: 'My Blobs' },
]
const activeTab = ref<string>('upload')

const { account, signPersonalMessage, buildExecutor } = useWallet()

// One access-gate state per Walrus network (the gate is a per-network setting); the active
// network's is used. Each is inert until an ownership check runs.
const gateStates = {
  testnet: useAccessGate({ gate: accessGate('testnet'), getClient: () => getSuiClient() }),
  mainnet: useAccessGate({ gate: accessGate('mainnet'), getClient: () => getSuiClient() }),
}
/** The active network's gate state (testnet's while the view is hidden on a non-Walrus network). */
const gateState = computed(() => gateStates[walrusNetwork.value ?? 'testnet'])
const purchasing = ref(false)
const result = ref<UploadResult | null>(null)

// Check gate ownership whenever the connected account or the network changes. A switched or
// disconnected wallet never inherits the previous wallet's access state: `reset()` also discards
// any in-flight check.
watch(
  [() => account.value?.address ?? null, walrusNetwork],
  ([addr], previous) => {
    const prevAddr = previous?.[0] ?? null
    if (addr !== prevAddr) for (const s of Object.values(gateStates)) s.reset()
    else gateState.value.reset()
    result.value = null
    if (addr && walrusNetwork.value && gateState.value.gate) void gateState.value.checkOwnership(addr)
  },
  { immediate: true },
)

async function onPurchase(): Promise<void> {
  if (!account.value) return
  purchasing.value = true
  try {
    const executor = await buildExecutor()
    await gateState.value.purchase(executor, account.value.address)
  } finally {
    purchasing.value = false
  }
}

// Wire the shared WalrusUpload widget to walrus-client's upload orchestrator and the wallet. The
// orchestrator registers fresh on every attempt (the relay rejects an old register transaction),
// and, for a gated relay, `createGatedAccess` keeps the single-use consume resumable: its digest is
// persisted before the upload, reused after an interruption, cleared once the upload lands, and
// replaced only after the gateway reports it redeemed.
async function performUpload(
  bytes: Uint8Array,
  opts: {
    relayHost: string
    epochs: number
    force?: boolean
    deletable?: boolean
    onStatus: (s: string | UploadProgress) => void
  },
): Promise<UploadResult> {
  if (!account.value) throw new Error('Connect your wallet first.')
  const net = walrusNetwork.value
  if (!net) throw new Error(`Walrus storage is not available on ${network.value}.`)
  const executor = await buildExecutor()
  const address = account.value.address
  const storage = window.localStorage
  const state = gateState.value
  const gate = state.gate
  const nftId = state.nftId.value

  const access =
    gate && state.hasAccess.value === true && nftId
      ? createGatedAccess({
          storage,
          key: consumeStorageKey(net, gate.gateId, address),
          relayHost: opts.relayHost,
          address,
          nftId,
          singleUse: state.usesRemaining.value !== null,
          buildConsume: (id, nonce) => state.buildConsume(id, nonce),
          signAndExecute: (tx) => executor.signAndExecute(tx),
          waitForTransaction: (digest) => executor.waitForTransaction(digest),
          sign: signPersonalMessage,
          onStatus: opts.onStatus,
        })
      : undefined

  return runBlobUpload({
    bytes,
    network: net,
    relayHost: opts.relayHost,
    address,
    wasmUrl: walrusWasmUrl,
    maxTipMist: uploadRelayMaxTipMist(),
    epochs: opts.epochs,
    deletable: opts.deletable,
    force: opts.force,
    findExistingCopy,
    executor,
    suiClient: getSuiClient(),
    access,
    onStatus: opts.onStatus,
    // Persist the certificate the moment the upload lands, and drop it once certified — so a
    // dismissed certify can be finished from My Blobs after a tab switch or reload.
    onUploaded: (info) => savePendingCertify(storage, pendingCertifyKey(net, address), info),
    onCertified: (blobObjectId) => clearPendingCertify(storage, pendingCertifyKey(net, address), blobObjectId),
  })
}

// Precheck (before paying to register): does the wallet already own this exact blob? Returns a
// `certified` match (offer Extend) or a `pending` one — uncertified but with a saved certificate
// (offer Certify). Best-effort: any failure returns null so the upload simply proceeds.
async function findExistingCopy(blobId: string): Promise<ExistingCopy | null> {
  const address = account.value?.address
  const net = walrusNetwork.value
  if (!address || !net) return null
  try {
    const { createWalrusClient, fetchOwnedWalrusBlobs } = await import('@meddleware/walrus-client')
    const walrusClient = createWalrusClient({ network: net, wasmUrl: walrusWasmUrl })
    const [sys, owned] = await Promise.all([
      walrusClient.walrus.systemState(),
      fetchOwnedWalrusBlobs(getSuiClient(), walrusClient, address),
    ])
    const currentEpoch = Number(sys.committee.epoch)
    const copies = owned.filter((b) => b.blobId === blobId && b.endEpoch > currentEpoch)
    const certified = copies.find((b) => b.certified)
    if (certified) {
      return { kind: 'certified', blobId, objectId: certified.objectId, endEpoch: certified.endEpoch }
    }
    const store = loadPendingCertifies(window.localStorage, pendingCertifyKey(net, address))
    const pending = copies.find((b) => !b.certified && b.objectId in store)
    if (pending) {
      return { kind: 'pending', blobId, objectId: pending.objectId, endEpoch: pending.endEpoch }
    }
    return null
  } catch {
    return null
  }
}

// Injected into the upload widget so it can price a chosen reservation duration (storage is WAL,
// billed per size × epochs). Returns total cost in FROST, or null on error.
async function estimateUploadStorageCost(sizeBytes: number, epochs: number): Promise<bigint | null> {
  const net = walrusNetwork.value
  if (!net) return null
  try {
    const { createWalrusClient, estimateStorageCost } = await import('@meddleware/walrus-client')
    const walrusClient = createWalrusClient({ network: net, wasmUrl: walrusWasmUrl })
    const cost = await estimateStorageCost(walrusClient, sizeBytes, epochs)
    return cost.totalCost
  } catch {
    return null
  }
}

// The user declined a duplicate upload and chose to manage the existing copy: jump to My Blobs and
// highlight it (the grouped row exposes Extend for certified, Certify for pending).
const highlightBlobId = ref<string | null>(null)
function onManageExisting(existing: ExistingCopy): void {
  highlightBlobId.value = existing.blobId
  activeTab.value = 'blobs'
}

const ownedBlobs = useOwnedBlobs()

function onUploaded(r: UploadResult): void {
  result.value = r
}

// Fires after every upload attempt (success or failure) — a failed UI run may still have landed
// on-chain, so force-refresh the owned-blobs cache and NFT ownership (uses remaining) in the
// background regardless of outcome.
function onSettled(): void {
  if (account.value) {
    void ownedBlobs.load(account.value.address, { force: true })
    if (gateState.value.gate) void gateState.value.checkOwnership(account.value.address)
  }
}
</script>

<template>
    <UiToolIntro>Upload and manage blobs on Walrus decentralised storage ({{ network }}).</UiToolIntro>

    <UiNotice v-if="!walrusNetwork" type="info">Walrus storage is not available on {{ network }}. Switch to testnet or mainnet.</UiNotice>
    <template v-else>

    <AppTabNav v-model="activeTab" :tabs="TABS" id-prefix="walrus" aria-label="Feature tabs" class="walrus-tabs" />

    <!-- The tab list and its panel always render (the selected tab controls a live panel); the wallet
         prompt replaces only the panel's content until a wallet is connected. -->
    <UiTabPanel id-prefix="walrus" :tab="activeTab">
      <WalletGuard message="Connect a Sui wallet to upload and manage your blobs.">
        <template v-if="activeTab === 'upload'">
          <!-- Gated + no access: replace the form with the purchase CTA so the user is guided to buy
               first, rather than facing a disabled form. -->
          <div v-if="gateState.gateConfigured && gateState.hasAccess.value === false" class="gate-card">
            <AccessGateCta
              :gate-configured="gateState.gateConfigured"
              :has-access="gateState.hasAccess.value"
              :busy="purchasing"
              :price-mist="gateState.gate?.priceMist ?? null"
              @purchase="onPurchase"
            />
          </div>

          <!-- Ownership check still in flight. -->
          <p
            v-else-if="gateState.gateConfigured && gateState.hasAccess.value === null"
            class="checking"
          >
            Checking access…
          </p>

          <!-- Access held (or ungated relay): show the upload form. -->
          <template v-else>
            <!-- Gated relays spend a credit before the file is stored — make the "attempt, not a
                 guarantee" nature explicit, while reassuring that attempts resume. -->
            <UiNotice v-if="gateState.gateConfigured" type="info" class="credit-notice">
              Uploading spends <strong>one credit</strong> from your access NFT (an on-chain step)
              before the file is stored — it pays for an upload <em>attempt</em>, not a guaranteed
              upload. Your attempt resumes automatically, even after a page reload if you re-select
              the same file, so a credit is normally not lost. A credit is spent without a completed
              upload only if you abandon the upload entirely, cancel a required wallet approval, or
              wait long enough that the reserved storage lapses.
            </UiNotice>

            <WalrusUpload
              :hosts="relayHosts(walrusNetwork)"
              :connected="!!account"
              :access="{ gateConfigured: gateState.gateConfigured, hasAccess: gateState.hasAccess }"
              :perform-upload="performUpload"
              :estimate-storage-cost="estimateUploadStorageCost"
              @uploaded="onUploaded"
              @settled="onSettled"
              @manage-existing="onManageExisting"
            />

            <section v-if="result" class="result">
              <h2>Uploaded ✓</h2>
              <p>
                <strong>Blob ID:</strong>
                <CopyableAddress :address="result.blobId" label="Copy blob ID">
                  <ExplorerLink
                    :href="walruscanBlobUrl(walrusNetwork, result.blobId)"
                    :value="result.blobId"
                    :chars="[8, 6]"
                  />
                </CopyableAddress>
              </p>
              <p>
                <strong>URL:</strong>
                <a :href="safeHref(result.url)" target="_blank" rel="noopener noreferrer">{{ result.url }}</a>
              </p>
              <p v-if="result.digest">
                <strong>Certify tx:</strong>
                <CopyableAddress :address="result.digest" label="Copy transaction digest">
                  <ExplorerLink
                    :href="suiExplorerUrl('txblock', result.digest, walrusNetwork)"
                    :value="result.digest"
                    :chars="[8, 6]"
                  />
                </CopyableAddress>
              </p>
            </section>
          </template>
        </template>

        <MyBlobs
          v-if="activeTab === 'blobs'"
          :address="account?.address ?? null"
          :build-executor="() => buildExecutor()"
          :highlight-blob-id="highlightBlobId"
        />
      </WalletGuard>
    </UiTabPanel>
    </template>
</template>

<style scoped>
.walrus-tabs {
  margin: 1rem 0 0.5rem;
}
.result {
  margin-top: 1.5rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  word-break: break-all;
}

.result code {
  font-size: 0.85rem;
}

.gate-card {
  margin-top: 1rem;
  padding: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface, transparent);
  text-align: center;
}

.checking {
  margin-top: 1.5rem;
  color: var(--muted);
  text-align: center;
}

.credit-notice {
  margin: 1rem 0;
  font-size: 0.85rem;
  line-height: 1.5;
}

</style>
