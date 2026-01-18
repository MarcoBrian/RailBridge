# RailBridge Cross-Chain x402 Facilitator

A cross-chain payment facilitator for the x402 protocol, enabling payments where users pay on one EVM chain and servers receive on another (for example, Base → Polygon).

## Features

- ✅ **Multi-chain support**: EVM (Base, Base Sepolia, Ethereum, Polygon)
- 🌉 **Cross-chain payments**: Pay on one EVM chain, receive on another (via `cross-chain` scheme)
- 🔒 **Secure verification**: Reuses Coinbase's `@x402/core` and `@x402/evm` implementations
- 🚀 **Easy integration**: Standard x402 protocol endpoints; plug-and-play for merchants

## Architecture

This facilitator extends the x402 protocol by:

1. **Reusing existing schemes**: Uses `@x402/evm` `ExactEvmScheme` for single-chain EVM payments
2. **Adding cross-chain scheme**: Implements a new `cross-chain` scheme that orchestrates:
   - Payment verification on source chain
   - Bridge liquidity checks
   - Cross-chain settlement via a pluggable `BridgeService`

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
- `EVM_RPC_URL`: RPC endpoint for EVM chains
- `DEPLOY_ERC4337_WITH_EIP6492` (optional): `true` to enable ERC-4337 smart wallet deployment

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

## API Endpoints (Facilitator)

### POST /verify

Verify a payment payload against requirements.

**Request (example, cross-chain Base → Polygon):**
```json
{
  "paymentPayload": {
    "x402Version": 2,
    "resource": {
      "url": "http://merchant/api/premium",
      "description": "Premium API",
      "mimeType": "application/json"
    },
    "accepted": {
      "scheme": "cross-chain",
      "network": "eip155:137",
      "asset": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      "amount": "100000",
      "payTo": "0xMerchantPolygonAddress"
    },
    "payload": { "...": "scheme-specific payload" },
    "extensions": {
      "sourceNetwork": "eip155:8453",
      "sourceAsset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    }
  },
  "paymentRequirements": { "...": "same shape as accepted" }
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

Settle a payment on-chain (and bridge cross-chain if needed).

**Request:** Same as `/verify`

**Response (example):**
```json
{
  "success": true,
  "transaction": "0xDestinationChainTxHash",
  "network": "eip155:137",
  "payer": "0xPayerAddress"
}
```

### GET /supported

Get list of supported payment schemes and networks.

**Response (shape):**
```json
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:8453"
    },
    {
      "x402Version": 2,
      "scheme": "cross-chain",
      "network": "eip155:137",
      "extra": {
        "crossChain": true,
        "supportedSourceChains": [
          "eip155:8453",
          "eip155:84532",
          "eip155:1",
          "eip155:137"
        ]
      }
    }
  ],
  "extensions": [],
  "signers": { "eip155:*": ["0xFacilitatorSigner..."] }
}
```

## How Cross-Chain Payments Work (EVM → EVM)

1. **Client** creates a payment payload on the **source** EVM chain (e.g., Base)
2. **Merchant server** receives the request and the x402 middleware calls facilitator `/verify`
3. **Facilitator** verifies:
   - Payment signature on source chain (using `ExactEvmScheme`)
   - Bridge liquidity on destination chain (via `BridgeService.checkLiquidity`)
   - Exchange rates if source/destination assets differ
4. **Merchant server** calls facilitator `/settle`
5. **Facilitator**:
   - Settles payment on source chain (locks funds in bridge)
   - Bridges funds via `BridgeService.bridge`
   - Delivers funds on destination chain
6. **Merchant server** receives settlement confirmation and fulfills request, returning a `PAYMENT-RESPONSE` header to the client

## Bridge Integration

The `BridgeService` class is a stub that needs to be integrated with your actual bridge:

- **Wormhole**: For cross-chain message passing
- **LayerZero**: For omnichain interoperability
- **Custom RailBridge**: Your own bridge implementation

See `src/services/bridgeService.ts` for the interface to implement.

## Server Integration (Merchant)

A merchant integrates with this facilitator by:

1. Running the facilitator (`src/facilitator-implementation.ts`)
2. Running a merchant server that points to the facilitator (for example `src/merchant-server.ts`)

### Minimal Express Merchant Server

```ts
import dotenv from "dotenv";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

dotenv.config();

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}`;

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(resourceServer, {});

const routes = {
  "GET /api/premium": {
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        price: "$0.01",
        payTo: MERCHANT_ADDRESS,
      },
      {
        scheme: "cross-chain",
        network: "eip155:137",
        price: "$0.01",
        payTo: MERCHANT_ADDRESS,
      },
    ],
    description: "Premium API endpoint",
    mimeType: "application/json",
  },
} as const;

const app = express();
app.use(express.json());

app.use(paymentMiddleware(routes, resourceServer));

app.get("/api/premium", (req, res) => {
  res.json({ message: "Premium content", ts: Date.now() });
});

app.listen(4021, () => {
  console.log("🛒 Merchant server on http://localhost:4021");
});
```

### Env for Merchant

```bash
FACILITATOR_URL=http://localhost:4022
MERCHANT_ADDRESS=0xYourBaseAddress
```

## Client Integration

A client needs to:

1. Create an x402 client
2. Register the EVM scheme
3. Wrap `fetch` with `wrapFetchWithPayment`
4. Call the merchant endpoint

### Minimal EVM Client (same-chain)

```ts
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

async function main() {
  const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);

  const client = new x402Client();
  registerExactEvmScheme(client, { signer });

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const response = await fetchWithPayment("http://localhost:4021/api/premium");
  console.log("Status:", response.status);
  console.log("Body:", await response.json());
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

### Cross-Chain Client (Conceptual)

For cross-chain, the client still signs an EVM `exact` payload on the source chain, but:

- Chooses `scheme: "cross-chain"` / destination `network`
- Includes `extensions.sourceNetwork` and `extensions.sourceAsset`

A thin helper (not yet implemented) can wrap the existing EVM client to:

- Create the `exact` payload
- Wrap it into a `PaymentPayload` with `scheme: "cross-chain"`
- Attach the required `extensions`

This keeps your merchant and facilitator APIs unchanged while allowing richer client behavior over time.

## Development

### Project Structure

```
facilitator/
├── src/
│   ├── facilitator-implementation.ts  # Main facilitator server (EVM + cross-chain)
│   ├── merchant-server.ts    # Example merchant Express server
│   ├── schemes/
│   │   └── crossChainRouter.ts  # Cross-chain routing wrapper (delegates to ExactEvmScheme)
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

