# Why Cross-Chain Still Needs a Scheme

## The Problem: Network Mismatch

When a merchant wants to accept cross-chain payments, there's a fundamental mismatch:

**Merchant Requirements:**
```typescript
{
  scheme: "cross-chain",  // or could be "exact"?
  network: "eip155:137",  // Polygon (where merchant wants to receive)
  asset: "0x...",         // USDC on Polygon
  amount: "10000",
  payTo: "0xmerchant..."  // Merchant address on Polygon
}
```

**Client Payment (signed):**
```typescript
{
  scheme: "cross-chain",
  network: "eip155:8453",  // Base (where user is paying from)
  payload: {
    signature: "0x...",   // EIP-712 signature for Base chain
    authorization: {...}   // Valid only on Base
  },
  extensions: {
    "cross-chain": {
      sourceNetwork: "eip155:8453",  // Base
      sourceAsset: "0x..."            // USDC on Base
    }
  }
}
```

## Why Hooks Can't Solve This

The facilitator selects the scheme **before** hooks run:

```typescript
// In x402Facilitator.verify():
// 1. Find scheme by requirements.scheme
if (schemeData.facilitator.scheme === paymentRequirements.scheme) {
  // 2. Check network matches
  if (schemeData.networks.has(paymentRequirements.network)) {
    // 3. Call scheme.verify()
    return scheme.verify(payload, requirements);
  }
}
```

**The Issue:**
- If `requirements.scheme = "exact"` and `requirements.network = "eip155:137"` (Polygon)
- Facilitator finds `ExactEvmScheme` registered for `"eip155:137"`
- Calls `ExactEvmScheme.verify(payload, requirements)`
- But `payload` has signature for `"eip155:8453"` (Base)!
- Verification fails because signature is for wrong chain

## Why We Need a Scheme

The scheme acts as a **router** that:

1. **Detects the mismatch**: Requirements say destination, payment signed for source
2. **Routes correctly**: Creates source chain requirements and delegates to `ExactEvmScheme`
3. **Handles bridging**: After settlement on source, bridges to destination

```typescript
// CrossChainRouter.verify()
const crossChainInfo = extractCrossChainInfo(payload);
// Requirements say: network = "eip155:137" (destination)
// But payment signed for: sourceNetwork = "eip155:8453" (source)

// Create source chain requirements
const sourceRequirements = {
  scheme: "exact",
  network: crossChainInfo.sourceNetwork,  // "eip155:8453" (Base)
  asset: crossChainInfo.sourceAsset,      // USDC on Base
  amount: requirements.amount,
  payTo: bridgeLockAddress,               // Lock on Base
};

// Delegate to ExactEvmScheme on SOURCE chain
return exactEvmScheme.verify(payload, sourceRequirements);
```

## Could We Use "exact" Scheme Instead?

**Option 1: Merchant sends source chain requirements**
```typescript
// Merchant sends:
{
  scheme: "exact",
  network: "eip155:8453",  // Source chain (Base)
  payTo: bridgeLockAddress
}
```
**Problem**: Merchant doesn't know which chain the user will pay from! The user chooses.

**Option 2: Client modifies requirements**
```typescript
// Client receives requirements for destination, modifies to source
```
**Problem**: Client shouldn't modify requirements - they're the contract between merchant and facilitator.

**Option 3: Use extension to route in "exact" scheme**
```typescript
// ExactEvmScheme checks for cross-chain extension
if (hasCrossChainExtension) {
  // Route to source chain
}
```
**Problem**: This would require modifying `ExactEvmScheme` (which we don't own), or it would need to be aware of cross-chain logic (violates separation of concerns).

## The Solution: Routing Scheme

A scheme is needed because:

1. **Scheme selection happens first**: Facilitator routes by `requirements.scheme` before hooks
2. **Network mismatch must be handled**: Requirements specify destination, payment signed for source
3. **Routing logic belongs in a scheme**: It's scheme-specific behavior (how to handle "cross-chain" payments)
4. **Clean separation**: `ExactEvmScheme` stays pure (only handles same-chain), router handles cross-chain

## Is It Really a "Scheme"?

Technically, yes - it's registered as a scheme because:
- Facilitator routes by scheme name
- It implements `SchemeNetworkFacilitator` interface
- It appears in `/supported` endpoint

But conceptually, it's a **router**:
- Doesn't implement new payment logic
- Delegates all verification/settlement to `ExactEvmScheme`
- Only adds routing (source chain) and transport (bridging)

## Alternative: Could x402 Core Support This?

In theory, x402 could add support for:
- Network-agnostic schemes (scheme handles network mismatch)
- Extension-based routing (schemes check extensions to route)

But currently, schemes are network-specific, so we need a routing layer.

## Conclusion

**Yes, a scheme is needed** because:
1. Facilitator architecture requires scheme registration for routing
2. Network mismatch (destination in requirements, source in payment) must be handled
3. Hooks can't change which scheme is called
4. `ExactEvmScheme` shouldn't know about cross-chain logic

The `CrossChainRouter` is the minimal solution - a thin routing wrapper that delegates to `ExactEvmScheme` for the actual payment logic.

