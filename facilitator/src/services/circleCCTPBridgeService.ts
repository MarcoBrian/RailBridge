import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http, isAddress } from "viem";
import type {
  BridgeConfig,
  BridgeResult,
  IBridgeService,
} from "../types/bridge.js";
import { Network } from "@x402/core/types";

/**
 * Circle CCTP Bridge Service Implementation
 * 
 * Uses Circle's Cross-Chain Transfer Protocol (CCTP) for USDC transfers.
 * Supports burn-and-mint model for native USDC bridging.
 */
export class CircleCCTPBridgeService implements IBridgeService {
  private config: BridgeConfig;
  private kit: BridgeKit;
  private adapter: ReturnType<typeof createViemAdapterFromPrivateKey> | null = null;

  // Map CAIP-2 network identifiers to Circle BridgeKit chain names
  private readonly chainNameMap: Record<string, string> = {
    "eip155:84532": "Base_Sepolia", // Base Sepolia
    "eip155:8453": "Base", // Base Mainnet
    "eip155:421614": "Arbitrum_Sepolia", // Arbitrum Sepolia
    "eip155:42161": "Arbitrum", // Arbitrum Mainnet
    "eip155:11155111": "Ethereum_Sepolia", // Ethereum Sepolia
    "eip155:1": "Ethereum", // Ethereum Mainnet
    "eip155:80002": "Polygon_Amoy", // Polygon Amoy
    "eip155:137": "Polygon", // Polygon Mainnet
    // Add more chains as needed
  };

  // Map CAIP-2 network identifiers to default RPC URLs
  private readonly chainRpcMap: Record<string, string> = {
    "eip155:84532": "https://sepolia.base.org", // Base Sepolia
    "eip155:8453": "https://mainnet.base.org", // Base Mainnet
    "eip155:421614": "https://sepolia-rollup.arbitrum.io/rpc", // Arbitrum Sepolia
    "eip155:42161": "https://arb1.arbitrum.io/rpc", // Arbitrum Mainnet
    "eip155:11155111": "https://rpc.sepolia.org", // Ethereum Sepolia
    "eip155:1": "https://eth.llamarpc.com", // Ethereum Mainnet
    "eip155:80002": "https://rpc-amoy.polygon.technology", // Polygon Amoy
    "eip155:137": "https://polygon-rpc.com", // Polygon Mainnet
  };

  private readonly defaultUsdcAddresses: Record<string, string[]> = {
    "eip155:84532": ["0x036CbD53842c5426634e7929541eC2318f3dCF7e"], // Base Sepolia USDC
    "eip155:8453": ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"], // Base Mainnet USDC
    "eip155:11155111": ["0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"], // Ethereum Sepolia USDC
    "eip155:1": ["0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48"], // Ethereum Mainnet USDC
    "eip155:137": ["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"], // Polygon Mainnet USDC
  };

  constructor(config: BridgeConfig) {
    this.config = config;
    this.kit = new BridgeKit();
    
    // Initialize adapter if private key is available
    if (process.env.EVM_PRIVATE_KEY) {
      this.adapter = createViemAdapterFromPrivateKey({
        privateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
      });
    }
  }

  /**
   * Check if bridge has sufficient liquidity on destination chain
   * 
   * For CCTP (burn-and-mint), liquidity is always available since USDC
   * is minted on destination. However, testnets may have limitations.
   */
  async checkLiquidity(
    sourceChain: Network,
    destChain: Network,
    asset: string,
    amount: string,
  ): Promise<boolean> {
    console.log(`[CCTP] Checking liquidity: ${sourceChain} -> ${destChain}, asset: ${asset}, amount: ${amount}`);
    
    // CCTP uses burn-and-mint, so liquidity is theoretically always available
    // However, testnets may have limitations
    // For now, return true (can be enhanced with actual contract checks)
    
    // TODO: Could check if both chains support CCTP and if USDC addresses exist
    const sourceChainName = this.mapNetworkToChainName(sourceChain);
    const destChainName = this.mapNetworkToChainName(destChain);
    
    if (!sourceChainName || !destChainName) {
      console.warn(`[CCTP] Unsupported chain pair: ${sourceChain} -> ${destChain}`);
      return false;
    }

    // Check if chains are supported by Circle CCTP
    const supportedChains = this.kit.getSupportedChains();
    const sourceSupported = supportedChains.some(c => c.chain === sourceChainName);
    const destSupported = supportedChains.some(c => c.chain === destChainName);
    
    if (!sourceSupported || !destSupported) {
      console.warn(`[CCTP] Chain not supported by CCTP: ${sourceChainName} or ${destChainName}`);
      return false;
    }

    return true;
  }

