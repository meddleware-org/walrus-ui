// Minimal Sui wallet integration on @mysten/wallet-standard (dapp-kit is React-only).
// Discovers wallets, connects, signs personal messages (for the NFT-gate proof), and
// adapts the connected wallet into a transaction executor. Module singleton.
//
// NOTE: the signing path can only be exercised with a real wallet extension in a
// browser; it is intentionally thin and executes via a JSON-RPC client so we control
// the returned effects.
import { markRaw, readonly, ref, shallowRef } from 'vue'
import { getWallets, isWalletWithRequiredFeatureSet } from '@mysten/wallet-standard'
import type { Wallet, WalletAccount } from '@mysten/wallet-standard'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { Transaction } from '@mysten/sui/transactions'
import type { WalrusNetwork } from '@meddleware/walrus-relay'
import { RPC_URLS } from './config.js'

const REQUIRED_FEATURES = ['standard:connect', 'sui:signTransaction'] as const

const wallets = shallowRef<Wallet[]>([])
const currentWallet = shallowRef<Wallet | null>(null)
const account = shallowRef<WalletAccount | null>(null)
const connecting = ref(false)
const error = ref<string | null>(null)

const clients = new Map<WalrusNetwork, SuiJsonRpcClient>()
/** Return a memoised {@link SuiJsonRpcClient} for the network (one instance per network). */
export function getSuiClient(network: WalrusNetwork): SuiJsonRpcClient {
  let c = clients.get(network)
  if (!c) {
    c = new SuiJsonRpcClient({ url: RPC_URLS[network], network })
    clients.set(network, c)
  }
  return c
}

function refreshWallets(): void {
  // markRaw: extension Wallet objects expose name/icon as ES-private-field getters
  // that throw when accessed through a Vue reactive Proxy.
  wallets.value = getWallets()
    .get()
    .filter((w) => isWalletWithRequiredFeatureSet(w, [...REQUIRED_FEATURES]))
    .map((w) => markRaw(w))
}

let initialised = false
function init(): void {
  if (initialised) return
  initialised = true
  const api = getWallets()
  refreshWallets()
  api.on('register', refreshWallets)
  api.on('unregister', refreshWallets)
}

async function connect(wallet: Wallet): Promise<void> {
  error.value = null
  connecting.value = true
  try {
    const feature = wallet.features['standard:connect'] as {
      connect: () => Promise<{ accounts: readonly WalletAccount[] }>
    }
    const { accounts } = await feature.connect()
    if (!accounts.length) throw new Error('Wallet returned no accounts.')
    currentWallet.value = markRaw(wallet)
    account.value = markRaw(accounts[0])
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    connecting.value = false
  }
}

function disconnect(): void {
  const disc = currentWallet.value?.features['standard:disconnect'] as
    | { disconnect?: () => Promise<void> }
    | undefined
  void disc?.disconnect?.()
  currentWallet.value = null
  account.value = null
}

/** Sign `nft-gate:access:<nonce>` to prove address control (returns base64 signature). */
async function signPersonalMessage(message: Uint8Array): Promise<{ signature: string }> {
  const wallet = currentWallet.value
  const acct = account.value
  if (!wallet || !acct) throw new Error('Connect a wallet first.')
  const feature = wallet.features['sui:signPersonalMessage'] as
    | {
        signPersonalMessage: (input: {
          message: Uint8Array
          account: WalletAccount
        }) => Promise<{ bytes: string; signature: string }>
      }
    | undefined
  if (!feature) throw new Error('This wallet cannot sign personal messages.')
  const { signature } = await feature.signPersonalMessage({ message, account: acct })
  return { signature }
}

/** Transaction executor bound to the connected wallet: sign+execute a PTB and await finality. */
export interface Executor {
  signAndExecute(tx: Transaction): Promise<{ digest: string }>
  waitForTransaction(digest: string): Promise<unknown>
}

/** Build an executor bound to the connected wallet + network. */
async function buildExecutor(network: WalrusNetwork): Promise<Executor> {
  const wallet = currentWallet.value
  const acct = account.value
  if (!wallet || !acct) throw new Error('Connect a wallet first.')
  const client = getSuiClient(network)
  const chain = `sui:${network}` as const

  const signFeature = wallet.features['sui:signTransaction'] as {
    signTransaction: (input: {
      transaction: Transaction
      account: WalletAccount
      chain: `sui:${string}`
    }) => Promise<{ bytes: string; signature: string }>
  }

  return {
    async signAndExecute(tx: Transaction): Promise<{ digest: string }> {
      const { bytes, signature } = await signFeature.signTransaction({
        transaction: tx,
        account: acct,
        chain,
      })
      const res = await client.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: { showEffects: true },
      })
      return { digest: res.digest }
    },
    async waitForTransaction(digest: string): Promise<unknown> {
      return client.waitForTransaction({ digest })
    },
  }
}

/**
 * Wallet composable: discovers wallets, exposes reactive connection state, and provides
 * `connect` / `disconnect` / `signPersonalMessage` / `buildExecutor`. Module singleton —
 * all callers share one wallet/account state.
 */
export function useWallet() {
  init()
  return {
    wallets: readonly(wallets),
    currentWallet: readonly(currentWallet),
    account: readonly(account),
    connecting: readonly(connecting),
    error: readonly(error),
    connect,
    disconnect,
    signPersonalMessage,
    buildExecutor,
  }
}
