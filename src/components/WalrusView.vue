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
import { CopyableAddress, ExplorerLink, suiExplorerUrl } from '@meddleware/ui'
// Lightweight URL import — just the wasm asset URL (does not pull the walrus client).
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import { WalletGuard } from '@meddleware/wallet-adapter'
import { useWallet, getSuiClient } from '../wallet.js'
import { fetchChallenge, buildAccessProof } from '@meddleware/nft-gate-client'
import { NETWORK, relayHosts, accessGate, uploadRelayMaxTipMist, walruscanBlobUrl } from '../config.js'
import { runBlobUpload, type UploadResumeState } from '../upload-flow.js'
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

// The relay auth token for the current attempt. The walrus client reads it PER REQUEST (a provider),
// so a retained flow resumed after a failure presents a fresh challenge signature. Undefined ⇒
// ungated (no header).
const authTokenRef = ref<string | undefined>(undefined)
// A same-session registered blob retained after a failed upload, keyed by file content, so a retry
// resumes from the relay upload instead of re-registering (no new WAL/gas). Cleared on success or
// when a resumed attempt itself fails (fall back to a fresh full upload).
const uploadSession = ref<{ key: string; state: UploadResumeState } | null>(null)

/** Cheap content key (length + head/tail bytes) to match a retry to the same selected file. */
function contentKey(bytes: Uint8Array): string {
  const head = Array.from(bytes.slice(0, 16)).join(',')
  const tail = Array.from(bytes.slice(-16)).join(',')
  return `${bytes.length}:${head}:${tail}`
}

// Wire the shared WalrusUpload widget to the extracted upload orchestration + the wallet. The
// register/upload/certify sequence lives in src/upload-flow.ts (unit-tested); this closure gathers
// the wallet-bound inputs and manages two resume layers so an interrupted upload wastes nothing:
//   1. Single-use consume: the relay treats the permanent on-chain `consumeDigest` as the one-time
//      redemption token, so a use is only spent when an upload succeeds. The digest is persisted and
//      reused across retries/reload (re-signing a fresh challenge is free); cleared on success.
//   2. Walrus flow (same session): a registered-but-not-uploaded blob is retained and reused on a
//      retry of the same file, skipping re-encode/re-register (no new WAL/gas).
async function performUpload(
  bytes: Uint8Array,
  opts: { relayHost: string; onStatus: (s: string) => void },
): Promise<UploadResult> {
  if (!account.value) throw new Error('Connect your wallet first.')
  const executor = await buildExecutor()
  const address = account.value.address
  const key = contentKey(bytes)

  const gated = !!(gate && gateState.hasAccess.value === true && gateState.nftId.value)
  const consumeKey = gate ? consumeStorageKey(NETWORK, gate.gateId, address) : null

  // Resolve this attempt's relay token (gated only) and stash it where the client reads it.
  async function setToken(forceFresh: boolean): Promise<void> {
    if (!gated) {
      authTokenRef.value = undefined
      return
    }
    authTokenRef.value = await resolveGatedAuthToken({
      storage: window.localStorage,
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
  }

  const deps = (resume?: UploadResumeState) => ({
    bytes,
    network: NETWORK,
    relayHost: opts.relayHost,
    address,
    wasmUrl: walrusWasmUrl,
    maxTipMist: uploadRelayMaxTipMist(),
    epochs: MAX_SINGLE_RESERVATION_EPOCHS,
    executor,
    suiClient: getSuiClient(),
    // Provider: resolved per request so a resumed flow uses the fresh token.
    authToken: () => authTokenRef.value,
    onStatus: opts.onStatus,
    resume,
    onRegistered: (state: UploadResumeState) => {
      uploadSession.value = { key, state }
    },
  })

  const succeed = (r: UploadResult): UploadResult => {
    uploadSession.value = null
    if (consumeKey) window.localStorage.removeItem(consumeKey) // use spent only on success
    return r
  }

  // Reuse a retained registration for this exact file, if any.
  const resumeFor = () => (uploadSession.value?.key === key ? uploadSession.value.state : undefined)
  const wasResuming = resumeFor() !== undefined

  await setToken(false)
  try {
    return succeed(await runBlobUpload(deps(resumeFor())))
  } catch (e) {
    // A resumed attempt failed → drop the retained registration so the next try does a full fresh
    // upload (re-register), guaranteeing behaviour no worse than a non-resumed run.
    if (wasResuming) uploadSession.value = null

    if (gated && isRedeemedConflict(e)) {
      // Stored consume already redeemed (a prior upload actually landed): clear it, spend a fresh
      // use, and retry — resuming the registered blob if we still hold it.
      window.localStorage.removeItem(consumeKey as string)
      await setToken(true)
      const resume2 = resumeFor()
      try {
        return succeed(await runBlobUpload(deps(resume2)))
      } catch (e2) {
        if (resume2) uploadSession.value = null
        throw e2
      }
    }
    throw e // keep the retained registration so a manual retry resumes
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
