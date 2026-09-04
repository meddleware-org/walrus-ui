import { defineConfig, devices } from '@playwright/test'

// Browser e2e for the SPA. The smoke spec runs anywhere (builds + serves the app and checks it
// mounts). The localnet upload spec is gated on WALRUS_LOCALNET (see e2e/upload.localnet.spec.ts).
const PORT = Number(process.env.E2E_PORT || 4173)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Build once, then serve the static bundle. Env for a localnet-targeted build is passed through
  // from the shell (e.g. after `source ../walrus-client/localnet/.env.localnet` + VITE_* mapping).
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
