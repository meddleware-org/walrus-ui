import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Unit tests for the app's pure logic (config resolution + the extracted upload orchestration).
// The Vue plugin is needed because config.ts imports the @meddleware/walrus-relay barrel, which
// re-exports .vue components. The e2e/ Playwright suite is separate (test:e2e) and excluded here.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
