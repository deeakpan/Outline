"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, type Address } from "viem";
import { MARKET_ABI, ERC20_ABI, FACTORY_ABI } from "@/lib/abis";
import type { MarketData } from "@/lib/contracts";
import { formatUSDC } from "@/lib/contracts";
import Link from "next/link";

const FACTORY = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address;

const TV_SYMBOL: Record<string, string> = {
  BTC:   "BINANCE:BTCUSDT",
  ETH:   "BINANCE:ETHUSDT",
  SOL:   "BINANCE:SOLUSDT",
  LINK:  "BINANCE:LINKUSDT",
  cbETH: "COINBASE:CBETHUSD",
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function ordinal(d: number) {
  if (d === 1 || d === 21 || d === 31) return `${d}st`;
  if (d === 2 || d === 22) return `${d}nd`;
  if (d === 3 || d === 23) return `${d}rd`;
  return `${d}th`;
}

function formatExpiry(ts: bigint) {
  const d = new Date(Number(ts) * 1000);
  return `${ordinal(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")} UTC`;
}

function formatUsdWhole(n: bigint) {
  return (Number(n) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmt2(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeLeft(ts: bigint) {
  const ms = Number(ts) * 1000 - Date.now();
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  return `${h}h ${m}m left`;
}

// ── TradingView chart ────────────────────────────────────────────────────────

function TradingViewChart({ asset }: { asset: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const symbol = TV_SYMBOL[asset] ?? `BINANCE:${asset}USDT`;

  useEffect(() => {
    const containerId = "tv_chart";
    let script: HTMLScriptElement | null = null;

    function initWidget() {
      if (!(window as any).TradingView || !document.getElementById(containerId)) return;
      new (window as any).TradingView.widget({
        container_id: containerId,
        symbol,
        interval: "60",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        autosize: true,
        hide_top_toolbar: false,
        hide_legend: false,
        allow_symbol_change: false,
        save_image: false,
        backgroundColor: "#111111",
        gridColor: "rgba(255,255,255,0.03)",
        hide_volume: false,
      });
    }

    if ((window as any).TradingView) {
      initWidget();
    } else {
      script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    }

    return () => {
      if (script && document.head.contains(script)) document.head.removeChild(script);
    };
  }, [symbol]);

  return (
    <div
      ref={containerRef}
      style={{
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid var(--border)",
        height: 460,
        background: "#111111",
      }}
    >
      <div id="tv_chart" style={{ height: "100%" }} />
    </div>
  );
}

// ── Inline trade panel ───────────────────────────────────────────────────────

function TradePanel({ market }: { market: MarketData }) {
  const { address, isConnected } = useAccount();
  const [side, setSide] = useState<"BOUND" | "BREAK">("BOUND");
  const [amountStr, setAmountStr] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "buying" | "done">("idle");
  const [error, setError] = useState("");

  const isBound = side === "BOUND";
  const sideColor = isBound ? "#22C55E" : "#EF4444";

  const { data: usdcAddress } = useReadContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "collateralToken" });
  const { data: usdcBalance } = useReadContract({
    address: usdcAddress as Address, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!usdcAddress },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress as Address, abi: ERC20_ABI, functionName: "allowance",
    args: address && market.address ? [address, market.address] : undefined,
    query: { enabled: !!address && !!usdcAddress },
  });
  const { data: position } = useReadContract({
    address: market.address, abi: MARKET_ABI, functionName: "positions",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const existingPosition = position as [bigint, bigint, boolean, boolean, boolean] | undefined;
  const hasPosition = existingPosition?.[3] ?? false;     // exists is index 3
  const positionIsBound = existingPosition?.[2] ?? false; // isBound is index 2
  const wrongSide = hasPosition && (isBound ? !positionIsBound : positionIsBound);

  const { data: rawBoundPrice } = useReadContract({
    address: market.address, abi: MARKET_ABI, functionName: "getBoundPrice",
    query: { refetchInterval: 10_000 },
  });
  const { data: rawBreakPrice } = useReadContract({
    address: market.address, abi: MARKET_ABI, functionName: "getBreakPrice",
    query: { refetchInterval: 10_000 },
  });

  const amountUsdc = amountStr ? parseUnits(amountStr, 6) : 0n;

  const { data: estimatedPayout } = useReadContract({
    address: market.address, abi: MARKET_ABI, functionName: "getEstimatedPayout",
    args: [isBound, amountUsdc],
    query: { enabled: amountUsdc > 0n, refetchInterval: 10_000 },
  });

  const rawPrice = (isBound ? rawBoundPrice : rawBreakPrice) as bigint | undefined;
  const priceNum = rawPrice && rawPrice > 0n ? Number(rawPrice) / 1e18 : null;
  const impliedOdds = priceNum ? 1 / priceNum : null;
  const tokensOut = amountUsdc > 0n && rawPrice && rawPrice > 0n
    ? (amountUsdc * BigInt(1e18)) / rawPrice : 0n;
  const tokensOutNum = Number(tokensOut) / 1e6;
  const slippage = 1;
  const minTokensOut = tokensOut > 0n ? (tokensOut * BigInt(Math.round((100 - slippage) * 100))) / 10000n : 0n;
  const estimatedPayoutNum = estimatedPayout ? Number(estimatedPayout as bigint) / 1e6 : null;
  const estimatedProfit = estimatedPayoutNum !== null ? estimatedPayoutNum - Number(amountStr || 0) : null;
  const balanceNum = usdcBalance ? Number(usdcBalance) / 1e6 : null;
  const overBalance = balanceNum !== null && Number(amountStr) > balanceNum;
  const needsApproval = !allowance || (allowance as bigint) < amountUsdc;
  const canSubmit = !!amountStr && amountUsdc > 0n && !overBalance && !wrongSide;

  const { writeContract, data: txHash, isPending: walletPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isSuccess, isError: txFailed } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } });
  const lastHandledHash = useRef<string | undefined>(undefined);
  const busy = walletPending || step === "approving" || step === "buying";

  useEffect(() => {
    if (!isSuccess || !txHash || txHash === lastHandledHash.current) return;
    lastHandledHash.current = txHash;
    if (step === "approving") {
      refetchAllowance().then(() => setStep("idle"));
    } else if (step === "buying") {
      setStep("done");
    }
  }, [isSuccess, txHash, step, refetchAllowance]);

  useEffect(() => {
    if (!writeError && !txFailed) return;
    const msg = writeError
      ? (writeError.message.includes("User rejected") ? "Transaction rejected" : writeError.message.split("\n")[0])
      : "Transaction failed on-chain";
    setError(msg);
    setStep("idle");
    resetWrite();
  }, [writeError, txFailed, resetWrite]);

  function handleApprove() {
    if (!usdcAddress) return;
    setError(""); setStep("approving");
    writeContract({ address: usdcAddress as Address, abi: ERC20_ABI, functionName: "approve", args: [market.address, amountUsdc] });
  }
  function handleBuy() {
    if (!canSubmit) return;
    setError(""); setStep("buying");
    writeContract({ address: market.address, abi: MARKET_ABI, functionName: isBound ? "joinBound" : "joinBreak", args: [amountUsdc, minTokensOut] });
  }

  if (step === "done") {
    return (
      <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>✦</div>
        <div style={{ color: "var(--text-primary)", fontWeight: 700, marginBottom: "0.4rem" }}>Position opened!</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
          You bought {side} on {market.asset}
        </div>
        <button onClick={() => { setStep("idle"); setAmountStr(""); }} style={{
          background: "#252525", border: "1px solid #3A3A3A", borderRadius: 10,
          padding: "0.6rem 1.5rem", color: "var(--text-primary)", fontWeight: 600,
          cursor: "pointer", fontSize: "0.875rem",
        }}>Trade again</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* Side tabs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
        {(["BOUND", "BREAK"] as const).map(s => {
          const active = side === s;
          const col = s === "BOUND" ? "#22C55E" : "#EF4444";
          return (
            <button key={s} onClick={() => { setSide(s); setError(""); }} style={{
              padding: "0.65rem",
              borderRadius: 10,
              border: active ? `1px solid ${col}44` : "1px solid #2A2A2A",
              background: active ? `${col}12` : "#222",
              color: active ? col : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.82rem",
              letterSpacing: "0.06em",
              cursor: "pointer",
              transition: "all 0.12s",
            }}>
              {s}
            </button>
          );
        })}
      </div>

      {/* Amount input */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em" }}>AMOUNT</span>
          {balanceNum !== null && (
            <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>
              Bal: <span style={{ color: "#fff" }}>${fmt2(balanceNum)}</span>
            </span>
          )}
        </div>
        <div style={{ background: "#252525", border: `1px solid ${overBalance && amountStr ? "#EF4444" : "#3A3A3A"}`, borderRadius: 10, padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <input
            type="number"
            value={amountStr}
            onChange={e => setAmountStr(e.target.value)}
            placeholder="0.00"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text-primary)", fontSize: "1.5rem", fontWeight: 700, fontFamily: "var(--font-geist-mono)", width: 0 }}
          />
          <span style={{ color: "var(--text-secondary)", fontSize: "0.78rem", fontWeight: 600, background: "#2E2E2E", border: "1px solid #3A3A3A", borderRadius: 5, padding: "0.2rem 0.5rem", flexShrink: 0 }}>USDC</span>
        </div>
        {overBalance && <div style={{ color: "#EF4444", fontSize: "0.7rem", marginTop: "0.3rem" }}>Exceeds balance</div>}
        <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.5rem" }}>
          {[10, 25, 50, 100].map(a => (
            <button key={a} onClick={() => setAmountStr(String(a))} style={{ flex: 1, padding: "0.3rem 0", borderRadius: 6, border: "1px solid #3A3A3A", background: "#252525", color: "#CCC", fontSize: "0.7rem", cursor: "pointer" }}>
              ${a}
            </button>
          ))}
          {balanceNum !== null && (
            <button onClick={() => setAmountStr(fmt2(balanceNum))} style={{ flex: 1, padding: "0.3rem 0", borderRadius: 6, border: "1px solid var(--accent-border)", background: "var(--accent-dim)", color: "var(--accent)", fontSize: "0.7rem", fontWeight: 600, cursor: "pointer" }}>
              MAX
            </button>
          )}
        </div>
      </div>

      {/* YOU RECEIVE */}
      <div style={{ background: "#242424", border: "1px solid #3A3A3A", borderRadius: 10, padding: "0.9rem 1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.75rem" }}>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em" }}>YOU RECEIVE</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1.15rem", fontFamily: "var(--font-geist-mono)" }}>
            {tokensOutNum > 0 ? fmt2(tokensOutNum) : "—"}
            <span style={{ fontSize: "0.72rem", marginLeft: "0.3rem", color: sideColor }}>{side}</span>
          </span>
        </div>
        {[
          { k: "Price per token", v: priceNum != null ? `$${fmt2(priceNum)}` : "—" },
          { k: "Implied odds",    v: impliedOdds != null ? `${impliedOdds.toFixed(2)}×` : "—" },
          { k: "Est. payout",     v: estimatedPayoutNum != null ? `$${fmt2(estimatedPayoutNum)}` : amountUsdc > 0n ? "…" : "—",
            color: estimatedProfit !== null ? (estimatedProfit >= 0 ? "#22C55E" : "#EF4444") : undefined },
        ].map(({ k, v, color }) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "0.73rem" }}>{k}</span>
            <span style={{ color: color ?? "var(--text-primary)", fontSize: "0.73rem", fontWeight: color ? 700 : 500, fontFamily: "var(--font-geist-mono)" }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && <div style={{ color: "#EF4444", fontSize: "0.75rem" }}>{error}</div>}

      {/* CTA */}
      {!isConnected ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>
          Connect wallet to trade
        </div>
      ) : wrongSide ? (
        <div style={{ textAlign: "center", padding: "0.6rem", borderRadius: 10, background: "#1E1E1E", border: "1px solid #2A2A2A" }}>
          <div style={{ color: "var(--text-secondary)", fontSize: "0.78rem", fontWeight: 600 }}>
            You already hold {positionIsBound ? "BOUND" : "BREAK"}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", marginTop: "0.25rem" }}>
            One side per market per wallet
          </div>
        </div>
      ) : needsApproval ? (
        <button onClick={handleApprove} disabled={!canSubmit || busy} style={ctaStyle(!canSubmit || busy)}>
          {walletPending ? "Check wallet…" : step === "approving" ? "Approving…" : "Approve USDC"}
        </button>
      ) : (
        <button onClick={handleBuy} disabled={!canSubmit || busy} style={ctaStyle(!canSubmit || busy)}>
          {walletPending ? "Check wallet…" : step === "buying" ? "Confirming…" : `Buy ${side}`}
        </button>
      )}
    </div>
  );
}

function ctaStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%", padding: "0.85rem", borderRadius: 10, border: "none",
    background: disabled ? "#2A2A2A" : "var(--accent)",
    color: disabled ? "var(--text-secondary)" : "#fff",
    fontWeight: 700, fontSize: "0.9rem",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : "0 0 18px rgba(0,82,255,0.35)",
    transition: "all 0.15s",
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  LIVE:      { color: "#22C55E", bg: "rgba(34,197,94,0.1)",  border: "rgba(34,197,94,0.3)"  },
  PENDING:   { color: "#888",    bg: "rgba(136,136,136,0.1)", border: "rgba(136,136,136,0.3)" },
  SETTLED:   { color: "#888",    bg: "rgba(136,136,136,0.1)", border: "rgba(136,136,136,0.3)" },
  CANCELLED: { color: "#EF4444", bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.3)"  },
};

