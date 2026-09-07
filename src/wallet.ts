// Thin walrus-ui shim over the shared @meddleware/wallet-adapter singleton.
//
// RPC URL is resolved from the runtime useNetwork() singleton so network switching
// in the dashboard propagates immediately to all tool views. Because the adapter is a
// module singleton, the wallet connection is shared with any other tool view rendered
// in the same window (e.g. the dashboard).
import {
  useWallet as useWalletBase,
  getSuiClient as getSuiClientBase,
  buildExecutor as buildExecutorBase,
  useNetwork,
} from '@meddleware/wallet-adapter'
import type { Executor } from '@meddleware/wallet-adapter'

export type { Executor }

const { network, rpcUrl } = useNetwork()

/** Memoised Sui gRPC client for the currently selected network. */
export function getSuiClient() {
  return getSuiClientBase(network.value, rpcUrl.value)
}

/** Build a transaction executor bound to the connected wallet and current network RPC URL. */
export function buildExecutor(): Promise<Executor> {
  return buildExecutorBase(network.value, rpcUrl.value)
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
