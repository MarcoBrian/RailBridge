import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import { PaymentPayload, PaymentRequirements, SettleResponse, SchemeNetworkFacilitator } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme, ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { createWalletClient, http, publicActions, isAddress } from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { Network } from "@x402/core/types";
import { CircleCCTPBridgeService } from "./services/circleCCTPBridgeService.js";
import { extractCrossChainInfo, CROSS_CHAIN } from "./extensions/crossChain.js";
import { CrossChainRouter } from "./schemes/crossChainRouter.js";
import { handleCrossChainBridgeAsync } from "./bridgeWorker.js";
import { config } from "./config.js";

// ============================================================================
// EVM Setup
// ============================================================================

// Use shared nonce manager to coordinate nonces across facilitator + BridgeKit
const evmAccount = privateKeyToAccount(config.EVM_PRIVATE_KEY, { nonceManager });
console.info(`✅ EVM Facilitator account: ${evmAccount.address}`);

// Determine chain from RPC URL or use testnet by default
const isTestnet = !config.EVM_RPC_URL?.includes("mainnet");
const chain = isTestnet ? baseSepolia : base;
const defaultRpcUrl = isTestnet ? "https://sepolia.base.org" : "https://mainnet.base.org";

const viemClient = createWalletClient({
  account: evmAccount,
  chain: chain,
  transport: http(config.EVM_RPC_URL || defaultRpcUrl),
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

function validateCrossChainRequest(
  paymentPayload: PaymentPayload,
  requirements: PaymentRequirements,
): { abort: boolean; reason?: string } {
  const crossChainInfo = extractCrossChainInfo(paymentPayload);
  if (!crossChainInfo || !config.CROSS_CHAIN_ENABLED) {
    return { abort: false };
  }

  const sourceNetwork = requirements.network as Network;
  const destinationNetwork = crossChainInfo.destinationNetwork as Network;
  const sourceAsset = requirements.asset;
  const destinationAsset = crossChainInfo.destinationAsset;
  const destinationPayTo = crossChainInfo.destinationPayTo;

  if (!isAddress(destinationPayTo)) {
    return { abort: true, reason: "invalid_destination_pay_to" };
  }

  if (!bridgeService.supportsChain(sourceNetwork) || !bridgeService.supportsChain(destinationNetwork)) {
    return { abort: true, reason: "unsupported_chain_pair" };
  }

  if (!bridgeService.isUSDC(sourceAsset, sourceNetwork)) {
    return { abort: true, reason: "unsupported_source_asset" };
  }

  if (!bridgeService.isUSDC(destinationAsset, destinationNetwork)) {
    return { abort: true, reason: "unsupported_destination_asset" };
  }

  if (requirements.payTo.toLowerCase() !== evmAccount.address.toLowerCase()) {
    return { abort: true, reason: "invalid_source_pay_to" };
  }

  return { abort: false };
}

// ============================================================================
// Scheme Setup
// ============================================================================

const evmScheme = new ExactEvmScheme(evmSigner, {
  deployERC4337WithEIP6492: config.DEPLOY_ERC4337_WITH_EIP6492,
});

const schemeFacilitators = new Map<string, SchemeNetworkFacilitator>();
schemeFacilitators.set("exact", evmScheme);
// Add more schemes here as they're implemented:
// schemeFacilitators.set("bazaar", bazaarScheme);
// schemeFacilitators.set("subscription", subscriptionScheme);

const crossChainRouter = new CrossChainRouter(schemeFacilitators, bridgeService, {
  isEnabled: config.CROSS_CHAIN_ENABLED,
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

    const validation = validateCrossChainRequest(
      context.paymentPayload,
      context.requirements,
    );
    if (validation.abort) {
      return { abort: true, reason: validation.reason ?? "invalid_cross_chain_request" };
    }

    // Check bridge liquidity for cross-chain payments
    const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
    if (crossChainInfo && config.CROSS_CHAIN_ENABLED) {
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

    const validation = validateCrossChainRequest(
      context.paymentPayload,
      context.requirements,
    );
    if (validation.abort) {
      return { abort: true, reason: validation.reason ?? "invalid_cross_chain_request" };
    }

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
      config.CROSS_CHAIN_ENABLED
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
console.info(`   Cross-chain bridging: ${config.CROSS_CHAIN_ENABLED ? "enabled" : "disabled"}`);
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

app.listen(parseInt(config.PORT), () => {
  console.log(`🚀 RailBridge Cross-Chain Facilitator listening on port ${config.PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST /verify - Verify payment payloads`);
  console.log(`   POST /settle - Settle payments on-chain`);
  console.log(`   GET  /supported - Get supported payment kinds`);
  console.log(`   GET  /health - Health check`);
});
