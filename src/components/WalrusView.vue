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
  MAX_SINGLE_RESERVATION_EPOCHS,
} from '@meddleware/walrus-relay'
import type { UploadResult } from '@meddleware/walrus-relay'
import { CopyableAddress, ExplorerLink, UiNotice, suiExplorerUrl } from '@meddleware/ui'
// Lightweight URL import — just the wasm asset URL (does not pull the walrus client).
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import { WalletGuard } from '@meddleware/wallet-adapter'
import { useWallet, getSuiClient } from '../wallet.js'
import { fetchChallenge, buildAccessProof } from '@meddleware/nft-gate-client'
import { NETWORK, relayHosts, accessGate, uploadRelayMaxTipMist, walruscanBlobUrl } from '../config.js'
import { runBlobUpload } from '../upload-flow.js'
import {
  consumeStorageKey,
  isRedeemedConflict,
  resolveGatedAuthToken,
  registerStorageKey,
  contentKey,
  loadRegisterResume,
  saveRegisterResume,
  clearRegisterResume,
} from '../access-resume.js'
import { useOwnedBlobs } from '../composables/useOwnedBlobs.js'
import MyBlobs from './MyBlobs.vue'

type Tab = 'upload' | 'blobs'
const activeTab = ref<Tab>('upload')

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
// the wallet-bound inputs and manages two resume layers so an interrupted upload wastes nothing —
// both persisted in localStorage, so they survive a page reload once the same file is re-selected:
//   1. Single-use consume: the relay treats the permanent on-chain `consumeDigest` as the one-time
//      redemption token, so a use is only spent when an upload succeeds. The digest is persisted and
//      reused across retries/reload (re-signing a fresh challenge is free); cleared on success.
//   2. Walrus register: a registered-but-not-uploaded blob is resumed by its persisted register
//      digest (matched to the re-selected file by content hash), skipping the register transaction
//      (no new WAL/gas). Cleared on success, or when a resumed attempt itself fails (fall back to a
//      fresh register).
async function performUpload(
  bytes: Uint8Array,
  opts: { relayHost: string; onStatus: (s: string) => void },
): Promise<UploadResult> {
  if (!account.value) throw new Error('Connect your wallet first.')
  const executor = await buildExecutor()
  const address = account.value.address
  const key = contentKey(bytes)
  const storage = window.localStorage

  const gated = !!(gate && gateState.hasAccess.value === true && gateState.nftId.value)
  const consumeKey = gate ? consumeStorageKey(NETWORK, gate.gateId, address) : null
  const regKey = registerStorageKey(NETWORK, address)

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
    // Resume the register step iff a digest was saved for THIS exact file (survives reload).
    const resumeRegisterDigest = loadRegisterResume(storage, regKey, key) ?? undefined
    try {
      const r = await runBlobUpload({
        bytes,
        network: NETWORK,
        relayHost: opts.relayHost,
        address,
        wasmUrl: walrusWasmUrl,
        maxTipMist: uploadRelayMaxTipMist(),
        epochs: MAX_SINGLE_RESERVATION_EPOCHS,
        executor,
        suiClient: getSuiClient(),
        authToken,
        onStatus: opts.onStatus,
        resumeRegisterDigest,
        onRegistered: (digest) => saveRegisterResume(storage, regKey, key, digest),
      })
      // Success → clear both resume layers (the use is now genuinely spent for an upload).
      clearRegisterResume(storage, regKey)
      if (consumeKey) storage.removeItem(consumeKey)
      return r
    } catch (e) {
      // A resumed attempt that fails drops the saved register digest so the next try does a full
      // fresh register (never worse than today). A non-resumed failure keeps the digest that
      // onRegistered saved, so the next try (or a reload + re-select) resumes without re-registering.
      if (resumeRegisterDigest !== undefined) clearRegisterResume(storage, regKey)
      throw e
    }
  }

  try {
    return await runOnce(await token(false))
  } catch (e) {
    if (gated && isRedeemedConflict(e)) {
      // Stored consume already redeemed (a prior upload actually landed): clear it, spend a fresh
      // use, and retry — resuming the registered blob if one is still saved for this file.
      storage.removeItem(consumeKey as string)
      return await runOnce(await token(true))
    }
    throw e // keep the saved register digest so a manual retry / reload resumes
  }
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

    <nav class="tabs" aria-label="Feature tabs">
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'upload' }"
        @click="activeTab = 'upload'"
      >
        Upload
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'blobs' }"
        @click="activeTab = 'blobs'"
      >
        My Blobs
      </button>
    </nav>

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
          <!-- Gated relays spend a use before the file is stored — make the "attempt, not a
               guarantee" nature explicit, while reassuring that attempts resume. -->
          <UiNotice v-if="gateState.gateConfigured" type="info" class="use-notice">
            Uploading spends <strong>one use</strong> of your access NFT (an on-chain step) before
            the file is stored — it pays for an upload <em>attempt</em>, not a guaranteed upload.
            Your attempt resumes automatically, even after a page reload if you re-select the same
            file, so a use is normally not lost. A use is spent without a completed upload only if
            you abandon the upload entirely, cancel a required wallet approval, or wait long enough
            that the reserved storage lapses.
          </UiNotice>

          <WalrusUpload
            :hosts="relayHosts(NETWORK)"
            :connected="!!account"
            :access="{ gateConfigured: gateState.gateConfigured, hasAccess: gateState.hasAccess }"
            :perform-upload="performUpload"
            @uploaded="onUploaded"
            @settled="onSettled"
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
              <a :href="result.url" target="_blank" rel="noopener">{{ result.url }}</a>
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

.use-notice {
  margin: 1rem 0;
  font-size: 0.85rem;
  line-height: 1.5;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  margin: 1rem 0 0.5rem;
  border-bottom: 2px solid var(--border);
}

.tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0.5rem 1rem;
  margin-bottom: -2px;
  cursor: pointer;
  font-size: 0.95rem;
  color: var(--muted);
}

.tab.active {
  border-bottom-color: var(--accent);
  color: var(--text);
  font-weight: 600;
}
</style>
