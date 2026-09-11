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
  encode(): Promise<void>
  register(opts: { owner: string; epochs: number; deletable: boolean }): BuiltTx
  upload(opts: { digest: string }): Promise<void>
  certify(): BuiltTx
  getBlob(): Promise<{ blobId: string }>
}

/**
 * A same-session resume point: a flow whose blob is already registered on-chain, plus the register
 * transaction digest. Passing this to {@link runBlobUpload} skips encode + register (no new WAL/gas)
 * and retries from the relay upload — so an interrupted upload never re-registers. Not serialisable
 * / not for cross-reload use (the flow holds the encoded blob in memory).
 */
export interface UploadResumeState {
  flow: BlobUploadFlow
  registerDigest: string
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
   * Resume a prior same-session upload from its registered blob (skips encode + register). Omit for
   * a fresh upload.
   */
  resume?: UploadResumeState
  /**
   * Called once the blob is registered (fresh uploads only), handing back the flow + register digest
   * so the caller can retain them and resume the relay upload after a failure without re-registering.
   */
  onRegistered?: (state: UploadResumeState) => void
}

/**
 * Register → upload → certify a blob and resolve its id + public URL. Two wallet approvals
 * (register, certify) are requested via `executor`; `onStatus` narrates each step.
 */
export async function runBlobUpload(deps: RunBlobUploadDeps): Promise<UploadResult> {
  // The real module's flow types are richer than the narrow structural subset we use here, so the
  // default loader casts through `unknown`. Tests inject an exact-shape fake instead.
  const load =
    deps.loadWalrusClient ??
    (async () => (await import('@meddleware/walrus-client')) as unknown as WalrusClientModule)
  const { createWalrusClient, createBlobUploadFlow, walrusBlobUrl } = await load()

  let flow: BlobUploadFlow
  let registerDigest: string

  if (deps.resume) {
    // Same-session resume: the blob is already registered on-chain. Skip encode + register (no new
    // WAL/gas) and retry from the relay upload. The retained flow keeps its registered state; its
    // client resolves the relay token per request, so a fresh challenge is used on retry.
    flow = deps.resume.flow
    registerDigest = deps.resume.registerDigest
  } else {
    const client = createWalrusClient({
      network: deps.network,
      wasmUrl: deps.wasmUrl,
      uploadRelayHost: deps.relayHost,
      uploadRelayAuthToken: deps.authToken,
      uploadRelayMaxTipMist: deps.maxTipMist,
    })
    flow = createBlobUploadFlow(client, deps.bytes)

    deps.onStatus('Encoding…')
    await flow.encode()

    deps.onStatus('Registering blob (approve in wallet)…')
    const regTx = flow.register({ owner: deps.address, epochs: deps.epochs, deletable: false })
    regTx.setSenderIfNotSet(deps.address)
    await regTx.build({ client: deps.suiClient })
    const reg = await deps.executor.signAndExecute(regTx)
    await deps.executor.waitForTransaction(reg.digest)
    registerDigest = reg.digest
    // Hand the registered flow back so the caller can resume the relay upload after a failure.
    deps.onRegistered?.({ flow, registerDigest })
  }

  deps.onStatus('Uploading to the relay…')
  await flow.upload({ digest: registerDigest })

  deps.onStatus('Certifying (approve in wallet)…')
  const certTx = flow.certify()
  certTx.setSenderIfNotSet(deps.address)
  await certTx.build({ client: deps.suiClient })
  const cert = await deps.executor.signAndExecute(certTx)
  await deps.executor.waitForTransaction(cert.digest)

  const blob = await flow.getBlob()
  return { blobId: blob.blobId, url: walrusBlobUrl(deps.network, blob.blobId), digest: cert.digest }
}
