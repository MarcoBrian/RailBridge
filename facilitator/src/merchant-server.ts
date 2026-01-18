import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import {
  declareCrossChainExtension,
  CROSS_CHAIN,
} from "./extensions/crossChain.js";
import { HTTPFacilitatorClient } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import type { AssetAmount } from "@x402/core/types";
import type { RoutesConfig, RouteConfig } from "@x402/core/http";

// Get directory of current file (for ESM modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file in project root
const envPath = join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}` | undefined;
const FACILITATOR_ADDRESS = process.env.FACILITATOR_ADDRESS as `0x${string}` | undefined;

if (!MERCHANT_ADDRESS) {
  console.error("❌ MERCHANT_ADDRESS environment variable is required");
  process.exit(1);
}

// Create a wrapper around HTTPFacilitatorClient to add logging
class LoggingFacilitatorClient extends HTTPFacilitatorClient {
  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    console.log("📤 [MERCHANT] Calling facilitator.settle()", {
      url: this.url,
      scheme: paymentRequirements.scheme,
      network: paymentRequirements.network,
    });
    
    try {
      const result = await super.settle(paymentPayload, paymentRequirements);
      console.log("✅ [MERCHANT] Facilitator.settle() succeeded:", {
        success: result.success,
        transaction: result.transaction,
        network: result.network,
      });
      return result;
    } catch (error) {
      console.error("❌ [MERCHANT] Facilitator.settle() failed:", error);
      throw error;
    }
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    console.log("📤 [MERCHANT] Calling facilitator.verify()", {
      url: this.url,
      scheme: paymentRequirements.scheme,
      network: paymentRequirements.network,
    });
    
    try {
      const result = await super.verify(paymentPayload, paymentRequirements);
      console.log("✅ [MERCHANT] Facilitator.verify() succeeded:", {
        isValid: result.isValid,
        payer: result.payer,
      });
      return result;
    } catch (error) {
      console.error("❌ [MERCHANT] Facilitator.verify() failed:", error);
      throw error;
    }
  }
}

const facilitatorClient = new LoggingFacilitatorClient({
  url: FACILITATOR_URL,
});

let facilitatorAddress: string | null = null;
async function getFacilitatorAddress(): Promise<string | null> {
  if (facilitatorAddress) return facilitatorAddress;
  
  try {
    const supported = await facilitatorClient.getSupported();
    const evmSigners = supported.signers["eip155:*"];
    if (evmSigners && evmSigners.length > 0) {
      facilitatorAddress = evmSigners[0];
      console.log(`✅ Facilitator address: ${facilitatorAddress}`);
      return facilitatorAddress;
    }
  } catch (error) {
    console.warn("⚠️  Could not fetch facilitator address:", error);
  }
  
  return null;
}

const resourceServer = new x402ResourceServer(facilitatorClient);

// Add logging hooks to trace settlement flow
resourceServer.onBeforeSettle(async (context) => {
  console.log("🔍 [MERCHANT] Before settle:", {
    scheme: context.requirements.scheme,
    network: context.requirements.network,
    amount: context.requirements.amount,
  });
});

resourceServer.onAfterSettle(async (context) => {
  console.log("✅ [MERCHANT] After settle:", {
    success: context.result.success,
    transaction: context.result.transaction,
    network: context.result.network,
  });
});

resourceServer.onSettleFailure(async (context) => {
  console.error("❌ [MERCHANT] Settle failure:", {
    error: context.error.message,
    scheme: context.requirements.scheme,
    network: context.requirements.network,
  });
});

registerExactEvmScheme(resourceServer, {
  networks: [
    "eip155:84532",
    "eip155:8453",
    "eip155:1",
    "eip155:11155111",
    "eip155:137",
  ],
});

const routes = {
  "GET /api/premium": {
    accepts: [
      {
        scheme: "exact" as const,
        network: "eip155:84532" as const,
        price: {
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          amount: "10000",
          extra: {
            name: "USDC",
            version: "2",
          },
        } as AssetAmount,
        payTo: FACILITATOR_ADDRESS || "0x0000000000000000000000000000000000000000",
        extra: {
          description: "Cross-chain payment: Pay on Base Sepolia, receive on Ethereum Sepolia",
        },
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

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  console.log(`   IP: ${req.ip || req.socket.remoteAddress}`);
  console.log(`   User-Agent: ${req.get("user-agent") || "unknown"}`);
  
  const paymentHeader = req.get("payment-signature") || req.get("x-payment");
  if (paymentHeader) {
    console.log(`   Payment: ${paymentHeader.substring(0, 50)}...`);
  }
  
  const startTime = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    console.log(`[${timestamp}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "RailBridge Merchant (Cross-Chain Only)",
    testnet: true,
  })
  .build();

