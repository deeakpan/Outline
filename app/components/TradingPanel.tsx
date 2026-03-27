"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, type Address } from "viem";
import { MARKET_ABI, ERC20_ABI, FACTORY_ABI } from "@/lib/abis";
import type { MarketData } from "@/lib/contracts";

const FACTORY = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address;
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
function fmt2(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPrice(amt: bigint) {
  return (Number(amt) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function TradingPanel({
  market,
  side,
  onClose,
}: {
  market: MarketData;
  side: "BOUND" | "BREAK";
  onClose: () => void;
}) {
  const { address, isConnected } = useAccount();
  const isBound = side === "BOUND";

  const [amountStr, setAmountStr] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [slippageInput, setSlippageInput] = useState("1");
  const [step, setStep] = useState<"idle" | "approving" | "buying" | "done">("idle");
  const [error, setError] = useState("");

  const { data: usdcAddress } = useReadContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "collateralToken" });
  const { data: usdcBalance } = useReadContract({
    address: usdcAddress as Address, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!usdcAddress },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress as Address, abi: ERC20_ABI, functionName: "allowance",
    args: address && market.address ? [address, market.address] : undefined,
    query: { enabled: !!address && !!usdcAddress, refetchInterval: step === "approving" ? 2_000 : 30_000 },
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
  const isLoadingPrice = rawPrice === undefined;

  const balanceNum = usdcBalance ? Number(usdcBalance) / 1e6 : null;
  const priceNum = rawPrice && rawPrice > 0n ? Number(rawPrice) / 1e18 : null;
  const impliedOdds = priceNum ? (1 / priceNum) : null;

  // tokens have 6 decimals (matches USDC).
  const tokensOut: bigint = amountUsdc > 0n && rawPrice && rawPrice > 0n
    ? (amountUsdc * BigInt(1e18)) / rawPrice : 0n;
  const tokensOutNum = Number(tokensOut) / 1e6;
  const minTokensOut = tokensOut > 0n
    ? (tokensOut * BigInt(Math.round((100 - slippage) * 100))) / 10000n : 0n;

  const estimatedPayoutNum = estimatedPayout ? Number(estimatedPayout as bigint) / 1e6 : null;
  const estimatedProfit = estimatedPayoutNum !== null ? estimatedPayoutNum - Number(amountStr || 0) : null;

  const needsApproval = !allowance || (allowance as bigint) < amountUsdc;
  const overBalance = balanceNum !== null && Number(amountStr) > balanceNum;
  const canSubmit = !!amountStr && amountUsdc > 0n && !overBalance && !wrongSide;

  const { writeContract, data: txHash, isPending: walletPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isSuccess, isError: txFailed } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } });
  const lastHandledHash = useRef<string | undefined>(undefined);
  const busy = walletPending || step === "approving" || step === "buying";

  // Handle tx success — guard with lastHandledHash so we don't re-fire on re-renders
  useEffect(() => {
    if (!isSuccess || !txHash || txHash === lastHandledHash.current) return;
    lastHandledHash.current = txHash;
    if (step === "approving") {
      refetchAllowance();
    } else if (step === "buying") {
      setStep("done");
    }
  }, [isSuccess, txHash, step, refetchAllowance]);

  // Fallback: watch allowance directly — as soon as it's enough, leave "approving"
  useEffect(() => {
    if (step !== "approving") return;
    if (allowance && amountUsdc > 0n && (allowance as bigint) >= amountUsdc) {
      setStep("idle");
    }
  }, [allowance, step, amountUsdc]);

  // Surface write or receipt errors and reset step
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

  const sideColor  = isBound ? "#22C55E" : "#EF4444";
  const sideDim    = isBound ? "rgba(34,197,94,0.1)"  : "rgba(239,68,68,0.1)";
  const sideBorder = isBound ? "rgba(34,197,94,0.3)"  : "rgba(239,68,68,0.3)";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, backdropFilter: "blur(2px)" }} />
      <div
        className="trade-panel-inner"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 380, zIndex: 201,
          background: "#1A1A1A", borderLeft: "1px solid #3A3A3A",
          display: "flex", flexDirection: "column",
          boxShadow: "-12px 0 48px rgba(0,0,0,0.8)",
          animation: "tradePanelSlideRight 0.2s ease",
        }}
      >
        {/* Drag handle — visible on mobile bottom sheet */}
        <div className="trade-panel-handle" style={{ display: "flex", justifyContent: "center", padding: "0.6rem 0 0" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
        </div>

        {/* Header */}
        <div style={{ padding: "1.1rem 1.25rem", borderBottom: "1px solid #2A2A2A", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <div style={{ padding: "0.18rem 0.55rem", borderRadius: 5, background: sideDim, border: `1px solid ${sideBorder}`, color: sideColor, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", flexShrink: 0 }}>
                {side}
              </div>
              <span style={{ color: "var(--text-primary)", fontSize: "0.78rem", fontWeight: 600 }}>{market.asset} / USD</span>
            </div>
            <div style={{ color: "#FFFFFF", fontSize: "0.78rem", fontWeight: 600 }}>
              ${fmtPrice(market.lowerBound)} — ${fmtPrice(market.upperBound)}
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.72rem", marginTop: "0.1rem" }}>
              by {formatExpiry(market.expiryTimestamp)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, padding: 0, flexShrink: 0 }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "1.1rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem", background: "#1A1A1A" }}>

          {/* Amount input */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em" }}>AMOUNT</span>
              {balanceNum !== null && (
                <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>
                  Balance: <span style={{ color: "#FFFFFF" }}>${fmt2(balanceNum)}</span>
                </span>
              )}
            </div>
            <div style={{ background: "#252525", border: `1px solid ${amountStr && overBalance ? "#EF4444" : "#3A3A3A"}`, borderRadius: 10, padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
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
            {/* Quick amounts */}
            <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.5rem" }}>
              {[10, 25, 50, 100].map(a => (
                <button key={a} onClick={() => setAmountStr(String(a))} style={{ flex: 1, padding: "0.3rem 0", borderRadius: 6, border: "1px solid #3A3A3A", background: "#252525", color: "#CCCCCC", fontSize: "0.7rem", cursor: "pointer" }}>
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

          {/* Token preview */}
          <div style={{ background: "#242424", border: "1px solid #3A3A3A", borderRadius: 10, padding: "0.9rem 1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.75rem" }}>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em" }}>YOU RECEIVE</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1.15rem", fontFamily: "var(--font-geist-mono)" }}>
                {tokensOutNum > 0 ? fmt2(tokensOutNum) : "—"}
                <span style={{ fontSize: "0.72rem", marginLeft: "0.3rem", opacity: 0.8 }}>{side}</span>
              </span>
            </div>
            {[
              { k: "Price per token", v: isLoadingPrice ? "loading…" : priceNum != null ? `$${fmt2(priceNum)}` : "—" },
              { k: "Implied odds",    v: isLoadingPrice ? "loading…" : impliedOdds != null ? `${impliedOdds.toFixed(2)}×` : "—" },
              { k: "Est. payout",     v: estimatedPayoutNum != null ? `$${fmt2(estimatedPayoutNum)}` : amountUsdc > 0n ? "loading…" : "—",
                highlight: estimatedProfit !== null ? (estimatedProfit >= 0 ? "#22C55E" : "#EF4444") : undefined },
              { k: "Min received",   v: tokensOut > 0n ? `${(Number(minTokensOut) / 1e6).toFixed(2)} ${side}` : "—" },
            ].map(({ k, v, highlight }: { k: string; v: string; highlight?: string }) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                <span style={{ color: "var(--text-secondary)", fontSize: "0.73rem" }}>{k}</span>
                <span style={{ color: highlight ?? (v.includes("loading") ? "var(--text-muted)" : "var(--text-primary)"), fontSize: "0.73rem", fontWeight: highlight ? 700 : 500, fontFamily: "var(--font-geist-mono)" }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Slippage */}
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em" }}>SLIPPAGE</span>
              <button
                onClick={() => { setSlippageInput(slippage.toString()); setSlippageOpen(o => !o); }}
                style={{ display: "flex", alignItems: "center", gap: "0.35rem", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                <span style={{ color: slippage > 5 ? "#F59E0B" : "var(--text-primary)", fontWeight: 700, fontSize: "0.82rem", fontFamily: "var(--font-geist-mono)" }}>{slippage.toFixed(1)}%</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={slippage > 5 ? "#F59E0B" : "var(--text-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
            {slippageOpen && (
              <div style={{
                position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                background: "#222", border: "1px solid #3A3A3A", borderRadius: 10,
                padding: "0.75rem", zIndex: 10, minWidth: 180,
                boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              }}>
                <div style={{ color: "var(--text-muted)", fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", marginBottom: "0.5rem" }}>SET SLIPPAGE</div>
                <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }}>
                  {[0.5, 1, 2, 5].map(v => (
                    <button key={v} onClick={() => { setSlippage(v); setSlippageInput(String(v)); setSlippageOpen(false); }} style={{
                      flex: 1, padding: "0.3rem 0", borderRadius: 6, fontSize: "0.7rem", fontWeight: 600, cursor: "pointer",
                      border: slippage === v ? "1px solid var(--accent)" : "1px solid #3A3A3A",
                      background: slippage === v ? "var(--accent-dim)" : "#2A2A2A",
                      color: slippage === v ? "var(--accent)" : "var(--text-secondary)",
                    }}>{v}%</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <input
                    type="number" min={0.1} max={50} step={0.1}
                    value={slippageInput}
                    onChange={e => setSlippageInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { const v = Math.min(50, Math.max(0.1, Number(slippageInput))); setSlippage(v); setSlippageOpen(false); }}}
                    style={{ flex: 1, background: "#1A1A1A", border: "1px solid #3A3A3A", borderRadius: 6, padding: "0.3rem 0.5rem", color: "var(--text-primary)", fontSize: "0.78rem", outline: "none", fontFamily: "var(--font-geist-mono)" }}
                  />
                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>%</span>
                  <button onClick={() => { const v = Math.min(50, Math.max(0.1, Number(slippageInput))); setSlippage(v); setSlippageOpen(false); }} style={{ background: "var(--accent)", border: "none", borderRadius: 6, padding: "0.3rem 0.6rem", color: "#fff", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}>Set</button>
                </div>
                {slippage > 5 && <div style={{ color: "#F59E0B", fontSize: "0.68rem", marginTop: "0.5rem" }}>High slippage warning</div>}
              </div>
            )}
          </div>

          {error && <div style={{ color: "#EF4444", fontSize: "0.75rem" }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid #2A2A2A", background: "#1A1A1A" }}>
          {step === "done" ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "var(--accent)", fontWeight: 700, marginBottom: "0.3rem" }}>Position opened!</div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginBottom: "0.85rem" }}>You bought {side} on {market.asset}</div>
              <button onClick={onClose} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.6rem 1.5rem", color: "var(--text-primary)", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" }}>Close</button>
            </div>
          ) : !isConnected ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>Connect your wallet to trade</div>
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
      </div>
    </>
  );
}

function ctaStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%", padding: "0.85rem", borderRadius: 10, border: "none",
    background: disabled ? "#2A2A2A" : "var(--accent)",
    color: disabled ? "var(--text-secondary)" : "#fff",
    fontWeight: 700, fontSize: "0.9rem",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : "0 0 18px rgba(0,82,255,0.4)",
    transition: "all 0.15s",
  };
}
