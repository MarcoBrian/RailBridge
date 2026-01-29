# Security Audit Report: bigint-buffer Vulnerability

Date: 2026-01-29  
Audience: Circle Engineering / Security  
Scope: Circle CCTP dependency chain surfaced by npm audit

## Executive Summary

`npm audit` flags a **High severity** vulnerability in `bigint-buffer` with **no fix available**.  
The issue is **transitive** and is pulled in via Circle’s CCTP packages, specifically:
**`@circle-fin/bridge-kit` → `@circle-fin/provider-cctp-v2`**. This report summarizes
impact and proposes **recommended actions for Circle** to remediate or contain the risk.

## Vulnerability Details

- **Advisory**: GHSA-3gc7-fjrx-p6mg  
- **Package**: `bigint-buffer`  
- **Severity**: High  
- **Issue**: Buffer overflow / out-of-bounds read in `toBigIntLE()` when handling malformed or oversized buffers.



### Root Cause
`bigint-buffer` does not sufficiently guard buffer bounds in `toBigIntLE()`.  
Crafted input can cause an out-of-bounds read (and potential crash/DoS).

## Dependency Chain (Circle CCTP)

```
@circle-fin/bridge-kit
  → @circle-fin/provider-cctp-v2
    → @solana/spl-token
      → @solana/buffer-layout-utils
        → bigint-buffer (vulnerable)
```

## Impact Analysis

### Direct Impact
- The vulnerable package is shipped in Circle’s distribution chain.
- Consumers see persistent audit failures and must accept risk or fork.

### Likely Runtime Exposure
- The vulnerable code path is used by **Solana SPL token** tooling.
- For EVM‑only CCTP flows, the path is **likely dormant** but still present in runtime images.
- This still constitutes a **supply-chain risk** and compliance concern for integrators.

## Current Status

- **No fix available** (per npm audit).
- Upstream packages have not yet released patched versions.

## Steps to Reproduce

1. Install Circle BridgeKit:
   ```bash
   npm install @circle-fin/bridge-kit
   ```
2. Run npm audit:
   ```bash
   npm audit
   ```
3. Observe the `bigint-buffer` advisory in the output, with the transitive chain:
   ```
   @circle-fin/bridge-kit
     → @circle-fin/provider-cctp-v2
       → @solana/spl-token
         → @solana/buffer-layout-utils
           → bigint-buffer (vulnerable)
   ```

## Recommended Actions for Circle

### Short Term
1. **Publish an advisory note** acknowledging the transitive vulnerability and its Solana‑only reachability.
2. **Track upstream fixes** in:
   - `@solana/buffer-layout-utils`
   - `@solana/spl-token`
   - `@circle-fin/provider-cctp-v2`
   - `@circle-fin/bridge-kit`
3. **Provide guidance** to integrators:
   - EVM‑only users can treat this as low operational risk but still a compliance flag.
   - Solana paths may be affected and should be evaluated.

### Medium Term
1. **Upgrade dependencies** as soon as patched versions are released.
2. **Pin/override** transitive dependencies to a patched fork if upstream is slow to release.

### Long Term
1. **Offer an EVM‑only BridgeKit build** (optional dependency split) to remove Solana SPL dependencies when unused.
2. **Harden dependency review** for cryptographic / buffer utilities in the Solana chain.

## Notes

- This is a **transitive dependency**; integrators do not call `bigint-buffer` directly.
- The risk is primarily in **Solana‑related paths**, but the vulnerable code is shipped to all users.
- Audit warnings will remain until upstream packages ship a fix.

## Exploitability Assessment (Response for BBP Triage)

**What is known with certainty:**  
- The vulnerable package (`bigint-buffer`) is **shipped transitively** through Circle’s CCTP dependency chain:
  `@circle-fin/bridge-kit` → `@circle-fin/provider-cctp-v2` → `@solana/spl-token` → `@solana/buffer-layout-utils`.

**Conditional exposure (unclear without internal visibility):**  
- The vulnerable code path is tied to **Solana SPL token parsing**.  
- I do **not** have evidence that Circle BBP services accept or parse **attacker‑controlled Solana buffers**.  
- If BBP does **not** expose Solana parsing to untrusted input, the practical exploit path may be non‑reachable.  
- If any BBP service **does** parse untrusted Solana buffers, that would be the likely exposure point.

**Supply‑chain / compliance risk (regardless of exploitability):**  
- The vulnerable code ships to all integrators, producing persistent audit failures.  
- This creates a compliance burden and a latent risk if Solana flows are enabled later or new services consume untrusted Solana data.

**Answers to triage questions:**  
- **Evidence of BBP services parsing untrusted Solana buffers:** None.  
- **Nature of report:** This is a **supply‑chain/compliance risk** report with conditional exploitability based on whether Solana parsing is exposed to untrusted input.