  /**
   * Get exchange rate between source and destination assets
   * 
   * For USDC via CCTP, the rate is always 1:1 (same asset, burn-and-mint)
   */
  async getExchangeRate(
    sourceChain: Network,
    destChain: Network,
    sourceAsset: string,
    destAsset: string,
  ): Promise<number> {
    console.log(`[CCTP] Getting exchange rate: ${sourceAsset} -> ${destAsset}`);
    
    // For USDC via CCTP, rate is always 1:1 (same asset)
    // If different assets, would need price oracle (not supported by CCTP)
    
    if (this.isUSDC(sourceAsset, sourceChain) && this.isUSDC(destAsset, destChain)) {
      return 1.0;
    }
    
    // CCTP only supports USDC, so if assets differ, return 0 (not supported)
    console.warn(`[CCTP] CCTP only supports USDC transfers. Different assets not supported.`);
    return 0;
  }

  /**
   * Execute bridge transaction using Circle CCTP
   * 
   * Burns USDC on source chain and mints on destination chain
   */
  async bridge(
    sourceChain: Network,
    sourceTxHash: string,
    destChain: Network,
    asset: string,
    amount: string,
    recipient: string,
  ): Promise<BridgeResult> {
    this.validateBridgeInputs(sourceChain, destChain, asset, amount, recipient);
    // amount here is in on-chain base units (USDC has 6 decimals)
    // Circle BridgeKit expects a human-readable decimal string (e.g. "0.01")
    const humanAmount = this.toHumanReadableUSDC(amount);

    if (!this.adapter) {
      throw new Error("EVM_PRIVATE_KEY not configured. Cannot bridge without adapter.");
    }

    const sourceChainName = this.mapNetworkToChainName(sourceChain);
    const destChainName = this.mapNetworkToChainName(destChain);

    if (!sourceChainName || !destChainName) {
      throw new Error(`Unsupported chain pair: ${sourceChain} -> ${destChain}`);
    }

    console.log(`[CCTP] Bridging USDC:`, {
      sourceChain,
      destChain,
      sourceChainName,
      destChainName,
      rawAmount: amount,
      humanAmount,
    });
    console.log(`[CCTP] Recipient: ${recipient}`);
    console.log(`[CCTP] Source TX: ${sourceTxHash}`);

    try {
      // Wait for source transaction confirmation before bridging
      // This ensures the settlement transaction has confirmed and funds are available
      await this.waitForSourceConfirmation(sourceChain, sourceTxHash);

      // Recreate adapter after settlement to force fresh nonce query
      // BridgeKit's adapter caches nonce internally, so we recreate it to get fresh state
      // This prevents nonce conflicts when the settlement transaction just incremented the nonce
      this.recreateAdapter();

      // Execute bridge using Circle BridgeKit
      // Type assertion: sourceChainName and destChainName are validated above and match BridgeChainIdentifier
      const result = await this.kit.bridge({
        from: { adapter: this.adapter, chain: sourceChainName as any },
        to: {
          adapter: this.adapter,
          chain: destChainName as any,
          recipientAddress: recipient,
        },
        amount: humanAmount,
      });

      // Extract transaction hashes from result
      const burnStep = result.steps?.find(s => s.name === "burn");
      const mintStep = result.steps?.find(s => s.name === "mint");

      if (result.state === "error") {
        const errorStep = result.steps?.find(s => s.state === "error");
        throw new Error(
          `CCTP bridge failed at step "${errorStep?.name}": ${errorStep?.errorMessage || "Unknown error"}`
        );
      }

      if (!burnStep?.txHash) {
        throw new Error("Burn transaction hash not found in bridge result");
      }

      // For CCTP, the bridge transaction is the burn transaction
      // The destination transaction is the mint transaction
      const bridgeTxHash = burnStep.txHash;
      const destinationTxHash = mintStep?.txHash || "";

      console.log(`[CCTP] Bridge successful!`);
      console.log(`[CCTP] Burn TX: ${bridgeTxHash}`);
      if (destinationTxHash) {
        console.log(`[CCTP] Mint TX: ${destinationTxHash}`);
      }

      // Extract message ID from attestation step if available
      const attestationStep = result.steps?.find(s => s.name === "fetchAttestation");
      const messageId = attestationStep?.data && typeof attestationStep.data === 'object' && 'attestation' in attestationStep.data
        ? (attestationStep.data as { attestation?: string }).attestation
        : undefined;

      return {
        bridgeTxHash,
        destinationTxHash,
        sourceChain,
        destChain,
        messageId,
      };
    } catch (error) {
      console.error(`[CCTP] Bridge error:`, error);
      throw error;
    }
  }

