# RailBridge Merchant Treasury OS — AI-Agent Sprint Delivery Plan

## 1) Goal

Convert the existing tech spec into an execution model where **AI agents** implement the platform iteratively with human review gates.

This plan assumes:
- AI agents write code, tests, migrations, and docs.
- Humans approve architecture/security decisions and production release gates.
- Work is shipped in short, verifiable slices.

---

## 2) Delivery Operating Model (AI-first)

## 2.1 Agent roles

1. **Planner Agent**
   - Converts spec sections into implementation tickets.
   - Defines acceptance criteria + test matrix per ticket.

2. **Builder Agent**
   - Implements code + migrations + API contracts.
   - Adds/updates tests.

3. **Verifier Agent**
   - Runs lint/tests/replay checks/reconciliation checks.
   - Performs negative-path validation.

4. **Reviewer Agent**
   - Enforces architecture constraints and coding standards.
   - Validates backward compatibility and security checklist.

5. **Release Agent**
   - Generates release notes, migration checklist, rollback steps.

> One AI can play multiple roles in sequence, but roles should stay logically separated in PR workflow.

## 2.2 Definition of Ready (DoR) per ticket

A ticket is ready only if it has:
- Scope (files/services touched)
- Input/output contract
- Error cases
- Telemetry requirements
- Acceptance tests (unit + integration)

## 2.3 Definition of Done (DoD) per ticket

- Code implemented
- Tests added and passing
- Migrations reversible
- Observability added (logs/metrics)
- Docs updated
- Replay/idempotency validated where applicable

---

## 3) Sprint-by-Sprint Plan (AI Agent Execution)

Each sprint below is designed as a chain of agent tasks. Keep sprint length 1 week.

## Sprint 1 — Event Backbone + Outbox

### Outcome
Reliable event emission from verify/settle lifecycle with idempotent consumption support.

### Agent tasks
- Planner: define canonical event schema + versioning rules.
- Builder: add outbox table + write path from verify/settle pipeline.
- Builder: add outbox relay worker.
- Verifier: run duplicate delivery simulation and ensure consumer idempotency.
- Reviewer: validate no behavior regression in existing payment flow.

### Deliverables
- `event schema` module
- outbox migration
- relay worker
- replay CLI (basic)

### Exit criteria
- Replayed event does not create duplicate state updates.
- Event lag metrics visible.

---

## Sprint 0.5 — Merchant Identity + Custody Foundation

### Outcome
Web2 auth and custodial account primitives exist before exposing treasury controls.

### Agent tasks
- Planner: finalize auth scope matrix (`admin`, `finance`, `readonly`) and account-tenancy rules.
- Builder: implement merchant user/auth tables and account wallet registry migrations.
- Builder: add secure signer adapter interface using key references (no private keys in DB).
- Verifier: test cross-merchant isolation and role-based authorization failures.
- Reviewer: validate MFA requirements for policy/consolidation/payout writes.

### Deliverables
- merchant user/account/wallet migrations
- auth middleware with merchant/account scoped claims
- signer provider interface contract

### Exit criteria
- unauthorized cross-merchant and cross-account access is blocked
- write actions require correct role and pass audit logging requirements

---

## Sprint 2 — Ledger MVP (Treasury Truth)

### Outcome
Double-entry ledger and derived balances available for merchant read APIs.

### Agent tasks
- Planner: define account code map and invariants.
- Builder: implement journal writer + invariant checks.
- Builder: implement balance projector/materializer.
- Verifier: run ledger invariant tests on success/failure/duplicate events.
- Reviewer: validate traceability from event_id -> tx_hash -> ledger rows.

### Deliverables
- ledger tables and repository
- invariant validator
- balance projection job

### Exit criteria
- `sum(debit) == sum(credit)` per event group.
- Balance query deterministic after replay.

---

## Sprint 3 — Policy Engine MVP

### Outcome
Merchant settlement behavior is controlled via policy (not hardcoded flow).

### Agent tasks
- Planner: define policy schema v1 and validation matrix.
- Builder: create policy storage + get/update API.
- Builder: implement decision engine for bridge/no-bridge and destination asset/network.
- Verifier: test policy changes apply only to new settlements.
- Reviewer: validate safe defaults + fallback behavior.

### Deliverables
- policy model + API
- policy evaluation function
- policy decision logs

### Exit criteria
- Policy updates are versioned and auditable.
- Unsupported network/asset rejected with clear errors.

---

