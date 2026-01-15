import {
  SchemeNetworkFacilitator,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  Network,
} from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { BridgeService } from "../services/bridgeService.js";
import { extractCrossChainInfo } from "../extensions/crossChain.js";

/**
 * Configuration for CrossChainScheme
 */
export interface CrossChainSchemeConfig {
  /**
   * Enable/disable cross-chain bridging
   * When false: Only settles on source chain (no bridging)
   * When true: Settles on source chain and bridges to destination
   * @default true
   */
  isEnabled?: boolean;
}

/**
 * Cross-chain payment scheme for x402
 * 
 * Allows payments where:
 * - User pays on source chain (e.g., Base)
 * - Server receives on destination chain (e.g., Polygon, Ethereum)
 * - Bridge handles the cross-chain transfer
 * 
 * Currently supports EVM-to-EVM cross-chain payments
 * 
 * When disabled (isEnabled: false), only settles on source chain without bridging
 */
export class CrossChainScheme implements SchemeNetworkFacilitator {
  readonly scheme = "cross-chain";
  readonly caipFamily = "eip155:*"; // Supports EVM chains
  private readonly isEnabled: boolean;

  constructor(
    private evmFacilitator: ExactEvmScheme,
    private bridgeService: BridgeService,
    config?: CrossChainSchemeConfig,
  ) {
    this.isEnabled = config?.isEnabled ?? true; // Default to enabled
  }

  /**
   * Get extra metadata for supported kinds endpoint
   */
  getExtra(network: Network): Record<string, unknown> | undefined {
    return {
      crossChain: true,
      supportedSourceChains: [
        "eip155:8453", // Base
        "eip155:84532", // Base Sepolia
        "eip155:1", // Ethereum
        "eip155:137", // Polygon
      ],
    };
  }

  /**
   * Get signer addresses for this facilitator
   */
  getSigners(network: Network): string[] {
    // Return signers for destination chain (EVM only)
    if (network.startsWith("eip155:")) {
      return [...this.evmFacilitator.getSigners(network)];
    }
    return [];
  }

