/**
 * Test Client for RailBridge Facilitator
 * 
 * This script tests the facilitator with a real wallet on Base Sepolia testnet.
 * 
 * Prerequisites:
 * 1. Set TEST_WALLET_PRIVATE_KEY in .env
 * 2. Wallet must have Base Sepolia ETH for gas
 * 3. Wallet must have testnet USDC (or update asset address)
 * 4. Facilitator and merchant server must be running
 */

import dotenv from "dotenv";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { registerExactEvmClient } from "@x402/evm/exact/client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

dotenv.config();

// Configuration
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const MERCHANT_URL = process.env.MERCHANT_URL || "http://localhost:4021";
const TEST_WALLET_PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY as `0x${string}` | undefined;

if (!TEST_WALLET_PRIVATE_KEY) {
  console.error("❌ TEST_WALLET_PRIVATE_KEY environment variable is required");
  console.error("   Add it to your .env file");
  process.exit(1);
}

// Base Sepolia USDC address (testnet)
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
  console.log("🧪 Starting RailBridge Facilitator Test Client\n");

  // Create test wallet
  const testWallet = privateKeyToAccount(TEST_WALLET_PRIVATE_KEY);
  console.log(`📱 Test wallet: ${testWallet.address}\n`);

  // Create viem client
  const viemClient = createWalletClient({
    account: testWallet,
    chain: baseSepolia,
    transport: http(process.env.EVM_RPC_URL || "https://sepolia.base.org"),
  });

  // Create x402 client
  const client = new x402Client();
  registerExactEvmClient(client, {
    signer: {
      getAddresses: async () => [testWallet.address],
      signTypedData: async (data) => {
        return await viemClient.signTypedData(data as any);
      },
    },
    networks: ["eip155:84532"], // Base Sepolia
  });

  // Wrap with HTTP client
  const httpClient = new x402HTTPClient(client);

  // Wrap fetch to handle 402 responses
  const fetchWithPayment = async (url: string): Promise<Response> => {
    console.log(`📤 Making request to: ${url}`);
    const response = await fetch(url);

    if (response.status === 402) {
      console.log("💳 Received 402 Payment Required");
      
      // Get payment requirements
      const getHeader = (name: string) => response.headers.get(name);
      let body: any;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }

      const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, body);
      console.log("📋 Payment requirements:", {
        scheme: paymentRequired.accepts[0]?.scheme,
        network: paymentRequired.accepts[0]?.network,
        amount: paymentRequired.accepts[0]?.amount,
        asset: paymentRequired.accepts[0]?.asset,
      });

      // Create payment payload
      console.log("✍️  Creating payment payload...");
      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      console.log("✅ Payment payload created");

      // Encode payment header
      const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
      console.log("📦 Payment header encoded");

      // Retry with payment
      console.log("🔄 Retrying request with payment...");
      const retryResponse = await fetch(url, {
        headers: paymentHeaders,
      });

      return retryResponse;
    }

    return response;
  };

  // Test 1: Same-chain payment
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: Same-Chain Payment (Base Sepolia)");
  console.log("=".repeat(60) + "\n");

  try {
    const response = await fetchWithPayment(`${MERCHANT_URL}/api/premium`);
    console.log(`\n📥 Response status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      console.log("✅ Payment successful!");
      console.log("📦 Response data:", data);

      // Check for settlement header
      const paymentResponse = response.headers.get("PAYMENT-RESPONSE") || 
                              response.headers.get("X-PAYMENT-RESPONSE");
      if (paymentResponse) {
        console.log("💰 Settlement confirmed in header");
      }
    } else {
      console.error("❌ Payment failed");
      const error = await response.text();
      console.error("Error:", error);
    }
  } catch (error) {
    console.error("❌ Test failed:", error);
  }

  // Test 2: Check facilitator health
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Facilitator Health Check");
  console.log("=".repeat(60) + "\n");

  try {
    const healthResponse = await fetch(`${FACILITATOR_URL}/health`);
    const health = await healthResponse.json();
    console.log("🏥 Facilitator health:", health);
  } catch (error) {
    console.error("❌ Health check failed:", error);
  }

  // Test 3: Check supported schemes
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Supported Schemes");
  console.log("=".repeat(60) + "\n");

  try {
    const supportedResponse = await fetch(`${FACILITATOR_URL}/supported`);
    const supported = await supportedResponse.json();
    console.log("📋 Supported schemes:", JSON.stringify(supported, null, 2));
  } catch (error) {
    console.error("❌ Supported check failed:", error);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ Testing complete!");
  console.log("=".repeat(60) + "\n");
}

main().catch(console.error);

