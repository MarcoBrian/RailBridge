import dotenv from "dotenv";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import {
  declareCrossChainExtension,
  CROSS_CHAIN,
} from "./extensions/crossChain.js";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

dotenv.config();

// ---------------------------------------------------------------------------
// Merchant-side x402 server that uses your RailBridge facilitator
// ---------------------------------------------------------------------------

// Required env vars for merchant
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}` | undefined;

if (!MERCHANT_ADDRESS) {
  console.error("❌ MERCHANT_ADDRESS environment variable is required");
  process.exit(1);
}

// Create HTTP client that talks to your facilitator
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

// Create core x402 resource server
const resourceServer = new x402ResourceServer(facilitatorClient);

// Register EVM scheme on the server side (price parsing, requirements building)
registerExactEvmScheme(resourceServer, {});

// Define payment-protected routes for this merchant
const routes = {
  "GET /api/premium": {
    accepts: [
      // Simple same-chain EVM payment (Base)
      {
        scheme: "exact" as const,
        network: "eip155:8453" as const, // Base mainnet
        price: "$0.01",
        payTo: MERCHANT_ADDRESS,
      },
      // Example: cross-chain option, destination Polygon (facilitator handles bridging)
      {
        scheme: "cross-chain" as const,
        network: "eip155:137" as const, // Polygon (destination)
        price: "$0.01",
        payTo: MERCHANT_ADDRESS,
        extra: {
          // Optional metadata for your UI / analytics
          description: "Cross-chain payment to Polygon",
        },
      },
    ],
    description: "Premium API endpoint",
    mimeType: "application/json",
    // Extensions: Add cross-chain extension to indicate source chain info
    // Note: The client will copy this extension into PaymentPayload
    // The facilitator will extract it to know where the user is paying from
    extensions: {
      [CROSS_CHAIN]: declareCrossChainExtension(
        "eip155:8453", // Source network: Base (where user pays)
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
      ),
    },
  },
};

// Wrap routes with payment middleware
const app = express();
app.use(express.json());

app.use(
  paymentMiddleware(
    routes,
    resourceServer,
  ),
);

// Business logic route (protected by paymentMiddleware)
app.get("/api/premium", (req, res) => {
  // At this point, payment has been:
  // - Required (402 if unpaid)
  // - Verified via your facilitator
  // - Settled via your facilitator

  res.json({
    message: "You successfully paid for this premium content.",
    data: {
      timestamp: Date.now(),
      value: "premium-data",
    },
  });
});

const PORT = process.env.MERCHANT_PORT || "4021";

app.listen(parseInt(PORT), () => {
  console.log(`🛒 Merchant server listening at http://localhost:${PORT}`);
  console.log(`Using facilitator at: ${FACILITATOR_URL}`);
  console.log(`Merchant address: ${MERCHANT_ADDRESS}`);
});


