// Thin walrus-ui shim over the shared @meddleware/wallet-adapter singleton.
//
// The adapter is network-agnostic (RPC URL passed per call); this shim binds walrus-ui's
// RPC_URLS so call sites keep the one-arg ergonomics (`getSuiClient(NETWORK)` /
// `buildExecutor(NETWORK)`). Because the adapter is a module singleton, the wallet connection
// is shared with any other tool view rendered in the same window (e.g. the dashboard).
import {
  useWallet as useWalletBase,
  getSuiClient as getSuiClientBase,
  buildExecutor as buildExecutorBase,
} from '@meddleware/wallet-adapter'
import type { Executor } from '@meddleware/wallet-adapter'
import type { WalrusNetwork } from '@meddleware/walrus-relay'
import { RPC_URLS } from './config.js'

export type { Executor }

/** Memoised Sui JSON-RPC client for the network, using walrus-ui's configured RPC URL. */
export function getSuiClient(network: WalrusNetwork) {
  return getSuiClientBase(network, RPC_URLS[network])
}

/** Build a transaction executor bound to the connected wallet + walrus-ui's RPC URL. */
export function buildExecutor(network: WalrusNetwork): Promise<Executor> {
  return buildExecutorBase(network, RPC_URLS[network])
}

/**
 * Wallet composable bound to walrus-ui's network config. Delegates to the shared adapter
 * singleton; walrus needs `sui:signTransaction` (upload certify) so it's requested for discovery.
 */
export function useWallet() {
  const base = useWalletBase({ requiredFeatures: ['sui:signTransaction'] })
  return {
    wallets: base.wallets,
    currentWallet: base.currentWallet,
    account: base.account,
    connecting: base.connecting,
    error: base.error,
    connect: base.connect,
    disconnect: base.disconnect,
    signPersonalMessage: base.signPersonalMessage,
    getSuiClient,
    buildExecutor,
  }
}
