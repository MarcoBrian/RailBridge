# Cross-Chain Payment System - Complete Guide

## Overview

The RailBridge cross-chain payment system enables users to pay on one blockchain (source chain) while merchants receive payment on a different blockchain (destination chain). The system uses an **extension-based design** that keeps cross-chain complexity hidden from clients, making it scheme-agnostic and extensible.

## Key Design Principles

1. **Extension-Based, Not Scheme-Based**: Cross-chain is indicated by an extension, not a scheme name. Any scheme (exact, bazaar, subscription, etc.) can be cross-chain.

2. **Client-Agnostic**: Clients never see cross-chain complexity. They only see normal payment options on the source chain.

3. **Consistent Format**: Route network is source (where user pays), extension is destination (where merchant receives). Client and server see the same format - no transformation needed!

4. **Facilitator Routing**: The facilitator detects cross-chain payments by extension and routes them to the CrossChainRouter.

## Architecture Components

### 1. Merchant Server (`src/merchant-server.ts`)

**Role**: Defines payment requirements with source network and destination extension.

**Key Responsibilities**:
- Defines routes with source network (where user pays)
- Defines cross-chain extension with destination (where merchant receives)
- Handles payment verification and settlement requests

**Configuration Example**:
```typescript
const routes = {
  "GET /api/premium": {
    accepts: [{
      scheme: "exact",  // Base scheme
      network: "eip155:84532", // Source (Base Sepolia - where user pays)
      price: { asset: "0x...", amount: "10000" }, // Source asset
      payTo: MERCHANT_ADDRESS,
    }],
    extensions: {
      "cross-chain": {
        info: {
          destinationNetwork: "eip155:11155111", // Destination (Ethereum Sepolia - where merchant receives)
          destinationAsset: "0x...", // USDC on Ethereum Sepolia
        }
      }
    }
  }
};
```

**Key Design**: Route network is source, extension is destination. No transformation needed - client and server see the same format!

### 2. Client (`src/client-example.ts`)

**Role**: Creates and signs payment payloads.

**Key Points**:
- Only registers base schemes (e.g., "exact")
- Sees route with source network (no transformation needed!)
- Creates payment for source network
- Extension is automatically copied to payload

**No Cross-Chain Awareness Required**:
```typescript
// Client only needs this:
const client = new x402Client(networkSelector);
registerExactEvmScheme(client, { signer });
// That's it! No cross-chain code needed.
```

### 3. Facilitator (`src/facilitator-implementation.ts`)

**Role**: Verifies and settles payments, routes cross-chain payments.

**Key Responsibilities**:
- Detects cross-chain payments by extension
- Routes to CrossChainRouter for cross-chain payments
- Routes to normal scheme handlers for same-chain payments

**Routing Logic**:
```typescript
// In /verify and /settle endpoints:
const crossChainInfo = extractCrossChainInfo(paymentPayload);
if (crossChainInfo) {
  // Route to CrossChainRouter
  return crossChainRouter.verify(payload, requirements);
} else {
  // Route to normal scheme handler
  return facilitator.verify(payload, requirements);
}
```

### 4. CrossChainRouter (`src/schemes/crossChainRouter.ts`)

**Role**: Handles cross-chain payment verification and settlement.

**Key Responsibilities**:
- Uses route network as source (where user pays)
- Extracts destination network from extension (where merchant receives)
- Creates source chain requirements
- Delegates to base scheme (exact, bazaar, etc.) on source chain
- Handles bridging after settlement

**Verification Flow**:
1. Use route network as source (where user pays)
2. Extract `destinationNetwork` and `destinationAsset` from extension
3. Create source requirements: `scheme: "exact"`, `network: route.network` (source)
4. Delegate to `ExactEvmScheme.verify()` on source chain
5. Return verification result

**Settlement Flow**:
1. Verify payment (reuses verification logic)
2. Settle on source chain using `ExactEvmScheme.settle()` (route network is source)
3. If bridging enabled: Bridge funds from source to destination (from extension)
4. Return settlement result

### 5. Bridge Service (`src/services/bridgeService.ts`)

**Role**: Handles cross-chain bridging of funds.

**Key Responsibilities**:
- Checks bridge liquidity
- Gets exchange rates (if different assets)
- Executes bridge transactions
- Manages bridge lock addresses

