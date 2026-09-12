// Persistence for "uploaded but not yet certified" blobs, so certification can be completed later —
// after a tab switch OR a full page reload — from the My Blobs page, without re-uploading.
//
// A Walrus upload is register → upload → certify. Register + upload are paid and, with the tip relay,
// cannot be replayed (the register tx ages out — see upload-flow.ts). If certify doesn't happen (the
// user dismisses the prompt), the blob is registered + stored + paid but uncertified. The storage-node
// availability certificate returned by the upload step is all that's needed to certify, and it is not
// a secret, so we persist it keyed by (network, address). `@meddleware/walrus-client`'s
// `certifyBlobTransaction` accepts that base64 certificate directly — certify is a plain owner tx.

import type { StorageLike } from './access-resume.js'

/** A stored pending certification, keyed in the map by `blobObjectId`. */
export interface PendingCertify {
  /** The Walrus blob id (for display / matching). */
  blobId: string
  /** The on-chain Blob object id — the map key and the object being certified. */
  blobObjectId: string
  /** Base64 availability certificate from the upload step (accepted directly by the SDK). */
  certificate: string
  /** How the blob was registered (our uploads are non-deletable). */
  deletable: boolean
  /** Epoch ms the entry was saved, for display / housekeeping. */
  savedAt: number
}

/** Stable per-(network, address) key under which pending certifications are stored. */
export function pendingCertifyKey(network: string, address: string): string {
  return `mw:walrus:pendingCertify:${network}:${address}`
}

/** Read the pending-certify map (keyed by blobObjectId); empty object if none/corrupt. */
export function loadPendingCertifies(
  storage: StorageLike,
  key: string,
): Record<string, PendingCertify> {
  const raw = storage.getItem(key)
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as Record<string, PendingCertify>
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Persist one pending certification (merged into the map by blobObjectId). */
export function savePendingCertify(
  storage: StorageLike,
  key: string,
  entry: Omit<PendingCertify, 'savedAt'>,
): void {
  const map = loadPendingCertifies(storage, key)
  map[entry.blobObjectId] = { ...entry, savedAt: Date.now() }
  storage.setItem(key, JSON.stringify(map))
}

/** Remove a pending certification once the blob is certified (or found already certified). */
export function clearPendingCertify(storage: StorageLike, key: string, blobObjectId: string): void {
  const map = loadPendingCertifies(storage, key)
  if (blobObjectId in map) {
    delete map[blobObjectId]
    if (Object.keys(map).length === 0) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(map))
  }
}
