# Production Readiness Checklist

This repository is a solid dev/test harness. For production, make sure you address the following:

## 1. Nonce Isolation (Critical)
- **Problem**: Settlement transactions and CCTP bridge transactions currently use the same EVM key.
- **Impact**: Nonce races cause intermittent `nonce too low` errors.
- **Fix**: Use a **dedicated CCTP key** (e.g. `CCTP_EVM_PRIVATE_KEY`) or a centralized nonce manager that controls all txs for that key.

## 2. Durable Bridge Jobs (Critical)
- **Problem**: Bridge retries are in-memory only. Process restarts lose state.
- **Fix**: Persist a `bridge_jobs` record (sourceTx, destNetwork, amount, status, attempts, lastError) and run a background worker.

## 3. Idempotency + Partial Success Handling (High)
- **Problem**: Retries can overlap with partially completed bridges (burn succeeded, mint pending).
- **Fix**: Store `bridgeTxHash` + `messageId`, check on-chain status before retrying, and only retry if prior attempt is provably failed.

## 4. Explicit Error Taxonomy (High)
- **Problem**: Retry logic uses string matching; this is brittle.
- **Fix**: Use Circle CCTP error codes / `recoverability` to classify retryable vs permanent failures.

## 5. Bridge Status API (Medium)
- **Problem**: Clients/merchants have no way to query bridge completion.
- **Fix**: Expose `GET /bridge-status?sourceTx=...` or webhook updates.

## 6. Concurrency Control (Medium)
- **Problem**: Large volumes can overwhelm RPC or BridgeKit.
- **Fix**: Queue bridge jobs and enforce max concurrency.

## 7. Asset Validation (Low)
- **Problem**: `isUSDC()` is permissive.
- **Fix**: Validate USDC addresses per chain.

## 8. Observability (Low)
- **Fix**: Use structured logs and metrics; add correlation IDs (`sourceTx`, `messageId`).

