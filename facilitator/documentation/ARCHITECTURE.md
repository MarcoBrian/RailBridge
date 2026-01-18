# RailBridge Cross-Chain Facilitator - Technical Architecture

This document provides detailed technical diagrams showing how components interact in the x402 payment flow.

## Table of Contents
1. [High-Level System Overview](#high-level-system-overview)
2. [Client-Server Interaction Flow](#client-server-interaction-flow)
3. [Server Internal Components](#server-internal-components)
4. [Facilitator Internal Components](#facilitator-internal-components)
5. [Payment Verification Flow](#payment-verification-flow)
6. [Payment Settlement Flow](#payment-settlement-flow)
7. [Cross-Chain Payment Flow](#cross-chain-payment-flow)
8. [Cross-Chain System Guide](#cross-chain-system-guide)

---

## Cross-Chain System Guide

For a complete guide to how the cross-chain payment system works, see [CROSS_CHAIN_SYSTEM.md](./CROSS_CHAIN_SYSTEM.md).

This document covers:
- Extension-based design principles
- Component roles and responsibilities
- Complete payment flow with examples
- Data flow diagrams
- Key files and their functions

---

## High-Level System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           x402 Payment Ecosystem                         │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────┐                    ┌──────────────┐                    ┌──────────────┐
│              │                    │              │                    │              │
│    CLIENT    │◄──────────────────►│   MERCHANT   │◄──────────────────►│ FACILITATOR  │
│              │    HTTP Requests    │    SERVER    │   HTTP API Calls   │              │
│              │    (402, 200)       │              │   (/verify, /settle)│              │
└──────────────┘                    └──────────────┘                    └──────────────┘
     │                                      │                                      │
     │                                      │                                      │
     │ 1. Request Resource                  │                                      │
     │    GET /api/premium                  │                                      │
     │                                      │                                      │
     │ 2. 402 Payment Required              │                                      │
     │    { accepts: [...], extensions }    │                                      │
     │                                      │                                      │
     │ 3. Create & Sign Payment             │                                      │
     │    PaymentPayload                    │                                      │
     │                                      │                                      │
     │ 4. Retry with X-PAYMENT header       │                                      │
     │    GET /api/premium                  │                                      │
     │    Headers: { X-PAYMENT: "..." }     │                                      │
     │                                      │                                      │
     │                                      │ 5. Verify Payment                     │
     │                                      │    POST /verify                       │
     │                                      │    { PaymentPayload, Requirements }   │
     │                                      │                                      │
     │                                      │ 6. Verify Response                    │
     │                                      │    { isValid: true, payer: "0x..." } │
     │                                      │                                      │
     │                                      │ 7. Process Request                    │
     │                                      │    Execute business logic             │
     │                                      │                                      │
     │                                      │ 8. Settle Payment                     │
     │                                      │    POST /settle                       │
     │                                      │                                      │
     │                                      │ 9. Settlement Response                │
     │                                      │    { success: true, tx: "0x..." }     │
     │                                      │                                      │
     │ 10. 200 OK + Resource Data          │                                      │
     │     { data: "premium-content" }      │                                      │
     │                                      │                                      │
```

---

## Client-Server Interaction Flow

### Detailed HTTP Request/Response Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT SIDE                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│  x402Client      │
│  - Wallet        │
│  - Signer        │
└────────┬─────────┘
         │
         │ 1. wrapFetchWithPayment(fetch, client)
         │
         ▼
┌─────────────────┐
│  HTTP Request    │
│  GET /api/premium│
│  (no headers)    │
└────────┬─────────┘
         │
         │ HTTP
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MERCHANT SERVER                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│ Express App     │
│ app.use(...)    │
└────────┬────────┘
         │
         │ 2. Request intercepted
         ▼
┌─────────────────┐
│ paymentMiddleware│
│ (Express)       │
└────────┬────────┘
         │
         │ 3. Create ExpressAdapter(req)
         │    Extract headers, path, method
         ▼
┌─────────────────┐
│ HTTPRequestContext│
│ { adapter, path,│
│   method,       │
│   paymentHeader }│
└────────┬────────┘
         │
         │ 4. processHTTPRequest(context)
         ▼
┌─────────────────┐
│x402HTTPResource │
│Server           │
└────────┬────────┘
         │
         │ 5. Check if payment required
         │    getRouteConfig(path, method)
         │
         │ 6. Extract payment header
         │    extractPayment(adapter)
         │
         │ 7. Build PaymentRequirements
         │    buildPaymentRequirementsFromOptions()
         │
         │ 8. If no payment → Return 402
         │    createPaymentRequiredResponse()
         │
         │ 9. If payment exists → Verify
         │    verifyPayment(payload, requirements)
         ▼
┌─────────────────┐
│ x402ResourceServer│
│ (Core Protocol) │
└────────┬─────────┘
         │
         │ 10. Call facilitator /verify
         │     facilitatorClient.verify()
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FACILITATOR SERVER                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│ Express Server  │
│ POST /verify    │
└────────┬────────┘
         │
         │ 11. Request handler
         ▼
┌─────────────────┐
│ x402Facilitator │
│ .verify()       │
└────────┬────────┘
         │
         │ 12. Find matching scheme
         │     facilitator.getScheme(network, scheme)
         │
         │ 13. Delegate to scheme
         │     scheme.verify(payload, requirements)
         ▼
┌─────────────────┐
│ ExactEvmScheme  │
│ or               │
│ CrossChainRouter │
│ (routing wrapper)│
│ .verify()        │
└────────┬────────┘
         │
         │ 14. Verify signature, balance, etc.
         │     Return { isValid: true/false }
         │
         │ 15. Response back to merchant
         │     { isValid: true, payer: "0x..." }
         │
         │ HTTP Response
         ▼
┌─────────────────┐
│ Merchant Server  │
│ (continues...)   │
└────────┬─────────┘
         │
         │ 16. If valid → Proceed to route handler
         │     next() → app.get("/api/premium", ...)
         │
         │ 17. After handler completes → Settle
         │     processSettlement(payload, requirements)
         │
         │ 18. Call facilitator /settle
         │     facilitatorClient.settle()
         │
         │ HTTP Request
         ▼
┌─────────────────┐
│ Facilitator     │
│ POST /settle    │
└────────┬────────┘
         │
         │ 19. facilitator.settle()
         │
         │ 20. scheme.settle()
         │     Execute blockchain transaction
         │
         │ 21. Return settlement result
         │     { success: true, transaction: "0x..." }
         │
         │ HTTP Response
         ▼
┌─────────────────┐
│ Merchant Server  │
│ (final response) │
└────────┬─────────┘
         │
         │ 22. Send 200 OK to client
         │     res.json({ data: "..." })
         │
         │ HTTP Response
         ▼
┌─────────────────┐
│ Client           │
│ Receives data   │
└─────────────────┘
```

---

## Server Internal Components

### Merchant Server Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MERCHANT SERVER STACK                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Express Application                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────┐                        │
│  │  Express App      │         │  Route Handlers  │                        │
│  │  const app = ...  │────────►│  app.get("/api/  │                        │
│  │                    │         │   premium", ...) │                        │
│  └──────────────────┘         └──────────────────┘                        │
│           │                                                               │
│           │ app.use(paymentMiddleware(...))                               │
│           ▼                                                               │
│  ┌──────────────────┐                                                    │
│  │ paymentMiddleware │                                                    │
│  │ (@x402/express)  │                                                    │
│  │                   │                                                    │
│  │ - Intercepts req  │                                                    │
│  │ - Creates adapter │                                                    │
│  │ - Calls httpServer│                                                    │
│  │ - Handles response│                                                    │
│  └─────────┬─────────┘                                                    │
│            │                                                              │
└────────────┼────────────────────────────────────────────────────────────┘
             │
             │ Creates ExpressAdapter(req)
             │ Creates HTTPRequestContext
             │
┌────────────┼─────────────────────────────────────────────────────────────┐
│ Layer 2: HTTP Resource Server                                             │
├────────────┼─────────────────────────────────────────────────────────────┤
│            │                                                               │
│            ▼                                                               │
│  ┌──────────────────┐                                                    │
│  │x402HTTPResource   │                                                    │
│  │Server             │                                                    │
│  │                   │                                                    │
│  │ - Route matching  │                                                    │
│  │ - HTTP header     │                                                    │
│  │   extraction      │                                                    │
│  │ - HTTP response   │                                                    │
│  │   creation         │                                                    │
│  │ - Paywall HTML    │                                                    │
│  │                   │                                                    │
│  │ Uses:             │                                                    │
│  │ - HTTPAdapter     │                                                    │
│  │ - RoutesConfig    │                                                    │
│  └─────────┬─────────┘                                                    │
│            │                                                              │
│            │ Delegates to ResourceServer                                  │
│            │                                                              │
└────────────┼────────────────────────────────────────────────────────────┘
             │
             │ Calls ResourceServer methods:
             │ - buildPaymentRequirementsFromOptions()
             │ - verifyPayment()
             │ - findMatchingRequirements()
             │
┌────────────┼─────────────────────────────────────────────────────────────┐
│ Layer 3: Core Resource Server (Protocol Logic)                            │
├────────────┼─────────────────────────────────────────────────────────────┤
│            │                                                               │
│            ▼                                                               │
│  ┌──────────────────┐                                                    │
│  │ x402ResourceServer│                                                    │
│  │ (@x402/core)     │                                                    │
│  │                   │                                                    │
│  │ - Payment         │                                                    │
│  │   requirement     │                                                    │
│  │   building        │                                                    │
│  │ - Payment          │                                                    │
│  │   verification     │                                                    │
│  │   (via facilitator)│                                                   │
│  │ - Extension        │                                                    │
│  │   management       │                                                    │
│  │ - Scheme           │                                                    │
│  │   registration     │                                                    │
│  │                   │                                                    │
│  │ Registered:        │                                                    │
│  │ - ExactEvmScheme   │                                                    │
│  │   (server-side)    │                                                    │
│  └─────────┬─────────┘                                                    │
│            │                                                              │
│            │ Uses FacilitatorClient                                        │
│            │                                                              │
└────────────┼────────────────────────────────────────────────────────────┘
             │
             │ HTTP requests to facilitator
             │
┌────────────┼─────────────────────────────────────────────────────────────┐
│ Layer 4: Facilitator Client                                               │
├────────────┼─────────────────────────────────────────────────────────────┤
│            │                                                               │
│            ▼                                                               │
│  ┌──────────────────┐                                                    │
│  │HTTPFacilitator    │                                                    │
│  │Client             │                                                    │
│  │                   │                                                    │
│  │ - POST /verify    │                                                    │
│  │ - POST /settle    │                                                    │
│  │ - GET /supported  │                                                    │
│  └─────────┬─────────┘                                                    │
│            │                                                              │
│            │ HTTP requests                                                 │
│            │                                                              │
└────────────┴─────────────────────────────────────────────────────────────┘
             │
             │ HTTP
             ▼
      ┌──────────────┐
      │  Facilitator │
      │  Server      │
      └──────────────┘
```

---

## Facilitator Internal Components

### Facilitator Server Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FACILITATOR SERVER STACK                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Express HTTP Server                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐                                                    │
│  │ Express App       │                                                    │
│  │ const app = ...  │                                                    │
│  │                   │                                                    │
│  │ Routes:           │                                                    │
│  │ - POST /verify    │                                                    │
│  │ - POST /settle    │                                                    │
│  │ - GET /supported  │                                                    │
│  │ - GET /health     │                                                    │
│  └─────────┬─────────┘                                                    │
│            │                                                              │
│            │ Request handlers                                             │
│            │                                                              │
└────────────┼────────────────────────────────────────────────────────────┘
             │
             │ Calls facilitator methods
             │
┌────────────┼─────────────────────────────────────────────────────────────┐
│ Layer 2: x402 Facilitator (Orchestrator)                                   │
├────────────┼─────────────────────────────────────────────────────────────┤
│            │                                                               │
│            ▼                                                               │
│  ┌──────────────────┐                                                    │
│  │ x402Facilitator  │                                                    │
│  │ (@x402/core)      │                                                    │
│  │                   │                                                    │
│  │ Responsibilities: │                                                    │
│  │ - Scheme          │                                                    │
│  │   registration    │                                                    │
│  │ - Route requests  │                                                    │
│  │   to schemes      │                                                    │
│  │ - Lifecycle hooks │                                                    │
│  │ - Extension       │                                                    │
│  │   management      │                                                    │
│  │                   │                                                    │
│  │ Registered Schemes:│                                                   │
│  │ - "exact:eip155:*"│                                                    │
│  │   → ExactEvmScheme│                                                   │
│  │ - "cross-chain:*" │                                                    │
│  │   → CrossChainRouter│                                                  │
│  │   (routing wrapper around ExactEvmScheme)│                            │
│  └─────────┬─────────┘                                                    │
│            │                                                              │
│            │ Delegates to registered schemes                               │
│            │                                                              │
└────────────┼────────────────────────────────────────────────────────────┘
             │
             │ Calls scheme.verify() or scheme.settle()
             │
┌────────────┼─────────────────────────────────────────────────────────────┐
│ Layer 3: Payment Schemes                                                  │
├────────────┼─────────────────────────────────────────────────────────────┤
│            │                                                               │
│            ├──────────────────┬──────────────────┐                        │
│            │                  │                  │                        │
│            ▼                  ▼                  ▼                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                     │
│  │ExactEvmScheme│  │CrossChain   │  │Other Schemes│                     │
│  │              │  │Router        │  │              │                     │
│  │ - verify()   │  │(routing      │  │              │                     │
│  │ - settle()   │  │ wrapper)     │  │              │                     │
│  │ - getSigners │  │              │  │              │                     │
│  │              │  │ - verify()   │  │              │                     │
│  │ Uses:        │  │   → delegates│  │              │                     │
│  │ - EVM signer │  │   to ExactEvm│  │              │                     │
│  │ - Viem client│  │ - settle()   │  │              │                     │
│  └──────┬───────┘  │   → delegates│  └──────────────┘                     │
│         │          │   to ExactEvm│                                      │
│         │          │   then bridges│                                      │
│         │          │ - Uses       │                                      │
│         │          │   ExactEvm   │                                      │
│         │          │   Scheme     │                                      │
│         │          │   internally │                                      │
│         │          │ - Bridge     │                                      │
│         │          │   Service    │                                      │
│         │          └──────┬───────┘                                      │
│         │                 │                                              │
│         │                 │ Delegates to ExactEvmScheme                  │
│         │                 │ Uses BridgeService for bridging              │
│         │                 │                                              │
└─────────┼─────────────────┼──────────────────────────────────────────────┘
          │                 │
          │                 │
┌─────────┼─────────────────┼──────────────────────────────────────────────┐
│ Layer 4: External Services                                                 │
├─────────┼─────────────────┼──────────────────────────────────────────────┤
│          │                 │                                              │
│          ▼                 ▼                                              │
│  ┌──────────────┐  ┌──────────────┐                                       │
│  │ Blockchain   │  │ Bridge       │                                       │
│  │ (via Viem)   │  │ Service      │                                       │
│  │              │  │              │                                       │
│  │ - Read       │  │ - checkLiquidity│                                   │
│  │   contracts  │  │ - bridge()   │                                       │
│  │ - Write      │  │ - waitForConf│                                       │
│  │   transactions│ │              │                                       │
│  │ - Verify     │  │              │                                       │
│  │   signatures │  │              │                                       │
│  └──────────────┘  └──────────────┘                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Payment Verification Flow

### Detailed Verification Sequence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PAYMENT VERIFICATION FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

Client                    Merchant Server              Facilitator Server
  │                              │                            │
  │ 1. GET /api/premium          │                            │
  │─────────────────────────────►│                            │
  │                              │                            │
  │                              │ 2. paymentMiddleware       │
  │                              │    intercepts request      │
  │                              │                            │
  │                              │ 3. processHTTPRequest()    │
  │                              │    - No payment header     │
  │                              │    - Return 402            │
  │                              │                            │
  │ 4. 402 Payment Required      │                            │
  │    { accepts: [...],         │                            │
  │      extensions: {...} }     │                            │
  │◄─────────────────────────────│                            │
  │                              │                            │
  │ 5. Create PaymentPayload    │                            │
  │    - Select requirements     │                            │
  │    - Sign with wallet        │                            │
  │    - Build payload           │                            │
  │                              │                            │
  │ 6. GET /api/premium          │                            │
  │    Headers:                  │                            │
  │    X-PAYMENT: "base64..."    │                            │
  │─────────────────────────────►│                            │
  │                              │                            │
  │                              │ 7. processHTTPRequest()   │
  │                              │    - Extract payment       │
  │                              │    - Find matching reqs    │
  │                              │                            │
  │                              │ 8. verifyPayment()         │
  │                              │    Calls facilitator       │
  │                              │                            │
  │                              │ 9. POST /verify            │
  │                              │    {                      │
  │                              │      payload: {...},      │
  │                              │      requirements: {...}   │
  │                              │    }                      │
  │                              │──────────────────────────►│
  │                              │                            │
  │                              │                            │ 10. facilitator.verify()
  │                              │                            │     - Find scheme
  │                              │                            │     - Call scheme.verify()
  │                              │                            │
  │                              │                            │ 11. scheme.verify()
  │                              │                            │     - Verify signature
  │                              │                            │     - Check balance
  │                              │                            │     - Validate amount
  │                              │                            │
  │                              │                            │ 12. Return result
  │                              │                            │     { isValid: true,
  │                              │                            │       payer: "0x..." }
  │                              │                            │
  │                              │ 13. { isValid: true,       │
  │                              │      payer: "0x..." }      │
  │                              │◄───────────────────────────│
  │                              │                            │
  │                              │ 14. Payment verified        │
  │                              │     Proceed to handler     │
  │                              │                            │
```

---

## Payment Settlement Flow

### Detailed Settlement Sequence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PAYMENT SETTLEMENT FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Client                    Merchant Server              Facilitator Server
  │                              │                            │
  │                              │ 1. Route handler executes  │
  │                              │    app.get("/api/premium") │
  │                              │    - Business logic        │
  │                              │    - res.json({...})       │
  │                              │                            │
  │                              │ 2. Handler completes        │
  │                              │    res.end() called         │
  │                              │                            │
  │                              │ 3. Intercept response       │
  │                              │    - Buffer response       │
  │                              │    - Check status code     │
  │                              │    - If < 400, settle      │
  │                              │                            │
  │                              │ 4. processSettlement()     │
  │                              │    Calls facilitator       │
  │                              │                            │
  │                              │ 5. POST /settle            │
  │                              │    {                      │
  │                              │      payload: {...},      │
  │                              │      requirements: {...}   │
  │                              │    }                      │
  │                              │──────────────────────────►│
  │                              │                            │
  │                              │                            │ 6. facilitator.settle()
  │                              │                            │     - Find scheme
  │                              │                            │     - Call scheme.settle()
  │                              │                            │
  │                              │                            │ 7. scheme.settle()
  │                              │                            │     - Re-verify payment
  │                              │                            │     - Deploy wallet (if needed)
  │                              │                            │     - Execute transferWithAuthorization
  │                              │                            │     - Wait for confirmation
  │                              │                            │
│                              │                            │ 8. For CrossChainRouter:
│                              │                            │     - Delegates to ExactEvmScheme
│                              │                            │       on source chain
│                              │                            │     - Bridge funds to destination
│                              │                            │     - Merchant receives on dest chain
  │                              │                            │
  │                              │                            │ 9. Return result
  │                              │                            │     { success: true,
  │                              │                            │       transaction: "0x...",
  │                              │                            │       network: "eip155:8453" }
  │                              │                            │
  │                              │ 10. { success: true,       │
  │                              │      transaction: "0x..." } │
  │                              │◄───────────────────────────│
  │                              │                            │
  │                              │ 11. Add settlement headers │
  │                              │     X-PAYMENT-SETTLED: ...   │
  │                              │                            │
  │                              │ 12. Send buffered response │
  │                              │                            │
  │ 13. 200 OK                  │                            │
  │     Headers:                 │                            │
  │     X-PAYMENT-SETTLED: ...   │                            │
  │     Body: { data: "..." }   │                            │
  │◄─────────────────────────────│                            │
  │                              │                            │
```

---

## Cross-Chain Payment Flow

### Cross-Chain Scheme Specific Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CROSS-CHAIN PAYMENT FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐                    ┌──────────────┐                    ┌──────────────┐
│   CLIENT     │                    │   MERCHANT   │                    │ FACILITATOR  │
│              │                    │    SERVER    │                    │              │
└──────┬───────┘                    └──────┬───────┘                    └──────┬───────┘
       │                                    │                                    │
       │ 1. Request with cross-chain       │                                    │
       │    extension in PaymentRequired   │                                    │
       │                                    │                                    │
       │ 2. Create PaymentPayload          │                                    │
       │    - Copy cross-chain extension   │                                    │
       │    - Sign for source chain         │                                    │
       │                                    │                                    │
       │ 3. POST with X-PAYMENT             │                                    │
       │───────────────────────────────────►│                                    │
       │                                    │                                    │
       │                                    │ 4. Verify Payment                  │
       │                                    │───────────────────────────────────►│
       │                                    │                                    │
       │                                    │                                    │ 5. CrossChainRouter.verify()
       │                                    │                                    │     - Extract cross-chain info
       │                                    │                                    │     - Create source chain reqs
       │                                    │                                    │     - Delegate to ExactEvmScheme
       │                                    │                                    │       on source chain
       │                                    │                                    │     (Bridge liquidity checked
       │                                    │                                    │      in onBeforeVerify hook)
       │                                    │                                    │
       │                                    │                                    │ 6. { isValid: true }
       │                                    │                                    │
       │                                    │ 7. { isValid: true }               │
       │                                    │◄───────────────────────────────────│
       │                                    │                                    │
       │                                    │ 8. Process request                  │
       │                                    │                                    │
       │                                    │ 9. Settle Payment                  │
       │                                    │───────────────────────────────────►│
       │                                    │                                    │
       │                                    │                                    │ 10. CrossChainRouter.settle()
       │                                    │                                    │      - Create source chain reqs
       │                                    │                                    │      - Delegate to ExactEvmScheme
       │                                    │                                    │        (settle on source chain
       │                                    │                                    │         to bridge lock address)
       │                                    │                                    │      - Bridge funds via BridgeService
       │                                    │                                    │      - Merchant receives on
       │                                    │                                    │        destination chain
       │                                    │                                    │
       │                                    │                                    │ 11. { success: true,
       │                                    │                                    │      transaction: "0x...",
       │                                    │                                    │      network: "eip155:137" }
       │                                    │                                    │
       │                                    │ 12. { success: true }               │
       │                                    │◄───────────────────────────────────│
       │                                    │                                    │
       │ 13. 200 OK                         │                                    │
       │◄───────────────────────────────────│                                    │
       │                                    │                                    │

┌─────────────────────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN TRANSACTIONS                                 │
└─────────────────────────────────────────────────────────────────────────────┘

Source Chain (Base)                    Bridge                      Dest Chain (Polygon)
  │                                        │                              │
  │ 1. transferWithAuthorization           │                              │
  │    from: user                         │                              │
  │    to: bridge lock address             │                              │
  │    amount: 10000 USDC                  │                              │
  │───────────────────────────────────────►│                              │
  │                                        │                              │
  │                                        │ 2. Bridge locks funds        │
  │                                        │    - Validates transaction   │
  │                                        │    - Locks in contract       │
  │                                        │                              │
  │                                        │ 3. Bridge mints/releases     │
  │                                        │    on destination            │
  │                                        │──────────────────────────────►│
  │                                        │                              │
  │                                        │                              │ 4. Funds arrive
  │                                        │                              │    to: merchant
  │                                        │                              │    amount: 10000 USDC
  │                                        │                              │
```

---

## Component Interaction Matrix

### Who Calls Whom

| From Component | To Component | Method/Endpoint | Purpose |
|---------------|-------------|-----------------|---------|
| **Client** | Merchant Server | `GET /api/premium` | Request resource |
| **Client** | Merchant Server | `GET /api/premium` (with `X-PAYMENT`) | Retry with payment |
| **Merchant Server** | Facilitator | `POST /verify` | Verify payment signature |
| **Merchant Server** | Facilitator | `POST /settle` | Settle payment on blockchain |
| **Merchant Server** | Facilitator | `GET /supported` | Get supported schemes/networks |
| **paymentMiddleware** | x402HTTPResourceServer | `processHTTPRequest()` | Process payment check |
| **x402HTTPResourceServer** | x402ResourceServer | `buildPaymentRequirementsFromOptions()` | Build payment requirements |
| **x402HTTPResourceServer** | x402ResourceServer | `verifyPayment()` | Verify payment |
| **x402HTTPResourceServer** | x402ResourceServer | `findMatchingRequirements()` | Match payload to requirements |
| **x402ResourceServer** | HTTPFacilitatorClient | `verify()` | Call facilitator verify API |
| **x402ResourceServer** | HTTPFacilitatorClient | `settle()` | Call facilitator settle API |
| **x402Facilitator** | Scheme (e.g., ExactEvmScheme) | `verify()` | Delegate verification to scheme |
| **x402Facilitator** | Scheme (e.g., CrossChainRouter) | `settle()` | Delegate settlement to scheme |
| **x402Facilitator** | Hook (onBeforeVerify) | `checkLiquidity()` | Check bridge liquidity (via hook) |
| **CrossChainRouter** | ExactEvmScheme | `verify()` | Delegate verification to exact scheme on source chain |
| **CrossChainRouter** | ExactEvmScheme | `settle()` | Delegate settlement to exact scheme on source chain |
| **CrossChainRouter** | BridgeService | `bridge()` | Execute bridge transaction after settlement |
| **ExactEvmScheme** | Blockchain (via Viem) | `readContract()` | Read token balance |
| **ExactEvmScheme** | Blockchain (via Viem) | `writeContract()` | Execute transferWithAuthorization |

---

## Data Flow Diagrams

### PaymentPayload Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PAYMENTPAYLOAD FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

1. Merchant Server creates PaymentRequired
   ┌─────────────────────────────────────┐
   │ PaymentRequired                     │
   │ {                                   │
   │   accepts: [                       │
   │     { scheme: "cross-chain",       │
   │       network: "eip155:137",       │
   │       asset: "0x...",              │
   │       amount: "10000",              │
   │       payTo: "0xmerchant..." }     │
   │   ],                                │
   │   extensions: {                    │
   │     "cross-chain": {               │
   │       info: {                      │
   │         sourceNetwork: "eip155:8453",│
   │         sourceAsset: "0x..."       │
   │       }                             │
   │     }                               │
   │   }                                 │
   │ }                                   │
   └─────────────────────────────────────┘
                    │
                    │ HTTP 402 Response
                    ▼
2. Client receives PaymentRequired
   ┌─────────────────────────────────────┐
   │ Client parses PaymentRequired       │
   │ - Selects payment option            │
   │ - Copies extensions to payload      │
   └─────────────────────────────────────┘
                    │
                    │ Creates PaymentPayload
                    ▼
3. Client creates PaymentPayload
   ┌─────────────────────────────────────┐
   │ PaymentPayload                      │
   │ {                                   │
   │   x402Version: "2",                 │
   │   scheme: "cross-chain",           │
   │   network: "eip155:137",           │
   │   payload: {                       │
   │     amount: "10000",                │
   │     asset: "0x...",                 │
   │     payTo: "0xmerchant...",         │
   │     signature: "0x...",            │
   │     authorization: {...}            │
   │   },                                │
   │   extensions: {                     │
   │     "cross-chain": {               │
   │       info: {                      │
   │         sourceNetwork: "eip155:8453",│
   │         sourceAsset: "0x..."        │
   │       }                             │
   │     }                               │
   │   }                                 │
   │ }                                   │
   └─────────────────────────────────────┘
                    │
                    │ Base64 encode
                    │ HTTP Header: X-PAYMENT
                    ▼
4. Merchant Server extracts PaymentPayload
   ┌─────────────────────────────────────┐
   │ adapter.getHeader("x-payment")     │
   │ → Base64 decode                    │
   │ → JSON parse                       │
   │ → PaymentPayload                   │
   └─────────────────────────────────────┘
                    │
                    │ HTTP POST /verify
                    ▼
5. Facilitator receives PaymentPayload
   ┌─────────────────────────────────────┐
   │ CrossChainRouter.verify()           │
   │ - extractCrossChainInfo(payload)   │
   │ - Gets sourceNetwork, sourceAsset  │
   │ - Creates source chain requirements│
   │ - Delegates to ExactEvmScheme      │
   │   .verify() on source chain         │
   └─────────────────────────────────────┘
```

---

## Summary

### Key Takeaways

1. **Three Main Actors**: Client, Merchant Server, Facilitator
2. **Layered Architecture**: Express → HTTP Server → Core Server → Facilitator Client
3. **Scheme-Based Design**: Facilitator routes to specific schemes (ExactEvmScheme, CrossChainRouter)
4. **Routing Wrapper Pattern**: CrossChainRouter is a thin wrapper that delegates to ExactEvmScheme for source chain operations, then bridges funds
5. **Lifecycle Hooks**: Bridge liquidity checks performed in `onBeforeVerify` hooks
6. **Adapter Pattern**: Framework-agnostic HTTP handling via adapters
7. **Extension System**: Extensions flow from PaymentRequired → PaymentPayload → Facilitator
8. **Two-Phase Flow**: Verify (check signature) → Settle (execute transaction)

### Communication Patterns

- **Client ↔ Merchant**: HTTP requests with `X-PAYMENT` header
- **Merchant ↔ Facilitator**: HTTP API calls (`/verify`, `/settle`)
- **Facilitator ↔ Blockchain**: RPC calls via Viem
- **Cross-Chain**: CrossChainRouter delegates to ExactEvmScheme on source chain, then bridges via BridgeService

### Cross-Chain Architecture Notes

**Key Design Decision**: Cross-chain uses an **extension-based design**, not a scheme-based design. This means:

- **Any scheme can be cross-chain**: `scheme: "exact"` + `extensions: {cross-chain}` = cross-chain exact payment
- **Client-agnostic**: Clients never see cross-chain complexity - they only see base scheme on source network
- **Server-side transformation**: Merchant server transforms destination → source before sending to clients
- **Facilitator routing**: Facilitator detects cross-chain by extension, routes to `CrossChainRouter`

**Flow**:
1. **Merchant** defines: `scheme: "exact"`, `network: destination`, `extensions: {cross-chain: {sourceNetwork}}`
2. **Server** transforms: `scheme: "exact"`, `network: source` (keeps scheme, changes network)
3. **Client** sees: Normal "exact" payment on source network
4. **Client** pays: On source chain (unaware of cross-chain)
5. **Facilitator** detects: Extension in payload → routes to `CrossChainRouter`
6. **CrossChainRouter**: Creates source requirements → Delegates to `ExactEvmScheme` → Bridges funds

**Benefits**:
- ✅ Scheme-agnostic (works with exact, bazaar, subscription, etc.)
- ✅ Client simplicity (no cross-chain awareness needed)
- ✅ Clear separation (scheme = payment mechanism, extension = routing mechanism)
- ✅ Extensible (easy to add cross-chain to new schemes)

This architecture provides:
- ✅ Separation of concerns
- ✅ Framework independence
- ✅ Extensibility (new schemes, extensions)
- ✅ Testability (mockable interfaces)
- ✅ Scalability (stateless servers)

