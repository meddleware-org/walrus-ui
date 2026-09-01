# @meddleware/walrus-ui

[![License: 0BSD](https://img.shields.io/badge/license-0BSD-blue)](LICENSE)

A Vue 3 SPA for uploading and managing blobs on [Walrus](https://walrus.xyz) decentralised
storage on Sui. Supports NFT-gated operator relays (commission-enforced on-chain via
`access_gate`) with automatic fallback to the public Mysten relay.

## Features

- Connect any Sui wallet (wallet-standard)
- Select between operator relay (supports the app) and public relay (free)
- Upload blobs through an NFT-gated or open relay
- View and extend your owned Walrus blobs
- Two-approval upload flow: register tx → upload → certify tx

## Local development

```bash
npm install
npm run dev
```

> `@meddleware/walrus-relay` is resolved from the npm registry. For local development against an
> unpublished library, use `npm link @meddleware/walrus-relay` or an `overrides` entry pointing at
> a local checkout.

## Environment variables

All `VITE_*` vars are baked into the static bundle at build time.

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_NETWORK` | `testnet` | `testnet` or `mainnet` |
| `VITE_WALRUS_RELAY_TESTNET` | Public Mysten relay | Operator relay URL for testnet |
| `VITE_WALRUS_RELAY_MAINNET` | Public Mysten relay | Operator relay URL for mainnet |
| `VITE_RPC_TESTNET` | `https://sui-testnet-rpc.publicnode.com` | Sui RPC for testnet |
| `VITE_RPC_MAINNET` | `https://fullnode.mainnet.sui.io:443` | Sui RPC for mainnet |
| `VITE_ACCESS_GATE_ID_TESTNET` | — | Gate object ID (testnet; unset = no gate) |
| `VITE_ACCESS_GATE_SOULBOUND_TESTNET` | `false` | `true` if NFTs are soulbound |
| `VITE_ACCESS_GATE_PRICE_MIST_TESTNET` | `0` | Purchase price in MIST |
| `VITE_ACCESS_GATE_ID_MAINNET` | — | Gate object ID (mainnet) |
| `VITE_UPLOAD_RELAY_MAX_TIP_MIST` | `50000000` | Max relay tip cap in MIST (0.05 SUI) |

`ACCESS_GATE_PACKAGE_ID` and `ACCESS_GATE_PLATFORM_CONFIG_ID` are hardcoded in
`@meddleware/walrus-relay` — operators only configure the values listed above.

## Docker build

The Docker context is this repo root. `@meddleware/walrus-relay` resolves from the npm registry,
so the library must be published before building the image.

```bash
docker build \
  --build-arg VITE_NETWORK=testnet \
  --build-arg VITE_WALRUS_RELAY_TESTNET=https://sui-walrus-relay.example.com \
  --build-arg VITE_ACCESS_GATE_ID_TESTNET=0x... \
  --build-arg VITE_ACCESS_GATE_PRICE_MIST_TESTNET=100000000 \
  -t walrus-ui:latest .
```

## Architecture

Thin SPA — no accounting logic, no chain state derivation. The app:
1. Reads config from env vars
2. Wires `@meddleware/walrus-relay` composables (`useAccessGate`, `useWalrusRelay`) to the
   connected wallet
3. Passes a `performUpload` callback to `WalrusUpload`, which holds the `@mysten/walrus` client
   and the upload flow logic
4. Displays results

All financial truth is on-chain. This UI is an orchestration shell.

## License

0BSD
