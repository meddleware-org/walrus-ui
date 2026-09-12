// Unit tests for the extracted blob-upload orchestration. A fake walrus-client module is injected
// via loadWalrusClient, so no wasm/network is touched — we assert step order, tx wiring, and result.
import { describe, it, expect, vi } from 'vitest'
import { runBlobUpload, type WalrusClientModule } from '../src/upload-flow.js'
import { getCertifyRetry } from '@meddleware/walrus-relay'

function makeModule() {
  const steps: string[] = []
  const regTx = { setSenderIfNotSet: vi.fn(), build: vi.fn(async () => {}) }
  const certTx = { setSenderIfNotSet: vi.fn(), build: vi.fn(async () => {}) }
  const flow = {
    encode: vi.fn(async () => void steps.push('encode')),
    register: vi.fn(() => {
      steps.push('register')
      return regTx
    }),
    upload: vi.fn(async () => {
      steps.push('upload')
      return { blobId: 'BLOB123', blobObjectId: 'OBJ123', certificate: 'CERT_B64' }
    }),
    certify: vi.fn(() => {
      steps.push('certify')
      return certTx
    }),
    getBlob: vi.fn(async () => ({ blobId: 'BLOB123' })),
  }
  const mod: WalrusClientModule = {
    createWalrusClient: vi.fn(() => ({ __client: true })),
    createBlobUploadFlow: vi.fn(() => flow),
    walrusBlobUrl: (network: string, blobId: string) => `https://agg.example/${network}/${blobId}`,
  }
  return { mod, flow, regTx, certTx, steps }
}

function makeExecutor() {
  return {
    signAndExecute: vi.fn(async () => ({ digest: `dig-${Math.random().toString(16).slice(2)}` })),
    waitForTransaction: vi.fn(async () => {}),
  }
}

const baseDeps = {
  bytes: new Uint8Array([1, 2, 3]),
  network: 'testnet',
  relayHost: 'https://relay.example',
  address: '0xabc',
  wasmUrl: 'wasm://bundle',
  maxTipMist: 50_000_000,
  epochs: 53,
  suiClient: { __sui: true },
}

