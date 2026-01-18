# Bridge Accounting: Is It Necessary?

## Current Situation

When funds are settled to the bridge lock address, there's **no explicit on-chain accounting** of:
- Which merchant should receive the funds
- How much each merchant should receive
- Which destination chain to send to

## The Question: Is Accounting Necessary?

**Short Answer**: It depends on your bridge architecture, but **yes, you need some form of accounting** - either on-chain or event-based.

## Two Approaches

### Approach 1: Event-Based Accounting (Recommended for Existing Bridges)

**How it works**:
- Bridge contract emits events when funds are locked
- Event includes: `amount`, `recipient`, `destinationChain`
- Your facilitator/relayer watches events and bridges accordingly

**Example with Wormhole/LayerZero**:
```typescript
// When calling bridge contract
await bridgeContract.lock(
  asset,
  amount,
  destinationChainId,
  recipient  // Merchant address
);

// Contract emits event:
event FundsLocked(
  address indexed token,
  uint256 amount,
  uint256 destChainId,
  address recipient,
  bytes32 paymentId
);
```

**Pros**:
- ✅ Simple - bridge protocol handles it
- ✅ No custom contract needed
- ✅ Works with existing bridges (Wormhole, LayerZero)

**Cons**:
- ❌ Requires off-chain event watcher
- ❌ If event is missed, payment might not bridge

**Current Implementation**:
Your `bridgeService.bridge()` receives all the info:
```typescript
await bridgeService.bridge(
  sourceChain,
  sourceTxHash,      // Can query this transaction for event
  destChain,
  asset,
  amount,
  recipient          // Merchant address - already known!
);
```

### Approach 2: On-Chain Accounting (For Custom Bridges)

**How it works**:
- Bridge contract stores a mapping: `paymentId → PaymentInfo`
- Each lock includes recipient, amount, destination chain
- Destination contract can verify and release based on payment ID

**Example Custom Contract**:
```solidity
contract RailBridgeLock {
  struct PaymentInfo {
    address recipient;
    uint256 amount;
    uint256 destChainId;
    address asset;
    bool bridged;
  }
  
  mapping(bytes32 => PaymentInfo) public payments;
  
  function lockFunds(
    address token,
    uint256 amount,
    uint256 destChainId,
    address recipient
  ) external returns (bytes32 paymentId) {
    paymentId = keccak256(abi.encodePacked(
      msg.sender,
      block.timestamp,
      amount
    ));
    
    payments[paymentId] = PaymentInfo({
      recipient: recipient,
      amount: amount,
      destChainId: destChainId,
      asset: token,
      bridged: false
    });
    
    // Transfer tokens to this contract
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    
    emit FundsLocked(paymentId, recipient, amount, destChainId);
  }
}
```

**Pros**:
- ✅ On-chain verification possible
- ✅ Can prevent double-bridging
- ✅ More transparent

**Cons**:
- ❌ Requires custom contract deployment
- ❌ More complex
- ❌ Gas costs for storage

## Current Implementation Analysis

### What We Have Now

**In `crossChainRouter.ts`** (line 118-124):
```typescript
const bridgeLockAddress = this.bridgeService.getLockAddress(...);
const sourceRequirements = {
  payTo: bridgeLockAddress,  // Funds go here
  // amount, asset, etc. are in requirements
};
```

**In `onAfterSettle` hook** (line 257-264):
```typescript
await bridgeService.bridge(
  sourceChain,
  sourceTxHash,        // Transaction that sent funds to bridge lock
  destChain,
  asset,
  amount,
  recipient           // Merchant address - we know this!
);
```

### The Gap

**Problem**: The bridge lock address receives funds, but:
- The **bridge contract** doesn't know the recipient/amount/destination
- We rely on the **bridge service** to track this off-chain

**Solution Options**:

#### Option A: Event-Based (Works with Existing Bridges)

When using Wormhole/LayerZero, the bridge contract call includes recipient:

```typescript
// In bridgeService.initiateBridge()
await wormholeContract.lock(
  asset,
  amount,
  destinationChainId,
  recipient  // ✅ Included in contract call
);

// Contract emits event with all info
// Your relayer watches events and bridges
```

**Accounting**: Event contains all info, no on-chain storage needed.

#### Option B: Transaction-Based (Current Stub)

Your current stub implementation:
```typescript
// bridgeService.bridge() receives:
- sourceTxHash  // Can query this transaction
- recipient     // Already known from requirements
- amount        // Already known from requirements
- destChain     // Already known from requirements
```

**Accounting**: All info is in the function parameters, passed from `onAfterSettle` hook.

#### Option C: Custom Contract with Mapping

If building a custom bridge:
```solidity
// Store payment info on-chain
mapping(bytes32 => PaymentInfo) payments;
```

**Accounting**: On-chain storage tracks each payment.

## Recommendation

### For MVP (Using Existing Bridges)

**Use Event-Based Accounting**:
1. When settling to bridge lock, include recipient in the bridge contract call
2. Bridge contract emits event with all payment details
3. Your `bridgeService` watches events or queries the transaction
4. Bridge service uses event data to bridge to merchant

**Implementation**:
```typescript
// In bridgeService.initiateBridge()
const tx = await bridgeContract.lock(
  asset,
  amount,
  destinationChainId,
  recipient  // Merchant address
);

// Event emitted automatically by bridge contract
// Your service can query: bridgeContract.queryFilter("FundsLocked", ...)
```

### For Custom Bridge

**Use On-Chain Accounting**:
1. Bridge contract stores payment info in mapping
2. Each lock creates a payment record
3. Destination contract verifies payment ID before releasing
4. Prevents double-bridging and enables verification

## Is It Necessary?

**Yes, accounting is necessary**, but the form depends on your architecture:

1. **Existing Bridges (Wormhole/LayerZero)**: 
   - ✅ Accounting via events/contract calls
   - ✅ Recipient included in bridge contract call
   - ✅ No custom storage needed

2. **Custom Bridge**:
   - ✅ On-chain mapping recommended
   - ✅ Prevents double-bridging
   - ✅ Enables verification

3. **Current Stub**:
   - ⚠️ Works for testing (all info in function params)
   - ⚠️ Not production-ready (no persistence)
   - ✅ Can be upgraded to event-based or on-chain

## Next Steps

1. **If using Wormhole/LayerZero**: 
   - Include recipient in bridge contract call
   - Use events for accounting (no on-chain storage needed)

2. **If building custom bridge**:
   - Add on-chain mapping for payment tracking
   - Store: `paymentId → { recipient, amount, destChain, bridged }`

3. **For current implementation**:
   - The info is already available in `bridgeService.bridge()` parameters
   - When implementing actual bridge, choose event-based or on-chain accounting

## Summary

- **Accounting is necessary** to know where to send bridged funds
- **Event-based** works for existing bridges (Wormhole/LayerZero)
- **On-chain mapping** works for custom bridges
- **Current stub** has all info in parameters, but needs persistence for production

The key is: **The bridge contract/service needs to know the recipient, amount, and destination chain** - whether that's via events, on-chain storage, or function parameters.

