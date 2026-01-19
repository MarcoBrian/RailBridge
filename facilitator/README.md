# RailBridge Cross-Chain x402 Facilitator

A cross-chain payment facilitator for the x402 protocol, enabling payments where users pay on one EVM chain and servers receive on another (for example, Base → Polygon).

## Features

- **Multi-chain support**: EVM (Base, Base Sepolia, Ethereum, Polygon)
- **Cross-chain payments**: Pay on one EVM chain, receive on another (via `cross-chain` scheme)
- **Secure verification**: Reuses Coinbase's `@x402/core` and `@x402/evm` implementations
- **Easy integration**: Standard x402 protocol endpoints; plug-and-play for merchants

## Architecture

This facilitator extends the x402 protocol using an **extension-based cross-chain design**:

1. **Reusing existing schemes**: Uses `@x402/evm` `ExactEvmScheme` for both same-chain and cross-chain payments
2. **Extension-based routing**: Cross-chain payments use the `exact` scheme with a `cross-chain` extension that specifies:
   - Destination network (where merchant receives)
   - Destination asset (token on destination chain)
   - Destination payTo (merchant address on destination chain)
3. **Client transparency**: Clients only need to register the `exact` scheme - they don't need cross-chain awareness
4. **Merchant control**: Merchants specify cross-chain requirements via extensions, and the facilitator handles routing
5. **Bridge integration**: Cross-chain bridging happens automatically after settlement via a pluggable `BridgeService`

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

**Request (example, cross-chain Base Sepolia → Ethereum Sepolia):**
```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {
      "scheme": "exact",
      "network": "eip155:84532",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "amount": "10000",
      "payTo": "0xFacilitatorAddress"
    },
    "payload": { "...": "EIP-3009 authorization payload" },
    "extensions": {
      "cross-chain": {
        "destinationNetwork": "eip155:11155111",
        "destinationAsset": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        "destinationPayTo": "0xMerchantAddress"
      }
    }
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "eip155:84532",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "amount": "10000",
    "payTo": "0xFacilitatorAddress"
  }
}
```

**Response:**
```json
{
  "isValid": true,
  "payer": "0xUserAddress"
}
```

### POST /settle

Settle a payment on-chain (and bridge cross-chain if needed).

**Request:** Same as `/verify`

**Response (example, cross-chain payment):**
```json
{
  "success": true,
  "transaction": "0xSourceChainTxHash",
  "network": "eip155:84532",
  "payer": "0xUserAddress"
}
```

**Note**: The transaction hash is from the source chain (where payment was settled). Cross-chain bridging happens asynchronously in the `onAfterSettle` hook.

### GET /supported

Get list of supported payment schemes, networks, and extensions.

**Response (example):**
```json
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:84532"
    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:8453"
    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:11155111"
    }
  ],
  "extensions": [
    {
      "key": "cross-chain",
      "schema": {
        "type": "object",
        "properties": {
          "destinationNetwork": { "type": "string" },
          "destinationAsset": { "type": "string" },
          "destinationPayTo": { "type": "string" }
        }
      }
    }
  ],
  "signers": {
    "eip155:*": ["0xFacilitatorSignerAddress"]
  }
}
```

**Note**: Cross-chain is implemented via extensions, not a separate scheme. The facilitator supports `exact` scheme on multiple networks, and cross-chain routing is handled via the `cross-chain` extension.

## How Cross-Chain Payments Work (EVM → EVM)

### Extension-Based Design

Cross-chain payments use the **extension-based design** where:
- **Route network** = Source chain (where user pays)
- **Extension** = Destination chain info (where merchant receives)
- **Base scheme** = `exact` (same for both same-chain and cross-chain)

### Payment Flow

1. **Merchant** defines payment requirements with:
   - `network`: Source chain (e.g., `eip155:84532` for Base Sepolia)
   - `scheme`: `"exact"`
   - `payTo`: Facilitator address (where user pays on source chain)
   - `extensions.cross-chain`: Destination chain info (network, asset, payTo)

2. **Client** receives payment requirements and:
   - Sees `scheme: "exact"` and `network: "eip155:84532"` (source chain)
   - Creates payment payload on source chain using standard `exact` scheme
   - **No cross-chain awareness needed** - client just pays on the source chain

3. **Merchant server** calls facilitator `/verify`:
   - Facilitator detects `cross-chain` extension in requirements
   - Verifies payment signature on source chain (using `ExactEvmScheme`)
   - Checks bridge liquidity on destination chain
   - Validates exchange rates if assets differ

4. **Merchant server** calls facilitator `/settle`:
   - Facilitator settles payment on source chain (funds locked in bridge)
   - `onAfterSettle` hook triggers cross-chain bridging
   - Bridge service bridges funds to destination chain
   - Merchant receives funds on destination chain

