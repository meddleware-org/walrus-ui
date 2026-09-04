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

interface BlobUploadFlow {
  encode(): Promise<void>
  register(opts: { owner: string; epochs: number; deletable: boolean }): BuiltTx
  upload(opts: { digest: string }): Promise<void>
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
  /** Optional Bearer proof token for an NFT-gated relay. */
  authToken?: string
  onStatus: (s: string) => void
  /** Lazy loader for the Walrus client module (keeps wasm out of the eager bundle). */
  loadWalrusClient?: () => Promise<WalrusClientModule>
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

  const client = createWalrusClient({
    network: deps.network,
    wasmUrl: deps.wasmUrl,
    uploadRelayHost: deps.relayHost,
    uploadRelayAuthToken: deps.authToken,
    uploadRelayMaxTipMist: deps.maxTipMist,
  })
  const flow = createBlobUploadFlow(client, deps.bytes)

  deps.onStatus('Encoding…')
  await flow.encode()

  deps.onStatus('Registering blob (approve in wallet)…')
  const regTx = flow.register({ owner: deps.address, epochs: deps.epochs, deletable: false })
  regTx.setSenderIfNotSet(deps.address)
  await regTx.build({ client: deps.suiClient })
  const reg = await deps.executor.signAndExecute(regTx)
  await deps.executor.waitForTransaction(reg.digest)

  deps.onStatus('Uploading to the relay…')
  await flow.upload({ digest: reg.digest })

  deps.onStatus('Certifying (approve in wallet)…')
  const certTx = flow.certify()
  certTx.setSenderIfNotSet(deps.address)
  await certTx.build({ client: deps.suiClient })
  const cert = await deps.executor.signAndExecute(certTx)
  await deps.executor.waitForTransaction(cert.digest)

  const blob = await flow.getBlob()
  return { blobId: blob.blobId, url: walrusBlobUrl(deps.network, blob.blobId), digest: cert.digest }
}