export default function MarketPageClient({ market }: { market: MarketData }) {
  const totalPool = market.boundPool + market.breakPool;
  const boundPct = totalPool > 0n ? Math.round(Number(market.boundPool) / Number(totalPool) * 100) : 50;
  const ss = STATUS_STYLE[market.status] ?? STATUS_STYLE.PENDING;

  const breakPct = 100 - boundPct;
  const bandPct = totalPool > 0n && market.startPrice > 0n
    ? (Number((market.upperBound - market.startPrice) * 10000n / market.startPrice) / 100).toFixed(0)
    : "—";

  return (
    <div style={{ maxWidth: 1200 }}>

      {/* Breadcrumb + title */}
      <div style={{ marginBottom: "1.25rem" }}>
        <Link href="/" style={{ color: "var(--text-muted)", fontSize: "0.78rem", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.75rem" }}>
          ← Markets
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h1 style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1.2rem", margin: 0 }}>
            Will <span style={{ color: "var(--accent)" }}>{market.asset}</span> stay ${formatUsdWhole(market.lowerBound)} — ${formatUsdWhole(market.upperBound)}?
          </h1>
          <div style={{ padding: "0.2rem 0.6rem", borderRadius: 6, background: ss.bg, border: `1px solid ${ss.border}`, color: ss.color, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em" }}>
            {market.status}
          </div>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginTop: "0.3rem" }}>
          Expires {formatExpiry(market.expiryTimestamp)} · {market.asset} / USD
        </div>
      </div>

      {/* Main grid */}
      <div className="market-detail-grid" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.25rem", alignItems: "start" }}>

        {/* Left: chart + stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <TradingViewChart asset={market.asset} />

        </div>

        {/* Right: trade panel */}
        <div style={{
          background: "#1A1A1A",
          border: "1px solid #3A3A3A",
          borderRadius: 16,
          padding: "1.25rem",
          position: "sticky",
          top: "1.5rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em" }}>TRADE</span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.7rem", fontFamily: "var(--font-geist-mono)" }}>{timeLeft(market.expiryTimestamp)}</span>
          </div>
          <TradePanel market={market} />
          <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #2A2A2A", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>Total pool</span>
            <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontFamily: "var(--font-geist-mono)" }}>${formatUSDC(totalPool)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
