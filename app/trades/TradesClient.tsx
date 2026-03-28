"use client";

import { useAccount, useReadContracts, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { type Address } from "viem";
import { MARKET_ABI, ERC20_ABI } from "@/lib/abis";
import type { MarketData } from "@/lib/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

function fmt2(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtRange(lo: bigint, hi: bigint) {
  const f = (n: bigint) => (Number(n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `$${f(lo)} — $${f(hi)}`;
}
function timeLeft(ts: bigint) {
  const ms = Number(ts) * 1000 - Date.now();
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

const STATUS_COLOR: Record<string, string> = {
  LIVE:      "#22C55E",
  PENDING:   "#999",
  SETTLED:   "#888",
  CANCELLED: "#EF4444",
};

// ── Per-row component (needs hooks for settlement data + write) ───────────────

function PositionRow({
  market, userAddress, principal, isBound, claimed,
}: {
  market: MarketData;
  userAddress: Address;
  principal: bigint;
  isBound: boolean;
  claimed: boolean;
}) {
  const isSettled   = market.status === "SETTLED";
  const sideColor   = isBound ? "#22C55E" : "#EF4444";
  const statusColor = STATUS_COLOR[market.status] ?? "#777";

  // Settlement reads
  const { data: boundWins } = useReadContract({
    address: market.address, abi: MARKET_ABI, functionName: "boundWins",
    query: { enabled: isSettled },
  });
  const { data: redemptionRate } = useReadContract({
    address: market.address, abi: MARKET_ABI, functionName: "redemptionRate",
    query: { enabled: isSettled },
  });
  const { data: boundTokenAddr } = useReadContract({
    address: market.address, abi: MARKET_ABI, functionName: "boundToken",
    query: { enabled: isSettled },
  });
  const { data: breakTokenAddr } = useReadContract({
    address: market.address, abi: MARKET_ABI, functionName: "breakToken",
    query: { enabled: isSettled },
  });
  const winTokenAddr = (isBound ? boundTokenAddr : breakTokenAddr) as Address | undefined;
  const { data: winTokenBalance } = useReadContract({
    address: winTokenAddr, abi: ERC20_ABI, functionName: "balanceOf",
    args: [userAddress],
    query: { enabled: isSettled && !!winTokenAddr },
  });

  // Claim write
  const { writeContract, data: txHash, isPending: walletPending, reset } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } });
  const lastHash = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (isSuccess && txHash && txHash !== lastHash.current) {
      lastHash.current = txHash;
      reset();
    }
  }, [isSuccess, txHash, reset]);

  // Derived
  const totalPool = market.boundPool + market.breakPool;
  const myPool    = isBound ? market.boundPool : market.breakPool;
  const odds      = totalPool > 0n && myPool > 0n ? Number(totalPool) / Number(myPool) : null;
  const estValue  = odds && principal > 0n ? (Number(principal) / 1e6) * odds : null;

  const userWon      = isSettled && boundWins !== undefined ? (isBound ? !!boundWins : !boundWins) : null;
  const tokenBalance = (winTokenBalance as bigint | undefined) ?? 0n;
  const rate         = (redemptionRate as bigint | undefined) ?? 0n;
  const winPayout    = userWon && rate > 0n && tokenBalance > 0n
    ? Number((tokenBalance * rate) / BigInt(1e18)) / 1e6
    : null;

  const principalNum = Number(principal) / 1e6;

  // Value/payout cell
  let valueCell: React.ReactNode;
  if (isSettled && userWon !== null) {
    if (userWon) {
      valueCell = <span style={{ color: "#22C55E", fontWeight: 700, fontFamily: "var(--font-geist-mono)" }}>
        {winPayout !== null ? `$${fmt2(winPayout)}` : "—"}
      </span>;
    } else {
      valueCell = <span style={{ color: "#EF4444", fontWeight: 600 }}>Lost</span>;
    }
  } else if (market.status === "LIVE" && estValue !== null) {
    valueCell = <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-geist-mono)" }}>${fmt2(estValue)}</span>;
  } else {
    valueCell = <span style={{ color: "var(--text-muted)" }}>—</span>;
  }

  // Action cell
  let actionCell: React.ReactNode = null;
  if (isSettled && !claimed) {
    if (userWon) {
      actionCell = (
        <button
          onClick={() => tokenBalance > 0n && writeContract({ address: market.address, abi: MARKET_ABI, functionName: "redeemWinner", args: [tokenBalance] })}
          disabled={walletPending || tokenBalance === 0n}
          style={{
            padding: "0.3rem 0.75rem", borderRadius: 6, border: "none",
            background: walletPending || tokenBalance === 0n ? "#2A2A2A" : "#22C55E",
            color: walletPending || tokenBalance === 0n ? "var(--text-muted)" : "#000",
            fontWeight: 700, fontSize: "0.72rem", cursor: walletPending || tokenBalance === 0n ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >{walletPending ? "…" : "Claim"}</button>
      );
    } else {
      actionCell = (
        <button
          onClick={() => writeContract({ address: market.address, abi: MARKET_ABI, functionName: "claimLoserYield", args: [] })}
          disabled={walletPending}
          style={{
            padding: "0.3rem 0.75rem", borderRadius: 6, border: "1px solid #3A3A3A",
            background: "#1E1E1E", color: "var(--text-secondary)",
            fontWeight: 600, fontSize: "0.72rem", cursor: walletPending ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >{walletPending ? "…" : "Claim yield"}</button>
      );
    }
  } else if (isSettled && claimed) {
    actionCell = <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>Claimed</span>;
  }

  return (
    <tr style={{ borderBottom: "1px solid #1E1E1E" }}>
      {/* Market */}
      <td style={{ padding: "0.85rem 1rem" }}>
        <Link href={`/markets/${market.address}`} style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "0.85rem", textDecoration: "none", display: "block" }}>
          {market.asset} / USD
        </Link>
        <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", marginTop: "0.15rem" }}>
          {fmtRange(market.lowerBound, market.upperBound)}
        </div>
      </td>

      {/* Side */}
      <td style={{ padding: "0.85rem 1rem" }}>
        <span style={{
          display: "inline-block", padding: "0.2rem 0.55rem", borderRadius: 5,
          background: `${sideColor}14`, border: `1px solid ${sideColor}33`,
          color: sideColor, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em",
        }}>
          {isBound ? "BOUND" : "BREAK"}
        </span>
      </td>

      {/* Status */}
      <td className="col-hide-mobile" style={{ padding: "0.85rem 1rem" }}>
        <span style={{
          display: "inline-block", padding: "0.2rem 0.55rem", borderRadius: 5,
          background: `${statusColor}14`, border: `1px solid ${statusColor}33`,
          color: statusColor, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em",
        }}>
          {market.status}
        </span>
      </td>

      {/* Invested */}
      <td style={{ padding: "0.85rem 1rem", fontFamily: "var(--font-geist-mono)", fontSize: "0.85rem", color: "var(--text-primary)", fontWeight: 600 }}>
        ${fmt2(principalNum)}
      </td>

      {/* Value / Payout */}
      <td style={{ padding: "0.85rem 1rem", fontSize: "0.85rem" }}>
        {valueCell}
      </td>

      {/* Expires */}
      <td className="col-hide-mobile" style={{ padding: "0.85rem 1rem", color: "var(--text-muted)", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
        {timeLeft(market.expiryTimestamp)}
      </td>

      {/* Action */}
      <td style={{ padding: "0.85rem 1rem", textAlign: "right" }}>
        {actionCell}
      </td>
    </tr>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TradesClient({ markets }: { markets: MarketData[] }) {
  const { address, isConnected } = useAccount();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "LIVE" | "PENDING" | "SETTLED" | "CANCELLED">("ALL");
  const [sideFilter, setSideFilter] = useState<"ALL" | "BOUND" | "BREAK">("ALL");

  const { data: positionsData, isLoading } = useReadContracts({
    contracts: markets.map(m => ({
      address: m.address,
      abi: MARKET_ABI,
      functionName: "positions" as const,
      args: [address ?? "0x0000000000000000000000000000000000000000"],
    })),
    query: { enabled: isConnected && !!address && markets.length > 0 },
  });

  if (!isConnected || !address) {
    return (
      <div>
        <h1 style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1.3rem", marginBottom: "2rem" }}>My Positions</h1>
        <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "3rem", textAlign: "center" }}>
          <div style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: "0.4rem" }}>Wallet not connected</div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Connect your wallet to view your positions</div>
        </div>
      </div>
    );
  }

  // Struct order: [principal, morphoShares, isBound, exists, claimed]
  type PosResult = [bigint, bigint, boolean, boolean, boolean];
  const rows: Array<{ market: MarketData; principal: bigint; isBound: boolean; claimed: boolean }> = [];
  if (positionsData) {
    for (let i = 0; i < markets.length; i++) {
      const r = positionsData[i];
      if (r?.status === "success" && r.result) {
        const pos = r.result as PosResult;
        if (pos[3]) rows.push({ market: markets[i], principal: pos[0], isBound: pos[2], claimed: pos[4] });
      }
    }
  }

  const filtered = rows.filter(({ market, isBound }) => {
    if (search && !market.asset.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "ALL" && market.status !== statusFilter) return false;
    if (sideFilter === "BOUND" && !isBound) return false;
    if (sideFilter === "BREAK" && isBound) return false;
    return true;
  });

  return (
    <div>
      <h1 style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1.3rem", marginBottom: "1.25rem" }}>My Positions</h1>

      {/* Search + filters */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        {/* Search */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <svg style={{ position: "absolute", left: "0.7rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search asset…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              borderRadius: 8, padding: "0.45rem 0.75rem 0.45rem 2rem",
              color: "var(--text-primary)", fontSize: "0.82rem", outline: "none",
              width: 160,
            }}
          />
        </div>

        {/* Status filter */}
        <div style={{ display: "flex", gap: "0.3rem" }}>
          {(["ALL", "LIVE", "PENDING", "SETTLED", "CANCELLED"] as const).map(s => {
            const active = statusFilter === s;
            const col = s === "LIVE" ? "#22C55E" : s === "CANCELLED" ? "#EF4444" : "var(--text-muted)";
            return (
              <button key={s} onClick={() => setStatusFilter(s)} style={{
                padding: "0.35rem 0.65rem", borderRadius: 6, fontSize: "0.68rem", fontWeight: 600,
                letterSpacing: "0.06em", cursor: "pointer", transition: "all 0.12s",
                border: active ? `1px solid ${s === "LIVE" ? "#22C55E44" : s === "CANCELLED" ? "#EF444444" : "#444"}` : "1px solid transparent",
                background: active ? (s === "LIVE" ? "#22C55E14" : s === "CANCELLED" ? "#EF444414" : "#2A2A2A") : "transparent",
                color: active ? col : "var(--text-muted)",
              }}>{s}</button>
            );
          })}
        </div>

        {/* Side filter */}
        <div style={{ display: "flex", gap: "0.3rem", marginLeft: "auto" }}>
          {(["ALL", "BOUND", "BREAK"] as const).map(s => {
            const active = sideFilter === s;
            const col = s === "BOUND" ? "#22C55E" : s === "BREAK" ? "#EF4444" : "var(--text-muted)";
            return (
              <button key={s} onClick={() => setSideFilter(s)} style={{
                padding: "0.35rem 0.65rem", borderRadius: 6, fontSize: "0.68rem", fontWeight: 600,
                letterSpacing: "0.06em", cursor: "pointer", transition: "all 0.12s",
                border: active ? `1px solid ${s === "BOUND" ? "#22C55E44" : s === "BREAK" ? "#EF444444" : "#444"}` : "1px solid transparent",
                background: active ? (s === "BOUND" ? "#22C55E14" : s === "BREAK" ? "#EF444414" : "#2A2A2A") : "transparent",
                color: active ? col : "var(--text-muted)",
              }}>{s}</button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "3rem 0", textAlign: "center" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "3rem", textAlign: "center" }}>
          <div style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: "0.4rem" }}>No positions yet</div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Trade on a market to see your positions here</div>
        </div>
      ) : (
        <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div className="table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #2A2A2A" }}>
                {[
                  { label: "Market",         hide: false },
                  { label: "Side",           hide: false },
                  { label: "Status",         hide: true  },
                  { label: "Invested",       hide: false },
                  { label: "Value / Payout", hide: false },
                  { label: "Expires",        hide: true  },
                  { label: "",               hide: false },
                ].map(({ label, hide }) => (
                  <th key={label} className={hide ? "col-hide-mobile" : ""} style={{
                    padding: "0.6rem 1rem", textAlign: label === "" ? "right" : "left",
                    color: "var(--text-muted)", fontSize: "0.65rem", fontWeight: 600,
                    letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap",
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "2.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                    No positions match your filters
                  </td>
                </tr>
              ) : filtered.map(({ market, principal, isBound, claimed }) => (
                <PositionRow
                  key={market.address}
                  market={market}
                  userAddress={address}
                  principal={principal}
                  isBound={isBound}
                  claimed={claimed}
                />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
