"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import "./globals.css";

// Simple Chain Badge (text-based so you can swap easily)
function ChainBadge({ label }: { label: string }) {
  return (
    <div className="px-3 py-1 rounded-full border border-black/30 bg-black/5 backdrop-blur text-xs text-black/90 shadow-sm">
      {label}
    </div>
  );
}

// Horizontal sliding row of chain logos
function SlidingRow({
  items,
  direction = "left",
  duration = 20,
  gap = 80,
}: {
  items: Array<{ src: string; alt: string }>;
  direction?: "left" | "right";
  duration?: number;
  gap?: number;
}) {
  // Duplicate items for seamless loop
  const duplicatedItems = [...items, ...items];
  const itemWidth = 60; // width of each logo container
  const totalWidth = items.length * (itemWidth + gap);

  return (
    <div className="relative overflow-hidden w-full h-16">
      <motion.div
        style={{
          display: "flex",
          alignItems: "center",
          gap: gap,
          position: "absolute",
          width: totalWidth * 2,
        }}
        animate={{
          x: direction === "left" ? [-totalWidth, 0] : [0, -totalWidth],
        }}
        transition={{
          repeat: Infinity,
          ease: "linear",
          duration,
        }}
      >
        {duplicatedItems.map((item, idx) => (
          <div
            key={idx}
            className="flex-shrink-0 flex items-center justify-center"
            style={{ width: itemWidth }}
          >
            <div className="size-14 rounded-full border border-black/20 bg-black/5 backdrop-blur flex items-center justify-center shadow-sm">
              <img
                src={item.src}
                alt={item.alt}
                className="w-8 h-8 object-contain"
                draggable={false}
              />
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

function ChainSlides() {
  const chains = [
    { src: "/base.png", alt: "Base" },
    { src: "/arbitrum.svg", alt: "Arbitrum" },
    { src: "/optimism.svg", alt: "Optimism" },
    { src: "/polygon.svg", alt: "Polygon" },
    { src: "/ethereum.svg", alt: "Ethereum" },
    { src: "/polkadot.svg", alt: "Polkadot" },
    { src: "/bsc.svg", alt: "BSC" },
    { src: "/avax.png", alt: "Avalanche" },
    { src: "/hype.png", alt: "Hyperbridge" },
    { src: "/solana.png", alt: "Solana" },
    { src: "/tron-trx-logo.png", alt: "Tron" },
    { src: "/gnosis.jpg", alt: "Gnosis" },
    { src: "/sonic.png", alt: "Sonic" },
    { src: "/story.png", alt: "Story" },
    { src: "/monad.png", alt: "Monad" },
  ];

  return (
    <div className="relative w-full max-w-5xl mx-auto py-12">
      {/* Sliding rows */}
      <div className="relative space-y-8">
        {/* Row 1 - Left */}
        <SlidingRow
          items={chains.slice(0, 5)}
          direction="left"
          duration={25}
        />
        
        {/* Row 2 - Right */}
        <SlidingRow
          items={chains.slice(5, 10)}
          direction="right"
          duration={30}
        />
        
        {/* Row 3 - Left (faster) */}
        <SlidingRow
          items={chains.slice(10, 15)}
          direction="left"
          duration={20}
        />
      </div>
    </div>
  );
}

function Section({ id, title, subtitle, children }: any) {
  return (
    <section id={id} className="relative py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="mb-8">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-black">{title}</h2>
          {subtitle && (
            <p className="mt-3 text-black/70 max-w-3xl">{subtitle}</p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

export default function Page() {
  useEffect(() => {
    document.body.classList.add("bg-white");
    return () => document.body.classList.remove("bg-white");
  }, []);

  return (
    <div className="min-h-screen text-black selection:bg-black/20 selection:text-black">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-black/20 backdrop-blur bg-white/80">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/RailBridge-Logo.png" alt="RailBridge AI" className="w-10 h-10 rounded-sm object-contain" draggable={false} />
            <span className="font-bold tracking-tight">RailBridge AI</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-sm text-black/70">
            <a href="#problem" className="hover:text-black">Problem</a>
            <a href="#solution" className="hover:text-black">Solution</a>
            <a href="#how" className="hover:text-black">How it Works</a>
            <a href="#ecosystem" className="hover:text-black">Ecosystem</a>
            <a href="#docs" className="px-3 py-1.5 rounded-md bg-black/10 border border-black/30 hover:bg-black/20 text-black">Docs</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden min-h-[600px] sm:min-h-[650px]">
        {/* Background gradient */}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(0,0,0,0.03),transparent_40%),radial-gradient(ellipse_at_bottom,rgba(0,0,0,0.02),transparent_45%)]" />

        <div className="max-w-6xl mx-auto px-6 pt-16 pb-28 sm:pt-24 sm:pb-36 md:pb-32">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-black/30 bg-black/5 mb-4">
                <span className="size-1.5 rounded-full bg-black" />
                Interoperability for x402
              </div>
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-semibold leading-tight">
                The <span className="text-black">Interoperability</span> Layer for x402
              </h1>
              <p className="mt-5 text-black/70 max-w-xl">
                Enable truly cross-chain micropayments so users and agents can pay with any token, on any chain,
                while services receive seamlessly where they are.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a href="#docs" className="px-4 py-2.5 rounded-xl bg-black hover:bg-black/90 text-white font-medium">Read Whitepaper</a>
                <a href="#join" className="px-4 py-2.5 rounded-xl border border-black/30 hover:bg-black/10">Join Testnet</a>
              </div>
            </div>

            <div className="flex justify-center mt-8 sm:mt-0">
              <ChainSlides />
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <Section
        id="problem"
        title="The Multi‑Chain Payment Problem"
        subtitle="Payments are siloed within single chains. Even with x402 enabling agentic micropayments, there is no seamless, trustless way to pay on one chain and settle on another."
      >
        <div className="grid md:grid-cols-3 gap-6">
          {[{
            h: "Fragmentation",
            p: "Each chain has its own tokens, liquidity, and tooling, forcing users to stay within one ecosystem.",
          },{
            h: "Manual Workarounds",
            p: "Developers build custom bridges or use custodial relays to move value across chains — slow, costly, risky.",
          },{
            h: "Stalled Agentic UX",
            p: "AI agents can initiate payments, but not seamlessly across networks; cross‑chain subscriptions and pay‑per‑use remain clunky.",
          }].map((card, i) => (
            <div key={i} className="rounded-2xl border border-black/20 bg-black/[0.02] p-5">
              <h3 className="text-lg font-medium text-black">{card.h}</h3>
              <p className="mt-2 text-sm text-black/70">{card.p}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Solution */}
      <Section
        id="solution"
        title="RailBridge AI Bridges Every Chain"
        subtitle="A non‑custodial, programmable routing layer on top of x402 that handles cross‑chain conversion and settlement."
      >
        <div className="grid md:grid-cols-2 gap-6 items-center">
          <div className="rounded-2xl border border-black/20 bg-gradient-to-br from-black/[0.04] to-black/[0.01] p-6">
            <ul className="space-y-3 text-black/80 text-sm">
              <li>• Pay on Chain A, receive on Chain B — automatically.</li>
              <li>• Route stablecoin flows across ecosystems without custodial bridges.</li>
              <li>• Programmable hooks for agents (refunds, metering, usage‑based caps).</li>
              <li>• Works with x402 flows; we add the cross‑chain plumbing.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-black/20 bg-black/[0.02] p-6">
            <ol className="list-decimal list-inside text-sm text-black/80 space-y-2">
              <li>Sender (user/agent) attaches payment via x402 on Chain A.</li>
              <li>RailBridge AI Router performs trust‑minimized cross‑chain route.</li>
              <li>Service receives on its preferred chain; receipts emitted for audit.</li>
            </ol>
          </div>
        </div>
      </Section>

      {/* How it works */}
      <Section id="how" title="How It Works">
        <div className="grid md:grid-cols-3 gap-6">
          {[{
            h: "Send",
            p: "Attach an x402 payment from any supported chain or token.",
          },{
            h: "Route",
            p: "RailBridge AI selects a path across bridges/routers with on‑chain proofs.",
          },{
            h: "Settle",
            p: "Funds land on the destination chain; service unlocks resource.",
          }].map((s, i) => (
            <div key={i} className="rounded-2xl border border-black/20 bg-black/[0.02] p-5">
              <h3 className="text-lg font-medium text-black">{s.h}</h3>
              <p className="mt-2 text-sm text-black/70">{s.p}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Use cases */}
      <Section id="usecases" title="Use Cases">
        <div className="grid md:grid-cols-3 gap-6">
          {["AI agents paying compute & data APIs","Cross‑chain SaaS subscriptions","Pay‑per‑call web services","Usage‑metered dApps","Multi‑chain marketplaces","Programmatic refunds & credits"].map((u, i) => (
            <div key={i} className="rounded-2xl border border-black/20 bg-black/[0.02] p-5 text-sm text-black/80">
              • {u}
            </div>
          ))}
        </div>
      </Section>

      {/* Ecosystem */}
      <Section id="ecosystem" title="Ecosystem & Integrations" subtitle="Designed to work alongside x402 + your favorite chains and bridges.">
        <div className="flex flex-wrap gap-3 text-xs text-black/80">
          {["x402","Polkadot","Hyperbridge","Base","Arbitrum","Optimism","Ethereum","Polygon","Solana","BSC","Avalanche","Tron","Gnosis","Sonic","Story","Monad"].map((e, i) => (
            <ChainBadge key={i} label={e} />
          ))}
        </div>
      </Section>

      {/* CTA */}
      <Section id="join" title="Build with RailBridge AI" subtitle="Join the early builder cohort and help shape the cross‑chain agentic economy.">
        <div className="flex flex-wrap gap-3">
          <a href="#docs" className="px-4 py-2.5 rounded-xl bg-black hover:bg-black/90 text-white font-medium">Get Started</a>
          <a href="#contact" className="px-4 py-2.5 rounded-xl border border-black/30 hover:bg-black/10">Contact Team</a>
        </div>
      </Section>

      <footer className="py-10 border-t border-black/20 text-center text-xs text-black/60">
        © {new Date().getFullYear()} RailBridge AI. Built for the agentic internet.
      </footer>
    </div>
  );
}
