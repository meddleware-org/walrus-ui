import { describe, it, expect } from 'vitest'
import {
  groupBlobs,
  epochsLeft,
  expiryLabel,
  maxExtendableEpochs,
} from '../src/blob-groups.js'
import type { OwnedBlob } from '@meddleware/walrus-client'

function blob(p: Partial<OwnedBlob> & { objectId: string; blobId: string }): OwnedBlob {
  return { size: 1024, endEpoch: 100, certified: false, ...p }
}

describe('groupBlobs', () => {
  it('collapses copies of the same blobId, furthest end epoch first', () => {
    const groups = groupBlobs([
      blob({ objectId: 'a1', blobId: 'A', endEpoch: 560, certified: false }),
      blob({ objectId: 'a2', blobId: 'A', endEpoch: 572, certified: true }),
      blob({ objectId: 'b1', blobId: 'B', endEpoch: 600, certified: true }),
    ])
    expect(groups.map((g) => g.blobId)).toEqual(['A', 'B']) // sorted by soonest maxEndEpoch
    const a = groups.find((g) => g.blobId === 'A')!
    expect(a.copies.map((c) => c.objectId)).toEqual(['a2', 'a1']) // furthest-expiry first
    expect(a.maxEndEpoch).toBe(572)
    expect(a.representative.objectId).toBe('a2')
    expect(a.anyCertified).toBe(true)
  })

  it('marks a group uncertified when no copy is certified', () => {
    const [g] = groupBlobs([blob({ objectId: 'x', blobId: 'X', certified: false })])
    expect(g.anyCertified).toBe(false)
  })
})

describe('epoch helpers', () => {
  it('epochsLeft clamps at zero', () => {
    expect(epochsLeft(572, 519)).toBe(53)
    expect(epochsLeft(500, 519)).toBe(0)
  })

  it('expiryLabel shows epochs remaining (no fabricated days) and handles expiry', () => {
    expect(expiryLabel(572, 519)).toBe('epoch 572 · 53 epochs left')
    expect(expiryLabel(520, 519)).toBe('epoch 520 · 1 epoch left')
    expect(expiryLabel(500, 519)).toBe('epoch 500 · expired')
  })

  it('maxExtendableEpochs caps at currentEpoch + maxReservation', () => {
    // current 519, max reservation 53 ⇒ ceiling epoch 572.
    expect(maxExtendableEpochs(560, 519, 53)).toBe(12)
    expect(maxExtendableEpochs(572, 519, 53)).toBe(0) // already at max lifetime
  })
})
