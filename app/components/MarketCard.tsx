"use client";

import Image from "next/image";
import type { MarketData } from "@/lib/contracts";
import { formatUSDC } from "@/lib/contracts";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function ordinal(day: number) {
  if (day === 1 || day === 21 || day === 31) return `${day}st`;
  if (day === 2 || day === 22) return `${day}nd`;
  if (day === 3 || day === 23) return `${day}rd`;
  return `${day}th`;
}

function formatExpiry(ts: bigint) {
  const d = new Date(Number(ts) * 1000);
  return `${ordinal(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")} UTC`;
}

function formatUsdWhole(amount: bigint) {
  return (Number(amount) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function timeLeft(ts: bigint) {
  const ms = Number(ts) * 1000 - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

const ASSET_LOGOS: Record<string, string> = {
  BTC:   "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  ETH:   "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  SOL:   "https://assets.coingecko.com/coins/images/4128/large/solana.png",
  LINK:  "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  cbETH: "https://coin-images.coingecko.com/coins/images/27008/large/cbeth.png",
  DAI:   "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
  USDC:  "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
};

const ASSET_COLORS: Record<string, string> = {
  BTC: "#F7931A", ETH: "#627EEA", SOL: "#9945FF",
  LINK: "#2A5ADA", cbETH: "#627EEA", DAI: "#F5AC37", USDC: "#2775CA",
};

const STATUS_CONFIG = {
  LIVE:      { label: "LIVE",      dot: "#22C55E", text: "#22C55E" },
  PENDING:   { label: "PENDING",   dot: "#555",    text: "#555"    },
  SETTLED:   { label: "SETTLED",   dot: "#555",    text: "#555"    },
  CANCELLED: { label: "CANCELLED", dot: "#EF4444", text: "#EF4444" },
};

function ProbArc({ boundPct }: { boundPct: number }) {
  const w = 88, h = 54;
  const cx = 44, cy = 46;
  const r = 36, sw = 5;
  const breakPct = 100 - boundPct;
  const dominant = boundPct >= breakPct;
  const dominantColor = dominant ? "#22C55E" : "#EF4444";
  const dominantPct = dominant ? boundPct : breakPct;
  const dominantLabel = dominant ? "BOUND" : "BREAK";

  // semicircle path left→right, arc length = π*r
  const path = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const totalLen = Math.PI * r;
  const gap = 3;
  const boundLen = (boundPct / 100) * totalLen;
  const breakLen = (breakPct / 100) * totalLen;

  return (
    <div style={{ position: "relative", width: w, height: h, flexShrink: 0 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible">
        {/* Track */}
        <path d={path} fill="none" stroke="#2A2A2A" strokeWidth={sw} strokeLinecap="round" />
        {/* BOUND segment */}
        <path d={path} fill="none" stroke="#22C55E" strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${Math.max(0, boundLen - gap / 2)} ${totalLen}`}
        />
        {/* BREAK segment */}
        <path d={path} fill="none" stroke="#EF4444" strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${Math.max(0, breakLen - gap / 2)} ${totalLen}`}
          strokeDashoffset={-boundLen}
        />
      </svg>
      {/* Label sits in the mouth of the arc */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>
        <span style={{ color: dominantColor, fontWeight: 700, fontSize: "0.95rem", lineHeight: 1, fontFamily: "var(--font-geist-mono)" }}>
          {dominantPct}%
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: "0.55rem", fontWeight: 600, letterSpacing: "0.06em", lineHeight: 1.5 }}>
          {dominantLabel}
        </span>
      </div>
    </div>
  );
}

export default function MarketCard({ market, onTrade }: { market: MarketData; onTrade?: (side: "BOUND" | "BREAK") => void }) {
  const totalPool = market.boundPool + market.breakPool;
  const boundPct = totalPool > 0n ? Math.round(Number(market.boundPool) / Number(totalPool) * 100) : 50;
  const breakPct = 100 - boundPct;
  const status = STATUS_CONFIG[market.status] ?? STATUS_CONFIG.PENDING;
  const assetColor = ASSET_COLORS[market.asset] ?? "var(--accent)";
  const remaining = timeLeft(market.expiryTimestamp);

  return (
    <a
      href={`/markets/${market.address}`}
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        textDecoration: "none",
        overflow: "hidden",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#333";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(0,0,0,0.4)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      <div style={{ padding: "1.1rem 1.25rem 1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              {ASSET_LOGOS[market.asset] ? (
                <Image
                  src={ASSET_LOGOS[market.asset]}
                  alt={market.asset}
                  width={32}
                  height={32}
                  style={{ borderRadius: 8, flexShrink: 0 }}
                />
              ) : (
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: assetColor,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "0.7rem", color: "#fff", flexShrink: 0,
                }}>
                  {market.asset.slice(0, 3)}
                </div>
              )}
              <span style={{ color: "var(--text-secondary)", fontSize: "0.78rem", fontWeight: 600 }}>
                {market.asset} / USD
              </span>
            </div>
            {/* Status */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: status.dot,
                boxShadow: market.status === "LIVE" ? `0 0 6px ${status.dot}` : "none",
              }} />
              <span style={{ color: status.text, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em" }}>
                {status.label}
              </span>
            </div>
          </div>
          <ProbArc boundPct={boundPct} />
        </div>

        {/* Title */}
        <div style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "0.92rem", lineHeight: 1.5 }}>
          Will <span style={{ color: assetColor }}>{market.asset}</span> break out of ${formatUsdWhole(market.lowerBound)} — ${formatUsdWhole(market.upperBound)} by{" "}
          <span style={{ color: "var(--text-muted)" }}>{formatExpiry(market.expiryTimestamp)}</span>?
        </div>

      </div>

      <div style={{ height: 1, background: "var(--border-subtle)" }} />

      {/* Action buttons */}
      <div style={{ padding: "0.75rem 1.25rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
        <button
          onClick={e => { e.preventDefault(); onTrade?.("BOUND"); }}
          style={{
            background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)",
            borderRadius: 10, padding: "0.55rem", textAlign: "center",
            color: "#22C55E", fontWeight: 700, fontSize: "0.82rem", letterSpacing: "0.05em",
            cursor: "pointer", transition: "background 0.12s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(34,197,94,0.22)")}
          onMouseLeave={e => (e.currentTarget.style.background = "rgba(34,197,94,0.12)")}
        >BOUND <span style={{ opacity: 0.8, fontWeight: 500 }}>{boundPct}%</span></button>
        <button
          onClick={e => { e.preventDefault(); onTrade?.("BREAK"); }}
          style={{
            background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 10, padding: "0.55rem", textAlign: "center",
            color: "#EF4444", fontWeight: 700, fontSize: "0.82rem", letterSpacing: "0.05em",
            cursor: "pointer", transition: "background 0.12s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.22)")}
          onMouseLeave={e => (e.currentTarget.style.background = "rgba(239,68,68,0.12)")}
        >BREAK <span style={{ opacity: 0.8, fontWeight: 500 }}>{breakPct}%</span></button>
      </div>

      {/* Footer */}
      <div style={{
        padding: "0.6rem 1.25rem", borderTop: "1px solid var(--border-subtle)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>${formatUSDC(totalPool)} pool</span>
        <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>
          {remaining ? `${remaining} left` : "Expired"}
        </span>
      </div>
    </a>
  );
}