async function initializeRoutes() {
  let facilitatorAddr = FACILITATOR_ADDRESS;
  
  if (!facilitatorAddr) {
    const fetchedAddr = await getFacilitatorAddress();
    if (!fetchedAddr) {
      console.warn("⚠️  Could not fetch facilitator address. Cross-chain payments may fail.");
      console.warn("   Set FACILITATOR_ADDRESS in .env to avoid this warning.");
      return routes;
    }
    facilitatorAddr = fetchedAddr as `0x${string}`;
    console.log(`✅ Fetched facilitator address: ${facilitatorAddr}`);
  } else {
    console.log(`✅ Using facilitator address from env: ${facilitatorAddr}`);
  }

  const transformedRoutes = JSON.parse(JSON.stringify(routes)) as RoutesConfig;
  
  if (typeof transformedRoutes === "object" && !Array.isArray(transformedRoutes)) {
    for (const [routeKey, routeConfig] of Object.entries(transformedRoutes)) {
      const config = routeConfig as RouteConfig;
      if (config.extensions?.[CROSS_CHAIN]) {
        if (config.accepts) {
          const accepts = Array.isArray(config.accepts) ? config.accepts : [config.accepts];
          for (const accept of accepts) {
            if (!accept.payTo || accept.payTo === "0x0000000000000000000000000000000000000000") {
              accept.payTo = facilitatorAddr as `0x${string}`;
              console.log(`✅ Updated ${routeKey}: payTo = ${facilitatorAddr}`);
            }
          }
        }
      }
    }
  }
  
  return transformedRoutes;
}

async function startServer() {
  const finalRoutes = await initializeRoutes();

  console.log("🔍 Routes being passed to middleware:", JSON.stringify(finalRoutes, null, 2));
  console.log("🔍 Route keys:", Object.keys(finalRoutes));

  try {
  // Create payment middleware
  const baseMiddleware = paymentMiddleware(
    finalRoutes,
    resourceServer,
    undefined,
    paywall,
    true,
  );

  // Wrap the middleware to add logging and ensure it's called
  app.use((req, res, next) => {
    console.log(`\n🔍 [MIDDLEWARE WRAPPER] Request: ${req.method} ${req.path}`);
    console.log(`   Payment header: ${req.get("payment-signature") || req.get("x-payment") || "NONE"}`);
    console.log(`   URL: ${req.url}`);
    console.log(`   Original URL: ${req.originalUrl}`);
    
    // Call the actual payment middleware
    const middlewareResult = baseMiddleware(req, res, (err?: any) => {
      if (err) {
        console.error(`❌ [MIDDLEWARE WRAPPER] Error from payment middleware:`, err);
      } else {
        console.log(`✅ [MIDDLEWARE WRAPPER] Payment middleware completed, calling next()`);
      }
      next(err);
    });
    
    // Handle promise if middleware returns one
    if (middlewareResult && typeof middlewareResult.then === 'function') {
      middlewareResult.catch((err: any) => {
        console.error(`❌ [MIDDLEWARE WRAPPER] Promise rejection from payment middleware:`, err);
        next(err);
      });
    }
  });
    console.log("✅ Payment middleware registered successfully");
  } catch (error) {
    console.error("❌ Failed to register payment middleware:", error);
    throw error;
  }

  // Register route handler AFTER middleware (important for Express middleware order)
  app.get("/api/premium", (req, res) => {
  console.log(`\n🔍 ===== REQUEST DEBUG =====`);
  console.log(`Path: ${req.path}`);
  console.log(`Method: ${req.method}`);
  console.log(`Status Code: ${res.statusCode}`);
  
  // Check if payment header was sent
  const paymentHeader = req.get("payment-signature") || req.get("x-payment");
  if (paymentHeader) {
    console.log(`📝 Payment header present: ${String(paymentHeader).substring(0, 50)}...`);
  } else {
    console.warn(`⚠️  No payment header found - request may have bypassed payment middleware`);
    console.warn(`⚠️  This means payment verification/settlement was NOT performed!`);
  }
  
  console.log(`✅ Premium content accessed - Payment verified and settled`);
  
  // Check if PAYMENT-RESPONSE header is set (should be set by middleware after settlement)
  const paymentResponseHeader = res.getHeader("PAYMENT-RESPONSE") || res.getHeader("payment-response");
  if (paymentResponseHeader) {
    console.log(`💰 PAYMENT-RESPONSE header found: ${String(paymentResponseHeader).substring(0, 100)}...`);
  } else {
    console.warn(`⚠️  PAYMENT-RESPONSE header NOT found - settlement headers may not be set`);
  }

  res.json({
    message: "You successfully paid for this premium content.",
    data: {
      timestamp: Date.now(),
      value: "premium-data",
    },
  });
  });

  // Error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ Error handling request ${req.method} ${req.path}:`);
    console.error(`   Error: ${err.message}`);
    console.error(`   Stack: ${err.stack}`);
    
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
        message: process.env.NODE_ENV === "development" ? err.message : "An error occurred processing your request",
        timestamp,
      });
    }
  });

  const PORT = process.env.MERCHANT_PORT || "4021";
  app.listen(parseInt(PORT), () => {
    console.log(`🛒 Merchant server (cross-chain only) listening at http://localhost:${PORT}`);
    console.log(`Using facilitator at: ${FACILITATOR_URL}`);
    console.log(`Merchant address: ${MERCHANT_ADDRESS}`);
    console.log(`💡 Cross-chain: Users pay on Base Sepolia, merchant receives on Ethereum Sepolia`);
  });
}

startServer().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error: Error) => {
  console.error("❌ Uncaught Exception:", error);
});


