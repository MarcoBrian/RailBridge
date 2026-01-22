## Merchant Integration Guide

This guide walks you through integrating RailBridge x402 payments into your Express.js application to accept same-chain or cross-chain payments.

### 1. Prerequisites

- Node.js 18+ and npm
- An existing Express.js application (or create a new one)
- Access to a hosted RailBridge facilitator service
- A funded merchant wallet on your destination chain

### 2. Install x402 Packages

In your project, install the required x402 packages:

```bash
npm install @x402/express @x402/core @x402/evm @x402/paywall
```

### 3. Configure Environment Variables

Set these environment variables in your production environment:

- `FACILITATOR_URL` - The hosted RailBridge facilitator service URL (e.g., `https://facilitator.railbridge.io`)
- `FACILITATOR_ADDRESS` - The facilitator's address on the source chain (for cross-chain payments). Get this from the facilitator's `/supported` endpoint or from the facilitator service documentation.
- `MERCHANT_ADDRESS` - Your merchant address on the destination chain

### 4. Basic Setup

Start by creating the core components:

```typescript
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";

const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.railbridge.io";
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}`;

// Create facilitator client
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

// Create resource server
const resourceServer = new x402ResourceServer(facilitatorClient);

// Register EVM scheme
registerExactEvmScheme(resourceServer, {
  networks: [
    "eip155:84532", // Base Sepolia
    "eip155:8453",  // Base Mainnet
    "eip155:1",     // Ethereum Mainnet
    "eip155:11155111", // Ethereum Sepolia
    "eip155:137",   // Polygon
  ],
});

// Create paywall for browser requests
const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "Your App Name",
    testnet: true, // Set to false for mainnet
  })
  .build();

const app = express();
app.use(express.json());
```

### 5. Same-Chain Payment Integration

For same-chain payments (user and merchant on the same chain):

```typescript
// Define routes with payment requirements
const routes = {
  "GET /api/premium": {
    accepts: [
      {
        scheme: "exact" as const,
        network: "eip155:84532" as const, // Base Sepolia
        price: "$0.01", // Simple price string
        payTo: MERCHANT_ADDRESS, // Merchant receives directly
      },
    ],
    description: "Premium API endpoint",
    mimeType: "application/json",
  },
};

// Register payment middleware BEFORE route handlers
app.use(
  paymentMiddleware(
    routes,
    resourceServer,
    undefined, // paywallConfig (optional)
    paywall,   // paywall provider
    true,      // syncFacilitatorOnStart
  ),
);

// Your protected route handler
app.get("/api/premium", (req, res) => {
  // Payment has been verified and settled at this point
  res.json({
    message: "Premium content",
    data: { timestamp: Date.now() },
  });
});
```

### 6. Cross-Chain Payment Integration

For cross-chain payments (user pays on source chain, merchant receives on destination chain):

**Note**: For cross-chain payments, you'll need to copy the `crossChain.ts` extension file from this repository's `src/extensions/` directory into your project, or install it as a package if available.

```typescript
import { declareCrossChainExtension, CROSS_CHAIN } from "./extensions/crossChain";
import type { AssetAmount } from "@x402/core/types";

const FACILITATOR_ADDRESS = process.env.FACILITATOR_ADDRESS as `0x${string}`;

