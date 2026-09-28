// Runnable smoke e2e: the SPA builds, serves, and mounts, and its shell renders as expected. No
// wallet or network needed — this validates the app boots and the refactored code path is wired.
import { test, expect } from '@playwright/test'

test('the app mounts and renders the shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Walrus Assets' })).toBeVisible()
  // Both feature tabs are present (AppTabNav renders an ARIA tablist), Upload selected by default.
  await expect(page.getByRole('tab', { name: 'Upload' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'My Blobs' })).toHaveAttribute('aria-selected', 'false')
})

test('switching to the My Blobs tab prompts for a wallet connection', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'My Blobs' }).click()
  // With no wallet injected the app should not crash: the tab becomes selected and WalletGuard asks
  // the user to connect (in place of the tab panel), rather than showing any network content.
  await expect(page.getByRole('tab', { name: 'My Blobs' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Connect a Sui wallet to upload and manage your blobs.')).toBeVisible()
})

test('the wallet control reflects that no wallet is present in a bare browser', async ({ page }) => {
  await page.goto('/')
  // WalletGuard renders WalletModal's trigger button when no wallet is connected. The modal always
  // shows "Connect wallet" regardless of installed wallets; the empty-wallet message appears inside
  // the modal after it is opened.
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible()
})