describe('runBlobUpload', () => {
  it('runs encode → register → upload → certify and resolves id + url + digest', async () => {
    const { mod, steps } = makeModule()
    const executor = makeExecutor()
    const progress: { step: string; detail?: string }[] = []

    const res = await runBlobUpload({
      ...baseDeps,
      executor,
      onStatus: (p) => progress.push(p),
      loadWalrusClient: async () => mod,
    })

    expect(steps).toEqual(['encode', 'register', 'upload', 'certify'])
    expect(res).toEqual({
      blobId: 'BLOB123',
      url: 'https://agg.example/testnet/BLOB123',
      digest: expect.stringMatching(/^dig-/),
    })
    // two wallet approvals: register + certify
    expect(executor.signAndExecute).toHaveBeenCalledTimes(2)
    expect(executor.waitForTransaction).toHaveBeenCalledTimes(2)
    // structured step progress reached the user for each phase, in journey order, with detail text.
    expect(progress.map((p) => p.step)).toEqual(['encode', 'register', 'upload', 'certify'])
    expect(progress.every((p) => typeof p.detail === 'string' && p.detail.length > 0)).toBe(true)
  })

  it('always registers fresh and uploads with the register tx digest (never a reused digest)', async () => {
    // The upload relay embeds its tip + nonce in the register tx and rejects a stale tx_id as "too
    // old", so every attempt MUST register fresh — no resume/discovery shortcut skips register.
    const { mod, flow, steps } = makeModule()
    const executor = makeExecutor()
    await runBlobUpload({
      ...baseDeps,
      executor,
      onStatus: () => {},
      loadWalrusClient: async () => mod,
    })
    expect(flow.register).toHaveBeenCalledTimes(1)
    expect(steps).toEqual(['encode', 'register', 'upload', 'certify'])
    // upload is given the digest produced by the register tx executed this attempt.
    const regDigest = (await executor.signAndExecute.mock.results[0].value).digest
    expect(flow.upload).toHaveBeenCalledWith({ digest: regDigest, deletable: false })
  })

  it('persists the certificate on upload (onUploaded) and clears it on certify (onCertified)', async () => {
    const { mod } = makeModule()
    const onUploaded = vi.fn()
    const onCertified = vi.fn()
    await runBlobUpload({
      ...baseDeps,
      executor: makeExecutor(),
      onStatus: () => {},
      loadWalrusClient: async () => mod,
      onUploaded,
      onCertified,
    })
    expect(onUploaded).toHaveBeenCalledWith({
      blobId: 'BLOB123',
      blobObjectId: 'OBJ123',
      certificate: 'CERT_B64',
      deletable: false,
    })
    expect(onCertified).toHaveBeenCalledWith('OBJ123')
  })

  it('on a certify failure, throws with a certifyRetry that re-certifies without re-uploading', async () => {
    const { mod, flow } = makeModule()
    // Register ok (#1), certify rejected (#2), certify retry ok (#3).
    let calls = 0
    const executor = {
      signAndExecute: vi.fn(async () => {
        calls += 1
        if (calls === 2) throw new Error('user rejected certify')
        return { digest: `dig-${calls}` }
      }),
      waitForTransaction: vi.fn(async () => {}),
    }

    let thrown: unknown
    try {
      await runBlobUpload({
        ...baseDeps,
        executor,
        onStatus: () => {},
        loadWalrusClient: async () => mod,
      })
    } catch (e) {
      thrown = e
    }

    // The error carries a certify retry; upload was NOT repeated (only one upload call total).
    const retry = getCertifyRetry<{ blobId: string }>(thrown)
    expect(retry).toBeTypeOf('function')
    expect(flow.upload).toHaveBeenCalledTimes(1)
    expect(flow.register).toHaveBeenCalledTimes(1)

    // Retrying certifies successfully — certify (and getBlob) run again; register/upload do not.
    const res = await retry!()
    expect(res.blobId).toBe('BLOB123')
    expect(flow.certify).toHaveBeenCalledTimes(2) // initial attempt + retry
    expect(flow.register).toHaveBeenCalledTimes(1) // never re-registered
    expect(flow.upload).toHaveBeenCalledTimes(1) // never re-uploaded
  })

  it('forwards relay host, tip cap, wasm url and auth token into the client factory', async () => {
    const { mod } = makeModule()
    await runBlobUpload({
      ...baseDeps,
      authToken: 'Bearer-ish',
      executor: makeExecutor(),
      onStatus: () => {},
      loadWalrusClient: async () => mod,
    })
    expect(mod.createWalrusClient).toHaveBeenCalledWith(
      expect.objectContaining({
        network: 'testnet',
        wasmUrl: 'wasm://bundle',
        uploadRelayHost: 'https://relay.example',
        uploadRelayAuthToken: 'Bearer-ish',
        uploadRelayMaxTipMist: 50_000_000,
      }),
    )
  })

  it('sets the sender on both the register and certify transactions', async () => {
    const { mod, regTx, certTx } = makeModule()
    await runBlobUpload({
      ...baseDeps,
      executor: makeExecutor(),
      onStatus: () => {},
      loadWalrusClient: async () => mod,
    })
    expect(regTx.setSenderIfNotSet).toHaveBeenCalledWith('0xabc')
    expect(certTx.setSenderIfNotSet).toHaveBeenCalledWith('0xabc')
  })

  it('forwards a provider-function auth token to the client factory', async () => {
    const { mod } = makeModule()
    const provider = () => 'tok'
    await runBlobUpload({
      ...baseDeps,
      authToken: provider,
      executor: makeExecutor(),
      onStatus: () => {},
      loadWalrusClient: async () => mod,
    })
    expect(mod.createWalrusClient).toHaveBeenCalledWith(
      expect.objectContaining({ uploadRelayAuthToken: provider }),
    )
  })
})
