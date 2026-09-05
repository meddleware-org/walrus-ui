<script setup lang="ts">
import { ref } from 'vue'
import {
  WalrusUpload,
  TipConfigBadge,
  AccessGateCta,
  useAccessGate,
  MAX_SINGLE_RESERVATION_EPOCHS,
} from '@meddleware/walrus-relay'
import type { UploadResult } from '@meddleware/walrus-relay'
// Lightweight URL import — just the wasm asset URL (does not pull the walrus client).
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url'
import { AppHeader, AppFooter, ColorModeControl, useColorMode } from '@meddleware/ui'
import { useWallet, getSuiClient } from './wallet.js'
import { NETWORK, OPERATOR_RELAY_HOSTS, relayHosts, accessGate, uploadRelayMaxTipMist } from './config.js'
import { runBlobUpload } from './upload-flow.js'
import MyBlobs from './components/MyBlobs.vue'

const isEmbedded = new URLSearchParams(window.location.search).has('embedded')
const { mode, set } = useColorMode('dark')

type Tab = 'upload' | 'blobs'
const activeTab = ref<Tab>('upload')

const { wallets, account, connect, disconnect, signPersonalMessage, buildExecutor } = useWallet()

const gate = accessGate(NETWORK)
const gateState = useAccessGate({ gate, getClient: () => getSuiClient(NETWORK) })
const purchasing = ref(false)
const result = ref<UploadResult | null>(null)

async function onConnectFirst(): Promise<void> {
  const w = wallets.value[0]
  if (w) {
    await connect(w)
    if (account.value) await gateState.checkOwnership(account.value.address)
  }
}

async function onPurchase(): Promise<void> {
  if (!account.value) return
  purchasing.value = true
  try {
    const executor = await buildExecutor(NETWORK)
    await gateState.purchase(executor, account.value.address)
  } finally {
    purchasing.value = false
  }
}

// Wire the shared WalrusUpload widget to the extracted upload orchestration + the wallet. The
// register/upload/certify sequence lives in src/upload-flow.ts (unit-tested); this closure only
// gathers the wallet-bound inputs (executor, sui client, gated proof token) and delegates.
async function performUpload(
  bytes: Uint8Array,
  opts: { relayHost: string; onStatus: (s: string) => void },
): Promise<UploadResult> {
  if (!account.value) throw new Error('Connect your wallet first.')
  const executor = await buildExecutor(NETWORK)

  // If the relay is NFT-gated and we hold access, attach a signed proof token.
  let authToken: string | undefined
  if (gate && gateState.hasAccess.value === true) {
    authToken = await gateState.buildRelayAccessToken({
      relayHost: opts.relayHost,
      address: account.value.address,
      sign: signPersonalMessage,
    })
  }

  return runBlobUpload({
    bytes,
    network: NETWORK,
    relayHost: opts.relayHost,
    address: account.value.address,
    wasmUrl: walrusWasmUrl,
    maxTipMist: uploadRelayMaxTipMist(),
    epochs: MAX_SINGLE_RESERVATION_EPOCHS,
    executor,
    suiClient: getSuiClient(NETWORK),
    authToken,
    onStatus: opts.onStatus,
  })
}

function onUploaded(r: UploadResult): void {
  result.value = r
}
</script>

<template>
  <div class="app" :class="{ 'app--embedded': isEmbedded }">
    <AppHeader v-if="!isEmbedded" variant="dark">
      <template #brand>
        <span>Walrus Assets</span>
      </template>
      <template #actions>
        <TipConfigBadge :host="OPERATOR_RELAY_HOSTS[NETWORK]" />
        <ColorModeControl :model-value="mode" @update:model-value="set" />
      </template>
    </AppHeader>

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

      <section class="wallet">
        <template v-if="account">
          <span class="addr">{{ account.address.slice(0, 8) }}…{{ account.address.slice(-4) }}</span>
          <button type="button" @click="disconnect">Disconnect</button>
        </template>
        <template v-else>
          <button type="button" :disabled="!wallets.length" @click="onConnectFirst">
            {{ wallets.length ? 'Connect wallet' : 'No wallet detected' }}
          </button>
        </template>
      </section>

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
        :build-executor="() => buildExecutor(NETWORK)"
      />
    </div>

    <AppFooter v-if="!isEmbedded" />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app--embedded {
  min-height: 100%;
}

.page {
  max-width: 640px;
  margin: 0 auto;
  padding: 2rem 1.25rem 4rem;
  flex: 1;
}

.app--embedded .page {
  padding-top: 1rem;
  padding-bottom: 1rem;
}

.sub {
  color: var(--muted);
  margin: 0.25rem 0 0;
}

.wallet {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.25rem 0;
}

.addr {
  font-family: monospace;
  font-size: 0.9rem;
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
