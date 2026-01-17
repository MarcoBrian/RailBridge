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
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { BridgeService } from "../services/bridgeService.js";
import { extractCrossChainInfo } from "../extensions/crossChain.js";

export interface CrossChainRouterConfig {
  isEnabled?: boolean; // Default: true
}

/**
 * Cross-chain router that delegates to ExactEvmScheme for source chain operations,
 * then bridges funds to destination chain.
 * 
 * This is NOT a different payment scheme - it's just routing logic.
 * The payment mechanism is still "exact" (EIP-3009 transferWithAuthorization).
 */
export class CrossChainRouter implements SchemeNetworkFacilitator {
  readonly scheme = "cross-chain";
  readonly caipFamily = "eip155:*";
  private readonly isEnabled: boolean;

  constructor(
    private exactEvmScheme: ExactEvmScheme,
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
    return this.exactEvmScheme.getSigners(network);
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // Extract source chain info from extension
    const crossChainInfo = extractCrossChainInfo(payload);
    if (!crossChainInfo) {
      return {
        isValid: false,
        invalidReason: "missing_cross_chain_extension",
      };
    }

    // Create source chain requirements
    // If bridging disabled: verify payment to merchant on source chain
    // If bridging enabled: verify payment to bridge lock on source chain
    const payToAddress = this.isEnabled
      ? this.bridgeService.getLockAddress(crossChainInfo.sourceNetwork as Network)
      : requirements.payTo; // Merchant address when bridging disabled

    const sourceRequirements: PaymentRequirements = {
      scheme: "exact",
      network: crossChainInfo.sourceNetwork as Network,
      asset: crossChainInfo.sourceAsset,
      amount: requirements.amount,
      payTo: payToAddress,
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      extra: requirements.extra,
    };

    // Delegate verification to exact scheme on source chain
    try {
      return await this.exactEvmScheme.verify(payload, sourceRequirements);
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

    // If bridging is disabled, settle directly to merchant on source chain
    if (!this.isEnabled) {
      const sourceRequirements: PaymentRequirements = {
        scheme: "exact",
        network: crossChainInfo.sourceNetwork as Network,
        asset: crossChainInfo.sourceAsset,
        amount: requirements.amount,
        payTo: requirements.payTo, // Merchant address - settle directly to merchant
        maxTimeoutSeconds: requirements.maxTimeoutSeconds,
        extra: requirements.extra,
      };

      const settleResult = await this.exactEvmScheme.settle(payload, sourceRequirements);
      return {
        ...settleResult,
        network: crossChainInfo.sourceNetwork as Network,
      };
    }

    // If bridging is enabled, settle to bridge lock address on source chain
    const bridgeLockAddress = this.bridgeService.getLockAddress(crossChainInfo.sourceNetwork as Network);
    const sourceRequirements: PaymentRequirements = {
      scheme: "exact",
      network: crossChainInfo.sourceNetwork as Network,
      asset: crossChainInfo.sourceAsset,
      amount: requirements.amount,
      payTo: bridgeLockAddress, // Bridge lock address - will be bridged later
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      extra: requirements.extra,
    };

    const settleResult = await this.exactEvmScheme.settle(payload, sourceRequirements);

    if (!settleResult.success) {
      return settleResult;
    }

    // Settlement on source chain succeeded
    // Bridging will happen asynchronously in onAfterSettle hook
    // Return source chain settlement result
    // The hook will detect cross-chain by comparing:
    // - result.network (source) vs requirements.network (destination)
    return {
      ...settleResult,
      network: crossChainInfo.sourceNetwork as Network,
    };
  }
}

