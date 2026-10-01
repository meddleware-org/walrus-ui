// Configuration. The network is wallet-adapter's shared runtime selector (the standalone build
// selects VITE_NETWORK in main.ts; embedded, the host's selector rules). Operator settings are
// build-time VITE_* per network: relay hostnames default to the public Mysten relay (set
// VITE_WALRUS_RELAY_* to your operator relay to collect the tip); the access gate is optional
// (unset ⇒ ungated), and its package + PlatformConfig come from the published deployment.
import { computed } from 'vue'
import type { WalrusNetwork, RelayGateConfig } from '@meddleware/walrus-relay'
import { relayGateConfig } from '@meddleware/walrus-relay'
import { useNetwork } from '@meddleware/wallet-adapter'

/** Build-time env bag. Injectable on the env-reading helpers below purely so unit tests can exercise
 *  each branch without depending on Vite's (frozen) `import.meta.env` inlining. */
export type EnvSource = Record<string, string | undefined>

const env: EnvSource = (import.meta as unknown as { env?: EnvSource }).env ?? {}

/** The active network (read-only ref). */
export const network = useNetwork().network

/** The active network as a Walrus network, or null where Walrus has none (e.g. localnet). */
export const walrusNetwork = computed<WalrusNetwork | null>(() =>
  network.value === 'testnet' || network.value === 'mainnet' ? network.value : null,
)

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
 * Walruscan explorer URL for a blob. A Walrus blob id is not a Sui object, so it links to the
 * Walrus-native explorer rather than a Sui explorer (SuiVision handles Sui entities elsewhere).
 */
export function walruscanBlobUrl(network: WalrusNetwork, blobId: string): string {
  return `https://walruscan.com/${network}/blob/${blobId}`
}

/**
 * Default relay tip ceiling (MIST) when `VITE_UPLOAD_RELAY_MAX_TIP_MIST` is unset: 0.05 SUI, the
 * workspace-wide ceiling (~8× the operator relay's worst-case tip at the 100 MiB edge cap).
 */
export const DEFAULT_UPLOAD_RELAY_MAX_TIP_MIST = 50_000_000

/**
 * Cap on the relay tip payment in MIST, from `VITE_UPLOAD_RELAY_MAX_TIP_MIST`. This is a ceiling to
 * prevent overpayment (the relay asks for the minimum), NOT a fixed charge. A non-positive or
 * unparseable value falls back to {@link DEFAULT_UPLOAD_RELAY_MAX_TIP_MIST}.
 */
export function uploadRelayMaxTipMist(envSource: EnvSource = env): number {
  const parsed = Number(envSource.VITE_UPLOAD_RELAY_MAX_TIP_MIST)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_RELAY_MAX_TIP_MIST
}

/**
 * The optional NFT access gate for a network: the operator supplies only the Gate id, soulbound
 * flag and purchase price (`VITE_ACCESS_GATE_*_{NET}`); `relayGateConfig` fixes the package and
 * `PlatformConfig` to the published deployment (commission enforcement). `null` — an ungated
 * relay — when no gate id is set, or when no access_gate deployment is recorded for the network.
 */
export function accessGate(network: WalrusNetwork, envSource: EnvSource = env): RelayGateConfig | null {
  const NET = network.toUpperCase()
  const gateId = envSource[`VITE_ACCESS_GATE_ID_${NET}`]
  if (!gateId) return null
  try {
    return relayGateConfig(network, {
      gateId,
      soulbound: envSource[`VITE_ACCESS_GATE_SOULBOUND_${NET}`] === 'true',
      priceMist: BigInt(envSource[`VITE_ACCESS_GATE_PRICE_MIST_${NET}`] || '0'),
    })
  } catch (e) {
    console.warn(`[walrus-ui] access gate for ${network} disabled: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
