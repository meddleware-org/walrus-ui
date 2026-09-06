<script setup lang="ts">
// Standalone shell for the Walrus SPA: app header + footer wrapping the core tool view.
// The core UI lives in WalrusView.vue (also exported for inline embedding in the dashboard).
import { AppHeader, AppFooter, ColorModeControl, useColorMode } from '@meddleware/ui'
import { TipConfigBadge } from '@meddleware/walrus-relay'
import { NETWORK, OPERATOR_RELAY_HOSTS } from './config.js'
import WalrusView from './components/WalrusView.vue'

const { mode, set } = useColorMode('dark')
</script>

<template>
  <div class="app">
    <AppHeader variant="dark">
      <template #brand>
        <span>Walrus Assets</span>
      </template>
      <template #actions>
        <TipConfigBadge :host="OPERATOR_RELAY_HOSTS[NETWORK]" />
        <ColorModeControl :model-value="mode" @update:model-value="set" />
      </template>
    </AppHeader>

    <WalrusView />

    <AppFooter />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
