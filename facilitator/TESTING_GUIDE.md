# Local Testing Guide - Base Sepolia Testnet

This guide walks you through testing the RailBridge Cross-Chain Facilitator locally using Base Sepolia testnet.

## Prerequisites

1. **Node.js v20+** and **pnpm**
2. **Testnet ETH** for gas fees (Base Sepolia)
3. **Testnet USDC** for payments (Base Sepolia)
4. **Two wallets** (one for facilitator, one for client)

## Step 1: Get Testnet Tokens

### Get Base Sepolia ETH (for gas)

1. **Base Sepolia Faucet**: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
   - Connect your wallet
   - Request testnet ETH

2. **Alternative Faucets**:
   - https://faucet.quicknode.com/base/sepolia
   - https://www.alchemy.com/faucets/base-sepolia

### Get Base Sepolia USDC (for payments)

Base Sepolia USDC contract: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

**Option 1: Use Coinbase Faucet** (if available)
- Some faucets provide testnet USDC

**Option 2: Mint via Contract** (if you have contract access)
```solidity
// Call mint() on USDC contract if you have permissions
```

**Option 3: Use a different testnet token**
- You can use any ERC-20 token that supports EIP-3009
- Update the asset address in your test

## Step 2: Set Up Environment Variables

Create a `.env` file in the `facilitator` directory:

```bash
cd facilitator
cp env.template .env
```

Edit `.env` with testnet values:

```env
# Server Configuration
PORT=4022

# EVM Facilitator Configuration (Base Sepolia)
EVM_PRIVATE_KEY=0xYourFacilitatorPrivateKeyHere
EVM_RPC_URL=https://sepolia.base.org

# Cross-Chain Configuration
CROSS_CHAIN_ENABLED=true

# ERC-4337 Smart Wallet Deployment (optional)
DEPLOY_ERC4337_WITH_EIP6492=false
```

### Get Your Private Key

**For Facilitator:**
- Use a wallet you control (MetaMask, etc.)
- Export private key (keep it secure!)
- Make sure it has Base Sepolia ETH for gas

**For Testing Client:**
- Use a different wallet
- Make sure it has Base Sepolia ETH and USDC

## Step 3: Install Dependencies

```bash
cd facilitator
pnpm install
```

## Step 4: Start the Facilitator

```bash
pnpm dev
# or
npm run dev
# or
tsx src/index.ts
```

You should see:
```
✅ EVM Facilitator account: 0x...
🌉 Cross-chain EVM facilitator initialized
   Cross-chain bridging: enabled
   'exact' scheme: same-chain payments
   'cross-chain' scheme: routing wrapper around 'exact' for cross-chain payments
🚀 RailBridge Cross-Chain Facilitator listening on port 4022
📡 Endpoints:
   POST /verify - Verify payment payloads
   POST /settle - Settle payments on-chain
   GET  /supported - Get supported payment kinds
   GET  /health - Health check
```

## Step 5: Test the Facilitator Endpoints

### Check Health

```bash
curl http://localhost:4022/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-...",
  "facilitator": "railbridge-cross-chain"
}
```

### Check Supported Schemes

```bash
curl http://localhost:4022/supported
```

Expected response:
```json
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:84532"
    },
    {
      "x402Version": 2,
      "scheme": "cross-chain",
      "network": "eip155:84532",
      "extra": {
        "crossChain": true
      }
    }
  ],
  "extensions": ["cross-chain"],
  "signers": {
    "eip155": ["0x..."]
  }
}
```

## Step 6: Set Up Merchant Server

In a **new terminal**, set up the merchant server:

```bash
cd facilitator
```

Create `.env` for merchant (or add to existing):

```env
# Merchant Server Configuration
MERCHANT_PORT=4021
FACILITATOR_URL=http://localhost:4022
MERCHANT_ADDRESS=0xYourMerchantAddressHere
```

**Important**: `MERCHANT_ADDRESS` should be a different address than your facilitator address.

Start merchant server:

```bash
tsx src/merchant-server.ts
```

You should see:
```
🛒 Merchant server listening at http://localhost:4021
Using facilitator at: http://localhost:4022
Merchant address: 0x...
```

## Step 7: Test with a Client

### Option A: Using curl (Manual Testing)

#### 1. Make initial request (should get 402)

```bash
curl -v http://localhost:4021/api/premium
```

Expected: `402 Payment Required` with payment requirements in response

#### 2. Create payment payload (requires x402 client)

For manual testing, you'll need to use the x402 client libraries. See "Option B" below.

### Option B: Using x402 Client (Recommended)

Create a test client script:

```typescript
// test-client.ts
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { registerExactEvmClient } from "@x402/evm/exact/client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// Your test wallet (different from facilitator)
const testWallet = privateKeyToAccount("0xYourTestWalletPrivateKey");

// Create viem client
const viemClient = createWalletClient({
  account: testWallet,
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
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

// Wrap fetch
const fetchWithPayment = async (url: string) => {
  const response = await fetch(url);
  
  if (response.status === 402) {
    // Get payment requirements
    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      await response.json()
    );
    
    // Create payment payload
    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    
    // Encode payment header
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    
    // Retry with payment
    const retryResponse = await fetch(url, {
      headers: paymentHeaders,
    });
    
    return retryResponse;
  }
  
  return response;
};

// Test same-chain payment
console.log("Testing same-chain payment...");
const sameChainResponse = await fetchWithPayment("http://localhost:4021/api/premium");
console.log("Response:", await sameChainResponse.json());

// Test cross-chain payment (if configured)
// This would require cross-chain extension setup
```

