// Build-time configuration (Vite inlines VITE_*). The relay hostnames default to
// the public Mysten relay; set VITE_WALRUS_RELAY_* to your operator relay to collect
// the tip. Access-gate config is optional (unset ⇒ ungated).
import type { WalrusNetwork, RelayGateConfig } from '@meddleware/walrus-relay'
import {
  ACCESS_GATE_PACKAGE_ID,
  ACCESS_GATE_PLATFORM_CONFIG_ID,
  accessGateNftType,
} from '@meddleware/walrus-relay'

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

/** Active Walrus network, from `VITE_NETWORK` (default `testnet`). */
export const NETWORK: WalrusNetwork = (env.VITE_NETWORK as WalrusNetwork) || 'testnet'

/** Public Mysten relays — the fallback when no operator relay is configured. */
export const PUBLIC_WALRUS_RELAY_HOSTS: Record<WalrusNetwork, string> = {
  testnet: 'https://upload-relay.testnet.walrus.space',
  mainnet: 'https://upload-relay.mainnet.walrus.space',
}

/** Operator relay host per network (env → public fallback). */
export const OPERATOR_RELAY_HOSTS: Record<WalrusNetwork, string> = {
  testnet: env.VITE_WALRUS_RELAY_TESTNET || PUBLIC_WALRUS_RELAY_HOSTS.testnet,
  mainnet: env.VITE_WALRUS_RELAY_MAINNET || PUBLIC_WALRUS_RELAY_HOSTS.mainnet,
}

/** The operator/public host pair for `useWalrusRelay`. */
export function relayHosts(network: WalrusNetwork): { operator: string; public: string } {
  return { operator: OPERATOR_RELAY_HOSTS[network], public: PUBLIC_WALRUS_RELAY_HOSTS[network] }
}

/**
 * JSON-RPC endpoint used to build + execute the register/certify transactions.
 * NOTE: this is JSON-RPC (the public testnet fullnode serves gRPC only for JSON-RPC,
 * so a JSON-RPC-capable endpoint is used for testnet).
 */
export const RPC_URLS: Record<WalrusNetwork, string> = {
  testnet: env.VITE_RPC_TESTNET || 'https://sui-testnet-rpc.publicnode.com',
  mainnet: env.VITE_RPC_MAINNET || 'https://fullnode.mainnet.sui.io:443',
}

/**
 * Parse the optional NFT access-gate config for a network from env.
 * packageId and platformConfigId are hardcoded in the library — operators only
 * need to supply their Gate object ID, soulbound flag, and purchase price.
 */
export function accessGate(network: WalrusNetwork): RelayGateConfig | null {
  const NET = network.toUpperCase()
  const packageId = ACCESS_GATE_PACKAGE_ID[network]
  const platformConfigId = ACCESS_GATE_PLATFORM_CONFIG_ID[network]
  const gateId = env[`VITE_ACCESS_GATE_ID_${NET}`]
  if (!packageId || !platformConfigId || !gateId) return null
  const soulbound = env[`VITE_ACCESS_GATE_SOULBOUND_${NET}`] === 'true'
  return {
    packageId,
    gateId,
    platformConfigId,
    nftType: accessGateNftType(network, soulbound),
    soulbound,
    priceMist: BigInt(env[`VITE_ACCESS_GATE_PRICE_MIST_${NET}`] || '0'),
  }
}
