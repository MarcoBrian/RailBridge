/**
 * Bridge service types for cross-chain payments
 */

export interface BridgeConfig {
  provider: "wormhole" | "layerzero" | "custom";
  apiKey?: string;
  rpcUrls?: {
    [chainId: string]: string;
  };
  facilitatorAddress?: string; // Facilitator address to use as bridge lock address for testing
}

export interface BridgeLiquidityCheck {
  hasLiquidity: boolean;
  availableAmount: string;
  sourceChain: string;
  destChain: string;
  asset: string;
}

export interface ExchangeRate {
  rate: number;
  sourceAsset: string;
  destAsset: string;
  timestamp: number;
}

export interface BridgeResult {
  bridgeTxHash: string;
  destinationTxHash: string;
  sourceChain: string;
  destChain: string;
  messageId?: string; // For tracking bridge messages
}

