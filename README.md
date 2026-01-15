# RailBridge Cross-Chain x402 Facilitator

A cross-chain payment facilitator for the x402 protocol, enabling payments where users pay on one blockchain and servers receive on another.

## Features

- ✅ **Multi-chain support**: EVM (Base, Ethereum, Polygon) and Solana
- 🌉 **Cross-chain payments**: Pay on any supported chain, receive on any other
- 🔒 **Secure verification**: Reuses Coinbase's battle-tested x402 implementations
- 🚀 **Easy integration**: Standard x402 protocol endpoints

## Architecture

This facilitator extends the x402 protocol by:

1. **Reusing existing schemes**: Uses `@x402/evm` and `@x402/svm` for single-chain payments
2. **Adding cross-chain scheme**: Implements a new `cross-chain` scheme that orchestrates:
   - Payment verification on source chain
   - Bridge liquidity checks
   - Cross-chain settlement via bridge service

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your configuration:

```bash
cp .env.example .env
```

Required variables:
- `EVM_PRIVATE_KEY`: Private key for EVM facilitator wallet
- `SVM_PRIVATE_KEY`: Base58-encoded private key for Solana facilitator wallet
- `EVM_RPC_URL`: RPC endpoint for EVM chains
- `SVM_RPC_URL`: RPC endpoint for Solana

### 3. Run

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

## API Endpoints

### POST /verify

Verify a payment payload against requirements.

**Request:**
```json
{
  "paymentPayload": {
    "x402Version": 2,
    "resource": { ... },
    "accepted": {
      "scheme": "cross-chain",
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "amount": "1000000",
      "payTo": "YourSolanaAddress",
      ...
    },
    "payload": { ... },
    "extensions": {
      "sourceNetwork": "eip155:8453",
      "sourceAsset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    }
  },
  "paymentRequirements": { ... }
}
```

**Response:**
```json
{
  "isValid": true,
  "payer": "0x..."
}
```

### POST /settle

Settle a payment on-chain.

**Request:** Same as `/verify`

**Response:**
```json
{
  "success": true,
  "transaction": "0x...",
  "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "payer": "0x..."
}
```

### GET /supported

Get list of supported payment schemes and networks.

**Response:**
```json
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:8453",
      ...
    },
    {
      "x402Version": 2,
      "scheme": "cross-chain",
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "extra": {
        "crossChain": true,
        "supportedSourceChains": [...]
      }
    }
  ],
  "extensions": [],
  "signers": { ... }
}
```

## How Cross-Chain Payments Work

1. **Client** creates payment payload on source chain (e.g., Base)
2. **Server** receives payload and calls facilitator `/verify`
3. **Facilitator** verifies:
   - Payment signature on source chain
   - Bridge liquidity on destination chain
   - Exchange rates (if different assets)
4. **Server** calls facilitator `/settle`
5. **Facilitator**:
   - Settles payment on source chain (locks in bridge)
   - Bridges funds via bridge service
   - Delivers funds on destination chain
6. **Server** receives settlement confirmation and fulfills request

## Bridge Integration

The `BridgeService` class is a stub that needs to be integrated with your actual bridge:

- **Wormhole**: For cross-chain message passing
- **LayerZero**: For omnichain interoperability
- **Custom RailBridge**: Your own bridge implementation

See `src/services/bridgeService.ts` for the interface to implement.

## Development

### Project Structure

```
facilitator/
├── src/
│   ├── index.ts              # Main facilitator server
│   ├── schemes/
│   │   └── crossChainScheme.ts  # Cross-chain scheme implementation
│   ├── services/
│   │   └── bridgeService.ts     # Bridge service (stub)
│   └── types/
│       └── bridge.ts            # Bridge types
├── package.json
├── tsconfig.json
└── README.md
```

### Adding New Chains

1. Register the chain in the appropriate scheme registration
2. Update bridge service to support the chain
3. Add chain-specific signers if needed

### Testing

```bash
# Type check
npm run typecheck

# Lint
npm run lint
```

## License

MIT

