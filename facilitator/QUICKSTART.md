# Quick Start - Testing on Base Sepolia

## 🚀 5-Minute Setup

### 1. Get Testnet Tokens

**Base Sepolia ETH** (for gas):
- https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
- Or: https://faucet.quicknode.com/base/sepolia

**Base Sepolia USDC** (for payments):
- Contract: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- You may need to mint or get from a testnet faucet

### 2. Set Up Environment

```bash
cd facilitator
cp env.template .env
```

Edit `.env`:
```env
# Use Base Sepolia testnet
EVM_PRIVATE_KEY=0xYourPrivateKeyHere
EVM_RPC_URL=https://sepolia.base.org

# Disable bridging for initial testing
CROSS_CHAIN_ENABLED=false
```

### 3. Install & Start Facilitator

```bash
pnpm install
pnpm dev
```

You should see:
```
✅ EVM Facilitator account: 0x...
🚀 RailBridge Cross-Chain Facilitator listening on port 4022
```

### 4. Start Merchant Server (New Terminal)

```bash
cd facilitator

# Add to .env or create separate .env.merchant
MERCHANT_PORT=4021
FACILITATOR_URL=http://localhost:4022
MERCHANT_ADDRESS=0xYourMerchantAddress
```

```bash
pnpm test:merchant
# or
tsx src/merchant-server.ts
```

### 5. Test with Client

Add to `.env`:
```env
TEST_WALLET_PRIVATE_KEY=0xYourTestWalletPrivateKey
```

```bash
pnpm test:client
# or
tsx test-client.ts
```

## ✅ Expected Flow

1. **Client** requests `/api/premium` → Gets `402 Payment Required`
2. **Client** creates payment, signs, retries → Gets `200 OK`
3. **Facilitator logs** show verification and settlement
4. **Base Sepolia explorer** shows transaction: https://sepolia.basescan.org/

## 🔍 Verify It Works

```bash
# Check facilitator
curl http://localhost:4022/health

# Check supported schemes
curl http://localhost:4022/supported | jq

# Test merchant (should get 402)
curl -v http://localhost:4021/api/premium
```

## 📝 Network IDs

- **Base Sepolia**: `eip155:84532`
- **Base Mainnet**: `eip155:8453`

## 🐛 Troubleshooting

**"Insufficient funds"**
- Get more Base Sepolia ETH from faucet

**"Token balance insufficient"**
- Get testnet USDC or update asset address in merchant config

**"No facilitator registered"**
- Check facilitator is running on port 4022
- Check `FACILITATOR_URL` in merchant server

See `TESTING_GUIDE.md` for detailed instructions.
