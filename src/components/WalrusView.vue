<script setup lang="ts">
// Core Walrus tool UI (upload + owned-blob management), free of any app shell (header/footer).
// Rendered standalone by walrus-ui's App.vue and inline by the dashboard. Wallet state comes
// from the shared @meddleware/wallet-adapter singleton (via ./wallet.js), so connecting here or
// in any other inline tool view reflects everywhere.
import { ref, watch } from 'vue'
import {
  WalrusUpload,
  AccessGateCta,
  useAccessGate,
} from '@meddleware/walrus-relay'
import type { UploadResult, UploadProgress, ExistingCopy } from '@meddleware/walrus-relay'
import { AppTabNav, CopyableAddress, ExplorerLink, UiNotice, suiExplorerUrl, safeHref, type AppTab } from '@meddleware/ui'
// Lightweight URL import — just the wasm asset URL (does not pull the walrus client).
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import { WalletGuard } from '@meddleware/wallet-adapter'
import { useWallet, getSuiClient } from '../wallet.js'
import { fetchChallenge, buildAccessProof } from '@meddleware/nft-gate-client'
import { NETWORK, relayHosts, accessGate, uploadRelayMaxTipMist, walruscanBlobUrl } from '../config.js'
import { runBlobUpload } from '../upload-flow.js'
import { getCertifyRetry } from '@meddleware/walrus-relay'
import {
  consumeStorageKey,
  isRedeemedConflict,
  resolveGatedAuthToken,
} from '../access-resume.js'
import {
  pendingCertifyKey,
  savePendingCertify,
  clearPendingCertify,
  loadPendingCertifies,
} from '../certify-resume.js'
import { useOwnedBlobs } from '../composables/useOwnedBlobs.js'
import MyBlobs from './MyBlobs.vue'

const TABS: AppTab[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'blobs', label: 'My Blobs' },
]
const activeTab = ref<string>('upload')

const { account, signPersonalMessage, buildExecutor } = useWallet()

const gate = accessGate(NETWORK)
const gateState = useAccessGate({ gate, getClient: () => getSuiClient() })
const purchasing = ref(false)
const result = ref<UploadResult | null>(null)

// Check gate ownership whenever the connected account changes (handles connect, reconnect,
// and disconnect without needing a manual trigger from the connect button).
watch(
  () => account.value?.address ?? null,
  (addr) => { if (addr && gate) void gateState.checkOwnership(addr) },
  { immediate: true },
)

async function onPurchase(): Promise<void> {
  if (!account.value) return
  purchasing.value = true
  try {
    const executor = await buildExecutor()
    await gateState.purchase(executor, account.value.address)
  } finally {
    purchasing.value = false
  }
}

