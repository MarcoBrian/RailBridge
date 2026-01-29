# RailBridge USDC Bridging Reliability & Security Implementation Plan

## Goals
- Prevent unsupported or malicious cross-chain USDC bridge attempts before settlement.
- Make bridging durable, idempotent, and observable across process restarts.
- Reduce key-management risk and harden operational controls for the facilitator.

## Scope
This plan targets the facilitator cross-chain flow and Circle CCTP integration located under:
- `facilitator/src/facilitator-implementation.ts`
- `facilitator/src/schemes/crossChainRouter.ts`
- `facilitator/src/extensions/crossChain.ts`
- `facilitator/src/services/circleCCTPBridgeService.ts`
- `facilitator/src/bridgeWorker.ts`

## Phase 0: Architecture + Data Model (Day 0–1)
1. **Define bridge job model**
   - Fields: `id`, `sourceNetwork`, `destinationNetwork`, `sourceTxHash`, `amount`, `destinationAsset`, `destinationPayTo`, `status`, `attempts`, `lastError`, `createdAt`, `updatedAt`, `bridgeTxHash`, `destinationTxHash`, `messageId`.
   - Add **idempotency key**: `sourceNetwork + sourceTxHash + destinationNetwork`.
2. **Select persistence layer**
   - Use a DB table (e.g., Postgres) or a queue (e.g., BullMQ + Redis) with a database for durability.
   - Decide on a minimal schema for v1 and migration strategy.
3. **Define API responses for bridge status**
   - Document the internal/admin endpoint response shape for bridge job status.

## Phase 1: Prevent Unsupported or Malicious Settlements (Days 1–3)
1. **Pre-settlement validation of chains/assets**
   - Add a `validateCrossChainRequest()` in facilitator (or router) that checks:
     - Source chain supported by CCTP.
     - Destination chain supported by CCTP.
     - Source asset address matches known USDC for source chain.
     - Destination asset address matches known USDC for destination chain.
   - Fail verification and settlement with a clear error reason when unsupported.
2. **Strengthen cross-chain extension validation**
   - Extend `extractCrossChainInfo()` to validate:
     - `destinationNetwork` and `destinationAsset` are in an allowlist per environment.
     - `destinationPayTo` is a valid address and matches merchant configuration if available.
   - Add JSON schema validation or a strict runtime validator.
3. **Enforce correct pay-to usage**
   - Ensure `requirements.payTo` is the facilitator/bridge-lock address, not client-defined.
   - Reject if it deviates from configured facilitator address.

## Phase 2: Make Bridging Durable & Idempotent (Days 3–6)
1. **Persist bridge jobs**
   - Create a persistence layer (DB or queue-backed storage).
   - Write bridge jobs on `onAfterSettle` before initiating a bridge.
2. **Implement idempotent bridge execution**
   - Before bridging, check if a job with the same idempotency key already exists.
   - If already completed, skip; if in-progress, do nothing; if failed, retry based on policy.
3. **Worker-based bridge executor**
   - Move `handleCrossChainBridgeAsync` into a worker process/service.
   - Worker consumes queued jobs, updates status, and records tx hashes.
4. **Retry policy with backoff + jitter**
   - Improve `isRetryableBridgeError()` to use structured error codes from CCTP.
   - Use exponential backoff with jitter and a maximum retry window.

## Phase 3: Improve Observability + Reconciliation (Days 6–8)
1. **Structured logs with correlation IDs**
   - Emit a `bridgeJobId` in all logs for bridge lifecycle events.
   - Include `sourceTxHash`, `destinationNetwork`, `amount` consistently.
2. **Bridge status API**
   - Add an admin endpoint to query bridge status by `sourceTxHash` or job ID.
   - Provide operational tooling to retrigger or cancel a bridge job.
3. **Reconciliation job**
   - Add a scheduled reconciliation task that checks pending jobs against CCTP status.
   - Automatically reattempt or flag manual review after a threshold.

## Phase 4: Key Management & Endpoint Security (Days 8–10)
1. **Split facilitator and bridge keys**
   - Require `BRIDGE_EVM_PRIVATE_KEY` explicitly; do not default to `EVM_PRIVATE_KEY`.
   - Add startup warnings and hard failure if key not set in production.
2. **Add API authentication + rate limits**
   - Require an API key or mTLS for `/verify` and `/settle`.
   - Implement IP-based rate limiting to reduce abuse.
3. **Secrets management**
   - Store keys in a secrets manager (AWS/GCP) rather than env files.

## Phase 5: Chain Reliability (Days 10–12)
1. **RPC failover**
   - Add multiple RPC endpoints per chain with fallback.
2. **Confirmation depth**
   - Require N-block confirmations for large transfers.
   - Configure chain-specific confirmation thresholds.

## Milestones & Deliverables
- **M1 (Week 1)**: Pre-settlement validation + strengthened extension checks.
- **M2 (Week 2)**: Persisted bridge jobs + worker + idempotency + retries.
- **M3 (Week 3)**: Admin status API + reconciliation + observability upgrades.
- **M4 (Week 4)**: Key management + API authentication + RPC failover.

## Rollout Plan
1. Ship validation and allowlists behind a feature flag.
2. Backfill bridge jobs for existing settlements (if needed) before enabling worker.
3. Enable job persistence and worker in staging, validate metrics.
4. Enable in production with alerting and a rollback path.

## Risks & Mitigations
- **Risk:** False negatives on validation block legitimate payments.
  - **Mitigation:** Start in `warn-only` mode in staging, then enforce in prod.
- **Risk:** Worker outage stalls bridging.
  - **Mitigation:** Reconciler + retry jobs + alerting on queue depth.
- **Risk:** RPC outages delay confirmations.
  - **Mitigation:** Multi-RPC failover + increased confirmation timeout.

## Dependencies
- Database or queue infrastructure.
- Secrets management (KMS or Vault).
- Metrics/monitoring stack (Datadog/Prometheus).
