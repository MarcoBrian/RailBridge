/**
 * Cross-Chain Extension for x402 v2
 *
 * Enables cross-chain payments where:
 * - User pays on source chain (e.g., Base)
 * - Server receives on destination chain (e.g., Polygon)
 * - Facilitator bridges funds between chains
 *
 * ## Usage
 *
 * ### For Resource Servers
 *
 * ```typescript
 * import { declareCrossChainExtension, CROSS_CHAIN } from './extensions/crossChain';
 *
 * const extensions = {
 *   [CROSS_CHAIN]: declareCrossChainExtension(
 *     "eip155:8453",  // Source network (where user pays)
 *     "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // Source asset (token address)
 *   ),
 * };
 *
 * const paymentRequired = {
 *   x402Version: 2,
 *   resource: { ... },
 *   accepts: [{ scheme: "cross-chain", network: "eip155:137", ... }],
 *   extensions,
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
 *   const { sourceNetwork, sourceAsset } = info;
 *   // Use source chain info for verification/settlement
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
 * Contains the source chain information needed for cross-chain payments
 */
export interface CrossChainInfo {
  /**
   * Source network in CAIP-2 format (e.g., "eip155:8453" for Base)
   * This is where the user will pay from
   */
  sourceNetwork: string;

  /**
   * Source asset address (e.g., "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" for USDC on Base)
   * This is the token the user will pay with on the source chain
   */
  sourceAsset: string;
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
 * Declares a cross-chain extension for a resource server
 *
 * This helper creates a properly formatted extension that can be included
 * in PaymentRequired responses to indicate cross-chain payment support.
 *
 * @param sourceNetwork - CAIP-2 network identifier where user pays (e.g., "eip155:8453")
 * @param sourceAsset - Token contract address on source chain
 * @returns CrossChainExtension ready to include in PaymentRequired.extensions
 *
 * @example
 * ```typescript
 * const extension = declareCrossChainExtension(
 *   "eip155:8453",  // Base
 *   "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // USDC
 * );
 * ```
 */
export function declareCrossChainExtension(
  sourceNetwork: string,
  sourceAsset: string,
): CrossChainExtension {
  return {
    info: {
      sourceNetwork,
      sourceAsset,
    },
    schema: {
      type: "object",
      properties: {
        sourceNetwork: {
          type: "string",
          pattern: "^eip155:\\d+$", // CAIP-2 format: namespace:reference
          description: "Source network in CAIP-2 format (e.g., eip155:8453)",
        },
        sourceAsset: {
          type: "string",
          pattern: "^0x[a-fA-F0-9]{40}$", // Ethereum address format
          description: "Token contract address on source chain",
        },
      },
      required: ["sourceNetwork", "sourceAsset"],
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
 *   console.log(`User paying on ${info.sourceNetwork} with ${info.sourceAsset}`);
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
    typeof info.sourceNetwork === "string" &&
    typeof info.sourceAsset === "string" &&
    /^eip155:\d+$/.test(info.sourceNetwork) && // Basic CAIP-2 validation
    /^0x[a-fA-F0-9]{40}$/.test(info.sourceAsset) // Basic address validation
  ) {
    return {
      sourceNetwork: info.sourceNetwork,
      sourceAsset: info.sourceAsset,
    };
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
    typeof info.sourceNetwork !== "string" ||
    typeof info.sourceAsset !== "string"
  ) {
    return false;
  }

  // Check schema structure
  if (!ext.schema || typeof ext.schema !== "object") {
    return false;
  }

  return true;
}

