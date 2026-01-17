/**
 * Cross-Chain Server Scheme
 * 
 * Server-side implementation for "cross-chain" scheme.
 * This is a thin wrapper around ExactEvmScheme that reports scheme as "cross-chain".
 * 
 * The server-side operations (price parsing, requirement building) are identical to "exact",
 * so we delegate to ExactEvmScheme. The actual cross-chain routing is handled by the facilitator.
 */

import {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";

/**
 * Server-side scheme for cross-chain payments.
 * Delegates to ExactEvmScheme for price parsing and requirement building.
 */
export class CrossChainServerScheme implements SchemeNetworkServer {
  readonly scheme = "cross-chain";
  private exactEvmScheme: ExactEvmScheme;

  constructor() {
    // Use ExactEvmScheme for server-side operations
    // Price parsing and requirement building are the same for cross-chain
    this.exactEvmScheme = new ExactEvmScheme();
  }

  /**
   * Parse price into asset amount (delegates to ExactEvmScheme)
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    return this.exactEvmScheme.parsePrice(price, network);
  }

  /**
   * Enhance payment requirements (delegates to ExactEvmScheme)
   */
  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    extensions: string[],
  ): Promise<PaymentRequirements> {
    return this.exactEvmScheme.enhancePaymentRequirements(
      requirements,
      supportedKind,
      extensions,
    );
  }
}

