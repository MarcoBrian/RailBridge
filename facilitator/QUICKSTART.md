# Quick Start Guide

## 1. Install Dependencies

```bash
cd facilitator
npm install
```

## 2. Set Up Environment

```bash
# Copy the template
cp env.template .env

# Edit .env and add your keys:
# - EVM_PRIVATE_KEY: Your EVM wallet private key (0x...)
# - SVM_PRIVATE_KEY: Your Solana wallet private key (base58)
# - RPC URLs: Your preferred RPC endpoints
```

## 3. Generate Test Keys (Optional)

### EVM Key
```bash
# Using Node.js
node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
```

### Solana Key
```bash
# Using solana-keygen (if you have Solana CLI)
solana-keygen new --outfile ~/.config/solana/test-keypair.json
solana-keygen pubkey ~/.config/solana/test-keypair.json
```

## 4. Run the Facilitator

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start
```

The facilitator will start on `http://localhost:4022`

## 5. Test the Facilitator

### Check Health
```bash
curl http://localhost:4022/health
```

### Get Supported Schemes
```bash
curl http://localhost:4022/supported
```

## Next Steps

1. **Integrate Bridge Service**: Update `src/services/bridgeService.ts` with your actual bridge implementation
2. **Add More Chains**: Register additional networks in `src/index.ts`
3. **Configure Bridge**: Add bridge API keys/endpoints to `.env`

## Troubleshooting

### "EVM_PRIVATE_KEY environment variable is required"
- Make sure you've created `.env` file
- Check that the private key starts with `0x`

### "SVM_PRIVATE_KEY environment variable is required"
- Make sure your Solana key is in base58 format
- You can convert from keypair JSON using Solana CLI

### RPC Connection Issues
- Check your RPC URLs in `.env`
- Make sure you have access to the RPC endpoints
- For testnets, use public RPCs or get API keys from providers like Alchemy, Infura, QuickNode

