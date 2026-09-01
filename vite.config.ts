import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// design-tokens and ui resolve from node_modules (published packages).
// @mysten/walrus is excluded from dep-optimization so its wasm `?url` import resolves.
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['@mysten/walrus', '@mysten/walrus-wasm'],
  },
})
