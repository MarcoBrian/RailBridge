# Offchain Batching Architecture for Cross-Chain Microtransactions

## Overview

This document describes the architecture for handling cross-chain payments in the RailBridge facilitator using an **offchain batching model**. This approach solves the economic problem where individual microtransactions (e.g., $0.01) would be uneconomical to bridge individually due to cross-chain gas fees (e.g., $1 per bridge).

### MVP Implementation: Circle CCTP for USDC

**For MVP**, this architecture is implemented using **Circle's Cross-Chain Transfer Protocol (CCTP)** for USDC transfers:
- ✅ **USDC-only**: MVP focuses on USDC cross-chain payments
- ✅ **Testnet support**: CCTP available on Sepolia and other testnets for development
- ✅ **Simplified**: Burn-and-mint model means no liquidity checks needed
- ✅ **Future expansion**: Architecture supports adding other bridge providers (Wormhole, deBridge, etc.) for non-USDC tokens

Instead of bridging each payment immediately, the facilitator:
1. **Settles every payment on the source chain** (trustless, on-chain)
2. **Tracks pending balances in an offchain ledger** (per merchant, per route)
3. **Batches multiple payments** and bridges them together when thresholds are met
4. **Amortizes bridge costs** across many microtransactions

## Problem Statement

### The Economic Challenge

- User pays $0.01 per API request (microtransaction)
- Cross-chain bridge fee: ~$1 per transaction
- **Total cost: $1.01 to send $0.01** ❌

### Solution: Batching

- 1,000 requests of $0.01 = $10 revenue
- One bridge transaction: ~$1
- **Effective bridge fee: 10%** ✅

## Architecture Components

### 1. Cross-Chain Ledger (Data Storage)

**Purpose**: Track pending cross-chain balances per merchant/route without bridging immediately.

#### Data Model

**Unique Identifier** (Composite Key):
- `sourceNetwork` (e.g., `eip155:84532` - Base Sepolia)
- `destinationNetwork` (e.g., `eip155:137` - Polygon)
- `asset` (source token address, e.g., `0x036CbD53842c5426634e7929541eC2318f3dCF7e`)
- `merchantAddress` (destination `payTo` address from cross-chain extension)

**Stored Values**:
- `pendingAmount` (string/BigInt) - Cumulative amount owed to merchant
- `lastUpdatedAt` (timestamp) - When last payment was added
- `lastSourceTxHash` (string) - Latest source chain transaction hash (for audit)
- `count` (integer) - Number of payments batched
- `currencyUsdEstimate` (optional) - USD value for threshold checks

#### Storage Options

- **Simple**: SQLite / PostgreSQL table
- **Scalable**: Redis (for fast writes) + periodic sync to DB
- **Distributed**: Shared DB or Redis cluster (if running multiple facilitator instances)

#### Key Operations

- `incrementBalance(key, amount, txHash)` - Add to pending balance
- `getBalance(key)` - Read current pending amount
- `resetBalance(key, bridgedAmount)` - Clear after successful bridge
- `listPendingBatches(threshold, maxAge)` - Query for rebalancer

---

### 2. Settlement Hook Handler (Payment Ingestion)

**Purpose**: Intercept settled payments and update the ledger instead of bridging immediately.

#### Input

From `onAfterSettle` hook context:
- `sourceNetwork` - Where payment was settled
- `amount` - Payment amount
- `asset` - Source token address
- Cross-chain extension info:
  - `destinationNetwork` - Where merchant receives
  - `destinationAsset` - Destination token address
  - `destinationPayTo` - Merchant address on destination chain
- `sourceTxHash` - Source chain transaction hash (for audit)

#### Logic Flow

1. Detect cross-chain payment (via `extractCrossChainInfo`)
2. Check if batching is enabled for this route
3. Update ledger: increment balance for `(sourceNetwork, destinationNetwork, asset, destinationPayTo)`
4. Log the event for audit trail
5. Return success (settlement already succeeded on source chain)

#### Edge Cases

- **Ledger write fails**: Retry with backoff, or fall back to immediate bridge
- **Duplicate payments**: Use `sourceTxHash` for idempotency checks
- **Same payment settled twice**: Check if `sourceTxHash` already processed

