/**
 * Cross-Chain Extension for x402 v2
 *
 * Enables cross-chain payments where:
 * - User pays on source chain (specified in route network, e.g., Base)
 * - Merchant receives on destination chain (specified in extension, e.g., Polygon)
 * - Facilitator bridges funds between chains
 *
 * ## Usage
 *
 * ### For Resource Servers
 *
 * ```typescript
 * import { declareCrossChainExtension, CROSS_CHAIN } from './extensions/crossChain';
 *
 * // Route: network = source (where user pays)
 * // Extension: destination (where merchant receives)
 * const routes = {
 *   "GET /api/premium": {
 *     accepts: [{
 *       scheme: "exact",
 *       network: "eip155:8453",  // Source (Base - where user pays)
 *       asset: "0x...", // Source asset
 *     }],
 *     extensions: {
 *       [CROSS_CHAIN]: declareCrossChainExtension({
 *         destinationNetwork: "eip155:137",  // Destination (Polygon - where merchant receives)
 *         destinationAsset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Destination asset
 *         destinationPayTo: "0xMerchantAddress..." // Merchant address on destination chain
 *       }),
 *     },
 *     // Note: payTo in accepts should be facilitator address (where to pay on source chain)
 *   },
 * };
 * ```
 *
 * ### For Facilitators
 *
 * ```typescript
 * import { extractCrossChainInfo } from './extensions/crossChain';
 *
 * const info = extractCrossChainInfo(paymentPayload);
 * if (info) {
 *   const { destinationNetwork, destinationAsset } = info;
 *   // Use destination chain info for bridging
 *   // Source chain is in paymentPayload.network
 * }
 * ```
 */

import type { PaymentPayload } from "@x402/core/types";

/**
 * Extension identifier for cross-chain payments
 */
export const CROSS_CHAIN = "cross-chain";

/**
 * JSON Schema type (simplified)
 */
export type JSONSchema = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  pattern?: string;
  [key: string]: unknown;
};

/**
 * Cross-chain extension info
 * Contains the destination chain information for cross-chain payments
 * 
 * Note: The route network is the source (where user pays).
 * The extension specifies the destination (where merchant receives).
 */
export interface CrossChainInfo {
  /**
   * Destination network in CAIP-2 format (e.g., "eip155:137" for Polygon)
   * This is where the merchant will receive payment
   */
  destinationNetwork: string;

  /**
   * Destination asset address (e.g., "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" for USDC on Polygon)
   * This is the token the merchant will receive on the destination chain
   */
  destinationAsset: string;

  /**
   * Destination payTo address (merchant address on destination chain)
   * This is where the merchant will receive payment after bridging
   * The facilitator bridges funds to this address on the destination chain
   */
  destinationPayTo: string;
}

/**
 * Cross-chain extension structure following x402 v2 spec
 * Contains both info (data) and schema (validation)
 */
export interface CrossChainExtension {
  /**
   * The actual cross-chain data
   */
  info: CrossChainInfo;

  /**
   * JSON Schema validating the info structure
   */
  schema: JSONSchema;
}

/**
 * Parameters for declaring a cross-chain extension
 */
export interface CrossChainExtensionParams {
  /**
   * CAIP-2 network identifier where merchant receives payment (e.g., "eip155:137" for Polygon)
   */
  destinationNetwork: string;

  /**
   * Token contract address on destination chain (e.g., "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" for USDC on Polygon)
   */
  destinationAsset: string;

  /**
   * Merchant address on destination chain (where merchant receives payment after bridging)
   * The facilitator will bridge funds to this address on the destination chain
   */
  destinationPayTo: string;
}

/**
 * Declares a cross-chain extension for a resource server
 *
 * This helper creates a properly formatted extension that can be included
 * in PaymentRequired responses to indicate cross-chain payment support.
 *
 * Note: The route network should be the source (where user pays).
 * This extension specifies the destination (where merchant receives) and
 * the source chain payTo address (bridge lock address).
 *
 * @param params - Object containing destinationNetwork, destinationAsset, and sourcePayTo
 * @returns CrossChainExtension ready to include in PaymentRequired.extensions
 *
 * @example
 * ```typescript
 * // Route: network = source (eip155:8453), asset = source asset, payTo = facilitator address (where to pay on source chain)
 * // Extension: destinationNetwork = destination (eip155:137), destinationAsset = destination asset
 * //           destinationPayTo = merchant address (where merchant receives on destination chain)
 * const extension = declareCrossChainExtension({
 *   destinationNetwork: "eip155:137",  // Polygon (destination - where merchant receives)
 *   destinationAsset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC on Polygon
 *   destinationPayTo: "0xMerchantAddress..." // Merchant address on destination chain
 * });
 * ```
 */