  /**
   * Map CAIP-2 network identifier to Circle BridgeKit chain name
   */
  private mapNetworkToChainName(network: Network): string | null {
    return this.chainNameMap[network] || null;
  }

  /**
   * Check if asset is USDC (basic check by address or symbol)
   * 
   * TODO: Enhance with actual USDC address checks per chain
   */
  private isUSDC(asset: string, chain: Network): boolean {
    if (!isAddress(asset)) {
      return false;
    }
    const normalized = asset.toLowerCase();
    const allowlist = this.defaultUsdcAddresses[chain];
    if (!allowlist || allowlist.length === 0) {
      return false;
    }
    return allowlist.some((address) => address.toLowerCase() === normalized);
  }

  /**
   * Convert USDC amount from base units (6 decimals) to human-readable string.
   *
   * Example:
   * - "10000" (base units) -> "0.01"
   * - "1000000" (base units) -> "1"
   */
  private toHumanReadableUSDC(amount: string): string {
    const decimals = 6n;
    const base = 10n ** decimals;
    const value = BigInt(amount);

    const integer = value / base;
    const fraction = value % base;

    if (fraction === 0n) {
      return integer.toString();
    }

    let fractionStr = fraction.toString().padStart(Number(decimals), "0");
    // Trim trailing zeros
    fractionStr = fractionStr.replace(/0+$/, "");

    return `${integer.toString()}.${fractionStr}`;
  }

  /**
   * Recreate the adapter to force fresh nonce query
   * BridgeKit's adapter caches nonce internally, so recreating it ensures
   * it queries the current nonce from the chain after settlement
   */
  private recreateAdapter(): void {
    if (!process.env.EVM_PRIVATE_KEY) {
      console.warn(`[CCTP] Cannot recreate adapter: EVM_PRIVATE_KEY not set`);
      return;
    }

    console.log(`[CCTP] Recreating adapter to refresh nonce state`);
    this.adapter = createViemAdapterFromPrivateKey({
      privateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
    });
    console.log(`[CCTP] Adapter recreated - will query fresh nonce on next transaction`);
  }

  /**
   * Wait for source chain transaction confirmation
   * This ensures the settlement transaction has confirmed before bridging
   */
  private async waitForSourceConfirmation(
    chain: Network,
    txHash: string,
  ): Promise<void> {
    console.log(`[CCTP] Waiting for source transaction confirmation: ${chain}, TX: ${txHash}`);

    // Get RPC URL for the source chain
    const rpcUrl = this.chainRpcMap[chain] || process.env.EVM_RPC_URL;
    
    if (!rpcUrl) {
      console.warn(`[CCTP] No RPC URL found for ${chain}, skipping confirmation wait`);
      return;
    }

    try {
      // Create a public client to check transaction status
      const publicClient = createPublicClient({
        transport: http(rpcUrl),
      });

      // Wait for transaction receipt (confirmation)
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout: 120_000, // 2 minute timeout
      });

      console.log(`[CCTP] Source transaction confirmed: ${txHash}`);
      console.log(`[CCTP] Block number: ${receipt.blockNumber}, Status: ${receipt.status}`);
    } catch (error) {
      console.error(`[CCTP] Error waiting for source transaction confirmation:`, error);
      // Don't throw - continue with bridge attempt (Circle BridgeKit will handle balance checks)
      console.warn(`[CCTP] Continuing with bridge despite confirmation wait error`);
    }
  }

  /**
   * Get supported chains for CCTP
   */
  getSupportedChains(): string[] {
    return this.kit.getSupportedChains().map(c => c.chain);
  }

  private validateBridgeInputs(
    sourceChain: Network,
    destChain: Network,
    asset: string,
    amount: string,
    recipient: string,
  ): void {
    if (!this.mapNetworkToChainName(sourceChain) || !this.mapNetworkToChainName(destChain)) {
      throw new Error(`Unsupported chain pair: ${sourceChain} -> ${destChain}`);
    }

    if (!isAddress(recipient)) {
      throw new Error(`Invalid recipient address: ${recipient}`);
    }

    if (!/^\d+$/.test(amount)) {
      throw new Error(`Invalid amount: ${amount}. Expected base-unit integer string.`);
    }

    const numericAmount = BigInt(amount);
    if (numericAmount <= 0n) {
      throw new Error(`Invalid amount: ${amount}. Must be greater than zero.`);
    }

    if (!this.isUSDC(asset, sourceChain)) {
      throw new Error(`CCTP only supports USDC on ${sourceChain}. Asset ${asset} is not supported.`);
    }
  }

}