---

### 3. Rebalancer Service (Bridging Trigger)

**Purpose**: Periodically scan ledger and trigger batched bridges when thresholds are met.

#### Configuration

- `MIN_BRIDGE_AMOUNT` - Minimum amount to trigger bridge (per asset or USD equivalent)
- `MAX_AGE_SECONDS` - Force bridge even if below threshold (e.g., 24 hours)
- `POLL_INTERVAL_SECONDS` - How often to check ledger (e.g., every 5 minutes)

#### Logic Flow

1. Query ledger for entries where:
   - `pendingAmount >= MIN_BRIDGE_AMOUNT` OR
   - `age >= MAX_AGE_SECONDS`
2. For each eligible entry:
   - Call `bridgeService.bridge(...)` with batched amount
   - On success:
     - Record bridge transaction in audit log
     - Reset ledger entry (`pendingAmount = 0`)
   - On failure:
     - Mark entry with `lastError` and `retryAfter` timestamp
     - Alert if retries exceed threshold

#### Execution Models

- **Option A**: Long-running Node process with `setInterval`
- **Option B**: Cron job / scheduled task (calls facilitator endpoint)
- **Option C**: Event-driven (triggered by ledger writes, with rate limiting)

#### Edge Cases

- **Bridge fails**: Retry logic with exponential backoff, dead letter queue
- **Multiple facilitator instances**: Need distributed locking / leader election
- **Bridge succeeds but ledger update fails**: Reconciliation job to match bridge txs to ledger entries

---

### 4. Configuration / Policy Layer

**Purpose**: Define rules for when to batch vs. bridge immediately, and minimum amounts.

#### Global Configuration

Environment variables or config file:
```env
BRIDGE_BATCHING_ENABLED=true
BRIDGE_MIN_AMOUNT_USD=10
BRIDGE_MAX_AGE_HOURS=24
BRIDGE_MIN_FOR_DIRECT_BRIDGE_USD=100  # If above this, bridge immediately
```

#### Per-Route Configuration (Optional)

Stored in DB or config:
- Some merchants might want immediate bridging (premium tier)
- Some routes might have different thresholds
- Some assets might have different minimums

#### Policy Checks

**In `onBeforeVerify`**:
- If `amount < MIN_FOR_DIRECT_BRIDGE` and batching disabled → Reject with `amount_below_cross_chain_minimum`
- If estimated bridge fee / amount ratio too high → Suggest same-chain route

**In `onAfterSettle`**:
- If `amount >= MIN_FOR_DIRECT_BRIDGE` → Bridge immediately (skip batching)
- If merchant has `immediateBridge=true` → Skip batching
- If `pendingAmount + newAmount >= MIN_BRIDGE` → Optionally trigger immediate bridge

---

### 5. Bridge Service Adapter (Integration Point)

**Purpose**: Your existing `BridgeService` interface, but now called by rebalancer instead of hooks.

#### Interface

- `bridge(sourceChain, sourceTxHash, destChain, asset, amount, recipient)` - Execute bridge
- `checkLiquidity(sourceChain, destChain, asset, amount)` - Check if bridgeable
- `getExchangeRate(sourceChain, destChain, sourceAsset, destAsset)` - Get rate

#### MVP Implementation: Circle CCTP

**For USDC with Circle CCTP**, the implementation simplifies:

- **`checkLiquidity()`**: Always returns `true` for USDC (burn-and-mint model, no liquidity pools needed)
- **`getExchangeRate()`**: Always returns `1.0` for USDC (1:1 rate guaranteed)
- **`bridge()`**: Implements CCTP burn-and-mint flow:
  1. Burn USDC on source chain via CCTP contract
  2. Wait for Circle attestation
  3. Mint USDC on destination chain to recipient

#### Usage Pattern Changes

- **Before**: Called synchronously in `onAfterSettle` hook with per-payment amounts
- **After**: Called asynchronously by rebalancer with batched amounts

#### Optional Additional Methods