5. **Merchant server** receives settlement confirmation and fulfills request, returning `PAYMENT-RESPONSE` header to client

## Bridge Integration

The `BridgeService` class is a stub that needs to be integrated with your actual bridge:

- **Wormhole**: For cross-chain message passing
- **LayerZero**: For omnichain interoperability
- **Custom RailBridge**: Your own bridge implementation

See `src/services/bridgeService.ts` for the interface to implement.

## Merchant Integration Guide

### Overview

Merchants integrate with RailBridge by:
1. Setting up a merchant server with x402 payment middleware
2. Configuring payment requirements with cross-chain extensions
3. Pointing to the RailBridge facilitator for verification and settlement

### Step 1: Install Dependencies

```bash
npm install @x402/express @x402/core @x402/evm
```

### Step 2: Same-Chain Payment Setup

For same-chain payments (user and merchant on the same chain):

```ts
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}`;

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);

registerExactEvmScheme(resourceServer, {
  networks: ["eip155:84532", "eip155:8453"], // Base Sepolia, Base Mainnet
});

const routes = {
  "GET /api/premium": {
    accepts: [
      {
        scheme: "exact" as const,
        network: "eip155:84532" as const, // Base Sepolia
        price: "$0.01",
        payTo: MERCHANT_ADDRESS, // Merchant receives directly
      },
    ],
    description: "Premium API endpoint",
    mimeType: "application/json",
  },
};

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

### Step 3: Cross-Chain Payment Setup

For cross-chain payments (user pays on source chain, merchant receives on destination chain):

```ts
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { declareCrossChainExtension, CROSS_CHAIN } from "./extensions/crossChain";
import type { AssetAmount } from "@x402/core/types";

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const FACILITATOR_ADDRESS = process.env.FACILITATOR_ADDRESS as `0x${string}`;
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}`;

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);

registerExactEvmScheme(resourceServer, {
  networks: ["eip155:84532", "eip155:11155111"], // Base Sepolia, Ethereum Sepolia
});

// Initialize routes with facilitator address
async function initializeRoutes() {
  let facilitatorAddr = FACILITATOR_ADDRESS;
  
  // Fetch facilitator address if not set
  if (!facilitatorAddr) {
    const supported = await facilitatorClient.getSupported();
    const evmSigners = supported.signers["eip155:*"];
    if (evmSigners && evmSigners.length > 0) {
      facilitatorAddr = evmSigners[0] as `0x${string}`;
    }
  }

  return {
    "GET /api/premium": {
      accepts: [
        {
          scheme: "exact" as const,
          network: "eip155:84532" as const, // Source chain (where user pays)
          price: {
            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
            amount: "10000", // Amount in atomic units (6 decimals for USDC)
            extra: {
              name: "USDC",
              version: "2",
            },
          } as AssetAmount,
          payTo: facilitatorAddr, // Facilitator address (where user pays on source chain)
        },
      ],
      description: "Premium API endpoint",
      mimeType: "application/json",
      extensions: {
        [CROSS_CHAIN]: declareCrossChainExtension({
          destinationNetwork: "eip155:11155111", // Ethereum Sepolia (where merchant receives)
          destinationAsset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // USDC on Ethereum Sepolia
          destinationPayTo: MERCHANT_ADDRESS, // Merchant address on destination chain
        }),
      },
    },
  };
}

async function startServer() {
  const routes = await initializeRoutes();
  
  const app = express();
  app.use(express.json());
  app.use(paymentMiddleware(routes, resourceServer));
  
  app.get("/api/premium", (req, res) => {
    res.json({ message: "Premium content", ts: Date.now() });
  });
  
  app.listen(4021, () => {
    console.log("🛒 Merchant server on http://localhost:4021");
  });
}

startServer().catch(console.error);
```

### Key Points for Cross-Chain Setup

1. **Source Network**: Set `network` in `accepts` to the source chain (where users pay)
2. **Facilitator Address**: Set `payTo` to the facilitator address (not merchant address)
3. **Cross-Chain Extension**: Add `extensions.cross-chain` with:
   - `destinationNetwork`: Chain where merchant receives
   - `destinationAsset`: Token address on destination chain
   - `destinationPayTo`: Merchant address on destination chain
4. **Async Initialization**: Use `async` function to fetch facilitator address if needed

### Environment Variables

```bash
# Required
FACILITATOR_URL=http://localhost:4022
MERCHANT_ADDRESS=0xYourMerchantAddressOnDestinationChain

# Optional (will be fetched if not set)
FACILITATOR_ADDRESS=0xFacilitatorAddressOnSourceChain
```

## Client Integration Guide

### Overview

**Key Point**: Clients don't need cross-chain awareness! They only register the `exact` scheme and pay on the source chain. The merchant and facilitator handle cross-chain routing automatically.

### Step 1: Install Dependencies

```bash
npm install @x402/core @x402/evm @x402/fetch viem
```

### Step 2: Basic Client Setup

```ts
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";

