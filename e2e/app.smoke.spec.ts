// Runnable smoke e2e: the SPA builds, serves, and mounts, and its shell renders as expected. No
// wallet or network needed — this validates the app boots and the refactored code path is wired.
import { test, expect } from '@playwright/test'

test('the app mounts and renders the shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Walrus Assets' })).toBeVisible()
  // Both feature tabs are present.
  await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'My Blobs' })).toBeVisible()
})

test('switching to the My Blobs tab prompts for a wallet connection', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'My Blobs' }).click()
  // With no wallet injected the app should not crash; it renders the blobs pane (which asks the user
  // to connect). We assert the tab became active rather than any specific network content.
  await expect(page.getByRole('button', { name: 'My Blobs' })).toHaveClass(/active/)
})

test('the wallet control reflects that no wallet is present in a bare browser', async ({ page }) => {
  await page.goto('/')
  // wallet.ts filters to wallets exposing standard:connect + sui:signTransaction; a bare Chromium
  // has none, so the connect button is disabled with the "No wallet detected" label.
  await expect(page.getByRole('button', { name: 'No wallet detected' })).toBeVisible()
})
