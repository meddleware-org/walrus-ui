// Group a wallet's owned Walrus blobs by `blobId` for display. Re-uploading the same content creates
// multiple independent Blob objects (each its own storage reservation); grouping collapses those into
// one row so My Blobs matches how Walruscan thinks per-blobId, while still exposing each copy.
import type { OwnedBlob } from '@meddleware/walrus-client'

export interface BlobGroup {
  /** Shared Walrus blob id. */
  blobId: string
  /** Size in bytes (identical across copies of the same content). */
  size: number
  /** Furthest storage end epoch across copies — the effective availability of this content. */
  maxEndEpoch: number
  /** True if any copy is certified (i.e. the content is currently available on-chain). */
  anyCertified: boolean
  /** The copy that defines availability (max end epoch); the default target for Extend. */
  representative: OwnedBlob
  /** All underlying Blob objects for this blobId, furthest-expiry first. */
  copies: OwnedBlob[]
}

/** Collapse owned blobs into per-blobId groups, each sorted by end epoch (furthest first). */
export function groupBlobs(blobs: OwnedBlob[]): BlobGroup[] {
  const byId = new Map<string, OwnedBlob[]>()
  for (const b of blobs) {
    const list = byId.get(b.blobId)
    if (list) list.push(b)
    else byId.set(b.blobId, [b])
  }
  const groups: BlobGroup[] = []
  for (const [blobId, copies] of byId) {
    const sorted = [...copies].sort((a, b) => b.endEpoch - a.endEpoch)
    const representative = sorted[0]
    groups.push({
      blobId,
      size: representative.size,
      maxEndEpoch: representative.endEpoch,
      anyCertified: sorted.some((b) => b.certified),
      representative,
      copies: sorted,
    })
  }
  // Most-expiring-soonest groups first (matches the pre-grouping sort), so attention lands on them.
  return groups.sort((a, b) => a.maxEndEpoch - b.maxEndEpoch)
}

/** Epochs of storage left before expiry (clamped at 0). */
export function epochsLeft(endEpoch: number, currentEpoch: number): number {
  return Math.max(0, endEpoch - currentEpoch)
}

/** Human label for a blob's remaining lifetime, transport-independent (no fabricated day estimate). */
export function expiryLabel(endEpoch: number, currentEpoch: number): string {
  const left = epochsLeft(endEpoch, currentEpoch)
  if (left <= 0) return `epoch ${endEpoch} · expired`
  return `epoch ${endEpoch} · ${left} epoch${left === 1 ? '' : 's'} left`
}

/**
 * Epochs that can still be added to a blob before hitting `max_epochs_ahead` (a blob's end epoch
 * cannot exceed `currentEpoch + maxReservation`). Zero means it's already at max lifetime.
 */
export function maxExtendableEpochs(
  endEpoch: number,
  currentEpoch: number,
  maxReservation: number,
): number {
  return Math.max(0, currentEpoch + maxReservation - endEpoch)
}
