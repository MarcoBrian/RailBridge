# Merchant Integration Guide

This guide shows how merchants (servers/sellers) can integrate with the RailBridge Cross-Chain Facilitator to accept x402 payments.

## Overview

As a merchant, you'll:
1. **Configure your server** to use the facilitator
2. **Define payment requirements** for your endpoints
3. **Handle payment verification** via facilitator
4. **Settle payments** after fulfilling requests

## Step 1: Install Dependencies

```bash
npm install @x402/core @x402/evm @x402/express
```

## Step 2: Set Up Facilitator Client

Create a facilitator client that points to your facilitator URL:

```typescript
// server.ts
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { x402HTTPResourceServer } from "@x402/core/http";
import express from "express";

// Create facilitator client pointing to your facilitator
const facilitatorClient = new HTTPFacilitatorClient({
  url: "http://localhost:4022", // Your facilitator URL
});

// Create x402 resource server
const server = new x402ResourceServer(facilitatorClient);

// Register EVM schemes (for parsing prices, building requirements)
registerExactEvmScheme(server, {});

// Define your payment-protected routes
const routes = {
  "GET /api/data": {
    accepts: [
      // Standard EVM payment (same chain)
      {
        scheme: "exact",
        network: "eip155:8453", // Base
        price: "$0.01",
        payTo: "0xYourMerchantAddress",
      },
      // Cross-chain payment option
      {
        scheme: "cross-chain",
        network: "eip155:137", // Polygon (destination)
        price: "$0.01",
        payTo: "0xYourMerchantAddressOnPolygon",
        extra: {
          // Cross-chain specific metadata
          supportedSourceChains: ["eip155:8453", "eip155:1"], // Base, Ethereum
        },
      },
    ],
    description: "Premium data endpoint",
  },
};

// Create HTTP resource server
const httpServer = new x402HTTPResourceServer(server, routes);

// Initialize (fetches facilitator capabilities)
await httpServer.initialize();
```

## Step 3: Add Express Middleware

```typescript
import { expressAdapter } from "@x402/express";

const app = express();
app.use(express.json());

// Add x402 payment middleware
app.use(async (req, res, next) => {
  const adapter = expressAdapter(req, res);
  const context = {
    adapter,
    path: req.path,
    method: req.method,
  };

  // Process payment request
  const result = await httpServer.processHTTPRequest(context);

  if (result.type === "no-payment-required") {
    // No payment needed for this route
    return next();
  }

  if (result.type === "payment-error") {
    // Return 402 Payment Required
    res.status(result.response.status);
    Object.entries(result.response.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    return res.send(result.response.body);
  }

  if (result.type === "payment-verified") {
    // Payment is valid! Fulfill the request
    // ... your business logic here ...
    const data = { message: "Premium data", timestamp: Date.now() };

    // Settle the payment
    const settleResult = await httpServer.processSettlement(
      result.paymentPayload,
      result.paymentRequirements,
    );

    if (settleResult.success) {
      // Add settlement headers
      Object.entries(settleResult.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      return res.json(data);
    } else {
      // Settlement failed
      return res.status(500).json({
        error: "Payment settlement failed",
        reason: settleResult.errorReason,
      });
    }
  }
});

// Your regular routes
app.get("/api/data", (req, res) => {
  // This will be protected by x402 middleware above
  res.json({ data: "protected content" });
});

app.listen(3000);
```

## Step 4: Client-Side Payment (How Users Pay)

Users need to create payment payloads. Here's how they do it:

```typescript
// client.ts
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

// Create client
const client = new x402Client();
const signer = privateKeyToAccount("0x..."); // User's wallet

// Register EVM scheme
registerExactEvmScheme(client, { signer });

// For cross-chain payments, you'd need a custom client scheme
// that creates payloads with sourceNetwork/sourceAsset in extensions

// Wrap fetch
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Make request - payment handled automatically
const response = await fetchWithPayment("http://your-api.com/api/data");
const data = await response.json();
```