// Define routes with cross-chain extension
const routes = {
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
        payTo: FACILITATOR_ADDRESS, // Facilitator address on source chain
        extra: {
          description: "Cross-chain payment: Pay on Base Sepolia, receive on Ethereum Sepolia",
        },
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

// Register payment middleware
app.use(
  paymentMiddleware(
    routes,
    resourceServer,
    undefined,
    paywall,
    true,
  ),
);

// Protected route handler
app.get("/api/premium", (req, res) => {
  res.json({
    message: "Premium content",
    data: { timestamp: Date.now() },
  });
});
```

### 7. Multiple Payment Options

You can offer multiple payment options (different networks or prices):

```typescript
const routes = {
  "GET /api/premium": {
    accepts: [
      // Option 1: Base Sepolia
      {
        scheme: "exact" as const,
        network: "eip155:84532" as const,
        price: "$0.01",
        payTo: MERCHANT_ADDRESS,
      },
      // Option 2: Polygon (same-chain)
      {
        scheme: "exact" as const,
        network: "eip155:137" as const,
        price: "$0.01",
        payTo: MERCHANT_ADDRESS, // Must be valid on Polygon
      },
      // Option 3: Cross-chain from Base to Ethereum
      {
        scheme: "exact" as const,
        network: "eip155:84532" as const,
        price: {
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          amount: "10000",
          extra: { name: "USDC", version: "2" },
        } as AssetAmount,
        payTo: FACILITATOR_ADDRESS,
      },
    ],
    description: "Premium API endpoint",
    mimeType: "application/json",
    extensions: {
      [CROSS_CHAIN]: declareCrossChainExtension({
        destinationNetwork: "eip155:11155111",
        destinationAsset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        destinationPayTo: MERCHANT_ADDRESS,
      }),
    },
  },
};
```

**Note**: The cross-chain extension applies to all `accepts` entries. If you want some same-chain and some cross-chain options, define separate routes.

### 8. Accessing Payment Information

After a successful payment, you can access settlement details from response headers:

```typescript
app.get("/api/premium", (req, res) => {
  // Payment transaction hash
  const paymentTx = res.getHeader("x-payment-transaction");
  
  // Payment network
  const paymentNetwork = res.getHeader("x-payment-network");
  
  // Payment payer address
  const paymentPayer = res.getHeader("x-payment-payer");
  
  // Or use the httpClient helper
  import { httpClient } from "@x402/core/http";
  const receipt = httpClient.getPaymentSettleResponse(res);
  // receipt.transaction, receipt.network, receipt.payer
  
  res.json({
    message: "Premium content",
    paymentTx,
    paymentNetwork,
    paymentPayer,
  });
});
```

### 9. Error Handling

The payment middleware automatically handles:
- **402 Payment Required**: When no payment is provided
- **400 Bad Request**: When payment is invalid
- **500 Internal Server Error**: When facilitator is unreachable or settlement fails

You can add custom error handling:

```typescript
// Error handler after middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Error:", err);
  
  if (!res.headersSent) {
    // Check if it's a payment-related error
    if (err.message.includes("payment") || err.message.includes("402")) {
      res.status(402).json({ error: "Payment required" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});
```

### 10. Advanced: Logging and Monitoring

Add logging hooks to track payment flow:

```typescript
// Before settlement
resourceServer.onBeforeSettle(async (context) => {
  console.log("Before settle:", {
    scheme: context.requirements.scheme,
    network: context.requirements.network,
    amount: context.requirements.amount,
  });
});

// After successful settlement
resourceServer.onAfterSettle(async (context) => {
  console.log("After settle:", {
    success: context.result.success,
    transaction: context.result.transaction,
    network: context.result.network,
  });
});

// On settlement failure
resourceServer.onSettleFailure(async (context) => {
  console.error("Settle failure:", {
    error: context.error.message,
    scheme: context.requirements.scheme,
    network: context.requirements.network,
  });
});
```

### 11. Complete Example: Same-Chain

```typescript
import dotenv from "dotenv";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";

dotenv.config();

const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.railbridge.io";
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}`;

if (!MERCHANT_ADDRESS) {
  console.error("MERCHANT_ADDRESS environment variable is required");
  process.exit(1);
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);

registerExactEvmScheme(resourceServer, {
  networks: ["eip155:84532", "eip155:8453"],
});

const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "My Merchant App",
    testnet: true,
  })
  .build();

const routes = {
  "GET /api/premium": {
    accepts: [
      {
        scheme: "exact" as const,
        network: "eip155:84532" as const,
        price: "$0.01",
        payTo: MERCHANT_ADDRESS,
      },
    ],
    description: "Premium API endpoint",
    mimeType: "application/json",
  },
};

const app = express();
app.use(express.json());

app.use(
  paymentMiddleware(
    routes,
    resourceServer,
    undefined,
    paywall,
    true,
  ),
);

app.get("/api/premium", (req, res) => {
  res.json({ message: "Premium content", ts: Date.now() });
});

app.listen(4021, () => {
  console.log("Merchant server listening on http://localhost:4021");
});
```

### 12. Complete Example: Cross-Chain

**Note**: Copy the `crossChain.ts` extension file from this repository's `src/extensions/` directory into your project.

```typescript
import dotenv from "dotenv";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import { declareCrossChainExtension, CROSS_CHAIN } from "./extensions/crossChain";
import type { AssetAmount } from "@x402/core/types";

dotenv.config();

const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.railbridge.io";
const FACILITATOR_ADDRESS = process.env.FACILITATOR_ADDRESS as `0x${string}`;
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}`;

if (!MERCHANT_ADDRESS || !FACILITATOR_ADDRESS) {
  console.error("MERCHANT_ADDRESS and FACILITATOR_ADDRESS are required");
  process.exit(1);
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);

registerExactEvmScheme(resourceServer, {
  networks: ["eip155:84532", "eip155:11155111"],
});

const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "My Merchant App",
    testnet: true,
  })
  .build();

const routes = {
  "GET /api/premium": {
    accepts: [
      {
        scheme: "exact" as const,
        network: "eip155:84532" as const,
        price: {
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          amount: "10000",
          extra: { name: "USDC", version: "2" },
        } as AssetAmount,
        payTo: FACILITATOR_ADDRESS,
      },
    ],
    description: "Premium API endpoint",
    mimeType: "application/json",
    extensions: {
      [CROSS_CHAIN]: declareCrossChainExtension({
        destinationNetwork: "eip155:11155111",
        destinationAsset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        destinationPayTo: MERCHANT_ADDRESS,
      }),
    },
  },
};

const app = express();
app.use(express.json());

app.use(
  paymentMiddleware(
    routes,
    resourceServer,
    undefined,
    paywall,
    true,
  ),
);

app.get("/api/premium", (req, res) => {
  res.json({ message: "Premium content", ts: Date.now() });
});

app.listen(4021, () => {
  console.log("Merchant server listening on http://localhost:4021");
});
```

### 13. Testing Your Integration

1. **Test without payment**: Make a request without payment headers - you should get `402 Payment Required`
2. **Test with invalid payment**: Send an invalid payment signature - you should get `400 Bad Request`
3. **Test with valid payment**: Use a client that supports x402 to make a payment - you should get `200 OK` with your content

### 14. Common Issues and Solutions

**Issue**: Payment middleware not intercepting requests
- **Solution**: Ensure `paymentMiddleware` is registered **before** your route handlers

**Issue**: `402 Payment Required` even after payment
- **Solution**: Check that `FACILITATOR_URL` is correct and the facilitator is reachable

**Issue**: Cross-chain payments not working
- **Solution**: Verify `FACILITATOR_ADDRESS` is set correctly and matches the facilitator's address on the source chain

**Issue**: Wrong network in payment requirements
- **Solution**: Ensure the networks in `registerExactEvmScheme` include all networks you want to support

