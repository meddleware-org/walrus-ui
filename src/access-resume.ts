// Consume-persistence + resume for the single-use NFT relay paywall.
//
// The relay consumes one NFT use BEFORE the upload (the gateway requires an on-chain
// AccessConsumedEvent before it will proxy). To ensure an interrupted upload never burns a use,
// the gateway treats the permanent on-chain `consumeDigest` as the one-time redemption token: a
// use is only spent when an upload succeeds. This module is the client half — it persists the
// consumeDigest so a reload/retry reuses the SAME consume (re-signing a fresh challenge is free)
// instead of consuming another use, and clears it once an upload succeeds.
//
// Extracted from WalrusView.vue so the resume decision is unit-testable with a fake storage.

/** The subset of the Web Storage API this module needs (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Stable per-(network, gate, address) key under which the pending consumeDigest is stored. */
export function consumeStorageKey(network: string, gateId: string, address: string): string {
  return `mw:walrus:consume:${network}:${gateId}:${address}`
}

/**
 * True if `err` is the gateway's "this consume was already redeemed" rejection (HTTP 409 with
 * `code: 'redeemed'`). Distinguished from transient failures so we only re-consume (spend a new
 * use) when the stored digest is genuinely spent — never on a network blip.
 */
export function isRedeemedConflict(err: unknown): boolean {
  const e = err as { status?: number; error?: { code?: string } } | null
  return !!e && e.status === 409 && e.error?.code === 'redeemed'
}

/** A challenge carrying at least a `nonce` (structural; the full object is passed through). */
export interface ChallengeLike {
  nonce: string
}

/**
 * Injected dependencies for {@link resolveGatedAuthToken} (all wallet/relay/chain calls).
 * Generic over the challenge (`C`), transaction (`Tx`), and signer (`S`) types so the wallet's
 * concrete `PersonalMessageSigner` flows through to `buildAccessProof` without widening.
 */
export interface ResolveTokenDeps<C extends ChallengeLike, Tx, S> {
  storage: StorageLike
  key: string
  relayHost: string
  address: string
  nftId: string
  /** Fetch a fresh challenge nonce from the gateway. */
  fetchChallenge: (relayHost: string) => Promise<C>
  /** Build the on-chain `access_gate::consume` PTB for `nftId` + `nonce`. */
  buildConsume: (nftId: string, nonce: string) => Tx
  /** Sign + execute a PTB; resolves with the transaction digest. */
  signAndExecute: (tx: Tx) => Promise<{ digest?: string }>
  /** Wait for a transaction to finalise (best-effort; errors are swallowed by the caller). */
  waitForTransaction: (digest: string) => Promise<unknown>
  /** Build the base64 relay access-proof token. */
  buildAccessProof: (args: {
    address: string
    challenge: C
    sign: S
    consumeDigest?: string
  }) => Promise<string>
  /** Personal-message signer (free — no gas, no use). */
  sign: S
  /** Ignore any stored digest and consume a fresh use (used after a `redeemed` conflict). */
  forceFresh?: boolean
}

/**
 * Resolve the relay auth token for a gated upload, reusing a persisted consume when present.
 *
 * - A stored (unspent) digest ⇒ reuse it: fetch a fresh challenge, sign (free), no new consume.
 * - Otherwise ⇒ consume one use on-chain and persist the digest BEFORE the upload, so an
 *   interruption after this point resumes rather than re-consuming.
 *
 * The caller must clear the stored key on a successful upload and may retry with `forceFresh`
 * after {@link isRedeemedConflict}.
 */
export async function resolveGatedAuthToken<C extends ChallengeLike, Tx, S>(
  deps: ResolveTokenDeps<C, Tx, S>,
): Promise<string> {
  const stored = deps.forceFresh ? null : deps.storage.getItem(deps.key)
  const challenge = await deps.fetchChallenge(deps.relayHost)

  let consumeDigest: string | undefined
  if (stored) {
    // Resume: reuse the already-consumed use; the fresh challenge is only for signature freshness.
    consumeDigest = stored
  } else {
    const consumeTx = deps.buildConsume(deps.nftId, challenge.nonce)
    const res = await deps.signAndExecute(consumeTx)
    consumeDigest = res.digest
    // Persist BEFORE the upload so a crash/reload between consume and upload success can resume.
    if (consumeDigest) {
      deps.storage.setItem(deps.key, consumeDigest)
      await deps.waitForTransaction(consumeDigest).catch(() => {})
    }
  }

  return deps.buildAccessProof({
    address: deps.address,
    challenge,
    sign: deps.sign,
    consumeDigest,
  })
}
