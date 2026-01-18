import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";

// Get directory of current file (for ESM modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file in project root
const envPath = join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

// ---------------------------------------------------------------------------
// Merchant-side x402 server - Same-Chain Payments Only
// This merchant only accepts payments on the same chain (no cross-chain)
// ---------------------------------------------------------------------------

// Required env vars for merchant
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}` | undefined;

if (!MERCHANT_ADDRESS) {
  console.error("❌ MERCHANT_ADDRESS environment variable is required");
  console.error("   This is where you want to receive payments");
  process.exit(1);
}

// Create HTTP client that talks to your RailBridge facilitator
// This client communicates with the facilitator's /verify and /settle endpoints
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

// Create core x402 resource server
// This handles payment requirement building, verification, and settlement
const resourceServer = new x402ResourceServer(facilitatorClient);

// Register EVM scheme on the server side for "exact" scheme
// This enables the server to:
// - Parse prices (e.g., "$0.01" -> token amount)
// - Build payment requirements for EVM networks
// Register for specific networks to ensure validation passes
registerExactEvmScheme(resourceServer, {
  networks: [
    "eip155:84532", // Base Sepolia
    "eip155:8453",  // Base Mainnet
    "eip155:1",     // Ethereum Mainnet
    "eip155:137",   // Polygon
  ],
});

// Define payment-protected routes for this merchant
// Only same-chain payments are accepted (using "exact" scheme)
const routes = {
  "GET /api/premium": {
    accepts: [
      // Same-chain EVM payment on Base Sepolia testnet
      {
        scheme: "exact" as const,
        network: "eip155:84532" as const, // Base Sepolia testnet
        price: "$0.01",
        payTo: MERCHANT_ADDRESS, // Merchant receives directly on same chain
      },
      // You can add more same-chain payment options for different networks
      // Example: Payment on Polygon
      // {
      //   scheme: "exact" as const,
      //   network: "eip155:137" as const, // Polygon
      //   price: "$0.01",
      //   payTo: MERCHANT_ADDRESS, // Must be valid address on Polygon
      // },
    ],
    description: "Premium API endpoint",
    mimeType: "application/json",
    // No extensions needed for same-chain payments
  },
};

// Initialize Express app
const app = express();
app.use(express.json());

// Add request logging middleware
// This logs all incoming requests before payment middleware processes them
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  console.log(`   IP: ${req.ip || req.socket.remoteAddress}`);
  console.log(`   User-Agent: ${req.get("user-agent") || "unknown"}`);
  
  // Log payment header if present
  const paymentHeader = req.get("payment-signature") || req.get("x-payment");
  if (paymentHeader) {
    console.log(`   Payment: ${paymentHeader.substring(0, 50)}...`);
  }
  
  // Track response time
  const startTime = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    console.log(`[${timestamp}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Create paywall using the builder pattern
// This provides the full wallet connection and payment UI
const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "RailBridge Merchant (Same-Chain Only)",
    testnet: true, // Set to false for mainnet
  })
  .build();

// Use payment middleware
// The middleware automatically initializes the server on first request
// It fetches supported schemes from the facilitator and validates routes
app.use(
  paymentMiddleware(
    routes,
    resourceServer,
    undefined, // paywallConfig (optional - not needed when using custom paywall provider)
    paywall, // paywall provider - full UI with wallet connection
    true, // syncFacilitatorOnStart - fetch facilitator capabilities on startup
  ),
);

// Business logic route (protected by paymentMiddleware)
app.get("/api/premium", (req, res) => {
  // At this point, payment has been:
  // - Required (402 if unpaid)
  // - Verified via your facilitator
  // - Settled via your facilitator

  // Log successful payment access
  console.log(`✅ Premium content accessed - Payment verified and settled`);
  
  // Extract payment info from response headers (set by paymentMiddleware after settlement)
  const paymentTx = res.getHeader("x-payment-transaction");
  const paymentNetwork = res.getHeader("x-payment-network");
  if (paymentTx) {
    console.log(`   Transaction: ${paymentTx}`);
    console.log(`   Network: ${paymentNetwork || "unknown"}`);
  }

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
  console.log(`🛒 Merchant server (same-chain only) listening at http://localhost:${PORT}`);
  console.log(`Using facilitator at: ${FACILITATOR_URL}`);
  console.log(`Merchant address: ${MERCHANT_ADDRESS}`);
});