## Complete Payment Flow

### Step 1: Merchant Defines Route

```typescript
// Merchant defines cross-chain payment
// Route network = source (where user pays)
// Extension = destination (where merchant receives)
{
  scheme: "exact",
  network: "eip155:84532", // Source (Base Sepolia - where user pays)
  asset: "0x...", // Source asset
  extensions: {
    "cross-chain": {
      info: {
        destinationNetwork: "eip155:11155111", // Destination (Ethereum Sepolia - where merchant receives)
        destinationAsset: "0x...", // Destination asset
      }
    }
  }
}
```

### Step 2: Client Receives PaymentRequired

```typescript
// Client sees the same format - no transformation needed!
{
  accepts: [{
    scheme: "exact", // Client has this registered ✅
    network: "eip155:84532", // Source network (where user pays)
    asset: "0x...", // Source asset
  }],
  extensions: {
    "cross-chain": { 
      info: {
        destinationNetwork: "eip155:11155111", // Destination (merchant receives here)
        destinationAsset: "0x...",
      }
    } // Copied to payload
  }
}
```

### Step 3: Client Creates Payment

```typescript
// Client creates payment payload:
{
  scheme: "exact",
  network: "eip155:84532", // Source network (route network)
  payload: {
    signature: "0x...", // Signed for source chain
    authorization: { ... }
  },
  extensions: {
    "cross-chain": { // Copied from PaymentRequired
      info: {
        destinationNetwork: "eip155:11155111", // Destination (where merchant receives)
        destinationAsset: "0x...",
      }
    }
  }
}
```

### Step 4: Merchant Verifies Payment

```typescript
// Merchant calls facilitator /verify
POST /verify
{
  paymentPayload: { ... },
  paymentRequirements: {
    scheme: "exact",
    network: "eip155:84532", // Source (route network - where user pays)
  }
}
```

### Step 5: Facilitator Routes to CrossChainRouter

```typescript
// Facilitator detects extension:
const crossChainInfo = extractCrossChainInfo(paymentPayload);
if (crossChainInfo) {
  // Route to CrossChainRouter
  return crossChainRouter.verify(payload, requirements);
}
```

### Step 6: CrossChainRouter Verifies on Source Chain

```typescript
// CrossChainRouter uses route network as source:
const sourceRequirements = {
  scheme: "exact",
  network: requirements.network, // Route network is source (eip155:84532)
  asset: requirements.asset, // Route asset is source asset
  payTo: bridgeLockAddress, // Bridge lock (if bridging enabled)
};

// Delegate to ExactEvmScheme on source chain
return exactEvmScheme.verify(payload, sourceRequirements);
```

### Step 7: Merchant Settles Payment

```typescript
// Merchant calls facilitator /settle
POST /settle
{
  paymentPayload: { ... },
  paymentRequirements: {
    scheme: "exact",
    network: "eip155:84532", // Source (route network)
  }
}
```

### Step 8: CrossChainRouter Settles on Source Chain

```typescript
// CrossChainRouter settles on source chain (route network)
const settleResult = await exactEvmScheme.settle(payload, sourceRequirements);
// Result: { success: true, transaction: "0x...", network: "eip155:84532" }
```

### Step 9: Bridge Funds (if enabled)

