import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import { BridgeKit, type EVMChainDefinition } from "@circle-fin/bridge-kit";
import {
  createPublicClient,
  http,
  keccak256,
  toHex,
  type Address,
} from "viem";
import { hashStruct } from "viem/utils";
import type { AssetAmount } from "@x402/core/types";

type Caip2 = `${string}:${string}`;

// Get directory of current file (for ESM modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file in project root
const envPath = join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

// ---------------------------------------------------------------------------
// Merchant-side x402 server - Same-Chain Payments Only
// This merchant only accepts payments on the same chain (no cross-chain)
// ---------------------------------------------------------------------------

// Required env vars for merchant
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS as `0x${string}` | undefined;

if (!MERCHANT_ADDRESS) {
  console.error("❌ MERCHANT_ADDRESS environment variable is required");
  console.error("   This is where you want to receive payments");
  process.exit(1);
}

// Create HTTP client that talks to your RailBridge facilitator
// This client communicates with the facilitator's /verify and /settle endpoints
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

// Create core x402 resource server
// This handles payment requirement building, verification, and settlement
const resourceServer = new x402ResourceServer(facilitatorClient);

const kit = new BridgeKit();
const testnetChains = kit
  .getSupportedChains({ chainType: "evm" })
  .filter((chain): chain is EVMChainDefinition => chain.type === "evm")
  .filter((chain) => chain.isTestnet);

const testnetNetworks = testnetChains.map(
  (chain) => `eip155:${chain.chainId}` as Caip2,
);

// Register EVM scheme on the server side for "exact" scheme
// This enables the server to build payment requirements for all testnets
registerExactEvmScheme(resourceServer, {
  networks: testnetNetworks,
});

