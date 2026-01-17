import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme, ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { BridgeService } from "./services/bridgeService.js";
import { extractCrossChainInfo, CROSS_CHAIN } from "./extensions/crossChain.js";
import { Network } from "@x402/core/types";
import { CrossChainRouter } from "./schemes/crossChainRouter.js";

// Get directory of current file (for ESM modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file in project root
// This ensures it works regardless of where the script is run from
const envPath = join(__dirname, "..", ".env");
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`⚠️  Could not load .env file from ${envPath}`);
  console.warn(`   Make sure you have created a .env file from env.template`);
  console.warn(`   Error: ${result.error.message}`);
}

// Configuration
const PORT = process.env.PORT || "4022";

// Validate required environment variables
if (!process.env.EVM_PRIVATE_KEY) {
  console.error("❌ EVM_PRIVATE_KEY environment variable is required");
  console.error("");
  console.error("📝 To fix this:");
  console.error("   1. Copy env.template to .env:");
  console.error("      cp env.template .env");
  console.error("   2. Edit .env and add your private key:");
  console.error("      EVM_PRIVATE_KEY=0xYourPrivateKeyHere");
  console.error("");
  console.error("   Note: Make sure .env is in the facilitator directory");
  process.exit(1);
}

// Initialize EVM account and signer
const evmAccount = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY as `0x${string}`,
);
console.info(`✅ EVM Facilitator account: ${evmAccount.address}`);

// Create Viem client for EVM operations
// For testnet, use baseSepolia instead of base
// Determine chain from RPC URL or use testnet by default
const isTestnet = !process.env.EVM_RPC_URL?.includes("mainnet");
const chain = isTestnet ? baseSepolia : base;
const defaultRpcUrl = isTestnet ? "https://sepolia.base.org" : "https://mainnet.base.org";

const viemClient = createWalletClient({
  account: evmAccount,
  chain: chain,
  transport: http(process.env.EVM_RPC_URL || defaultRpcUrl),
}).extend(publicActions);

// Create EVM facilitator signer
const evmSigner = toFacilitatorEvmSigner({
  getCode: (args: { address: `0x${string}` }) => viemClient.getCode(args),
  address: evmAccount.address,
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) =>
    viemClient.readContract({
      ...args,
      args: args.args || [],
    }),
  verifyTypedData: (args: {
    address: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
  }) => viemClient.verifyTypedData(args as any),
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) =>
    viemClient.writeContract({
      ...args,
      args: args.args || [],
    }),
  sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
    viemClient.sendTransaction(args),
  waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
    viemClient.waitForTransactionReceipt(args),
});

// Initialize bridge service
const bridgeService = new BridgeService({
  provider: "custom", // Change to "wormhole" or "layerzero" when integrating
  // Add your bridge configuration here
});

// Cross-chain bridging configuration
// Set CROSS_CHAIN_ENABLED=false in .env to disable bridging (only settle on source chain)
const CROSS_CHAIN_ENABLED = process.env.CROSS_CHAIN_ENABLED !== "false"; // Default to enabled

// Create EVM scheme instance (used by both exact and cross-chain)
const evmScheme = new ExactEvmScheme(evmSigner, {
  deployERC4337WithEIP6492: process.env.DEPLOY_ERC4337_WITH_EIP6492 === "true",
});

// Create cross-chain router (thin wrapper around exact scheme for routing)
const crossChainRouter = new CrossChainRouter(evmScheme, bridgeService, {
  isEnabled: CROSS_CHAIN_ENABLED,
});

