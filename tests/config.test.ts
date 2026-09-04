// Unit tests for env-driven config resolution. The env-reading helpers accept an injectable env bag
// (default: the module's frozen import.meta.env), so each branch is exercised deterministically —
// Vite inlines/freezes import.meta.env at transform time, which makes vi.stubEnv unreliable here.
import { describe, it, expect } from 'vitest'
import {
  relayHosts,
  uploadRelayMaxTipMist,
  accessGate,
  DEFAULT_UPLOAD_RELAY_MAX_TIP_MIST,
  PUBLIC_WALRUS_RELAY_HOSTS,
  type EnvSource,
} from '../src/config.js'

describe('uploadRelayMaxTipMist', () => {
  it('defaults when the env var is unset', () => {
    expect(uploadRelayMaxTipMist({})).toBe(DEFAULT_UPLOAD_RELAY_MAX_TIP_MIST)
  })

  it('uses a valid positive override', () => {
    expect(uploadRelayMaxTipMist({ VITE_UPLOAD_RELAY_MAX_TIP_MIST: '1234567' })).toBe(1234567)
  })

  it('falls back on non-positive or unparseable values', () => {
    expect(uploadRelayMaxTipMist({ VITE_UPLOAD_RELAY_MAX_TIP_MIST: '0' })).toBe(
      DEFAULT_UPLOAD_RELAY_MAX_TIP_MIST,
    )
    expect(uploadRelayMaxTipMist({ VITE_UPLOAD_RELAY_MAX_TIP_MIST: 'nonsense' })).toBe(
      DEFAULT_UPLOAD_RELAY_MAX_TIP_MIST,
    )
  })
})

describe('relayHosts', () => {
  it('returns the public host as fallback for both operator and public when no operator env set', () => {
    const hosts = relayHosts('testnet')
    expect(hosts.public).toBe(PUBLIC_WALRUS_RELAY_HOSTS.testnet)
    // operator defaults to the public host unless VITE_WALRUS_RELAY_TESTNET is set at build time.
    expect(hosts.operator).toBeTruthy()
  })
})

describe('accessGate', () => {
  it('returns null when no gate object id is configured', () => {
    expect(accessGate('testnet', {})).toBeNull()
  })

  it('builds a gate config when a gate id is present (packageId/platformConfigId from the library)', () => {
    const injected: EnvSource = {
      VITE_ACCESS_GATE_ID_TESTNET: '0xgate',
      VITE_ACCESS_GATE_PRICE_MIST_TESTNET: '1000',
    }
    const gate = accessGate('testnet', injected)
    expect(gate).not.toBeNull()
    expect(gate!.gateId).toBe('0xgate')
    expect(gate!.priceMist).toBe(1000n)
    expect(gate!.nftType).toContain('::access_gate::AccessNFT')
    expect(gate!.packageId).toBeTruthy()
    expect(gate!.platformConfigId).toBeTruthy()
  })

  it('marks the NFT type soulbound when the flag is set', () => {
    const gate = accessGate('testnet', {
      VITE_ACCESS_GATE_ID_TESTNET: '0xgate',
      VITE_ACCESS_GATE_SOULBOUND_TESTNET: 'true',
    })
    expect(gate!.soulbound).toBe(true)
    expect(gate!.nftType).toContain('SoulboundAccessNFT')
  })
})
