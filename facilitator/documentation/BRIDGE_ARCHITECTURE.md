# Bridge Architecture Options

## Overview

The cross-chain facilitator needs to bridge funds from source chain to destination chain. This requires on-chain contracts, but the implementation depends on which bridge provider you use.

## Current Flow

```
1. User pays on source chain → Funds locked in bridge contract
2. Bridge contract locks funds
3. Bridge protocol/relayer delivers message to destination
4. Destination contract releases funds to merchant
```

## Option 1: Use Existing Bridge Protocols (Recommended)

### Wormhole
**Contracts Required**: ✅ Yes, but already deployed
- Wormhole has contracts on all supported chains
- You interact with existing contracts (no deployment needed)
- Your facilitator calls Wormhole contracts to lock funds
- Wormhole relayer network handles cross-chain messaging
- Destination chain contract releases funds

**Implementation:**
```typescript
// In BridgeService.initiateBridge()
// Call Wormhole contract on source chain
await wormholeContract.lock(
  asset,
  amount,
  destinationChainId,
  recipient
);
```

**Pros:**
- No contract deployment needed
- Battle-tested, secure
- Supports many chains
- Relayer network handles messaging

**Cons:**
- Relies on Wormhole's security model
- Bridge fees go to Wormhole
- Less control over bridge process

### LayerZero
**Contracts Required**: ✅ Yes, but already deployed
- Similar to Wormhole
- LayerZero has contracts on all chains
- You interact with existing contracts
- LayerZero handles cross-chain messaging

**Pros:**
- No contract deployment needed
- Fast finality
- Good UX

**Cons:**
- Relies on LayerZero's security
- Bridge fees

## Option 2: Custom RailBridge Contracts

**Contracts Required**: ✅ Yes, you deploy your own

### Architecture

```
Source Chain (Base)                    Destination Chain (Polygon)
┌─────────────────────┐              ┌─────────────────────┐
│ RailBridgeLock      │              │ RailBridgeRelease   │
│ Contract            │              │ Contract            │
│                     │              │                     │
│ - Locks funds       │              │ - Holds liquidity   │
│ - Emits event       │              │ - Releases funds     │
│ - Validates txs     │              │ - Validates proofs   │
└─────────────────────┘              └─────────────────────┘
         │                                    │
         │ Event: FundsLocked                 │
         │ { amount, recipient, destChain }    │
         │                                    │
         └──────────► Relayer/API ────────────┘
                     (Your backend)
```

### Contract Responsibilities

**Source Chain Contract (`RailBridgeLock`):**
```solidity
contract RailBridgeLock {
  // Lock funds when payment is settled
  function lockFunds(
    address token,
    uint256 amount,
    uint256 destChainId,
    address recipient
  ) external {
    // Transfer tokens from facilitator to contract
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    
    // Emit event for relayer to pick up
    emit FundsLocked(
      token,
      amount,
      destChainId,
      recipient,
      block.timestamp
    );
  }
  
  // Relayer calls this to prove funds were released
  function markReleased(bytes32 lockId) external onlyRelayer {
    // Mark as released, allow withdrawal if needed
  }
}
```

**Destination Chain Contract (`RailBridgeRelease`):**
```solidity
contract RailBridgeRelease {
  // Holds liquidity pool for fast releases
  mapping(address => uint256) public liquidity;
  
  // Release funds to merchant
  function releaseFunds(
    address token,
    uint256 amount,
    address recipient,
    bytes32 sourceTxHash,
    bytes proof  // Proof that funds were locked on source
  ) external onlyRelayer {
    // Verify proof (could use Merkle proofs, signatures, etc.)
    require(verifyProof(sourceTxHash, proof), "Invalid proof");
    
    // Transfer from liquidity pool
    IERC20(token).transfer(recipient, amount);
    
    emit FundsReleased(recipient, amount, sourceTxHash);
  }
  
  // Replenish liquidity (from other side of bridge)
  function addLiquidity(address token, uint256 amount) external {
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    liquidity[token] += amount;
  }
}
```

