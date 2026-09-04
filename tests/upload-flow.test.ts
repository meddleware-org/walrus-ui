// Unit tests for the extracted blob-upload orchestration. A fake walrus-client module is injected
// via loadWalrusClient, so no wasm/network is touched — we assert step order, tx wiring, and result.
import { describe, it, expect, vi } from 'vitest'
import { runBlobUpload, type WalrusClientModule } from '../src/upload-flow.js'

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
    upload: vi.fn(async () => void steps.push('upload')),
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
    const status: string[] = []

    const res = await runBlobUpload({
      ...baseDeps,
      executor,
      onStatus: (s) => status.push(s),
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
    // status narration reached the user for each phase
    expect(status.length).toBeGreaterThanOrEqual(4)
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
})
