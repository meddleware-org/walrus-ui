<script setup lang="ts">
// Standalone shell for the Walrus SPA: app header + footer wrapping the core tool view.
// The core UI lives in WalrusView.vue (also exported for inline embedding in the dashboard).
import { AppHeader, AppFooter, ColorModeControl, useColorMode } from '@meddleware/ui'
import { TipConfigBadge } from '@meddleware/walrus-relay'
import { NETWORK, OPERATOR_RELAY_HOSTS } from './config.js'
import WalrusView from './components/WalrusView.vue'

const { mode, set } = useColorMode('dark')
const DOCS_URL = import.meta.env.VITE_DOCS_URL || 'https://docs.meddleware.co.uk/blockchain/sui/walrus-storage/'
const DEV_URL  = import.meta.env.VITE_DEV_URL  || 'https://dev.meddleware.co.uk/sui/walrus-storage/'
</script>

<template>
  <div class="app">
    <AppHeader variant="dark">
      <template #brand>
        <h1 class="brand-title">Walrus Assets</h1>
      </template>
      <template #actions>
        <TipConfigBadge :host="OPERATOR_RELAY_HOSTS[NETWORK]" />
        <ColorModeControl :model-value="mode" @update:model-value="set" />
      </template>
    </AppHeader>

    <WalrusView />

    <AppFooter :docs-url="DOCS_URL" :dev-url="DEV_URL" />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.brand-title {
  font: inherit;
  margin: 0;
}
</style>
