/**
 * Client Example for RailBridge Cross-Chain Facilitator
 * 
 * This example demonstrates how to interact with a merchant server that uses
 * the RailBridge cross-chain facilitator for x402 payments.
 * 
 * Prerequisites:
 * 1. Set CLIENT_PRIVATE_KEY in .env (your wallet private key)
 * 2. Wallet must have Base Sepolia ETH for gas
 * 3. Wallet must have testnet USDC (or update asset address)
 * 4. Facilitator and merchant server must be running
 * 
 * Usage:
 *   tsx src/client-example.ts
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// Get directory of current file (for ESM modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

// Configuration
const MERCHANT_URL = process.env.MERCHANT_URL || "http://localhost:4021";
const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!CLIENT_PRIVATE_KEY) {
  console.error("❌ CLIENT_PRIVATE_KEY environment variable is required");
  console.error("   Add it to your .env file:");
  console.error("   CLIENT_PRIVATE_KEY=0xYourPrivateKeyHere");
  process.exit(1);
}

// Create signer from private key
const signer = privateKeyToAccount(CLIENT_PRIVATE_KEY);
console.log(`📱 Client wallet: ${signer.address}\n`);

// Create viem wallet client for signing
const viemClient = createWalletClient({
  account: signer,
  chain: baseSepolia,
  transport: http(process.env.EVM_RPC_URL || "https://sepolia.base.org"),
});

// Create x402 client
const client = new x402Client();

// Register EVM scheme with the client
// This enables the client to create payment payloads for EVM networks
registerExactEvmScheme(client, { signer });


// Wrap fetch with payment handling
// This automatically handles 402 Payment Required responses
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

/**
 * Example 1: Same-Chain Payment
 * 
 * Makes a request to a paid endpoint. If payment is required (402),
 * the wrapped fetch automatically:
 * 1. Parses payment requirements
 * 2. Creates and signs payment payload
 * 3. Retries request with payment header
 */
