"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

// Simple Chain Badge (text-based so you can swap easily)
function ChainBadge({ label, darkMode }: { label: string; darkMode: boolean }) {
  return (
    <div className={`px-3 py-1 rounded-full backdrop-blur text-xs shadow-sm ${
      darkMode 
        ? "border border-white/30 bg-white/5 text-white/90" 
        : "border border-black/30 bg-black/5 text-black/90"
    }`}>
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
  darkMode = false,
}: {
  items: Array<{ src: string; alt: string }>;
  direction?: "left" | "right";
  duration?: number;
  gap?: number;
  darkMode?: boolean;
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
            <div className={`size-14 rounded-full backdrop-blur flex items-center justify-center shadow-sm ${
              darkMode 
                ? "border border-white/20 bg-white/5" 
                : "border border-black/20 bg-black/5"
            }`}>
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

function ChainSlides({ darkMode }: { darkMode: boolean }) {
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
          darkMode={darkMode}
        />
        
        {/* Row 2 - Right */}
        <SlidingRow
          items={chains.slice(5, 10)}
          direction="right"
          duration={30}
          darkMode={darkMode}
        />
        
        {/* Row 3 - Left (faster) */}
        <SlidingRow
          items={chains.slice(10, 15)}
          direction="left"
          duration={20}
          darkMode={darkMode}
        />
      </div>
    </div>
  );
}

function Section({ id, title, subtitle, children, darkMode, inverted = false }: any) {
  const sectionColors = inverted
    ? darkMode
      ? "bg-white text-black"
      : "bg-black text-white"
    : "";

  return (
    <section
      id={id}
      className={`relative py-20 sm:py-28 transition-colors ${sectionColors}`}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="mb-8">
          <h2
            className={`text-2xl sm:text-3xl md:text-4xl font-semibold ${
              inverted
                ? darkMode
                  ? "text-black"
                  : "text-white"
                : darkMode
                  ? "text-white"
                  : "text-black"
            }`}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              className={`mt-3 max-w-3xl ${
                inverted
                  ? darkMode
                    ? "text-black/70"
                    : "text-white/70"
                  : darkMode
                    ? "text-white/70"
                    : "text-black/70"
              }`}
            >
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

export default function Page() {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    if (darkMode) {
      document.body.classList.remove("bg-white");
      document.body.classList.add("bg-black");
    } else {
      document.body.classList.remove("bg-black");
      document.body.classList.add("bg-white");
    }
    return () => {
      document.body.classList.remove("bg-white", "bg-black");
    };
  }, [darkMode]);

  return (
    <div className={`min-h-screen transition-colors ${
      darkMode 
        ? "text-white selection:bg-white/20 selection:text-white" 
        : "text-black selection:bg-black/20 selection:text-black"
    }`}>
      {/* Header */}
      <header className={`sticky top-0 z-40 border-b backdrop-blur transition-colors ${
        darkMode 
          ? "border-white/20 bg-black/80" 
          : "border-black/20 bg-white/80"
      }`}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/RailBridge-Logo.png" alt="RailBridge AI" className="w-10 h-10 rounded-sm object-contain" draggable={false} />
            <span className="font-bold tracking-tight">RailBridge AI</span>
          </div>
          <div className="flex items-center gap-3">
            <nav className={`hidden sm:flex items-center gap-6 text-sm ${
              darkMode ? "text-white/70" : "text-black/70"
            }`}>
              <a href="#problem" className={darkMode ? "hover:text-white" : "hover:text-black"}>Problem</a>
              <a href="#solution" className={darkMode ? "hover:text-white" : "hover:text-black"}>Solution</a>
              <a href="#how" className={darkMode ? "hover:text-white" : "hover:text-black"}>How it Works</a>
              <a href="https://railbridge.gitbook.io/docs" target="_blank" rel="noopener noreferrer" className={darkMode ? "hover:text-white" : "hover:text-black"}>Docs</a>
            </nav>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                darkMode 
                  ? "bg-gray-800 focus:ring-white/50" 
                  : "bg-gray-200 focus:ring-black/50"
              }`}
              aria-label="Toggle dark mode"
              role="switch"
              aria-checked={darkMode}
            >
              {/* Moon icon - visible in dark mode */}
              <svg
                className={`absolute left-1.5 h-4 w-4 transition-opacity ${
                  darkMode ? "opacity-100 text-white" : "opacity-0"
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
              
              {/* Sun icon - visible in light mode */}
              <svg
                className={`absolute right-1.5 h-4 w-4 transition-opacity ${
                  darkMode ? "opacity-0" : "opacity-100 text-gray-800"
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                  clipRule="evenodd"
                />
              </svg>
              
              {/* Thumb */}
              <span
                className={`inline-block h-5 w-5 transform rounded-full transition-transform shadow-md ${
                  darkMode 
                    ? "translate-x-8 bg-white" 
                    : "translate-x-1 bg-white"
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden min-h-[calc(100vh-3.5rem)]">
        {/* Background gradient */}
        <div className={`absolute inset-0 -z-10 transition-colors ${
          darkMode 
            ? "bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03),transparent_40%),radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.02),transparent_45%)]" 
            : "bg-[radial-gradient(ellipse_at_top,rgba(0,0,0,0.03),transparent_40%),radial-gradient(ellipse_at_bottom,rgba(0,0,0,0.02),transparent_45%)]"
        }`} />

        <div className="max-w-6xl mx-auto px-6 pt-16 pb-28 sm:pt-24 sm:pb-36 md:pb-32">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-semibold leading-tight">
                The <span className={darkMode ? "text-white" : "text-black"}>Interoperability</span> Layer for Agentic Commerce
              </h1>
              <p className={`mt-5 max-w-xl transition-colors ${
                darkMode ? "text-white/70" : "text-black/70"
              }`}>
                Enable truly cross-chain micropayments so users and agents can pay with any token, on any chain,
                while services receive seamlessly where they prefer.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a href="https://railbridge.gitbook.io/docs" target="_blank" rel="noopener noreferrer" className={`px-4 py-2.5 font-medium transition-colors ${
                  darkMode 
                    ? "bg-white hover:bg-white/90 text-black" 
                    : "bg-black hover:bg-black/90 text-white"
                }`}>Read Docs </a>
                <a href="#join" className={`px-4 py-2.5 border transition-colors ${
                  darkMode 
                    ? "border-white/30 hover:bg-white/10" 
                    : "border-black/30 hover:bg-black/10"
                }`}>Join Testnet</a>
              </div>
            </div>

            <div className="flex justify-center mt-8 sm:mt-0">
              <ChainSlides darkMode={darkMode} />
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <Section
        id="problem"
        title="The Multi‑Chain Payment Problem"
        subtitle="Payments are siloed within single chains. Even with x402 enabling agentic micropayments, there is no seamless, trustless way to pay on one chain and settle on another."
        darkMode={darkMode}
        inverted
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
            <div
              key={i}
              className={`rounded-2xl border p-5 transition-colors ${
                darkMode
                  ? "border-black/30 bg-black/10"
                  : "border-white/30 bg-white/10"
              }`}
            >
              <h3
                className={`text-lg font-medium transition-colors ${
                  darkMode ? "text-black" : "text-white"
                }`}
              >
                {card.h}
              </h3>
              <p
                className={`mt-2 text-sm transition-colors ${
                  darkMode ? "text-black/70" : "text-white/70"
                }`}
              >
                {card.p}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Solution */}
      <Section
        id="solution"
        title="RailBridge AI Bridges Every Chain"
        subtitle="A non‑custodial, programmable routing layer on top of x402 that handles cross‑chain conversion and settlement."
        darkMode={darkMode}
      >
        <div className="grid md:grid-cols-2 gap-6 items-center">
          <div className={`rounded-2xl border p-6 transition-colors ${
            darkMode 
              ? "border-white/20 bg-gradient-to-br from-white/[0.04] to-white/[0.01]" 
              : "border-black/20 bg-gradient-to-br from-black/[0.04] to-black/[0.01]"
          }`}>
            <ul className={`space-y-3 text-sm transition-colors ${
              darkMode ? "text-white/80" : "text-black/80"
            }`}>
              <li>• Pay on Chain A, receive on Chain B — automatically.</li>
              <li>• Route stablecoin flows across ecosystems without custodial bridges.</li>
              <li>• Programmable hooks for agents (refunds, metering, usage‑based caps).</li>
              <li>• Works with x402 flows; we add the cross‑chain plumbing.</li>
            </ul>
          </div>
          <div className={`rounded-2xl border p-6 transition-colors ${
            darkMode 
              ? "border-white/20 bg-white/[0.02]" 
              : "border-black/20 bg-black/[0.02]"
          }`}>
            <ol className={`list-decimal list-inside text-sm space-y-2 transition-colors ${
              darkMode ? "text-white/80" : "text-black/80"
            }`}>
              <li>Sender (user/agent) attaches payment via x402 on Chain A.</li>
              <li>RailBridge AI Router performs trust‑minimized cross‑chain route.</li>
              <li>Service receives on its preferred chain; receipts emitted for audit.</li>
            </ol>
          </div>
        </div>
      </Section>

      {/* How it works */}
      <Section id="how" title="How It Works" darkMode={darkMode} inverted>
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
            <div
              key={i}
              className={`rounded-2xl border p-5 transition-colors ${
                darkMode
                  ? "border-black/30 bg-black/10"
                  : "border-white/30 bg-white/10"
              }`}
            >
              <h3
                className={`text-lg font-medium transition-colors ${
                  darkMode ? "text-black" : "text-white"
                }`}
              >
                {s.h}
              </h3>
              <p
                className={`mt-2 text-sm transition-colors ${
                  darkMode ? "text-black/70" : "text-white/70"
                }`}
              >
                {s.p}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Use cases */}
      <Section id="usecases" title="Use Cases" darkMode={darkMode}>
        <div className="grid md:grid-cols-3 gap-6">
          {["AI agents paying compute & data APIs","Cross‑chain SaaS subscriptions","Pay‑per‑call web services","Usage‑metered dApps","Multi‑chain marketplaces","Programmatic refunds & credits"].map((u, i) => (
            <div key={i} className={`rounded-2xl border p-5 text-sm transition-colors ${
              darkMode 
                ? "border-white/20 bg-white/[0.02] text-white/80" 
                : "border-black/20 bg-black/[0.02] text-black/80"
            }`}>
              • {u}
            </div>
          ))}
        </div>
      </Section>

      {/* Ecosystem */}
      <Section id="ecosystem" title="Ecosystem & Integrations" subtitle="Designed to work alongside x402 + your favorite chains and bridges." darkMode={darkMode}>
        <div className={`flex flex-wrap gap-3 text-xs transition-colors ${
          darkMode ? "text-white/80" : "text-black/80"
        }`}>
          {["x402","Polkadot","Base","Arbitrum","Optimism","Ethereum","Polygon","Solana","BSC","Avalanche","Tron","Gnosis","Sonic","Story","Monad"].map((e, i) => (
            <ChainBadge key={i} label={e} darkMode={darkMode} />
          ))}
        </div>
      </Section>

      {/* CTA */}
      <Section id="join" title="Build with RailBridge AI" subtitle="Join the early builder cohort and help shape the cross‑chain agentic economy." darkMode={darkMode}>
        <div className="flex flex-wrap gap-3">
          <a href="#docs" className={`px-4 py-2.5 font-medium transition-colors ${
            darkMode 
              ? "bg-white hover:bg-white/90 text-black" 
              : "bg-black hover:bg-black/90 text-white"
          }`}>Get Started</a>
          <a href="#contact" className={`px-4 py-2.5 border transition-colors ${
            darkMode 
              ? "border-white/30 hover:bg-white/10" 
              : "border-black/30 hover:bg-black/10"
          }`}>Contact Team</a>
        </div>
      </Section>

      <footer className={`py-10 border-t text-center text-xs transition-colors ${
        darkMode 
          ? "border-white/20 text-white/60" 
          : "border-black/20 text-black/60"
      }`}>
        © {new Date().getFullYear()} RailBridge AI. Built for the agentic internet.
      </footer>
    </div>
  );
}
