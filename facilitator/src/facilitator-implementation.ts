import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SchemeNetworkFacilitator,
} from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme, ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { CircleCCTPBridgeService } from "./services/circleCCTPBridgeService.js";
import { extractCrossChainInfo, CROSS_CHAIN } from "./extensions/crossChain.js";
import { Network } from "@x402/core/types";
import { CrossChainRouter } from "./schemes/crossChainRouter.js";
import type { BridgeResult } from "./types/bridge.js";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Decide whether a bridge error is retryable.
 * Uses Circle CCTP error shape when available (code, type, recoverability, cause).
 */
function isRetryableBridgeError(error: unknown): boolean {
  const err: any = error;

  // Circle CCTP errors often have a recoverability field
  if (err?.recoverability === "FATAL") {
    return false;
  }

  // Insufficient balance is not retryable without operator action
  const msg = (err?.message || String(err)).toLowerCase();
  if (msg.includes("insufficient usdc balance") || msg.includes("insufficient token balance")) {
    return false;
  }

  // Nonce issues and transient RPC problems are usually retryable
  if (msg.includes("nonce too low") || msg.includes("failed to fetch") || msg.includes("gateway timeout")) {
    return true;
  }

  // Default: allow a couple of retries for unknown/transient-seeming errors
  return true;
}

/**
 * Attempt to bridge funds with retry logic.
 * Returns the bridge result on success, throws on permanent failure.
 */
async function attemptBridgeWithRetry(
  bridgeService: CircleCCTPBridgeService,
  sourceNetwork: Network,
  sourceTxHash: string,
  destinationNetwork: Network,
  destinationAsset: string,
  amount: string,
  recipient: string,
  maxAttempts: number = 3,
): Promise<BridgeResult> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      console.log(`🌉 Bridge attempt ${attempt}/${maxAttempts}`);
      const bridgeResult = await bridgeService.bridge(
        sourceNetwork,
        sourceTxHash,
        destinationNetwork,
        destinationAsset,
        amount,
        recipient,
      );
      return bridgeResult;
    } catch (err) {
      lastError = err;
      const retryable = isRetryableBridgeError(err);

      console.error("❌ Cross-chain bridge attempt failed:", {
        attempt,
        maxAttempts,
        retryable,
        error: err instanceof Error ? err.message : String(err),
        sourceTx: sourceTxHash,
        sourceNetwork,
        destinationNetwork,
      });

      if (!retryable || attempt >= maxAttempts) {
        break;
      }

      // Simple linear backoff between retries
      const delayMs = attempt * 1000;
      console.log(`⏳ Waiting ${delayMs}ms before next bridge attempt`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // All retries exhausted
  throw lastError || new Error("Bridge failed after all retry attempts");
}

/**
 * Handle cross-chain bridging asynchronously after settlement.
 * This runs in the background and does not block the settlement response.
 */
function handleCrossChainBridgeAsync(
  bridgeService: CircleCCTPBridgeService,
  sourceNetwork: Network,
  sourceTxHash: string,
  destinationNetwork: Network,
  destinationAsset: string,
  amount: string,
  recipient: string,
): void {
  // Fire-and-forget async task: do NOT block the settle response on bridging
  void (async () => {
    try {
      console.log("🌉 Starting cross-chain bridge (async):", {
        sourceNetwork,
        sourceTx: sourceTxHash,
        destinationNetwork,
        asset: destinationAsset,
        amount,
      });

      const bridgeResult = await attemptBridgeWithRetry(
        bridgeService,
        sourceNetwork,
        sourceTxHash,
        destinationNetwork,
        destinationAsset,
        amount,
        recipient,
      );

      console.log("✅ Cross-chain bridge completed:", {
        sourceTx: sourceTxHash,
        bridgeTx: bridgeResult.bridgeTxHash,
        destinationTx: bridgeResult.destinationTxHash,
        destinationNetwork,
        messageId: bridgeResult.messageId,
      });

      // TODO: Integrate with persistent storage / notifications:
      // - Store bridge result in database with status=success
      // - Notify merchant / ops
      // - Update settlement status
      // - Emit event for monitoring/analytics
    } catch (error) {
      // Final failure after retries - log a structured record
      console.error("🚨 Cross-chain bridge permanently failed after retries:", {
        error: error instanceof Error ? error.message : String(error),
        sourceTx: sourceTxHash,
        sourceNetwork,
        destinationNetwork,
        destinationAsset,
        amount,
        attempts: 3,
      });

      // TODO: Persistent failure handling:
      // - Write a record to a durable store (DB / queue) for manual intervention
      // - Alert operations (PagerDuty, email, etc.)
      // - Expose an admin API to query / retry stuck bridges
    }
  })();
}

// ============================================================================
// Environment Setup
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", ".env");
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`⚠️  Could not load .env file from ${envPath}`);
  console.warn(`   Make sure you have created a .env file from env.template`);
  console.warn(`   Error: ${result.error.message}`);
}

const PORT = process.env.PORT || "4022";
const CROSS_CHAIN_ENABLED = process.env.CROSS_CHAIN_ENABLED !== "false"; // Default to enabled

// ============================================================================
// EVM Setup
// ============================================================================

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

const evmAccount = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
console.info(`✅ EVM Facilitator account: ${evmAccount.address}`);

// Determine chain from RPC URL or use testnet by default
const isTestnet = !process.env.EVM_RPC_URL?.includes("mainnet");
const chain = isTestnet ? baseSepolia : base;
const defaultRpcUrl = isTestnet ? "https://sepolia.base.org" : "https://mainnet.base.org";