## Complete Example: Express Server

```typescript
import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { x402HTTPResourceServer } from "@x402/core/http";
import { expressAdapter } from "@x402/express";

const app = express();
app.use(express.json());

// 1. Set up facilitator client
const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.FACILITATOR_URL || "http://localhost:4022",
});

// 2. Create resource server
const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server, {});

// 3. Define routes with payment requirements
const routes = {
  "GET /api/premium": {
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        price: "$0.10",
        payTo: process.env.MERCHANT_ADDRESS!,
      },
      {
        scheme: "cross-chain",
        network: "eip155:137", // Polygon
        price: "$0.10",
        payTo: process.env.MERCHANT_ADDRESS_POLYGON!,
      },
    ],
    description: "Premium API endpoint",
  },
};

// 4. Create HTTP server
const httpServer = new x402HTTPResourceServer(server, routes);

// 5. Initialize (validates routes, fetches facilitator support)
await httpServer.initialize();

// 6. Add middleware
app.use(async (req, res, next) => {
  const adapter = expressAdapter(req, res);
  const context = {
    adapter,
    path: req.path,
    method: req.method,
  };

  const result = await httpServer.processHTTPRequest(context);

  if (result.type === "no-payment-required") {
    return next();
  }

  if (result.type === "payment-error") {
    res.status(result.response.status);
    Object.entries(result.response.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    return res.send(result.response.body);
  }

  if (result.type === "payment-verified") {
    // Fulfill request
    const premiumData = {
      message: "You paid for this!",
      data: "premium content here",
    };

    // Settle payment
    const settleResult = await httpServer.processSettlement(
      result.paymentPayload,
      result.paymentRequirements,
    );

    if (settleResult.success) {
      Object.entries(settleResult.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      return res.json(premiumData);
    } else {
      return res.status(500).json({
        error: "Settlement failed",
        reason: settleResult.errorReason,
      });
    }
  }
});

// Your routes
app.get("/api/premium", (req, res) => {
  // Protected by middleware above
});

app.listen(3000, () => {
  console.log("Merchant server running on port 3000");
});
```

## Environment Variables

```bash
# .env
FACILITATOR_URL=http://localhost:4022
MERCHANT_ADDRESS=0xYourBaseAddress
MERCHANT_ADDRESS_POLYGON=0xYourPolygonAddress
```

## Payment Flow

1. **Client** makes request → `GET /api/premium`
2. **Server** responds with `402 Payment Required` + payment options
3. **Client** creates payment payload and retries with `PAYMENT-SIGNATURE` header
4. **Server** calls facilitator `/verify` endpoint
5. **Facilitator** verifies payment (signature, balance, etc.)
6. **Server** fulfills request (returns premium data)
7. **Server** calls facilitator `/settle` endpoint
8. **Facilitator** executes on-chain transaction (or bridges cross-chain)
9. **Server** returns `200 OK` + data + `PAYMENT-RESPONSE` header

## Cross-Chain Payments

For cross-chain payments, the client needs to specify source chain in the payload:

```typescript
// Client creates cross-chain payload
const paymentPayload = await client.createPaymentPayload({
  scheme: "cross-chain",
  network: "eip155:137", // Destination: Polygon
  price: "$0.10",
  payTo: merchantAddress,
  // Extensions specify source chain
  extensions: {
    sourceNetwork: "eip155:8453", // User pays on Base
    sourceAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
  },
});
```

The facilitator will:
1. Verify payment on Base (source)
2. Check bridge liquidity on Polygon (destination)
3. Settle on Base (lock in bridge)
4. Bridge to Polygon
5. Deliver on Polygon

## Testing

1. Start your facilitator: `cd facilitator && npm run dev`
2. Start your merchant server: `npm run dev`
3. Test with a client that has x402 support

## Next Steps

- Add more payment options (different chains, prices)
- Implement dynamic pricing based on usage
- Add webhook notifications for settlements
- Integrate with your existing payment infrastructure

