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

// ── Register-resume (Walrus flow) ───────────────────────────────────────────────────────────
// A blob registered on-chain but not yet uploaded/certified can be resumed WITHOUT re-registering
// (no new WAL/gas): persist its register transaction digest, keyed by a hash of the file content,
// and reuse it when the same file is uploaded again — even after a page reload, since the user
// re-selects the file (only the tiny digest is persisted, never the bytes).

/** Stable per-(network, address) key under which a pending register digest + content hash is stored. */
export function registerStorageKey(network: string, address: string): string {
  return `mw:walrus:register:${network}:${address}`
}

/** Cheap content fingerprint (length + head/tail bytes) to match a retry to the same file. */
export function contentKey(bytes: Uint8Array): string {
  const head = Array.from(bytes.slice(0, 16)).join(',')
  const tail = Array.from(bytes.slice(-16)).join(',')
  return `${bytes.length}:${head}:${tail}`
}

/** Return the stored register digest iff it was saved for this exact file content. */
export function loadRegisterResume(
  storage: StorageLike,
  key: string,
  content: string,
): string | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { contentKey?: string; registerDigest?: string }
    return v.contentKey === content && v.registerDigest ? v.registerDigest : null
  } catch {
    return null
  }
}

/** Persist a register digest against a file content key so the upload can resume later. */
export function saveRegisterResume(
  storage: StorageLike,
  key: string,
  content: string,
  registerDigest: string,
): void {
  storage.setItem(key, JSON.stringify({ contentKey: content, registerDigest }))
}

/** Clear any stored register-resume entry (on success, or to fall back to a fresh register). */
export function clearRegisterResume(storage: StorageLike, key: string): void {
  storage.removeItem(key)
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