const viemClient = createWalletClient({
  account: evmAccount,
  chain: chain,
  transport: http(process.env.EVM_RPC_URL || defaultRpcUrl),
}).extend(publicActions);

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

// ============================================================================
// Bridge Service Setup
// ============================================================================

const bridgeService = new CircleCCTPBridgeService({
  provider: "cctp",
  facilitatorAddress: evmAccount.address,
});

// ============================================================================
// Scheme Setup
// ============================================================================

const evmScheme = new ExactEvmScheme(evmSigner, {
  deployERC4337WithEIP6492: process.env.DEPLOY_ERC4337_WITH_EIP6492 === "true",
});

const schemeFacilitators = new Map<string, SchemeNetworkFacilitator>();
schemeFacilitators.set("exact", evmScheme);
// Add more schemes here as they're implemented:
// schemeFacilitators.set("bazaar", bazaarScheme);
// schemeFacilitators.set("subscription", subscriptionScheme);

const crossChainRouter = new CrossChainRouter(schemeFacilitators, bridgeService, {
  isEnabled: CROSS_CHAIN_ENABLED,
});

// ============================================================================
// Facilitator Setup with Hooks
// ============================================================================

const facilitator = new x402Facilitator()
  .registerExtension(CROSS_CHAIN)
  .onBeforeVerify(async (context) => {
    console.log("🔍 Before verify:", {
      scheme: context.requirements.scheme,
      network: context.requirements.network,
      payer: context.paymentPayload.payload,
    });

    // Check bridge liquidity for cross-chain payments
    const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
    if (crossChainInfo && CROSS_CHAIN_ENABLED) {
      const sourceNetwork = context.requirements.network as Network;
      const sourceAsset = context.requirements.asset;
      const destinationNetwork = crossChainInfo.destinationNetwork as Network;
      const destinationAsset = crossChainInfo.destinationAsset;

      const hasLiquidity = await bridgeService.checkLiquidity(
        sourceNetwork,
        destinationNetwork,
        sourceAsset,
        context.requirements.amount,
      );

      if (!hasLiquidity) {
        return { abort: true, reason: "insufficient_bridge_liquidity" };
      }

      // Check exchange rate if different assets
      if (sourceAsset !== destinationAsset) {
        const rate = await bridgeService.getExchangeRate(
          sourceNetwork,
          destinationNetwork,
          sourceAsset,
          destinationAsset,
        );

        if (rate <= 0) {
          return { abort: true, reason: "invalid_exchange_rate" };
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

    const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
    if (crossChainInfo) {
      console.log("🌉 Cross-chain payment detected, will settle on source chain:", {
        sourceNetwork: context.requirements.network,
        destinationNetwork: crossChainInfo.destinationNetwork,
        scheme: context.requirements.scheme,
      });
    }
  })
  .onAfterSettle(async (context) => {
    console.log("✅ After settle:", {
      success: context.result.success,
      transaction: context.result.transaction,
      network: context.result.network,
    });

    // Handle cross-chain bridging asynchronously after settlement
    const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
    if (
      crossChainInfo &&
      context.result.success &&
      context.result.network !== crossChainInfo.destinationNetwork &&
      CROSS_CHAIN_ENABLED
    ) {
      handleCrossChainBridgeAsync(
        bridgeService,
        context.result.network as Network,
        context.result.transaction,
        crossChainInfo.destinationNetwork as Network,
        crossChainInfo.destinationAsset,
        context.requirements.amount,
        crossChainInfo.destinationPayTo,
      );
    }
  })
  .onSettleFailure(async (context) => {
    console.error("❌ Settle failure:", {
      error: context.error.message,
      requirements: context.requirements,
    });
  });

// ============================================================================
// Register Payment Schemes
// ============================================================================

registerExactEvmScheme(facilitator, {
  signer: evmSigner,
  networks: [
    "eip155:8453", // Base Mainnet
    "eip155:84532", // Base Sepolia
    "eip155:1", // Ethereum Mainnet
    "eip155:11155111", // Ethereum Sepolia
    "eip155:137", // Polygon
  ],
  deployERC4337WithEIP6492: process.env.DEPLOY_ERC4337_WITH_EIP6492 === "true",
});

// Note: CrossChainRouter is NOT registered as a scheme
// Cross-chain is extension-based, not scheme-based
// The router is called directly from verify/settle endpoints when extension is detected

console.info("🌉 Cross-chain EVM facilitator initialized");
console.info(`   Cross-chain bridging: ${CROSS_CHAIN_ENABLED ? "enabled" : "disabled"}`);
console.info("   'exact' scheme: same-chain payments");
console.info("   Cross-chain: Extension-based routing (any scheme + cross-chain extension)");

// ============================================================================
// Express Server Setup
// ============================================================================

const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  console.log("📥 POST /verify - Received verify request");
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

    const response = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/settle", async (req, res) => {
  console.log("📥 POST /settle - Received settle request");
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

    const response = await facilitator.settle(paymentPayload, paymentRequirements);

    console.log(`🔍 Settle response:`, {
      success: response.success,
      transaction: response.transaction,
      network: response.network,
      payer: response.payer,
      errorReason: response.errorReason,
    });

    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);

    if (error instanceof Error && error.message.includes("Settlement aborted:")) {
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

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    facilitator: "railbridge-cross-chain",
  });
});

app.listen(parseInt(PORT), () => {
  console.log(`🚀 RailBridge Cross-Chain Facilitator listening on port ${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST /verify - Verify payment payloads`);
  console.log(`   POST /settle - Settle payments on-chain`);
  console.log(`   GET  /supported - Get supported payment kinds`);
  console.log(`   GET  /health - Health check`);
});
