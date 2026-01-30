import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import { PaymentPayload, PaymentRequirements, SettleResponse, SchemeNetworkFacilitator } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/facilitator";
import { ExactEvmSchemeDomainFacilitator } from "./schemes/exact-evm-domain.js";
import { NETWORKS as V1_NETWORKS } from "@x402/evm/v1";
import { createWalletClient, defineChain, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createNonceManager, jsonRpc } from "viem/nonce";
import { Network } from "@x402/core/types";
import { BridgeKit, type EVMChainDefinition } from "@circle-fin/bridge-kit";
import { CircleCCTPBridgeService } from "./services/circleCCTPBridgeService.js";
import { extractCrossChainInfo, CROSS_CHAIN } from "./extensions/crossChain.js";
import { CrossChainRouter } from "./schemes/crossChainRouter.js";
import { handleCrossChainBridgeAsync } from "./bridgeWorker.js";
import { config } from "./config.js";

// ============================================================================
// EVM Setup
// ============================================================================

// Base account for address logging and non-signing uses.
const evmAccount = privateKeyToAccount(config.EVM_PRIVATE_KEY);
console.info(`✅ EVM Facilitator account: ${evmAccount.address}`);

type EvmChainConfig = {
  network: Network;
  rpcUrl: string;
  chain: ReturnType<typeof defineChain>;
};

const buildCctpEvmChains = (): EvmChainConfig[] => {
  const kit = new BridgeKit();
  const evmChains = kit.getSupportedChains({ chainType: "evm" });

  return evmChains
    .filter((chain): chain is EVMChainDefinition => chain.type === "evm")
    .map((chain) => {
      const rpcUrl = chain.rpcEndpoints?.[0];
      if (!rpcUrl) {
        return null;
      }
      return {
        network: `eip155:${chain.chainId}` as Network,
        rpcUrl,
        chain: defineChain({
          id: chain.chainId,
          name: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: { default: { http: [rpcUrl] } },
          testnet: chain.isTestnet,
        }),
      };
    })
    .filter((chain): chain is EvmChainConfig => Boolean(chain));
};

const cctpEvmChains = buildCctpEvmChains();
if (!cctpEvmChains.length) {
  throw new Error("No supported EVM chains found from Circle BridgeKit");
}

const exactSchemesByNetwork = new Map<Network, ExactEvmSchemeDomainFacilitator>();
let v1EvmSigner: ReturnType<typeof toFacilitatorEvmSigner> | null = null;
cctpEvmChains.forEach(({ network, rpcUrl, chain }) => {
  // Create a chain-scoped nonce manager to avoid cross-chain nonce drift.
  const nonceManager = createNonceManager({ source: jsonRpc() });
  const chainAccount = privateKeyToAccount(config.EVM_PRIVATE_KEY, {
    nonceManager,
  });
  const viemClient = createWalletClient({
    account: chainAccount,
    chain,
    transport: http(rpcUrl),
  }).extend(publicActions);

  const evmSigner = toFacilitatorEvmSigner({
    getCode: (args: { address: `0x${string}` }) => viemClient.getCode(args),
    address: chainAccount.address,
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
        chain: undefined,
      }),
    sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
      viemClient.sendTransaction({ ...args, chain: undefined }),
    waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
      viemClient.waitForTransactionReceipt(args),
  });

  exactSchemesByNetwork.set(
    network,
    new ExactEvmSchemeDomainFacilitator(evmSigner, {
      deployERC4337WithEIP6492: config.DEPLOY_ERC4337_WITH_EIP6492,
    }),
  );

  if (!v1EvmSigner) {
    v1EvmSigner = evmSigner;
  }
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

class ExactEvmSchemeRouter implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "eip155:*";

  constructor(private schemes: Map<Network, SchemeNetworkFacilitator>) {}

  getExtra(network: Network): Record<string, unknown> | undefined {
    return this.getScheme(network).getExtra(network);
  }

  getSigners(network: Network): string[] {
    return this.getScheme(network).getSigners(network);
  }

  verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.getScheme(requirements.network as Network).verify(payload, requirements);
  }

  settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.getScheme(requirements.network as Network).settle(payload, requirements);
  }

  private getScheme(network: Network): SchemeNetworkFacilitator {
    const scheme = this.schemes.get(network);
    if (!scheme) {
      throw new Error(`Unsupported EVM network: ${network}`);
    }
    return scheme;
  }
}

const evmScheme = new ExactEvmSchemeRouter(exactSchemesByNetwork);

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

facilitator.register(
  cctpEvmChains.map((chain) => chain.network),
  evmScheme,
);

if (v1EvmSigner) {
  facilitator.registerV1(
    V1_NETWORKS as any,
    new ExactEvmSchemeV1(v1EvmSigner, {
      deployERC4337WithEIP6492: config.DEPLOY_ERC4337_WITH_EIP6492,
    }),
  );
}

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