  /**
   * Verify cross-chain payment
   * 
   * 1. Verifies payment on source chain
   * 2. Checks bridge liquidity on destination chain
   * 3. Validates exchange rates if needed
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // Extract source chain info from payload extensions (x402 v2 spec)
    const crossChainInfo = extractCrossChainInfo(payload);

    if (!crossChainInfo) {
      return {
        isValid: false,
        invalidReason: "missing_cross_chain_extension",
      };
    }

    const { sourceNetwork, sourceAsset } = crossChainInfo;

    // Step 1: Verify payment on SOURCE chain
    // Create source chain requirements (payment goes to bridge lock address)
    const bridgeLockAddress = this.bridgeService.getLockAddress(sourceNetwork as Network);
    
    const sourceRequirements: PaymentRequirements = {
      scheme: "exact", // Use standard exact scheme on source
      network: sourceNetwork as Network,
      asset: sourceAsset,
      amount: requirements.amount, // Same amount
      payTo: bridgeLockAddress, // Lock to bridge
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      extra: requirements.extra,
    };

    // Delegate to EVM facilitator for source chain verification
    let verifyResult: VerifyResponse;
    try {
      if (sourceNetwork.startsWith("eip155:")) {
        verifyResult = await this.evmFacilitator.verify(payload, sourceRequirements);
      } else {
        return {
          isValid: false,
          invalidReason: "unsupported_source_chain_evm_only",
        };
      }

      if (!verifyResult.isValid) {
        return verifyResult;
      }
    } catch (error) {
      return {
        isValid: false,
        invalidReason: `source_chain_verification_failed: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }

    // Step 2: Verify bridge has liquidity on DESTINATION chain (only if bridging enabled)
    if (this.isEnabled) {
      const hasLiquidity = await this.bridgeService.checkLiquidity(
        sourceNetwork as Network,
        requirements.network as Network, // Destination
        requirements.asset,
        requirements.amount,
      );

      if (!hasLiquidity) {
        return {
          isValid: false,
          invalidReason: "insufficient_bridge_liquidity",
          payer: verifyResult.payer,
        };
      }
    }

    // Step 3: Verify exchange rate (if different assets)
    if (sourceAsset !== requirements.asset) {
      const rate = await this.bridgeService.getExchangeRate(
        sourceNetwork as Network,
        requirements.network as Network,
        sourceAsset,
        requirements.asset,
      );

      // Validate rate is acceptable (e.g., within 5% of expected)
      // TODO: Add rate validation logic
      if (rate <= 0) {
        return {
          isValid: false,
          invalidReason: "invalid_exchange_rate",
          payer: verifyResult.payer,
        };
      }
    }

    // All checks passed
    return {
      isValid: true,
      payer: verifyResult.payer,
    };
  }

  /**
   * Settle cross-chain payment
   * 
   * 1. Settles payment on source chain (locks funds in bridge)
   * 2. Bridges funds from source to destination
   * 3. Delivers funds on destination chain
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    // Re-verify first
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        network: requirements.network,
        transaction: "",
        errorReason: verifyResult.invalidReason,
        payer: verifyResult.payer,
      };
    }

    // Extract source chain info from payload extensions (x402 v2 spec)
    const crossChainInfo = extractCrossChainInfo(payload);
    if (!crossChainInfo) {
      return {
        success: false,
        network: requirements.network,
        transaction: "",
        errorReason: "missing_cross_chain_extension",
        payer: verifyResult.payer,
      };
    }

    const { sourceNetwork, sourceAsset } = crossChainInfo;

    try {
      // STEP 1: Settle payment on SOURCE chain
      const bridgeLockAddress = this.bridgeService.getLockAddress(sourceNetwork as Network);
      
      const sourceRequirements: PaymentRequirements = {
        scheme: "exact",
        network: sourceNetwork as Network,
        asset: sourceAsset,
        amount: requirements.amount,
        payTo: bridgeLockAddress,
        maxTimeoutSeconds: requirements.maxTimeoutSeconds,
        extra: requirements.extra,
      };

      let sourceSettleResult: SettleResponse;
      if (sourceNetwork.startsWith("eip155:")) {
        sourceSettleResult = await this.evmFacilitator.settle(payload, sourceRequirements);
      } else {
        return {
          success: false,
          network: requirements.network,
          transaction: "",
          errorReason: "unsupported_source_chain_evm_only",
          payer: verifyResult.payer,
        };
      }

      if (!sourceSettleResult.success) {
        return {
          ...sourceSettleResult,
          network: requirements.network, // Return destination network
        };
      }

      // STEP 2: Bridge funds from source to destination (only if enabled)
      if (!this.isEnabled) {
        // Cross-chain disabled: Just settle on source chain and return
        // Note: Payment goes to bridge lock address, but bridging is skipped
        return {
          success: true,
          transaction: sourceSettleResult.transaction, // Source chain transaction
          network: sourceNetwork as Network, // Return source network (not destination)
          payer: verifyResult.payer,
        };
      }

      // Cross-chain enabled: Bridge funds to destination
      const bridgeResult = await this.bridgeService.bridge(
        sourceNetwork as Network,
        sourceSettleResult.transaction, // Source chain tx hash
        requirements.network as Network, // Destination
        requirements.asset,
        requirements.amount,
        requirements.payTo, // Final recipient
      );

      // Return success with destination chain transaction
      return {
        success: true,
        transaction: bridgeResult.destinationTxHash,
        network: requirements.network, // Destination network
        payer: verifyResult.payer,
      };
    } catch (error) {
      console.error("Cross-chain settlement failed:", error);
      return {
        success: false,
        network: requirements.network,
        transaction: "",
        errorReason: error instanceof Error ? error.message : "bridge_failed",
        payer: verifyResult.payer,
      };
    }
  }
}