export function declareCrossChainExtension(
  params: CrossChainExtensionParams,
): CrossChainExtension {
  return {
    info: {
      destinationNetwork: params.destinationNetwork,
      destinationAsset: params.destinationAsset,
      destinationPayTo: params.destinationPayTo,
    },
    schema: {
      type: "object",
      properties: {
        destinationNetwork: {
          type: "string",
          pattern: "^eip155:\\d+$", // CAIP-2 format: namespace:reference
          description: "Destination network in CAIP-2 format (e.g., eip155:137)",
        },
        destinationAsset: {
          type: "string",
          pattern: "^0x[a-fA-F0-9]{40}$", // Ethereum address format
          description: "Token contract address on destination chain",
        },
        destinationPayTo: {
          type: "string",
          pattern: "^0x[a-fA-F0-9]{40}$", // Ethereum address format
          description: "Merchant address on destination chain (where merchant receives payment after bridging)",
        },
      },
      required: ["destinationNetwork", "destinationAsset", "destinationPayTo"],
      additionalProperties: false,
    },
  };
}

/**
 * Extracts cross-chain info from a PaymentPayload
 *
 * This helper validates and extracts cross-chain extension data from a payment payload.
 * Returns null if the extension is missing or invalid.
 *
 * @param payload - PaymentPayload from client (may contain cross-chain extension)
 * @returns CrossChainInfo if extension is present and valid, null otherwise
 *
 * @example
 * ```typescript
 * const info = extractCrossChainInfo(paymentPayload);
 * if (info) {
 *   console.log(`Merchant receiving on ${info.destinationNetwork} with ${info.destinationAsset}`);
 * }
 * ```
 */
export function extractCrossChainInfo(
  payload: PaymentPayload,
): CrossChainInfo | null {
  // Check if extensions exist
  if (!payload.extensions || typeof payload.extensions !== "object") {
    return null;
  }

  // Get cross-chain extension
  const extension = payload.extensions[CROSS_CHAIN];
  if (!extension || typeof extension !== "object") {
    return null;
  }

  // Type guard: check if it has the expected structure
  const crossChainExt = extension as Partial<CrossChainExtension>;
  if (!crossChainExt.info || typeof crossChainExt.info !== "object") {
    return null;
  }

  const info = crossChainExt.info as Partial<CrossChainInfo>;

  // Validate required fields
  if (
    typeof info.destinationNetwork === "string" &&
    typeof info.destinationAsset === "string" &&
    typeof info.destinationPayTo === "string" &&
    /^eip155:\d+$/.test(info.destinationNetwork) && // Basic CAIP-2 validation
    /^0x[a-fA-F0-9]{40}$/.test(info.destinationAsset) && // Basic address validation
    /^0x[a-fA-F0-9]{40}$/.test(info.destinationPayTo) // Basic address validation
  ) {
    return {
      destinationNetwork: info.destinationNetwork,
      destinationAsset: info.destinationAsset,
      destinationPayTo: info.destinationPayTo,
    } as CrossChainInfo;
  }

  return null;
}

/**
 * Validates cross-chain extension structure
 *
 * Performs basic validation that the extension follows the expected format.
 * For production use, consider using a full JSON Schema validator.
 *
 * @param extension - Extension object to validate
 * @returns true if extension structure is valid, false otherwise
 */
export function validateCrossChainExtension(
  extension: unknown,
): extension is CrossChainExtension {
  if (!extension || typeof extension !== "object") {
    return false;
  }

  const ext = extension as Partial<CrossChainExtension>;

  // Check info structure
  if (!ext.info || typeof ext.info !== "object") {
    return false;
  }

  const info = ext.info as Partial<CrossChainInfo>;
  if (
    typeof info.destinationNetwork !== "string" ||
    typeof info.destinationAsset !== "string"
  ) {
    return false;
  }

  // Check schema structure
  if (!ext.schema || typeof ext.schema !== "object") {
    return false;
  }

  return true;
}

