# Cross-Chain Payment Flow - How It Works

## Overview

This document explains how the system knows to:
1. Put source funds in the bridge lock address
2. Then bridge them to the merchant address

## The Flow Step-by-Step

### Step 1: Merchant Defines Payment Requirements

**Location**: `merchant-server.ts` lines 48-83

```typescript
{
  scheme: "cross-chain",
  network: "eip155:84532", // Destination chain (where merchant wants to receive)
  price: "$0.01",
  payTo: MERCHANT_ADDRESS, // Final destination: merchant address
  extensions: {
    "cross-chain": {
      info: {
        sourceNetwork: "eip155:84532", // Where user will pay from
        sourceAsset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
      }
    }
  }
}
```

**Key Points**:
- `network`: Destination chain (where merchant receives)
- `payTo`: Merchant address (final destination)
- `extensions["cross-chain"].info.sourceNetwork`: Source chain (where user pays)

### Step 2: Client Creates Payment Payload

The client:
1. Reads the `PaymentRequirements` from merchant's 402 response
2. Sees `scheme: "cross-chain"` and the cross-chain extension
3. Creates a payment signed for the **source chain** (from extension)
4. Copies the cross-chain extension into `PaymentPayload.extensions`

### Step 3: Facilitator Receives Verify/Settle Request

**Location**: `index.ts` → `facilitator.verify()` / `facilitator.settle()`

The facilitator receives:
- `PaymentPayload`: Signed for source chain, contains cross-chain extension
- `PaymentRequirements`: Specifies destination chain and merchant address

### Step 4: CrossChainRouter Intercepts (Because Scheme = "cross-chain")

**Location**: `crossChainRouter.ts` lines 54-88 (verify) and 90-155 (settle)

The `CrossChainRouter` is registered for `scheme: "cross-chain"`, so it handles the request.

#### In `verify()` (lines 54-88):

```typescript
// 1. Extract source chain info from extension
const crossChainInfo = extractCrossChainInfo(payload);
// Returns: { sourceNetwork: "eip155:84532", sourceAsset: "0x..." }

// 2. Get bridge lock address for source chain
const bridgeLockAddress = this.bridgeService.getLockAddress(
  crossChainInfo.sourceNetwork
);
// Returns: Bridge contract address on source chain (e.g., "0x...")

// 3. Create NEW requirements for source chain settlement
const sourceRequirements: PaymentRequirements = {
  scheme: "exact",           // Use "exact" scheme on source chain
  network: crossChainInfo.sourceNetwork,  // Source chain
  asset: crossChainInfo.sourceAsset,      // Source asset
  amount: requirements.amount,           // Same amount
  payTo: bridgeLockAddress,  // ⭐ KEY: Bridge lock address, not merchant!
  // ...
};

// 4. Verify using source chain requirements
return this.exactEvmScheme.verify(payload, sourceRequirements);
```

**How it knows**: The `CrossChainRouter`:
- Detects `scheme: "cross-chain"` → routes to this handler
- Extracts `sourceNetwork` from `payload.extensions["cross-chain"]`
- Gets bridge lock address via `bridgeService.getLockAddress(sourceNetwork)`
- Creates source requirements with `payTo: bridgeLockAddress`

#### In `settle()` (lines 90-155):

```typescript
// Same process as verify, but actually executes the transaction
const bridgeLockAddress = this.bridgeService.getLockAddress(...);
const sourceRequirements = {
  // ...
  payTo: bridgeLockAddress,  // ⭐ Funds go to bridge lock
};

// Settle on source chain to bridge lock address
const settleResult = await this.exactEvmScheme.settle(
  payload, 
  sourceRequirements
);
// Result: Transaction hash of payment to bridge lock address
```

### Step 5: onAfterSettle Hook Detects Cross-Chain and Bridges

**Location**: `index.ts` lines 220-273

After settlement succeeds, the hook checks:

```typescript
if (
  context.requirements.scheme === "cross-chain" &&  // ✅ Scheme is cross-chain
  context.result.success &&                          // ✅ Settlement succeeded
  context.result.network !== context.requirements.network &&  // ✅ Networks differ
  CROSS_CHAIN_ENABLED                                // ✅ Bridging enabled
) {
  // Bridge funds
  await bridgeService.bridge(
    context.result.network,        // Source network (where funds were locked)
    context.result.transaction,     // Source transaction hash
    context.requirements.network,   // Destination network
    context.requirements.asset,     // Asset
    context.requirements.amount,   // Amount
    context.requirements.payTo,    // ⭐ Merchant address (final destination)
  );
}
```

