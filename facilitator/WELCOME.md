# Welcome to RailBridge Cross-Chain x402 Facilitator

Welcome! You've found the documentation for **RailBridge**, a cross-chain payment facilitator that extends the x402 protocol to enable seamless payments across different EVM blockchains.

## What is RailBridge?

RailBridge is a facilitator service that makes it possible for users to pay on one blockchain (like Base) while merchants receive funds on another (like Ethereum or Polygon). Built on top of Coinbase's x402 protocol, RailBridge handles all the complexity of cross-chain payments so that merchants and clients don't have to.

## Why RailBridge?

In today's multi-chain world, users often hold assets on different blockchains. Traditional payment systems require users to bridge tokens themselves, pay gas on multiple chains, and navigate complex DeFi protocols. RailBridge solves this by:

- **Seamless Cross-Chain Payments**: Users pay on their preferred chain, merchants receive on theirs
- **Client Transparency**: Clients don't need to know anything about cross-chain mechanics; they just pay
- **Merchant Control**: Merchants specify where they want to receive payments via simple configuration
- **Secure**: Built on battle-tested x402 protocol with Coinbase's security standards
- **Easy Integration**: Standard REST APIs that work with any x402-compatible client

## How It Works

RailBridge uses an **extension-based design** that is elegant and flexible:

1. **Merchants** define payment requirements with a `cross-chain` extension specifying the destination chain
2. **Clients** pay using the standard `exact` scheme; no cross-chain awareness needed
3. **RailBridge Facilitator** verifies the payment, settles on the source chain, and automatically bridges funds to the destination chain
4. **Merchants** receive funds on their preferred chain, all handled automatically

## What You'll Find Here

This documentation will guide you through:

- **Quickstart**: Get up and running in minutes
- **Architecture**: Understand how RailBridge works under the hood
- **Integration Guides**: Step-by-step instructions for merchants and clients
- **API Reference**: Complete facilitator endpoint documentation
- **Examples**: Working code examples you can copy and adapt

## Who Is This For?

- **Merchants** who want to accept payments on their preferred chain while allowing users to pay from any supported chain
- **Developers** building payment-enabled applications that need cross-chain flexibility
- **Integrators** looking to add x402 payment support with cross-chain capabilities

## Getting Started

Ready to dive in? Here's where to start:

1. **New to RailBridge?**: Start with the [Quickstart Guide](quickstart.md) to see it in action
2. **Building a merchant?**: Check out the [Merchant Integration Guide](merchant-integration.md)
3. **Building a client?**: See the [Client Integration Guide](client-integration.md)
4. **Want to understand the architecture?**: Read the [Architecture Overview](architecture.md)

## Key Concepts

Before diving in, it's helpful to understand a few key concepts:

- **x402 Protocol**: An open payment protocol for web3 that enables pay-per-use APIs and content
- **Facilitator**: A service that verifies and settles payments on-chain
- **Extension-Based Design**: Cross-chain is implemented as an extension to the base `exact` scheme, not a separate scheme
- **Source Chain**: Where the user pays (e.g., Base Sepolia)
- **Destination Chain**: Where the merchant receives (e.g., Ethereum Sepolia)

## Need Help?

- Check the [Common Issues](common-issues.md) section for troubleshooting
- Review the [API Reference](api-reference.md) for detailed endpoint documentation
- Explore the [Example Implementations](examples.md) to see working code

---

**Ready to get started?** Head over to the [Quickstart Guide](quickstart.md) and have RailBridge running in minutes!

