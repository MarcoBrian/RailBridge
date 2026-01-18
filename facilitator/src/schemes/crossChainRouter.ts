/**
 * Cross-Chain Router Scheme
 * 
 * This is a thin routing wrapper around ExactEvmScheme.
 * It handles the network mismatch between:
 * - Payment signed on source chain (from extension)
 * - Requirements specifying destination chain (where merchant receives)
 * 
 * The actual verification and settlement logic is identical to "exact" scheme,
 * just executed on the source chain, then bridged to destination.
 */

import { SchemeNetworkFacilitator } from "@x402/core/types";
import { PaymentPayload, PaymentRequirements, Network, VerifyResponse, SettleResponse } from "@x402/core/types";
import { BridgeService } from "../services/bridgeService.js";
import { extractCrossChainInfo, type CrossChainInfo } from "../extensions/crossChain.js";

export interface CrossChainRouterConfig {
  isEnabled?: boolean; // Default: true
}

/**
 * Cross-chain router that delegates to the appropriate scheme facilitator for source chain operations,
 * then bridges funds to destination chain.
 * 
 * This is NOT a different payment scheme - it's just routing logic.
 * It works with any scheme (exact, bazaar, subscription, etc.) by delegating to the registered facilitator.
 */
export class CrossChainRouter implements SchemeNetworkFacilitator {
  readonly scheme = "cross-chain";
  readonly caipFamily = "eip155:*";
  private readonly isEnabled: boolean;

  constructor(
    /**
     * Map of scheme name -> facilitator instance
     * Used to look up the appropriate facilitator based on requirements.scheme
     */
    private schemeFacilitators: Map<string, SchemeNetworkFacilitator>,
    private bridgeService: BridgeService,
    config?: CrossChainRouterConfig,
  ) {
    this.isEnabled = config?.isEnabled ?? true;
  }

  getExtra(network: Network): Record<string, unknown> | undefined {
    return {
      crossChain: true,
      note: "This is a routing wrapper around 'exact' scheme for cross-chain payments",
    };
  }

  getSigners(network: Network): string[] {
    // Return signers from the first registered scheme facilitator
    // In practice, all EVM schemes should have the same signers
    const firstFacilitator = Array.from(this.schemeFacilitators.values())[0];
    return firstFacilitator?.getSigners(network) || [];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // Extract destination chain info from extension
    // Route network is source (where user pays), extension is destination (where merchant receives)
    const crossChainInfo = extractCrossChainInfo(payload);
    if (!crossChainInfo) {
      return {
        isValid: false,
        invalidReason: "missing_cross_chain_extension",
      };
    }

    // Route network is the source (where user pays)
    const sourceNetwork = requirements.network as Network;
    const sourceAsset = requirements.asset;

    // Extension contains destination (where merchant receives)
    const destinationNetwork = crossChainInfo.destinationNetwork as Network;

    // Use requirements.payTo (facilitator address on source chain)
    // This is where the user pays on the source chain
    // Extension has destinationPayTo (merchant address on destination chain) for bridging
    const payToAddress = requirements.payTo; // Facilitator address on source chain

    // Look up the appropriate scheme facilitator
    const schemeFacilitator = this.schemeFacilitators.get(requirements.scheme);
    if (!schemeFacilitator) {
      return {
        isValid: false,
        invalidReason: `cross_chain_not_supported_for_scheme: ${requirements.scheme}. No facilitator registered for this scheme.`,
      };
    }

    const sourceRequirements: PaymentRequirements = {
      scheme: requirements.scheme, // Use original scheme (exact, bazaar, etc.)
      network: sourceNetwork, // Route network is source
      asset: sourceAsset, // Route asset is source asset
      amount: requirements.amount,
      payTo: payToAddress,
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      extra: requirements.extra,
    };

    // Delegate verification to the appropriate scheme facilitator on source chain
    try {
      return await schemeFacilitator.verify(payload, sourceRequirements);
    } catch (error) {
      return {
        isValid: false,
        invalidReason: `source_chain_verification_failed: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

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

    // Route network is the source (where user pays)
    const sourceNetwork = requirements.network as Network;
    const sourceAsset = requirements.asset;

    // If bridging is disabled, settle directly to merchant on source chain
    if (!this.isEnabled) {
      const sourceRequirements: PaymentRequirements = {
        scheme: requirements.scheme, // Use original scheme
        network: sourceNetwork, // Route network is source
        asset: sourceAsset, // Route asset is source asset
        amount: requirements.amount,
        payTo: requirements.payTo, // Merchant address - settle directly to merchant
        maxTimeoutSeconds: requirements.maxTimeoutSeconds,
        extra: requirements.extra,
      };

      // Look up the appropriate scheme facilitator
      const schemeFacilitator = this.schemeFacilitators.get(requirements.scheme);
      if (!schemeFacilitator) {
        return {
          success: false,
          network: sourceNetwork,
          transaction: "",
          errorReason: `cross_chain_not_supported_for_scheme: ${requirements.scheme}. No facilitator registered for this scheme.`,
          payer: verifyResult.payer,
        };
      }

      const settleResult = await schemeFacilitator.settle(payload, sourceRequirements);
      return {
        ...settleResult,
        network: sourceNetwork,
      };
    }

    // If bridging is enabled, settle to facilitator address on source chain
    // requirements.payTo is the facilitator address (where client paid)
    const bridgeLockAddress = requirements.payTo; // Facilitator address on source chain
    const sourceRequirements: PaymentRequirements = {
      scheme: requirements.scheme, // Use original scheme
      network: sourceNetwork, // Route network is source
      asset: sourceAsset, // Route asset is source asset
      amount: requirements.amount,
      payTo: bridgeLockAddress, // Bridge lock address from extension - will be bridged later
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      extra: requirements.extra,
    };

    // Look up the appropriate scheme facilitator
    const schemeFacilitator = this.schemeFacilitators.get(requirements.scheme);
    if (!schemeFacilitator) {
      return {
        success: false,
        network: sourceNetwork,
        transaction: "",
        errorReason: `cross_chain_not_supported_for_scheme: ${requirements.scheme}. No facilitator registered for this scheme.`,
        payer: verifyResult.payer,
      };
    }

    const settleResult = await schemeFacilitator.settle(payload, sourceRequirements);

    if (!settleResult.success) {
      return settleResult;
    }

    // Settlement on source chain succeeded
    // Bridging will happen asynchronously in onAfterSettle hook
    // Return source chain settlement result
    // The hook will detect cross-chain by comparing:
    // - result.network (source) vs crossChainInfo.destinationNetwork (destination)
    return {
      ...settleResult,
      network: sourceNetwork,
    };
  }
}