- `estimateBridgeFee(amount)` - For policy checks (CCTP fees are typically low and predictable)
- `getBridgeStatus(bridgeTxHash)` - For tracking bridge completion (CCTP attestation status)

#### Future Expansion

When adding support for other tokens (non-USDC), implement additional bridge providers:
- **Wormhole**: For general token bridging
- **deBridge**: For native-asset orders with 0-TVL model
- **LayerZero**: For messaging and composable cross-chain flows

The `BridgeService` abstraction allows routing based on asset type:
```typescript
if (asset === USDC && destAsset === USDC) {
  return circleCCTP.bridge(...);
} else {
  return wormholeBridge.bridge(...);
}
```

---

### 6. Audit / Logging System

**Purpose**: Track all ledger operations and bridge transactions for transparency and debugging.

#### Events to Log

**Payment Events**:
```json
{
  "type": "payment_settled",
  "sourceTx": "0x...",
  "amount": "10000",
  "merchant": "0x...",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

**Ledger Updates**:
```json
{
  "type": "ledger_incremented",
  "key": "eip155:84532|eip155:137|0x...|0x...",
  "amount": "10000",
  "newBalance": "50000",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

**Bridge Events** (CCTP-specific):
```json
{
  "type": "bridge_initiated",
  "sourceTx": "0x...",
  "burnTx": "0x...",
  "attestationMessage": "0x...",
  "destTx": "0x...",
  "amount": "50000",
  "merchant": "0x...",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

**Errors**:
```json
{
  "type": "bridge_failed",
  "error": "attestation_timeout",
  "retryCount": 3,
  "ledgerKey": "...",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### Storage

- Same DB as ledger (separate `audit_log` table)
- Or separate logging service (structured logs to file, external service)

#### Use Cases

- **Merchant queries**: "Show me all payments that contributed to bridge X"
- **Debugging**: "Why didn't this payment get bridged?"
- **Compliance**: "Prove that merchant Y received all their funds"

---

### 7. Merchant-Facing APIs (Optional but Recommended)

**Purpose**: Let merchants see their pending balances and request payouts.

#### Endpoints

**GET `/merchant/{address}/pending-balances`**

Returns pending balances per route:
```json
{
  "merchant": "0x...",
  "balances": [
    {
      "sourceNetwork": "eip155:84532",
      "destinationNetwork": "eip155:137",
      "asset": "0x...",
      "pendingAmount": "50000",
      "lastUpdated": "2024-01-01T00:00:00Z",
      "count": 5
    }
  ]
}
```

**POST `/merchant/{address}/request-payout`** (Optional)

Force immediate bridge for a specific route (even if below threshold):
```json
{
  "sourceNetwork": "eip155:84532",
  "destinationNetwork": "eip155:137",
  "asset": "0x..."
}
```

Could charge a fee for this premium feature.

#### Benefits

- **Transparency**: Builds trust with merchants
- **Cash flow planning**: Merchants know when funds will arrive
- **Reduces support**: "Where's my money?" questions answered via API

---

### 8. Error Handling & Recovery

**Purpose**: Handle failures gracefully and ensure funds aren't lost.

#### Failure Scenarios

**Ledger Write Fails** (DB down, disk full):
- Retry with exponential backoff
- Fallback: Log to file, reconcile later
- Worst case: Fall back to immediate bridge (better than losing payment)

**Bridge Fails** (CCTP attestation service down, network issues):
- Mark ledger entry with `lastError` and `retryAfter` timestamp
- Rebalancer retries on next cycle (with exponential backoff)
- Alert if retries exceed threshold (e.g., 5 attempts)
- **Note**: CCTP doesn't have liquidity issues (burn-and-mint), but attestation service or network problems can cause failures

**Bridge Succeeds but Ledger Update Fails**:
- Reconciliation job: Periodically check bridge tx hashes, match to ledger entries
- Or: Make ledger update part of bridge transaction (if possible)

#### Monitoring & Alerts

- **Stale batches**: Alert if `pendingAmount` grows too large without bridging
- **High failure rate**: Alert if bridge failure rate exceeds threshold
- **Balance drift**: Alert if ledger and on-chain balances don't match (reconciliation check)

---

### 9. Idempotency & Deduplication

**Purpose**: Ensure same payment isn't counted twice.

#### Implementation

**Unique Identifier**: `sourceTxHash` is natural key for each payment

**Check Before Incrementing**:
```sql
SELECT * FROM ledger 
WHERE lastSourceTxHash = ? 
AND sourceNetwork = ? 
AND destinationNetwork = ?
```

**Or Separate Tracking Table**:
- `processed_payments` table to track which `sourceTxHash`es already handled
- Check before processing, insert after successful ledger update

#### Why Important

- **Facilitator restart**: Hooks might fire again for same payment
- **Merchant retry**: If merchant retries `/settle`, don't double-count
- **Network issues**: Idempotency prevents duplicate processing

---

## Component Dependencies

```
┌─────────────────────────────────────────┐
│  Facilitator (existing x402 hooks)      │
│  - onAfterSettle hook                   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Settlement Hook Handler                │
│  - Detects cross-chain                  │
│  - Updates Cross-Chain Ledger          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Cross-Chain Ledger (DB/Storage)        │
│  - Stores pending balances              │
└──────────────┬──────────────────────────┘
               │
               ├──────────────────────────┐
               │                          │
               ▼                          ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│  Rebalancer Service      │  │  Merchant APIs           │
│  - Scans ledger          │  │  - Query balances        │
│  - Triggers bridges      │  │  - Request payouts       │
└──────────────┬───────────┘  └──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Bridge Service (Circle CCTP for MVP)   │
│  - bridge() called with batched amounts │
│  - USDC burn-and-mint flow              │
│  - Simplified: no liquidity checks      │
└─────────────────────────────────────────┘
```

## Design Decisions

### Why Offchain?

1. **Economic necessity**: Per-payment bridging is uneconomical for microtransactions
2. **User payment is still on-chain**: Each x402 request is settled trustlessly on source chain
3. **Trust increase is incremental**: Facilitator already controls when/which bridge to call
4. **Transparency mitigates risk**: Ledger + APIs + audit logs make system auditable

### Trade-offs

**Pros**:
- ✅ Makes microtransactions economically viable
- ✅ User payments remain on-chain and trustless
- ✅ Flexible batching thresholds per merchant/route
- ✅ Can evolve to on-chain netting later if needed

**Cons**:
- ⚠️ Adds timing risk (funds in transit longer)
- ⚠️ Requires trust in facilitator's ledger accounting
- ⚠️ More operational complexity (DB, rebalancer, monitoring)

**Mitigations**:
- Transparent APIs for merchants to see pending balances
- Audit logs for all operations
- Monitoring and alerts for failures
- Optional: Insurance or legal guarantees for facilitator

## Implementation Questions

Before coding, decide:

1. **Storage**: SQLite (simple) vs PostgreSQL (scalable) vs Redis (fast, ephemeral)?
2. **Rebalancer**: Separate process vs. same Node process with `setInterval`?
3. **Multi-instance**: Will you run multiple facilitator instances? (Needs distributed locking)
4. **Merchant APIs**: Do you want them now, or later?
5. **Monitoring**: What alerting/monitoring do you already have? (Integrate with that)

## Next Steps

### MVP Implementation (Circle CCTP for USDC)

1. Choose storage solution (recommend PostgreSQL for production)
2. Design ledger schema and create migration
3. Implement `CircleCCTPBridgeService`:
   - Integrate Circle CCTP SDK/contracts
   - Implement burn-and-mint flow
   - Simplified `checkLiquidity()` (always true for USDC)
   - Simplified `getExchangeRate()` (always 1.0 for USDC)
4. Implement settlement hook handler
5. Build rebalancer service
6. Add configuration layer
7. Implement audit logging
8. (Optional) Add merchant APIs
9. Add monitoring and alerts
10. Test on Sepolia testnets

### Future Expansion

- Add support for non-USDC tokens via Wormhole or other bridge providers
- Implement routing logic to choose bridge based on asset type
- Add support for cross-asset swaps (e.g., USDC on Base → ETH on Polygon)