// Create signer from private key
const signer = privateKeyToAccount(process.env.CLIENT_PRIVATE_KEY as `0x${string}`);

// Create viem wallet client for signing
const viemClient = createWalletClient({
  account: signer,
  chain: baseSepolia,
  transport: http(process.env.EVM_RPC_URL || "https://sepolia.base.org"),
});

// Create x402 client
const client = new x402Client();

// Register EVM scheme - this is all you need!
// Works for both same-chain and cross-chain payments
registerExactEvmScheme(client, { signer });

// Wrap fetch with payment handling
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Make payment-protected request
const response = await fetchWithPayment("http://localhost:4021/api/premium");
console.log("Status:", response.status);
console.log("Body:", await response.json());
```

### Step 3: Network Selection (Optional)

If you want to prefer specific networks, provide a network selector:

```ts
import type { PaymentRequirements } from "@x402/core/types";

const networkSelector = (
  _x402Version: number,
  options: PaymentRequirements[],
): PaymentRequirements => {
  // Prefer Base Sepolia, then Base Mainnet
  const preferredNetworks = ["eip155:84532", "eip155:8453"];
  
  for (const preferredNetwork of preferredNetworks) {
    const match = options.find(opt => opt.network === preferredNetwork);
    if (match) return match;
  }
  
  // Fallback to first available
  return options[0];
};

const client = new x402Client(networkSelector);
registerExactEvmScheme(client, { signer });
```

### Step 4: Handling Payment Response

After a successful payment, the merchant server returns a `PAYMENT-RESPONSE` header with settlement details:

```ts
import { httpClient } from "@x402/core/http";

const response = await fetchWithPayment("http://localhost:4021/api/premium");

if (response.ok) {
  // Extract payment receipt from headers
  try {
    const receipt = httpClient.getPaymentSettleResponse(response);
    console.log("Payment successful!");
    console.log("Transaction:", receipt.transaction);
    console.log("Network:", receipt.network);
    console.log("Payer:", receipt.payer);
  } catch (error) {
    console.warn("Could not extract payment receipt:", error);
  }
  
  const data = await response.json();
  console.log("Response:", data);
}
```

### How It Works for Cross-Chain Payments

1. **Client** receives payment requirements from merchant:
   - Sees `scheme: "exact"` and `network: "eip155:84532"` (source chain)
   - **Doesn't see** the cross-chain extension (it's server-side only)

2. **Client** creates payment payload:
   - Signs payment on source chain (Base Sepolia) using standard `exact` scheme
   - Sends payment to merchant server

3. **Merchant server** detects cross-chain extension:
   - Routes to facilitator with cross-chain extension
   - Facilitator verifies on source chain
   - Facilitator settles on source chain
   - Facilitator bridges to destination chain

4. **Client** receives response:
   - Gets `PAYMENT-RESPONSE` header with source chain transaction
   - **No awareness** that payment was bridged to another chain

### Complete Example

See `src/client-example.ts` for a complete working example with error handling and logging.

### Environment Variables

```bash
# Required
CLIENT_PRIVATE_KEY=0xYourPrivateKey

# Optional
EVM_RPC_URL=https://sepolia.base.org
MERCHANT_URL=http://localhost:4021
```

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

## Quick Reference

### Same-Chain vs Cross-Chain Setup

| Aspect | Same-Chain | Cross-Chain |
|--------|-----------|-------------|
| **Scheme** | `"exact"` | `"exact"` (same!) |
| **Network** | Merchant's chain | Source chain (where user pays) |
| **payTo** | Merchant address | Facilitator address |
| **Extension** | None | `cross-chain` extension required |
| **Client Awareness** | None | None (transparent to client) |
| **Settlement** | Direct to merchant | Source chain → Bridge → Destination chain |

### Key Configuration Fields

**For Cross-Chain Payments:**

```ts
{
  scheme: "exact",                    // Always "exact"
  network: "eip155:84532",            // Source chain (where user pays)
  payTo: facilitatorAddress,         // Facilitator address (not merchant!)
  extensions: {
    "cross-chain": {
      destinationNetwork: "eip155:11155111",  // Where merchant receives
      destinationAsset: "0x...",              // Token on destination
      destinationPayTo: merchantAddress       // Merchant on destination
    }
  }
}
```

### Common Issues

1. **Payment bypasses middleware**: Ensure route handler is registered AFTER middleware
2. **Missing PAYMENT-RESPONSE header**: Check that settlement completed successfully
3. **Facilitator not called**: Verify `FACILITATOR_URL` is correct and facilitator is running
4. **Cross-chain not working**: Ensure `payTo` is set to facilitator address, not merchant address

## License

MIT