const TOKEN_DOMAIN_ABI = [
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "version",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
const EIP712_DOMAIN_ABI = [
  {
    name: "eip712Domain",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;
const DOMAIN_SEPARATOR_ABI = [
  {
    name: "DOMAIN_SEPARATOR",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;
const hashStructUnsafe = hashStruct as unknown as (args: {
  data: Record<string, unknown>;
  primaryType: string;
  types: Record<string, { name: string; type: string }[]>;
}) => `0x${string}`;

// Define payment-protected routes for this merchant
// Only same-chain payments are accepted (using "exact" scheme)
const USDC_AMOUNT = "10000"; // $0.01 in atomic units (6 decimals)

const accepts = (
  await Promise.all(
    testnetChains.map(async (chain) => {
    if (!chain.usdcAddress) {
      throw new Error(`Missing USDC address for ${chain.name}`);
    }
    const rpc = chain.rpcEndpoints?.[0];
    let tokenName = "USDC";
    let tokenVersion = "2";

    if (rpc) {
      const client = createPublicClient({
        chain: {
          id: chain.chainId,
          name: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: { default: { http: [rpc] } },
        },
        transport: http(rpc),
      });

      try {
        tokenName = await client.readContract({
          address: chain.usdcAddress as Address,
          abi: TOKEN_DOMAIN_ABI,
          functionName: "name",
        });
      } catch (error) {
        console.warn(
          `⚠️  Could not read USDC name for ${chain.name}; using default`,
        );
      }

      try {
        tokenVersion = await client.readContract({
          address: chain.usdcAddress as Address,
          abi: TOKEN_DOMAIN_ABI,
          functionName: "version",
        });
      } catch (error) {
        console.warn(
          `⚠️  Could not read USDC version for ${chain.name}; using default`,
        );
      }

      try {
        const domain = await client.readContract({
          address: chain.usdcAddress as Address,
          abi: EIP712_DOMAIN_ABI,
          functionName: "eip712Domain",
        });
        const fields = Number(domain[0]);
        const domainExtra: { chainId?: number; salt?: `0x${string}` } = {};
        const hasChainId = (fields & 0x04) !== 0;
        const hasSalt = (fields & 0x10) !== 0;
        if (hasChainId) {
          domainExtra.chainId = Number(domain[3]);
        }
        if (hasSalt && domain[5] !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
          domainExtra.salt = domain[5] as `0x${string}`;
        }
        if (Object.keys(domainExtra).length > 0) {
          return {
            scheme: "exact" as const,
            network: `eip155:${chain.chainId}` as Caip2,
            price: {
              asset: chain.usdcAddress,
              amount: USDC_AMOUNT,
              extra: {
                name: tokenName,
                version: tokenVersion,
                domain: domainExtra,
              },
            } as AssetAmount,
            payTo: MERCHANT_ADDRESS,
          };
        }
      } catch (error) {
        console.warn(
          `⚠️  Could not read eip712Domain for ${chain.name}; using defaults`,
        );
      }

      try {
        const onChainDomainSeparator = await client.readContract({
          address: chain.usdcAddress as Address,
          abi: DOMAIN_SEPARATOR_ABI,
          functionName: "DOMAIN_SEPARATOR",
        });
        if (
          onChainDomainSeparator ===
          "0x0000000000000000000000000000000000000000000000000000000000000000"
        ) {
          console.warn(
            `⚠️  ${chain.name} USDC DOMAIN_SEPARATOR is zero; skipping same-chain payments`,
          );
          return null;
        }
        const chainIdCandidates = [
          BigInt(chain.chainId),
          1n,
          0n,
        ];
        const saltBytes32 = toHex(chain.chainId, { size: 32 });
        const saltedHash = keccak256(saltBytes32);
        const saltCandidates = [saltBytes32, saltedHash as `0x${string}`];
        const fieldCombos = [
          { name: true, version: true, verifyingContract: true, chainId: false, salt: false },
          { name: true, version: true, verifyingContract: true, chainId: true, salt: false },
          { name: true, version: true, verifyingContract: true, chainId: false, salt: true },
          { name: true, version: true, verifyingContract: true, chainId: true, salt: true },
          { name: true, version: false, verifyingContract: true, chainId: false, salt: false },
          { name: true, version: false, verifyingContract: true, chainId: true, salt: false },
          { name: true, version: false, verifyingContract: true, chainId: false, salt: true },
          { name: true, version: false, verifyingContract: true, chainId: true, salt: true },
        ];

        let matchedRequirement:
          | {
              scheme: "exact";
              network: Caip2;
              price: AssetAmount;
              payTo: `0x${string}`;
            }
          | null = null;

        for (const combo of fieldCombos) {
          if (matchedRequirement) break;
          const types = {
            EIP712Domain: [
              combo.name ? { name: "name", type: "string" } : null,
              combo.version ? { name: "version", type: "string" } : null,
              combo.chainId ? { name: "chainId", type: "uint256" } : null,
              combo.verifyingContract
                ? { name: "verifyingContract", type: "address" }
                : null,
              combo.salt ? { name: "salt", type: "bytes32" } : null,
            ].filter(Boolean) as { name: string; type: string }[],
          };

          const chainIds = combo.chainId ? chainIdCandidates : [undefined];
          const salts = combo.salt ? saltCandidates : [undefined];

          for (const chainIdCandidate of chainIds) {
            if (matchedRequirement) break;
            for (const saltCandidate of salts) {
              const separator = hashStructUnsafe({
                data: {
                  ...(combo.name ? { name: tokenName } : {}),
                  ...(combo.version ? { version: tokenVersion } : {}),
                  ...(combo.verifyingContract
                    ? { verifyingContract: chain.usdcAddress as `0x${string}` }
                    : {}),
                  ...(chainIdCandidate !== undefined
                    ? { chainId: chainIdCandidate }
                    : {}),
                  ...(saltCandidate !== undefined ? { salt: saltCandidate } : {}),
                },
                primaryType: "EIP712Domain",
                types,
              });
              if (separator !== onChainDomainSeparator) {
                continue;
              }
              const fields =
                (combo.name ? 0x1 : 0) |
                (combo.version ? 0x2 : 0) |
                (combo.chainId ? 0x4 : 0) |
                (combo.verifyingContract ? 0x8 : 0) |
                (combo.salt ? 0x10 : 0);
              const domainExtra: {
                fields?: number;
                chainId?: number;
                salt?: `0x${string}`;
              } = { fields };
              if (combo.chainId && chainIdCandidate !== undefined) {
                domainExtra.chainId = Number(chainIdCandidate);
              }
              if (combo.salt && saltCandidate !== undefined) {
                domainExtra.salt = saltCandidate;
              }
              matchedRequirement = {
                scheme: "exact",
                network: `eip155:${chain.chainId}` as Caip2,
                price: {
                  asset: chain.usdcAddress,
                  amount: USDC_AMOUNT,
                  extra: {
                    name: tokenName,
                    version: tokenVersion,
                    domain: domainExtra,
                  },
                } as AssetAmount,
                payTo: MERCHANT_ADDRESS,
              };
              break;
            }
          }
        }

        if (matchedRequirement) {
          return matchedRequirement;
        }
      } catch (error) {
        console.warn(
          `⚠️  Could not read DOMAIN_SEPARATOR for ${chain.name}; using defaults`,
        );
      }
    }

    return {
      scheme: "exact" as const,
      network: `eip155:${chain.chainId}` as Caip2,
      price: {
        asset: chain.usdcAddress,
        amount: USDC_AMOUNT,
        extra: {
          name: tokenName,
          version: tokenVersion,
        },
      } as AssetAmount,
      payTo: MERCHANT_ADDRESS,
    };
  }),
)
).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

const routes = {
  "GET /api/premium": {
    accepts,
    description: "Premium API endpoint",
    mimeType: "application/json",
    // No extensions needed for same-chain payments
  },
};

// Initialize Express app
const app = express();
app.use(express.json());

// Add request logging middleware
// This logs all incoming requests before payment middleware processes them
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  console.log(`   IP: ${req.ip || req.socket.remoteAddress}`);
  console.log(`   User-Agent: ${req.get("user-agent") || "unknown"}`);
  
  // Log payment header if present
  const paymentHeader = req.get("payment-signature") || req.get("x-payment");
  if (paymentHeader) {
    console.log(`   Payment: ${paymentHeader.substring(0, 50)}...`);
  }
  
  // Track response time
  const startTime = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    console.log(`[${timestamp}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Create paywall using the builder pattern
// This provides the full wallet connection and payment UI
const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "RailBridge Merchant (Same-Chain Only)",
    testnet: true, // Set to false for mainnet
  })
  .build();

// Use payment middleware
// The middleware automatically initializes the server on first request
// It fetches supported schemes from the facilitator and validates routes
app.use(
  paymentMiddleware(
    routes,
    resourceServer,
    undefined, // paywallConfig (optional - not needed when using custom paywall provider)
    paywall, // paywall provider - full UI with wallet connection
    true, // syncFacilitatorOnStart - fetch facilitator capabilities on startup
  ),
);

// Business logic route (protected by paymentMiddleware)
app.get("/api/premium", (req, res) => {
  // At this point, payment has been:
  // - Required (402 if unpaid)
  // - Verified via your facilitator
  // - Settled via your facilitator

  // Log successful payment access
  console.log(`✅ Premium content accessed - Payment verified and settled`);
  
  // Extract payment info from response headers (set by paymentMiddleware after settlement)
  const paymentTx = res.getHeader("x-payment-transaction");
  const paymentNetwork = res.getHeader("x-payment-network");
  if (paymentTx) {
    console.log(`   Transaction: ${paymentTx}`);
    console.log(`   Network: ${paymentNetwork || "unknown"}`);
  }

  res.json({
    message: "You successfully paid for this premium content.",
    data: {
      timestamp: Date.now(),
      value: "premium-data",
    },
  });
});

const PORT = process.env.MERCHANT_PORT || "4021";

app.listen(parseInt(PORT), () => {
  console.log(`🛒 Merchant server (same-chain only) listening at http://localhost:${PORT}`);
  console.log(`Using facilitator at: ${FACILITATOR_URL}`);
  console.log(`Merchant address: ${MERCHANT_ADDRESS}`);
});