**How it knows to bridge to merchant**:
- `context.requirements.payTo` = Merchant address (from original requirements)
- `context.result.network` = Source network (where settlement happened)
- `context.requirements.network` = Destination network (where merchant wants funds)

## Summary: How The System Knows

### 1. **Bridge Lock Address** (Source Chain)
- **How**: `CrossChainRouter` extracts `sourceNetwork` from `payload.extensions["cross-chain"]`
- **Where**: `crossChainRouter.ts` line 68 & 118: `bridgeService.getLockAddress(sourceNetwork)`
- **Why**: Funds must be locked on source chain before bridging

### 2. **Merchant Address** (Destination Chain)
- **How**: Stored in original `PaymentRequirements.payTo` from merchant
- **Where**: `merchant-server.ts` line 55/65: `payTo: MERCHANT_ADDRESS`
- **Why**: This is where merchant wants to receive funds

### 3. **The Routing Logic**
```
Merchant Requirements:
  - scheme: "cross-chain"
  - network: "eip155:84532" (destination)
  - payTo: MERCHANT_ADDRESS (final destination)
  - extensions: { sourceNetwork: "eip155:84532", ... }

↓ Client creates payment for source chain

↓ Facilitator routes to CrossChainRouter (scheme = "cross-chain")

↓ CrossChainRouter creates source requirements:
  - network: sourceNetwork (from extension)
  - payTo: bridgeLockAddress (from bridgeService)
  
↓ ExactEvmScheme settles to bridge lock address

↓ onAfterSettle hook bridges:
  - From: bridge lock address (source chain)
  - To: MERCHANT_ADDRESS (destination chain, from original requirements)
```

## Key Design Decisions

1. **Two-Stage Requirements**:
   - Original requirements: Destination chain + merchant address
   - Source requirements: Source chain + bridge lock address
   - Created dynamically by `CrossChainRouter`

2. **Extension-Based Source Info**:
   - Merchant declares source chain in extension
   - Client copies extension to payload
   - Facilitator extracts it to know where user is paying

3. **Hook-Based Bridging**:
   - Settlement happens synchronously (fast response)
   - Bridging happens asynchronously in hook (can take time)
   - Merchant address preserved in `context.requirements.payTo`

## Visual Flow

```
┌─────────────┐
│   Merchant  │ Defines: destination chain + merchant address
└──────┬──────┘
       │ PaymentRequirements
       │ { scheme: "cross-chain", network: "dest", payTo: "merchant" }
       ▼
┌─────────────┐
│   Client    │ Creates payment for source chain
└──────┬──────┘
       │ PaymentPayload
       │ { extensions: { sourceNetwork: "source", ... } }
       ▼
┌─────────────┐
│ Facilitator │ Routes to CrossChainRouter (scheme = "cross-chain")
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│ CrossChainRouter │ Extracts sourceNetwork from extension
└──────┬───────────┘
       │ Creates sourceRequirements
       │ { network: "source", payTo: bridgeLockAddress }
       ▼
┌─────────────┐
│ ExactEvm    │ Settles to bridge lock address
└──────┬──────┘
     │ Transaction: User → Bridge Lock (source chain)
     ▼
┌─────────────┐
│ onAfterSettle│ Detects cross-chain, bridges
└──────┬──────┘
       │ bridgeService.bridge(..., merchantAddress)
       ▼
┌─────────────┐
│   Bridge    │ Locks on source, releases on destination
└──────┬──────┘
       │ Transaction: Bridge → Merchant (destination chain)
       ▼
┌─────────────┐
│   Merchant  │ Receives funds on destination chain
└─────────────┘
```

## Code References

- **Merchant defines destination**: `merchant-server.ts:55,65`
- **CrossChainRouter extracts source**: `crossChainRouter.ts:59,68,118`
- **Bridge lock address**: `crossChainRouter.ts:68,118` → `bridgeService.getLockAddress()`
- **Merchant address preserved**: `index.ts:263` → `context.requirements.payTo`