// Initialize x402 Facilitator
const facilitator = new x402Facilitator()
  // Register cross-chain extension
  .registerExtension(CROSS_CHAIN)
  // Lifecycle hooks for logging/monitoring
  .onBeforeVerify(async (context) => {
    console.log("🔍 Before verify:", {
      scheme: context.requirements.scheme,
      network: context.requirements.network,
      payer: context.paymentPayload.payload,
    });

    // Check bridge liquidity for cross-chain payments only
    // Only check if this is actually a cross-chain scheme payment
    if (context.requirements.scheme === "cross-chain") {
      const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
      if (!crossChainInfo) {
        return {
          abort: true,
          reason: "missing_cross_chain_extension",
        };
      }

      if (CROSS_CHAIN_ENABLED) {
        const hasLiquidity = await bridgeService.checkLiquidity(
          crossChainInfo.sourceNetwork as Network,
          context.requirements.network as Network,
          context.requirements.asset,
          context.requirements.amount,
        );

        if (!hasLiquidity) {
          return {
            abort: true,
            reason: "insufficient_bridge_liquidity",
          };
        }

        // Check exchange rate if different assets
        if (crossChainInfo.sourceAsset !== context.requirements.asset) {
          const rate = await bridgeService.getExchangeRate(
            crossChainInfo.sourceNetwork as Network,
            context.requirements.network as Network,
            crossChainInfo.sourceAsset,
            context.requirements.asset,
          );

          if (rate <= 0) {
            return {
              abort: true,
              reason: "invalid_exchange_rate",
            };
          }
        }
      }
    }
  })
  .onAfterVerify(async (context) => {
    console.log("✅ After verify:", {
      isValid: context.result.isValid,
      payer: context.result.payer,
    });
  })
  .onVerifyFailure(async (context) => {
    console.error("❌ Verify failure:", {
      error: context.error.message,
      requirements: context.requirements,
    });
  })
  .onBeforeSettle(async (context) => {
    console.log("💰 Before settle:", {
      scheme: context.requirements.scheme,
      network: context.requirements.network,
      amount: context.requirements.amount,
    });

    // Log cross-chain payment info if applicable
    // Note: Actual cross-chain settlement is handled by CrossChainRouter.settle()
    // which delegates to ExactEvmScheme on the source chain
    if (context.requirements.scheme === "cross-chain") {
      const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
      if (crossChainInfo) {
        console.log("🌉 Cross-chain payment detected, will settle on source chain:", {
          sourceNetwork: crossChainInfo.sourceNetwork,
          destinationNetwork: context.requirements.network,
        });
      }
    }
  })
  .onAfterSettle(async (context) => {
    console.log("✅ After settle:", {
      success: context.result.success,
      transaction: context.result.transaction,
      network: context.result.network,
    });

    // Handle cross-chain bridging after settlement
    // This allows settlement to complete quickly, with bridging as async operation
    // Detect cross-chain by checking:
    // 1. Scheme is "cross-chain"
    // 2. Cross-chain extension exists in payload
    // 3. Settlement network (source) differs from requirements network (destination)
    // 4. Settlement succeeded
    // 5. Bridging is enabled
    if (
      context.requirements.scheme === "cross-chain" &&
      context.result.success &&
      context.result.network !== context.requirements.network &&
      CROSS_CHAIN_ENABLED
    ) {
      const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
      if (!crossChainInfo) {
        console.error("❌ Cross-chain bridging skipped: missing cross-chain extension in payload");
        return;
      }

      try {
        console.log("🌉 Starting cross-chain bridge:", {
          sourceNetwork: context.result.network,
          sourceTx: context.result.transaction,
          destinationNetwork: context.requirements.network,
          asset: context.requirements.asset,
          amount: context.requirements.amount,
        });

        // Bridge funds from source chain to destination chain
        const bridgeResult = await bridgeService.bridge(
          context.result.network as Network, // Source network (where settlement happened)
          context.result.transaction, // Source transaction hash
          context.requirements.network as Network, // Destination network
          context.requirements.asset,
          context.requirements.amount,
          context.requirements.payTo, // Merchant address on destination
        );

        console.log("✅ Cross-chain bridge completed:", {
          sourceTx: context.result.transaction,
          bridgeTx: bridgeResult.bridgeTxHash,
          destinationTx: bridgeResult.destinationTxHash,
          destinationNetwork: context.requirements.network,
        });

        // TODO: You might want to:
        // - Store bridge result in database
        // - Send notification to merchant
        // - Update settlement status
        // - Emit event for monitoring/analytics
      } catch (error) {
        console.error("❌ Cross-chain bridge failed:", {
          error: error instanceof Error ? error.message : "unknown",
          sourceTx: context.result.transaction,
          sourceNetwork: context.result.network,
          destinationNetwork: context.requirements.network,
        });

        // TODO: Implement retry logic or alerting
        // Settlement already succeeded on source chain, so funds are locked
        // You might want to:
        // - Queue bridge retry (with exponential backoff)
        // - Alert operations team
        // - Store failure for manual intervention
        // - Emit failure event for monitoring
      }
    }
  })
  .onSettleFailure(async (context) => {
    console.error("❌ Settle failure:", {
      error: context.error.message,
      requirements: context.requirements,
    });
  });

// Register standard EVM schemes (same-chain payments)
registerExactEvmScheme(facilitator, {
  signer: evmSigner,
  networks: [
    "eip155:8453", // Base Mainnet
    "eip155:84532", // Base Sepolia
    "eip155:1", // Ethereum Mainnet
    "eip155:137", // Polygon
  ],
  deployERC4337WithEIP6492: process.env.DEPLOY_ERC4337_WITH_EIP6492 === "true",
});

// Register cross-chain router (delegates to exact scheme, then bridges)
// This is a thin routing wrapper - verification/settlement logic is identical to "exact"
// Register with the same networks as exact scheme (cross-chain supports all EVM networks)
facilitator.register(
  [
    "eip155:8453", // Base Mainnet
    "eip155:84532", // Base Sepolia
    "eip155:1", // Ethereum Mainnet
    "eip155:137", // Polygon
  ],
  crossChainRouter,
);

console.info("🌉 Cross-chain EVM facilitator initialized");
console.info(`   Cross-chain bridging: ${CROSS_CHAIN_ENABLED ? "enabled" : "disabled"}`);
console.info("   'exact' scheme: same-chain payments");
console.info("   'cross-chain' scheme: routing wrapper around 'exact' for cross-chain payments");

// Initialize Express app
const app = express();
app.use(express.json());

/**
 * POST /verify
 * Verify a payment payload against requirements
 */
app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: VerifyResponse = await facilitator.verify(
      paymentPayload,
      paymentRequirements,
    );

    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /settle
 * Settle a payment on-chain
 */
app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: SettleResponse = await facilitator.settle(
      paymentPayload,
      paymentRequirements,
    );

    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);

    // Check if this was an abort from hook
    if (
      error instanceof Error &&
      error.message.includes("Settlement aborted:")
    ) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
        transaction: "",
      } as SettleResponse);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /supported
 * Get supported payment kinds, extensions, and signers
 */
app.get("/supported", async (req, res) => {
  try {
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    facilitator: "railbridge-cross-chain",
  });
});

// Start the server
app.listen(parseInt(PORT), () => {
  console.log(`🚀 RailBridge Cross-Chain Facilitator listening on port ${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST /verify - Verify payment payloads`);
  console.log(`   POST /settle - Settle payments on-chain`);
  console.log(`   GET  /supported - Get supported payment kinds`);
  console.log(`   GET  /health - Health check`);
});

