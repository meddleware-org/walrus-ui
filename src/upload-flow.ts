// The multi-step Walrus blob upload orchestration (encode → register → upload → certify → resolve),
// extracted from App.vue so it can be unit-tested and reused by the e2e harness.
//
// The `@mysten/walrus` wasm client must NOT be pulled into the eager module graph (see CLAUDE.md),
// so this module never imports @meddleware/walrus-client at top level — it loads it lazily through
// the injectable `loadWalrusClient` (default: a dynamic import). Tests inject a fake loader.
import type { UploadResult } from '@meddleware/walrus-relay'

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
  // The SDK `encode()` returns a `WriteBlobStepEncoded`; we use its deterministic `blobId` to look
  // up an existing on-chain registration for the same content (resume discovery).
  encode(): Promise<{ blobId: string }>
  register(opts: { owner: string; epochs: number; deletable: boolean }): BuiltTx
  // `digest` = the register transaction digest. When resuming without a prior `register()` call on
  // this flow instance, the SDK accepts the digest + `deletable` to upload against the already
  // registered blob (see `@mysten/walrus` WriteBlobFlowUploadOptions).
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
   * Bearer proof token for an NFT-gated relay. May be a provider resolved per request so a resumed
   * upload presents a fresh challenge signature (see `@meddleware/walrus-client`).
   */
  authToken?: string | (() => string | undefined)
  onStatus: (s: string) => void
  /** Lazy loader for the Walrus client module (keeps wasm out of the eager bundle). */
  loadWalrusClient?: () => Promise<WalrusClientModule>
  /**
   * Resume from a blob registered in a PRIOR attempt (this session or a previous page load) by
   * passing its register transaction digest. The file is re-encoded (client-side, no gas) but the
   * on-chain `register` transaction is skipped — so an interrupted upload never re-registers (no new
   * WAL/gas), even across a reload once the same file is re-selected. Omit for a fresh upload.
   */
  resumeRegisterDigest?: string
  /**
   * On-chain resume fallback: called with the encoded `blobId` when no `resumeRegisterDigest` was
   * supplied. Returns the register digest of an already-registered, uncertified on-chain blob for
   * this content (or `undefined`). This makes resume robust to a lost local pointer (cache-clear /
   * new device) — the registration is discovered on-chain rather than remembered client-side.
   */
  discoverRegisterDigest?: (blobId: string) => Promise<string | undefined>
  /**
   * Called with the register transaction digest immediately after a fresh register succeeds, so the
   * caller can PERSIST it (e.g. to localStorage) and resume the upload after a failure/reload
   * without re-registering.
   */
  onRegistered?: (registerDigest: string) => void
}

/**
 * Register → upload → certify a blob and resolve its id + public URL. Encoding is always performed
 * (client-side, no gas); when `resumeRegisterDigest` is supplied the on-chain register transaction
 * is skipped and the upload proceeds against the already-registered blob. Up to two wallet approvals
 * (register — skipped on resume — and certify) are requested via `executor`; `onStatus` narrates.
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

  // Encoding is deterministic from the content and costs no gas, so it always runs — including on a
  // resume, where it re-derives the slivers for the re-selected file (and yields the blobId used
  // for on-chain resume discovery).
  deps.onStatus('Encoding…')
  const { blobId } = await flow.encode()

  // Resolve a resume point: a caller-provided digest (localStorage fast path) or, failing that, an
  // on-chain lookup by blobId (robust to a lost local pointer). Either skips the register tx.
  let registerDigest = deps.resumeRegisterDigest
  if (registerDigest === undefined && deps.discoverRegisterDigest) {
    registerDigest = (await deps.discoverRegisterDigest(blobId)) ?? undefined
  }

  if (registerDigest === undefined) {
    deps.onStatus('Registering blob (approve in wallet)…')
    const regTx = flow.register({ owner: deps.address, epochs: deps.epochs, deletable: false })
    regTx.setSenderIfNotSet(deps.address)
    await regTx.build({ client: deps.suiClient })
    const reg = await deps.executor.signAndExecute(regTx)
    await deps.executor.waitForTransaction(reg.digest)
    registerDigest = reg.digest
    // Persist point: hand back the digest so the upload can be resumed after a failure/reload.
    deps.onRegistered?.(registerDigest)
  }

  deps.onStatus('Uploading to the relay…')
  await flow.upload({ digest: registerDigest, deletable: false })

  deps.onStatus('Certifying (approve in wallet)…')
  const certTx = flow.certify()
  certTx.setSenderIfNotSet(deps.address)
  await certTx.build({ client: deps.suiClient })
  const cert = await deps.executor.signAndExecute(certTx)
  await deps.executor.waitForTransaction(cert.digest)

  const blob = await flow.getBlob()
  return { blobId: blob.blobId, url: walrusBlobUrl(deps.network, blob.blobId), digest: cert.digest }
}
