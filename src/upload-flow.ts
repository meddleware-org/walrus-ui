// The multi-step Walrus blob upload orchestration (encode → register → upload → certify → resolve),
// extracted from App.vue so it can be unit-tested and reused by the e2e harness.
//
// The `@mysten/walrus` wasm client must NOT be pulled into the eager module graph (see CLAUDE.md),
// so this module never imports @meddleware/walrus-client at top level — it loads it lazily through
// the injectable `loadWalrusClient` (default: a dynamic import). Tests inject a fake loader.
//
// Register is ALWAYS performed, never resumed/skipped. With an upload relay (required for browser
// uploads) the SDK embeds the relay tip + a per-encode `nonce` INSIDE the register transaction, and
// the relay rejects a stale `tx_id` as "the received transaction is too old". A register tx therefore
// can't be reused across attempts — reusing a prior/discovered registration (localStorage or on-chain
// discovery) hands the relay an old tx with a non-matching nonce. Each attempt re-encodes (free) and
// registers fresh so the tip+nonce the relay verifies is always recent.
import type { UploadResult, UploadProgress } from '@meddleware/walrus-relay'

/** Minimal transaction executor — the structural subset App.vue's wallet executor already provides. */
export interface UploadExecutor {
  signAndExecute(tx: unknown): Promise<{ digest: string }>
  waitForTransaction(digest: string): Promise<unknown>
}

/** The slice of `@meddleware/walrus-client` this flow needs. */
export interface WalrusClientModule {
  createWalrusClient: (opts: Record<string, unknown>) => unknown
  createBlobUploadFlow: (client: unknown, bytes: Uint8Array) => BlobUploadFlow
  walrusBlobUrl: (network: string, blobId: string) => string
}

interface BuiltTx {
  setSenderIfNotSet(address: string): void
  build(opts: { client: unknown }): Promise<unknown>
}

export interface BlobUploadFlow {
  // Encoding is deterministic from the content and costs no gas; it also mints the per-attempt relay
  // `nonce` committed by the register tip, so it must precede register/upload on this flow instance.
  encode(): Promise<void>
  register(opts: { owner: string; epochs: number; deletable: boolean }): BuiltTx
  // `digest` = the register transaction digest produced by the register tx executed this attempt.
  upload(opts: { digest: string; deletable?: boolean }): Promise<void>
  certify(): BuiltTx
  getBlob(): Promise<{ blobId: string }>
}

export interface RunBlobUploadDeps {
  bytes: Uint8Array
  network: string
  relayHost: string
  /** Owner/sender address (already-connected wallet account). */
  address: string
  /** Wasm bundle URL for the Walrus client. */
  wasmUrl: string
  /** Cap on the relay tip payment in MIST. */
  maxTipMist: number
  /** Blob storage reservation length in epochs. */
  epochs: number
  executor: UploadExecutor
  /** A Sui client used to `build()` the register/certify transactions. */
  suiClient: unknown
  /**
   * Bearer proof token for an NFT-gated relay. May be a provider resolved per request so a retried
   * upload presents a fresh challenge signature (see `@meddleware/walrus-client`).
   */
  authToken?: string | (() => string | undefined)
  /** Structured step progress; drives the stepped indicator in the WalrusUpload widget. */
  onStatus: (p: UploadProgress) => void
  /** Lazy loader for the Walrus client module (keeps wasm out of the eager bundle). */
  loadWalrusClient?: () => Promise<WalrusClientModule>
}

/**
 * Register → upload → certify a blob and resolve its id + public URL. Every attempt encodes
 * (client-side, no gas) and registers fresh: the relay tip + nonce the relay verifies live in the
 * register transaction and must be recent, so a registration is never reused across attempts. Two
 * wallet approvals (register and certify) are requested via `executor`; `onStatus` narrates.
 */
export async function runBlobUpload(deps: RunBlobUploadDeps): Promise<UploadResult> {
  // The real module's flow types are richer than the narrow structural subset we use here, so the
  // default loader casts through `unknown`. Tests inject an exact-shape fake instead.
  const load =
    deps.loadWalrusClient ??
    (async () => (await import('@meddleware/walrus-client')) as unknown as WalrusClientModule)
  const { createWalrusClient, createBlobUploadFlow, walrusBlobUrl } = await load()

  const client = createWalrusClient({
    network: deps.network,
    wasmUrl: deps.wasmUrl,
    uploadRelayHost: deps.relayHost,
    uploadRelayAuthToken: deps.authToken,
    uploadRelayMaxTipMist: deps.maxTipMist,
  })
  const flow = createBlobUploadFlow(client, deps.bytes)

  deps.onStatus({ step: 'encode', detail: 'Encoding…' })
  await flow.encode()

  deps.onStatus({ step: 'register', detail: 'Registering blob (approve in wallet)…' })
  const regTx = flow.register({ owner: deps.address, epochs: deps.epochs, deletable: false })
  regTx.setSenderIfNotSet(deps.address)
  await regTx.build({ client: deps.suiClient })
  const reg = await deps.executor.signAndExecute(regTx)
  await deps.executor.waitForTransaction(reg.digest)

  deps.onStatus({ step: 'upload', detail: 'Uploading to the relay…' })
  await flow.upload({ digest: reg.digest, deletable: false })

  deps.onStatus({ step: 'certify', detail: 'Certifying (approve in wallet)…' })
  const certTx = flow.certify()
  certTx.setSenderIfNotSet(deps.address)
  await certTx.build({ client: deps.suiClient })
  const cert = await deps.executor.signAndExecute(certTx)
  await deps.executor.waitForTransaction(cert.digest)

  const blob = await flow.getBlob()
  return { blobId: blob.blobId, url: walrusBlobUrl(deps.network, blob.blobId), digest: cert.digest }
}
