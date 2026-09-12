// Unit tests for pending-certify persistence (uploaded-but-not-certified blobs). Fake StorageLike.
import { describe, it, expect } from 'vitest'
import {
  pendingCertifyKey,
  loadPendingCertifies,
  savePendingCertify,
  clearPendingCertify,
} from '../src/certify-resume.js'
import type { StorageLike } from '../src/access-resume.js'

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const entry = {
  blobId: 'BLOB1',
  blobObjectId: 'OBJ1',
  certificate: 'CERT_B64',
  deletable: false,
}

describe('pending-certify persistence', () => {
  it('key is namespaced by network + address', () => {
    expect(pendingCertifyKey('testnet', '0xabc')).toBe('mw:walrus:pendingCertify:testnet:0xabc')
  })

  it('saves, loads (keyed by blobObjectId), and clears a pending certification', () => {
    const storage = fakeStorage()
    const key = pendingCertifyKey('testnet', '0xabc')

    savePendingCertify(storage, key, entry)
    const map = loadPendingCertifies(storage, key)
    expect(Object.keys(map)).toEqual(['OBJ1'])
    expect(map.OBJ1).toMatchObject(entry)
    expect(typeof map.OBJ1.savedAt).toBe('number')

    clearPendingCertify(storage, key, 'OBJ1')
    expect(loadPendingCertifies(storage, key)).toEqual({})
    // Last entry removed ⇒ the key itself is dropped.
    expect(storage.getItem(key)).toBeNull()
  })

  it('keeps other entries when clearing one', () => {
    const storage = fakeStorage()
    const key = pendingCertifyKey('testnet', '0xabc')
    savePendingCertify(storage, key, entry)
    savePendingCertify(storage, key, { ...entry, blobId: 'BLOB2', blobObjectId: 'OBJ2' })
    clearPendingCertify(storage, key, 'OBJ1')
    const map = loadPendingCertifies(storage, key)
    expect(Object.keys(map)).toEqual(['OBJ2'])
  })

  it('returns an empty map for missing or corrupt data', () => {
    const storage = fakeStorage()
    const key = pendingCertifyKey('testnet', '0xabc')
    expect(loadPendingCertifies(storage, key)).toEqual({})
    storage.setItem(key, 'not json')
    expect(loadPendingCertifies(storage, key)).toEqual({})
  })
})