Run the test:

```bash
tsx test-client.ts
```

## Step 8: Test Cross-Chain Payment

For cross-chain testing, you'll need:

1. **Two testnets** (e.g., Base Sepolia → Polygon Mumbai)
2. **USDC on both chains**
3. **Bridge service configured** (or disable bridging for testing)

### Disable Bridging for Testing

Set in `.env`:
```env
CROSS_CHAIN_ENABLED=false
```

This will:
- Settle on source chain only
- Skip bridging (good for testing settlement logic)

### Test Cross-Chain Flow

1. **Merchant server** should have cross-chain route configured (already in `merchant-server.ts`)
2. **Client** creates payment with cross-chain extension
3. **Facilitator** verifies on source chain
4. **Facilitator** settles on source chain
5. **Hook** attempts to bridge (or skips if disabled)

## Step 9: Monitor Logs

Watch facilitator logs for:

```
🔍 Before verify: { scheme: 'exact', network: 'eip155:84532', ... }
✅ After verify: { isValid: true, payer: '0x...' }
💰 Before settle: { scheme: 'exact', network: 'eip155:84532', amount: '...' }
✅ After settle: { success: true, transaction: '0x...', network: 'eip155:84532' }
🌉 Starting cross-chain bridge: { ... }  // If cross-chain
```

## Step 10: Verify On-Chain

Check transactions on Base Sepolia explorer:
- https://sepolia.basescan.org/

Look for:
- Settlement transactions from facilitator address
- Token transfers to merchant/bridge lock address

## Troubleshooting

### "Insufficient funds for gas"
- Get more Base Sepolia ETH from faucet
- Check `EVM_PRIVATE_KEY` has ETH

### "Token balance insufficient"
- Get testnet USDC
- Or use a different token address
- Check token contract supports EIP-3009

### "No facilitator registered for scheme"
- Check facilitator is running
- Check `FACILITATOR_URL` in merchant server
- Verify scheme is registered in facilitator logs

### "Bridge liquidity check failed"
- Set `CROSS_CHAIN_ENABLED=false` for testing
- Or implement actual bridge service

### "Invalid signature"
- Check client is using correct wallet
- Verify network matches (Base Sepolia = eip155:84532)
- Check token contract address is correct

## Quick Test Checklist

- [ ] Facilitator starts without errors
- [ ] `/health` endpoint returns 200
- [ ] `/supported` shows your schemes
- [ ] Merchant server starts
- [ ] Initial request to `/api/premium` returns 402
- [ ] Payment verification succeeds
- [ ] Payment settlement succeeds
- [ ] Transaction appears on Base Sepolia explorer
- [ ] Merchant receives funds (or bridge lock receives for cross-chain)

## Next Steps

1. **Implement actual bridge service** (Wormhole/LayerZero)
2. **Add retry logic** for failed bridges
3. **Add monitoring/alerting** for bridge failures
4. **Test with multiple chains** (Base → Polygon, etc.)
5. **Load testing** with multiple concurrent payments

## Example Test Scenarios

### Scenario 1: Same-Chain Payment
```
1. Client requests /api/premium
2. Gets 402 with "exact" scheme, Base Sepolia
3. Client creates payment, signs, sends
4. Merchant verifies via facilitator
5. Merchant settles via facilitator
6. Client receives 200 with content
```

### Scenario 2: Cross-Chain Payment (Bridging Disabled)
```
1. Client requests /api/premium
2. Gets 402 with "cross-chain" scheme, Polygon destination
3. Client creates payment for Base Sepolia (source)
4. Merchant verifies via facilitator
5. Facilitator verifies on Base Sepolia
6. Facilitator settles on Base Sepolia to bridge lock
7. Bridging skipped (CROSS_CHAIN_ENABLED=false)
8. Client receives 200
```

### Scenario 3: Cross-Chain Payment (Bridging Enabled)
```
1-6. Same as Scenario 2
7. onAfterSettle hook bridges funds
8. Funds arrive on Polygon
9. Client receives 200
```

## Useful Commands

```bash
# Check facilitator is running
curl http://localhost:4022/health

# Check supported schemes
curl http://localhost:4022/supported | jq

# Test merchant endpoint
curl -v http://localhost:4021/api/premium

# View facilitator logs
# (in facilitator terminal)

# View merchant logs
# (in merchant terminal)
```

## Network IDs Reference

- **Base Sepolia**: `eip155:84532`
- **Base Mainnet**: `eip155:8453`
- **Polygon Mumbai**: `eip155:80001`
- **Polygon Mainnet**: `eip155:137`
- **Ethereum Sepolia**: `eip155:11155111`
- **Ethereum Mainnet**: `eip155:1`

## RPC URLs

- **Base Sepolia**: `https://sepolia.base.org`
- **Base Mainnet**: `https://mainnet.base.org`
- **Polygon Mumbai**: `https://rpc-mumbai.maticvigil.com`
- **Polygon Mainnet**: `https://polygon-rpc.com`

## Getting Help

If you encounter issues:
1. Check facilitator logs for errors
2. Check merchant server logs
3. Verify environment variables
4. Check testnet explorer for transactions
5. Verify wallet has sufficient funds

