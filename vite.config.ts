import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// design-tokens and ui resolve from node_modules (published packages).
// @mysten/walrus is excluded from dep-optimization so its wasm `?url` import resolves.
// node:fs/promises is declared external so rolldown doesn't warn about the Node-only
// uploadLocalFile helper in @meddleware/walrus-client (never called from browser code).
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['@mysten/walrus', '@mysten/walrus-wasm'],
  },
  build: {
    rollupOptions: {
      external: ['node:fs/promises'],
    },
  },
})