```typescript
// After settlement, bridge funds from source to destination
// Source: route network (eip155:84532)
// Destination: from extension (eip155:11155111)
if (bridgingEnabled) {
  await bridgeService.bridge(
    sourceNetwork: "eip155:84532", // Route network
    destinationNetwork: "eip155:11155111", // From extension
    amount: "10000",
    asset: crossChainInfo.destinationAsset, // From extension
  );
}
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CROSS-CHAIN PAYMENT FLOW                       │
└─────────────────────────────────────────────────────────────────────────┘

MERCHANT SERVER                    CLIENT                    FACILITATOR
─────────────────                  ──────                    ───────────

1. Define Route
   scheme: "exact"
   network: source (where user pays)
   extensions: {cross-chain: {destination}}
   │
   ▼
2. Send PaymentRequired
   ──────────────────────────────────►
   { accepts: [{scheme: "exact", network: source}],
     extensions: {cross-chain: {destination}} }
   │
   │                                   3. Create Payment
   │                                   ──────────────────
   │                                   { scheme: "exact",
   │                                     network: source,
   │                                     payload: {signature},
   │                                     extensions: {cross-chain: {destination}} }
   │
   │                                   4. Send Payment
   │                                   ◄──────────────────
   │
   ▼
5. Verify Payment
   POST /verify
   ──────────────────────────────────────────────────────►
   { paymentPayload, paymentRequirements }
   │
   │                                   6. Detect Extension
   │                                   extractCrossChainInfo()
   │                                   │
   │                                   7. Route to CrossChainRouter
   │                                   │
   │                                   8. Use Route Network as Source
   │                                   { scheme: "exact",
   │                                     network: route.network (source),
   │                                     payTo: bridgeLock }
   │                                   │
   │                                   9. Verify on Source Chain
   │                                   ExactEvmScheme.verify()
   │                                   │
   │                                   10. Return Result
   │                                   ◄──────────────────
   │
   ▼
11. Settle Payment
    POST /settle
    ──────────────────────────────────────────────────────►
    │
    │                                   12. Settle on Source Chain
    │                                   ExactEvmScheme.settle()
    │                                   │
    │                                   13. Bridge Funds (if enabled)
    │                                   bridgeService.bridge()
    │                                   source: route.network
    │                                   destination: extension.destinationNetwork
    │                                   │
    │                                   14. Return Result
    │                                   ◄──────────────────
    │
    ▼
15. Return Resource
   200 OK + data
```

## Key Files and Their Roles

| File | Role | Key Function |
|------|------|--------------|
| `merchant-server.ts` | Merchant server | Defines routes (source network + destination extension) |
| `client-example.ts` | Client | Creates payment payloads (no cross-chain awareness) |
| `facilitator-implementation.ts` | Facilitator | Routes payments, detects cross-chain by extension |
| `crossChainRouter.ts` | Cross-chain handler | Verifies/settles on source (route network), bridges to destination (extension) |
| `bridgeService.ts` | Bridge service | Handles cross-chain bridging |
| `extensions/crossChain.ts` | Extension utilities | Defines cross-chain extension format (destination) |

## Extension Format

The cross-chain extension follows this structure:

```typescript
{
  "cross-chain": {
    info: {
      destinationNetwork: "eip155:11155111", // CAIP-2 network ID (where merchant receives)
      destinationAsset: "0x...", // Token address on destination chain
    },
    schema: {
      // EIP-712 schema for signing
    }
  }
}
```

**Note**: The route network is the source (where user pays), the extension specifies the destination (where merchant receives).

## Benefits of This Design

1. **Scheme-Agnostic**: Works with any payment scheme (exact, bazaar, subscription, etc.)
2. **Client Simplicity**: Clients don't need cross-chain awareness
3. **Consistent Format**: Route = source, extension = destination. Client and server see the same format - no transformation needed!
4. **Extensible**: Easy to add cross-chain support to new schemes
5. **Clear Separation**: Scheme = payment mechanism, Extension = routing mechanism
6. **Backward Compatible**: Same-chain payments work normally
7. **Simpler Code**: No route transformation logic needed - cleaner architecture

## Current Limitations

1. **CrossChainRouter only supports "exact" scheme**: Currently checks `requirements.scheme === "exact"` and errors otherwise. This can be made generic in the future.

2. **Hooks don't run for cross-chain**: When routing directly to CrossChainRouter, facilitator hooks are bypassed. This is acceptable since CrossChainRouter handles the logic.

## Future Enhancements

1. **Generic CrossChainRouter**: Support any scheme facilitator, not just "exact"
2. **Multi-hop bridging**: Support bridging through intermediate chains
3. **Automatic asset conversion**: Handle different assets on source/destination
4. **Bridge retry logic**: Automatic retry for failed bridge transactions

## Summary

The cross-chain system works by:

1. **Merchant** defines route with source network + destination extension
2. **Client** sees same format - no transformation needed!
3. **Client** pays on source chain (route network)
4. **Facilitator** detects extension, routes to CrossChainRouter
5. **CrossChainRouter** verifies/settles on source (route network), bridges to destination (extension)

**Key Improvement**: Route network = source, extension = destination. This makes client and server format consistent - no transformation needed! Much cleaner design.