async function exampleSameChainPayment() {
  console.log("=".repeat(60));
  console.log("Example 1: Same-Chain Payment");
  console.log("=".repeat(60));
  console.log(`\n📤 Making request to: ${MERCHANT_URL}/api/premium\n`);

  try {
    // Make request - payment is handled automatically
    const response = await fetchWithPayment(`${MERCHANT_URL}/api/premium`, {
      method: "GET",
    });

    console.log(`📥 Response status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      console.log("✅ Payment successful!");
      console.log("📦 Response data:", JSON.stringify(data, null, 2));

      // Get payment receipt from response headers
      const httpClient = new x402HTTPClient(client);
      const paymentResponse = httpClient.getPaymentSettleResponse(
        (name) => response.headers.get(name),
      );

      if (paymentResponse) {
        console.log("\n💰 Payment Receipt:");
        console.log(`   Transaction: ${paymentResponse.transaction}`);
        console.log(`   Network: ${paymentResponse.network}`);
        console.log(`   Success: ${paymentResponse.success}`);
      }
    } else {
      // Detailed error logging
      console.error("❌ Request failed with status:", response.status);
      console.error("📋 Response headers:");
      response.headers.forEach((value, key) => {
        console.error(`   ${key}: ${value.substring(0, 100)}${value.length > 100 ? "..." : ""}`);
      });

      // Try to get response body
      let errorBody: any;
      try {
        const text = await response.text();
        if (text) {
          errorBody = JSON.parse(text);
          console.error("📦 Response body:", JSON.stringify(errorBody, null, 2));
        } else {
          console.error("📦 Response body: (empty)");
        }
      } catch (parseError) {
        console.error("📦 Response body: (could not parse)");
      }

      // If it's a 402, try to parse payment requirements manually
      if (response.status === 402) {
        console.error("\n💡 Debugging 402 Payment Required:");
        const httpClient = new x402HTTPClient(client);
        try {
          const getHeader = (name: string) => response.headers.get(name);
          const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, errorBody);
          console.error("📋 Payment Requirements parsed:");
          console.error(JSON.stringify(paymentRequired, null, 2));
          
          // Try to create payment payload to see what fails
          console.error("\n🔍 Attempting to create payment payload...");
          try {
            const paymentPayload = await client.createPaymentPayload(paymentRequired);
            console.error("✅ Payment payload created successfully");
            console.error("   Payload preview:", JSON.stringify({
              x402Version: paymentPayload.x402Version,
              scheme: paymentPayload.accepted.scheme,
              network: paymentPayload.accepted.network,
              amount: paymentPayload.accepted.amount,
            }, null, 2));
          } catch (payloadError) {
            console.error("❌ Failed to create payment payload:");
            console.error("   Error:", payloadError instanceof Error ? payloadError.message : payloadError);
            if (payloadError instanceof Error && payloadError.stack) {
              console.error("   Stack:", payloadError.stack);
            }
          }
        } catch (parseError) {
          console.error("❌ Failed to parse payment requirements:");
          console.error("   Error:", parseError instanceof Error ? parseError.message : parseError);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error("📚 Stack trace:");
      console.error(error.stack);
    }
  }
}

/**
 * Example 2: Cross-Chain Payment
 * 
 * For cross-chain payments, the merchant server includes a cross-chain extension
 * in the PaymentRequired response. The client automatically copies this extension
 * into the PaymentPayload, and the facilitator handles the cross-chain routing.
 * 
 * Note: The client doesn't need to know about cross-chain details - it just
 * signs the payment for the source chain as specified in the extension.
 */
async function exampleCrossChainPayment() {
  console.log("\n" + "=".repeat(60));
  console.log("Example 2: Cross-Chain Payment");
  console.log("=".repeat(60));
  console.log("\n💡 Note: Cross-chain payments work the same way!");
  console.log("   The merchant's PaymentRequired includes a cross-chain extension");
  console.log("   The client copies it to PaymentPayload");
  console.log("   The facilitator handles routing and bridging\n");

  try {
    const response = await fetchWithPayment(`${MERCHANT_URL}/api/premium`, {
      method: "GET",
    });

    console.log(`📥 Response status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      console.log("✅ Payment successful!");
      console.log("📦 Response data:", JSON.stringify(data, null, 2));

      // Get payment receipt
      const httpClient = new x402HTTPClient(client);
      const paymentResponse = httpClient.getPaymentSettleResponse(
        (name) => response.headers.get(name),
      );

      if (paymentResponse) {
        console.log("\n💰 Payment Receipt:");
        console.log(`   Transaction: ${paymentResponse.transaction}`);
        console.log(`   Network: ${paymentResponse.network}`);
        console.log(`   Success: ${paymentResponse.success}`);
        console.log("\n💡 For cross-chain:");
        console.log("   - Transaction is on source chain");
        console.log("   - Bridging happens asynchronously");
        console.log("   - Merchant receives on destination chain");
      }
    } else {
      const errorText = await response.text();
      console.error("❌ Request failed:");
      console.error(errorText);
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
  }
}

/**
 * Example 3: Manual Payment Flow (Advanced)
 * 
 * Shows how to manually handle the payment flow if you need more control.
 * This is useful for debugging or custom payment logic.
 */
async function exampleManualPaymentFlow() {
  console.log("\n" + "=".repeat(60));
  console.log("Example 3: Manual Payment Flow (Advanced)");
  console.log("=".repeat(60) + "\n");

  try {
    // Step 1: Make initial request
    console.log("📤 Step 1: Making initial request...");
    const response = await fetch(`${MERCHANT_URL}/api/premium`);

    if (response.status !== 402) {
      console.log("✅ No payment required");
      const data = await response.json();
      console.log("Response:", data);
      return;
    }

    console.log("💳 Step 2: Received 402 Payment Required");

    // Step 2: Parse payment requirements
    const httpClient = new x402HTTPClient(client);
    const getHeader = (name: string) => response.headers.get(name);
    let body: any;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, body);
    console.log("📋 Payment Requirements:");
    console.log(JSON.stringify(paymentRequired, null, 2));

    // Step 3: Create payment payload
    console.log("\n✍️  Step 3: Creating payment payload...");
    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    console.log("✅ Payment payload created");

    // Step 4: Encode payment header
    console.log("\n📦 Step 4: Encoding payment header...");
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    console.log("✅ Payment header encoded");

    // Step 5: Retry with payment
    console.log("\n🔄 Step 5: Retrying request with payment...");
    const retryResponse = await fetch(`${MERCHANT_URL}/api/premium`, {
      headers: paymentHeaders,
    });

    console.log(`📥 Response status: ${retryResponse.status}`);

    if (retryResponse.ok) {
      const data = await retryResponse.json();
      console.log("✅ Payment successful!");
      console.log("📦 Response data:", JSON.stringify(data, null, 2));

      // Get payment receipt
      const paymentResponse = httpClient.getPaymentSettleResponse(
        (name) => retryResponse.headers.get(name),
      );

      if (paymentResponse) {
        console.log("\n💰 Payment Receipt:");
        console.log(JSON.stringify(paymentResponse, null, 2));
      }
    } else {
      const errorText = await retryResponse.text();
      console.error("❌ Payment failed:");
      console.error(errorText);
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
  }
}

/**
 * Main function
 */
async function main() {
  console.log("🚀 RailBridge Client Example\n");
  console.log(`Merchant URL: ${MERCHANT_URL}`);
  console.log(`Client Address: ${signer.address}\n`);

  // Run examples
  await exampleSameChainPayment();
  // await exampleCrossChainPayment(); // Commented out for testing
  // await exampleManualPaymentFlow(); // Commented out for testing

  console.log("\n" + "=".repeat(60));
  console.log("✅ Examples complete!");
  console.log("=".repeat(60) + "\n");
}

// Run if executed directly
// This check ensures main() only runs when the file is executed as a script,
// not when it's imported as a module
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && fileURLToPath(`file://${process.argv[1]}`) === currentFilePath) {
  main().catch(console.error);
}

export { exampleSameChainPayment, exampleCrossChainPayment, exampleManualPaymentFlow };

