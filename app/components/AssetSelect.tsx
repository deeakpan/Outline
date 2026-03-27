"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";

const ASSETS = [
  { symbol: "BTC",   id: "bitcoin",                      logo: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png" },
  { symbol: "ETH",   id: "ethereum",                     logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png" },
  { symbol: "SOL",   id: "solana",                       logo: "https://assets.coingecko.com/coins/images/4128/large/solana.png" },
  { symbol: "LINK",  id: "chainlink",                    logo: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png" },
  { symbol: "cbETH", id: "coinbase-wrapped-staked-eth",  logo: "https://coin-images.coingecko.com/coins/images/27008/large/cbeth.png" },
  { symbol: "DAI",   id: "dai",                          logo: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png" },
  { symbol: "USDC",  id: "usd-coin",                     logo: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" },
];

type PriceData = Record<string, { usd: number; usd_24h_change: number }>;

export default function AssetSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prices, setPrices] = useState<PriceData>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ids = ASSETS.map(a => a.id).join(",");
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`)
      .then(r => r.json())
      .then(setPrices)
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const active = value !== "All assets";
  const selectedAsset = ASSETS.find(a => a.symbol === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.45rem 0.85rem",
          background: active ? "var(--accent-dim)" : "var(--bg-secondary)",
          border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8,
          color: active ? "var(--accent)" : "var(--text-primary)",
          fontSize: "0.8rem",
          fontWeight: active ? 600 : 500,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {selectedAsset ? (
          <Image src={selectedAsset.logo} alt={selectedAsset.symbol} width={16} height={16} style={{ borderRadius: "50%" }} />
        ) : null}
        {value}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          zIndex: 100,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
          minWidth: 240,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
          {/* All option */}
          <button
            onClick={() => { onChange("All assets"); setOpen(false); }}
            style={{
              width: "100%",
              padding: "0.65rem 1rem",
              background: value === "All assets" ? "var(--accent-dim)" : "transparent",
              border: "none",
              borderBottom: "1px solid var(--border-subtle)",
              color: value === "All assets" ? "var(--accent)" : "var(--text-secondary)",
              fontSize: "0.8rem",
              fontWeight: value === "All assets" ? 600 : 400,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            All assets
          </button>

          {ASSETS.map(a => {
            const p = prices[a.id];
            const change = p?.usd_24h_change;
            const isSelected = value === a.symbol;
            return (
              <button
                key={a.symbol}
                onClick={() => { onChange(a.symbol); setOpen(false); }}
                style={{
                  width: "100%",
                  padding: "0.6rem 1rem",
                  background: isSelected ? "var(--accent-dim)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.65rem",
                  textAlign: "left",
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "var(--bg-secondary)"; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <Image src={a.logo} alt={a.symbol} width={24} height={24} style={{ borderRadius: "50%", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: isSelected ? "var(--accent)" : "var(--text-primary)", fontWeight: 600, fontSize: "0.82rem" }}>
                    {a.symbol}
                  </div>
                </div>
                {p && (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "var(--text-primary)", fontSize: "0.8rem", fontWeight: 500, fontFamily: "var(--font-geist-mono)" }}>
                      ${p.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      color: change >= 0 ? "#22C55E" : "#EF4444",
                      fontFamily: "var(--font-geist-mono)",
                    }}>
                      {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
