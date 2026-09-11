// Unit tests for the single-use consume persistence/resume decision. A fake StorageLike and fake
// wallet/relay deps are injected — no wallet, network, or chain is touched.
import { describe, it, expect, vi } from 'vitest'
import {
  consumeStorageKey,
  isRedeemedConflict,
  resolveGatedAuthToken,
  registerStorageKey,
  contentKey,
  loadRegisterResume,
  saveRegisterResume,
  clearRegisterResume,
  type StorageLike,
} from '../src/access-resume.js'

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

/** Build resolve deps with spies; `signAndExecute` returns a fixed fresh digest. */
function makeDeps(storage: StorageLike, forceFresh = false) {
  const buildConsume = vi.fn((_id: string, nonce: string) => ({ nonce }))
  const signAndExecute = vi.fn(async () => ({ digest: 'fresh-digest' }))
  const waitForTransaction = vi.fn(async () => {})
  const fetchChallenge = vi.fn(async () => ({ nonce: 'nonce-xyz' }))
  const buildAccessProof = vi.fn(
    async (args: { consumeDigest?: string }) => `proof:${args.consumeDigest}`,
  )
  return {
    deps: {
      storage,
      key: 'k',
      relayHost: 'https://relay',
      address: '0xabc',
      nftId: '0xnft',
      fetchChallenge,
      buildConsume,
      signAndExecute,
      waitForTransaction,
      buildAccessProof,
      sign: {},
      forceFresh,
    },
    spies: { buildConsume, signAndExecute, buildAccessProof, fetchChallenge },
  }
}

describe('consumeStorageKey', () => {
  it('is stable and namespaced by network + gate + address', () => {
    expect(consumeStorageKey('testnet', '0xgate', '0xaddr')).toBe(
      'mw:walrus:consume:testnet:0xgate:0xaddr',
    )
  })
})

describe('register-resume persistence', () => {
  it('registerStorageKey is namespaced by network + address', () => {
    expect(registerStorageKey('testnet', '0xaddr')).toBe('mw:walrus:register:testnet:0xaddr')
  })

  it('contentKey differs for different content and matches identical content', () => {
    const a = contentKey(new Uint8Array([1, 2, 3, 4]))
    const b = contentKey(new Uint8Array([1, 2, 3, 4]))
    const c = contentKey(new Uint8Array([9, 9, 9, 9]))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('load returns the digest only for the same content, and clear removes it', () => {
    const storage = fakeStorage()
    const key = registerStorageKey('testnet', '0xaddr')
    const ck = contentKey(new Uint8Array([1, 2, 3]))
    saveRegisterResume(storage, key, ck, 'reg-digest')
    // Same content ⇒ resumes.
    expect(loadRegisterResume(storage, key, ck)).toBe('reg-digest')
    // Different content ⇒ no resume (a different file must not reuse another's registration).
    expect(loadRegisterResume(storage, key, contentKey(new Uint8Array([4, 5, 6])))).toBeNull()
    clearRegisterResume(storage, key)
    expect(loadRegisterResume(storage, key, ck)).toBeNull()
  })
})

describe('isRedeemedConflict', () => {
  it('matches only HTTP 409 with code "redeemed"', () => {
    expect(isRedeemedConflict({ status: 409, error: { code: 'redeemed' } })).toBe(true)
    expect(isRedeemedConflict({ status: 409, error: { code: 'leased' } })).toBe(false)
    expect(isRedeemedConflict({ status: 500, error: { code: 'redeemed' } })).toBe(false)
    expect(isRedeemedConflict(new Error('network'))).toBe(false)
    expect(isRedeemedConflict(null)).toBe(false)
  })
})

describe('resolveGatedAuthToken', () => {
  it('consumes a fresh use and persists the digest when nothing is stored', async () => {
    const storage = fakeStorage()
    const { deps, spies } = makeDeps(storage)
    const token = await resolveGatedAuthToken(deps)
    expect(spies.signAndExecute).toHaveBeenCalledTimes(1) // consumed a use
    expect(storage.getItem('k')).toBe('fresh-digest') // persisted BEFORE upload
    expect(token).toBe('proof:fresh-digest')
  })

  it('reuses a stored digest WITHOUT consuming another use (resume)', async () => {
    const storage = fakeStorage({ k: 'stored-digest' })
    const { deps, spies } = makeDeps(storage)
    const token = await resolveGatedAuthToken(deps)
    expect(spies.buildConsume).not.toHaveBeenCalled() // no new consume
    expect(spies.signAndExecute).not.toHaveBeenCalled()
    expect(spies.fetchChallenge).toHaveBeenCalledTimes(1) // fresh challenge is still signed (free)
    expect(token).toBe('proof:stored-digest') // proof carries the reused digest
  })

  it('forceFresh ignores a stored digest and consumes anew', async () => {
    const storage = fakeStorage({ k: 'stored-digest' })
    const { deps, spies } = makeDeps(storage, true)
    const token = await resolveGatedAuthToken(deps)
    expect(spies.signAndExecute).toHaveBeenCalledTimes(1)
    expect(storage.getItem('k')).toBe('fresh-digest')
    expect(token).toBe('proof:fresh-digest')
  })
})