## Sprint 4 — Merchant Treasury APIs

### Outcome
Merchant can access balances, settlements, and policy through stable APIs.

### Agent tasks
- Planner: finalize OpenAPI for balances/settlements/policy/payout trigger.
- Builder: implement read APIs over derived data.
- Builder: add cursor pagination and filtering.
- Verifier: contract tests against OpenAPI examples.
- Reviewer: enforce auth scope checks and PII-safe logging.

### Deliverables
- `/v1/merchant/{merchantId}/accounts/{accountId}/balances`
- `/v1/merchant/{merchantId}/accounts/{accountId}/settlements`
- `/v1/merchant/{merchantId}/accounts/{accountId}/policy`
- `/v1/merchant/{merchantId}/accounts/{accountId}/consolidations` (manual trigger)
- `/v1/merchant/{merchantId}/accounts/{accountId}/payouts` (manual trigger)

### Exit criteria
- APIs return lifecycle + failure reasons consistently.
- API examples and tests stay in sync.

---

## Sprint 5 — Gas Treasury + Ops Reliability

### Outcome
Operational gas abstraction and fee attribution are available.

### Agent tasks
- Planner: define gas health model and refill thresholds.
- Builder: implement gas balance monitors by network.
- Builder: implement refill workflow hooks and gas fee attribution.
- Verifier: simulate low-gas and route degradation scenarios.
- Reviewer: validate alarms + runbook completeness.

### Deliverables
- gas accounts tracker
- refill alerts/workflow
- per-merchant gas cost reporting

### Exit criteria
- Low-gas condition detected before settlement failures.
- Gas costs attributed per settlement/bridge event.

---

## 4) AI Agent PR Workflow Template

For every ticket/PR:

1. Planner agent creates `Implementation Plan` section:
   - assumptions
   - changed files
   - tests to add
2. Builder agent commits smallest possible slice.
3. Verifier agent runs:
   - unit tests
   - integration tests
   - replay/idempotency tests (if event-driven changes)
4. Reviewer agent blocks merge if:
   - missing invariants
   - no rollback notes for migration
   - missing metrics/logging

---

## 5) Prompt Contracts (Reusable)

## 5.1 Planner prompt skeleton

"Given `MERCHANT_TREASURY_TECH_SPEC.md`, break down `<ticket-id>` into exact code changes, DB migration steps, failure modes, and test cases. Output checklist + acceptance criteria."

## 5.2 Builder prompt skeleton

"Implement `<ticket-id>` exactly. Keep API contracts unchanged unless stated. Add tests for happy path + failure path + idempotency path."

## 5.3 Verifier prompt skeleton

"Run and report all relevant checks. Then create adversarial cases (duplicate event, out-of-order event, partial failure) and verify invariants."

## 5.4 Reviewer prompt skeleton

"Review for architecture drift, security risk, migration safety, and observability completeness. Provide block/approve decision with reason."

---

## 6) Governance & Safety Gates (Human-in-the-loop)

Require human approval for:
- Schema-breaking migrations
- New custody/private-key handling logic
- Policy engine behavior that impacts merchant funds routing
- Production rollout/rollback strategy

AI agents can propose; humans approve critical financial-risk decisions.

---

## 7) KPI-by-Sprint Validation

- Sprint 1: event delivery success rate, consumer retry success, lag P95.
- Sprint 2: ledger invariant pass rate, reconciliation drift.
- Sprint 3: policy evaluation correctness rate.
- Sprint 4: API correctness + latency P95.
- Sprint 5: gas incident rate and preemptive refill success rate.

---

## 8) First 10 AI Tickets (ready to run)

1. `AI-TREASURY-001`: Event envelope types + schema validation
2. `AI-TREASURY-002`: Outbox migration + repository
3. `AI-TREASURY-003`: Merchant users/accounts/wallets migrations
4. `AI-TREASURY-004`: Auth middleware + role scope enforcement
5. `AI-TREASURY-005`: Emit `payment.verified` / `payment.settled_source`
6. `AI-TREASURY-006`: Outbox relay worker + retries
7. `AI-TREASURY-007`: Ledger tables + invariant checker
8. `AI-TREASURY-008`: Balance projector + replay command
9. `AI-TREASURY-009`: Account-scoped balances/settlements/policy APIs
10. `AI-TREASURY-010`: Consolidation trigger API + gas monitor hooks

This sequence maps directly to the original technical spec while optimizing execution for AI-agent delivery.
