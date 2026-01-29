import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load environment variables from .env file in project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", ".env");
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`⚠️  Could not load .env file from ${envPath}`);
  console.warn(`   Make sure you have created a .env file from env.template`);
  console.warn(`   Error: ${result.error.message}`);
}

const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;

if (!EVM_PRIVATE_KEY) {
  console.error("❌ EVM_PRIVATE_KEY environment variable is required");
  console.error("");
  console.error("📝 To fix this:");
  console.error("   1. Copy env.template to .env:");
  console.error("      cp env.template .env");
  console.error("   2. Edit .env and add your private key:");
  console.error("      EVM_PRIVATE_KEY=0xYourPrivateKeyHere");
  console.error("");
  console.error("   Note: Make sure .env is in the facilitator directory");
  process.exit(1);
}

const PORT = process.env.PORT || "4022";
const CROSS_CHAIN_ENABLED = process.env.CROSS_CHAIN_ENABLED !== "false"; // Default to enabled
const EVM_RPC_URL = process.env.EVM_RPC_URL;
const DEPLOY_ERC4337_WITH_EIP6492 = process.env.DEPLOY_ERC4337_WITH_EIP6492 === "true";

export const config = {
  PORT,
  CROSS_CHAIN_ENABLED,
  EVM_PRIVATE_KEY,
  EVM_RPC_URL,
  DEPLOY_ERC4337_WITH_EIP6492,
};