// Wire the shared WalrusUpload widget to the extracted upload orchestration + the wallet. The
// register/upload/certify sequence lives in src/upload-flow.ts (unit-tested); this closure gathers
// the wallet-bound inputs and manages the single-use consume resume layer:
//   Single-use consume: the relay treats the permanent on-chain `consumeDigest` as the one-time
//   redemption token, so a use is only spent when an upload succeeds. The digest is persisted and
//   reused across retries/reload (re-signing a fresh challenge is free); cleared on success.
// The Walrus registration is NOT resumed — with an upload relay the tip + nonce live in the register
// transaction and the relay requires it to be recent, so every attempt registers fresh (see
// upload-flow.ts). Reusing a prior registration is what produced "the received transaction is too old".
async function performUpload(
  bytes: Uint8Array,
  opts: {
    relayHost: string
    epochs: number
    force?: boolean
    onStatus: (s: string | UploadProgress) => void
  },
): Promise<UploadResult> {
  if (!account.value) throw new Error('Connect your wallet first.')
  const executor = await buildExecutor()
  const address = account.value.address
  const storage = window.localStorage

  const gated = !!(gate && gateState.hasAccess.value === true && gateState.nftId.value)
  const consumeKey = gate ? consumeStorageKey(NETWORK, gate.gateId, address) : null

  // Gated uploads spend one NFT use on-chain before the core flow — surface it as the leading
  // "Access" step so the stepper reflects the extra wallet approval (a reused consume is instant).
  if (gated) opts.onStatus({ step: 'access', detail: 'Confirming access…' })

  // Resolve this attempt's relay token (gated only); reuses a stored consume, fresh challenge each time.
  const token = (forceFresh: boolean): Promise<string | undefined> =>
    !gated
      ? Promise.resolve(undefined)
      : resolveGatedAuthToken({
          storage,
          key: consumeKey as string,
          relayHost: opts.relayHost,
          address,
          nftId: gateState.nftId.value as string,
          fetchChallenge,
          buildConsume: (id, nonce) => gateState.buildConsume(id, nonce),
          signAndExecute: (tx) => executor.signAndExecute(tx),
          waitForTransaction: (digest) => executor.waitForTransaction(digest),
          buildAccessProof,
          sign: signPersonalMessage,
          forceFresh,
        })

  const runOnce = async (authToken: string | undefined): Promise<UploadResult> => {
    try {
      const r = await runBlobUpload({
        bytes,
        network: NETWORK,
        relayHost: opts.relayHost,
        address,
        wasmUrl: walrusWasmUrl,
        maxTipMist: uploadRelayMaxTipMist(),
        epochs: opts.epochs,
        force: opts.force,
        findExistingCopy,
        executor,
        suiClient: getSuiClient(),
        authToken,
        onStatus: opts.onStatus,
        // Persist the certificate the moment the upload lands, and drop it once certified — so a
        // dismissed certify can be finished from My Blobs after a tab switch or reload.
        onUploaded: (info) =>
          savePendingCertify(storage, pendingCertifyKey(NETWORK, address), info),
        onCertified: (blobObjectId) =>
          clearPendingCertify(storage, pendingCertifyKey(NETWORK, address), blobObjectId),
      })
      // Success → clear the consume layer (the use is now genuinely spent for an upload).
      if (consumeKey) storage.removeItem(consumeKey)
      return r
    } catch (e) {
      // A certify-only failure means the upload already landed (relay access was used), so clear the
      // consume too — the certify retry is a plain Sui tx and must not trigger a fresh NFT consume.
      if (getCertifyRetry(e) && consumeKey) storage.removeItem(consumeKey)
      throw e
    }
  }

  try {
    return await runOnce(await token(false))
  } catch (e) {
    if (gated && isRedeemedConflict(e)) {
      // Stored consume already redeemed (a prior upload actually landed): clear it, spend a fresh
      // use, and retry.
      storage.removeItem(consumeKey as string)
      return await runOnce(await token(true))
    }
    throw e
  }
}

// Precheck (before paying to register): does the wallet already own this exact blob? Returns a
// `certified` match (offer Extend) or a `pending` one — uncertified but with a saved certificate
// (offer Certify). Best-effort: any failure returns null so the upload simply proceeds.
async function findExistingCopy(blobId: string): Promise<ExistingCopy | null> {
  const address = account.value?.address
  if (!address) return null
  try {
    const { createWalrusClient, fetchOwnedWalrusBlobs } = await import('@meddleware/walrus-client')
    const walrusClient = createWalrusClient({ network: NETWORK, wasmUrl: walrusWasmUrl })
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
    const store = loadPendingCertifies(window.localStorage, pendingCertifyKey(NETWORK, address))
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
  try {
    const { createWalrusClient, estimateStorageCost } = await import('@meddleware/walrus-client')
    const walrusClient = createWalrusClient({ network: NETWORK, wasmUrl: walrusWasmUrl })
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
    void gateState.checkOwnership(account.value.address)
  }
}
</script>

<template>
  <div class="page">
    <p class="sub">Upload and manage blobs on Walrus decentralised storage ({{ NETWORK }}).</p>

    <AppTabNav :tabs="TABS" v-model="activeTab" aria-label="Feature tabs" style="margin: 1rem 0 0.5rem" />

    <WalletGuard message="Connect a Sui wallet to upload and manage your blobs.">
      <template v-if="activeTab === 'upload'">
        <!-- Gated + no access: replace the form with the purchase CTA so the user is guided to buy
             first, rather than facing a disabled form. -->
        <div v-if="gateState.gateConfigured && gateState.hasAccess.value === false" class="gate-card">
          <AccessGateCta
            :gate-configured="gateState.gateConfigured"
            :has-access="gateState.hasAccess.value"
            :busy="purchasing"
            :price-mist="gate?.priceMist ?? null"
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
            :hosts="relayHosts(NETWORK)"
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
                  :href="walruscanBlobUrl(NETWORK, result.blobId)"
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
                  :href="suiExplorerUrl('txblock', result.digest, NETWORK)"
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
  </div>
</template>

<style scoped>
.page {
  max-width: 640px;
  margin: 0 auto;
  padding: 2rem 1.25rem 4rem;
  flex: 1;
}

.sub {
  color: var(--muted);
  margin: 0.25rem 0 0;
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