### Implementation Flow

```typescript
// 1. Settlement locks funds in source chain contract
const lockTx = await bridgeLockContract.lockFunds(
  asset,
  amount,
  destinationChainId,
  merchantAddress
);

// 2. Your relayer/backend monitors source chain events
// 3. Relayer validates and calls destination contract
const releaseTx = await bridgeReleaseContract.releaseFunds(
  asset,
  amount,
  merchantAddress,
  sourceTxHash,
  proof
);
```

**Pros:**
- Full control over bridge process
- Custom fee structure
- Can optimize for your use case
- No dependency on third-party protocols

**Cons:**
- Need to deploy and maintain contracts
- Need to run relayer infrastructure
- Need liquidity pools on destination chains
- Security responsibility is yours
- More complex to implement

## Option 3: Centralized Bridge (Not Recommended)

**Contracts Required**: ❌ No, but less secure

### How it works:
- Funds locked in facilitator's wallet/contract
- Facilitator manually or programmatically sends funds on destination
- No on-chain proof/validation

**Pros:**
- Simple to implement
- No contracts needed

**Cons:**
- ❌ Requires trust in facilitator
- ❌ Not trustless
- ❌ Single point of failure
- ❌ Regulatory concerns (custody)

## Recommended Approach

### For MVP: Use Wormhole or LayerZero
- Fastest to implement
- No contract deployment
- Battle-tested security
- Focus on facilitator logic, not bridge infrastructure

### For Production: Custom Contracts (if needed)
- Only if you need:
  - Custom fee structure
  - Better economics
  - Specific optimizations
  - Full control

## Implementation Details

### Current Code Structure

```typescript
// In CrossChainRouter.settle()
const bridgeLockAddress = this.bridgeService.getLockAddress(sourceNetwork);
// This returns the bridge contract address

// Settlement goes to bridge lock contract
const sourceRequirements = {
  payTo: bridgeLockAddress,  // Bridge contract, not merchant
  // ...
};
```

### Bridge Service Integration

```typescript
// Option 1: Wormhole
class WormholeBridgeService {
  async bridge(...) {
    // Call Wormhole contract
    await wormhole.lock(asset, amount, destChain, recipient);
    // Wait for relayer
    // Return destination tx hash
  }
}

// Option 2: Custom RailBridge
class RailBridgeService {
  async bridge(...) {
    // Call your RailBridgeLock contract
    await railBridgeLock.lockFunds(asset, amount, destChain, recipient);
    // Your relayer picks up event
    // Relayer calls RailBridgeRelease contract
    // Return destination tx hash
  }
}
```

## Security Considerations

### Using Existing Protocols (Wormhole/LayerZero)
- ✅ Security model handled by protocol
- ✅ Audited contracts
- ✅ Decentralized relayers
- ⚠️ You trust the protocol

### Custom Contracts
- ⚠️ You're responsible for:
  - Contract security (audits!)
  - Relayer security
  - Liquidity management
  - Proof verification
  - Replay attack prevention

## Cost Analysis

### Wormhole/LayerZero
- Bridge fees: ~$0.10 - $1.00 per bridge
- No infrastructure costs
- No liquidity needed (protocol provides)

### Custom RailBridge
- Gas costs: ~$0.50 - $5.00 per bridge (both chains)
- Infrastructure: Relayer servers
- Liquidity: Need to maintain pools on each destination chain
- Development: Contract development + audits

## Recommendation

**Start with Wormhole or LayerZero:**
1. Fastest to market
2. No contract deployment
3. Focus on facilitator logic
4. Can migrate to custom later if needed

**Move to custom contracts only if:**
- You need specific optimizations
- Economics require it
- You have bridge expertise
- You can maintain security

## Next Steps

1. **Choose bridge provider** (Wormhole recommended for MVP)
2. **Integrate SDK** (Wormhole SDK, LayerZero SDK)
3. **Implement BridgeService** with actual provider calls
4. **Test on testnets** before mainnet
5. **Consider custom contracts** only if needed for production

