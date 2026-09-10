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
// Lightweight URL import — just the wasm asset URL (does not pull the walrus client).
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import { WalletGuard } from '@meddleware/wallet-adapter'
import { useWallet, getSuiClient } from '../wallet.js'
import { fetchChallenge, buildAccessProof } from '@meddleware/nft-gate-client'
import { NETWORK, relayHosts, accessGate, uploadRelayMaxTipMist } from '../config.js'
import { runBlobUpload } from '../upload-flow.js'
import { consumeStorageKey, isRedeemedConflict, resolveGatedAuthToken } from '../access-resume.js'
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
// register/upload/certify sequence lives in src/upload-flow.ts (unit-tested); this closure only
// gathers the wallet-bound inputs (executor, sui client, gated proof token) and delegates.
//
// Single-use resume: the relay treats the permanent on-chain `consumeDigest` as the one-time
// redemption token, so a use is only spent when an upload succeeds. We persist the digest before
// uploading and reuse it on retry/reload (re-signing a fresh challenge is free) — an interrupted
// upload never burns a use. On success we clear it; if the relay reports the digest already
// redeemed (a prior upload actually landed), we clear and consume a fresh use once.
async function performUpload(
  bytes: Uint8Array,
  opts: { relayHost: string; onStatus: (s: string) => void },
): Promise<UploadResult> {
  if (!account.value) throw new Error('Connect your wallet first.')
  const executor = await buildExecutor()
  const address = account.value.address

  // Ungated relay: no consume, straight upload.
  if (!(gate && gateState.hasAccess.value === true && gateState.nftId.value)) {
    return runBlobUpload(uploadDeps(bytes, opts, executor, undefined))
  }

  const nftId = gateState.nftId.value
  const key = consumeStorageKey(NETWORK, gate.gateId, address)
  const resolve = (forceFresh: boolean) =>
    resolveGatedAuthToken({
      storage: window.localStorage,
      key,
      relayHost: opts.relayHost,
      address,
      nftId,
      fetchChallenge,
      buildConsume: (id, nonce) => gateState.buildConsume(id, nonce),
      signAndExecute: (tx) => executor.signAndExecute(tx),
      waitForTransaction: (digest) => executor.waitForTransaction(digest),
      buildAccessProof,
      sign: signPersonalMessage,
      forceFresh,
    })

  try {
    const authToken = await resolve(false)
    const result = await runBlobUpload(uploadDeps(bytes, opts, executor, authToken))
    window.localStorage.removeItem(key) // upload succeeded → the use is now spent
    return result
  } catch (e) {
    if (!isRedeemedConflict(e)) throw e // transient failure → keep the digest so the next try resumes
    // The stored consume was already redeemed (a prior upload actually landed). Clear it and spend
    // one fresh use for this new upload.
    window.localStorage.removeItem(key)
    const authToken = await resolve(true)
    const result = await runBlobUpload(uploadDeps(bytes, opts, executor, authToken))
    window.localStorage.removeItem(key)
    return result
  }
}

/** Assemble the register→upload→certify inputs for {@link runBlobUpload}. */
function uploadDeps(
  bytes: Uint8Array,
  opts: { relayHost: string; onStatus: (s: string) => void },
  executor: Awaited<ReturnType<typeof buildExecutor>>,
  authToken: string | undefined,
) {
  if (!account.value) throw new Error('Connect your wallet first.')
  return {
    bytes,
    network: NETWORK,
    relayHost: opts.relayHost,
    address: account.value.address,
    wasmUrl: walrusWasmUrl,
    maxTipMist: uploadRelayMaxTipMist(),
    epochs: MAX_SINGLE_RESERVATION_EPOCHS,
    executor,
    suiClient: getSuiClient(),
    authToken,
    onStatus: opts.onStatus,
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
        <AccessGateCta
          :gate-configured="gateState.gateConfigured"
          :has-access="gateState.hasAccess.value"
          :busy="purchasing"
          :price-mist="gate?.priceMist ?? null"
          @purchase="onPurchase"
        />

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
          <p><strong>Blob ID:</strong> <code>{{ result.blobId }}</code></p>
          <p>
            <strong>URL:</strong>
            <a :href="result.url" target="_blank" rel="noopener">{{ result.url }}</a>
          </p>
          <p v-if="result.digest"><strong>Certify tx:</strong> <code>{{ result.digest }}</code></p>
        </section>
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
