"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, type Address } from "viem";
import { FACTORY_ABI, ERC20_ABI, CHAINLINK_ABI } from "@/lib/abis";

const FACTORY = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address;

const DURATION_OPTIONS = [
  { label: "15m", value: 15 * 60 },
  { label: "1h", value: 60 * 60 },
  { label: "4h", value: 4 * 60 * 60 },
  { label: "24h", value: 24 * 60 * 60 },
  { label: "3d", value: 3 * 24 * 60 * 60 },
  { label: "7d", value: 7 * 24 * 60 * 60 },
  { label: "30d", value: 30 * 24 * 60 * 60 },
];

const BAND_OPTIONS = [
  { label: "1%", value: 100 },
  { label: "2%", value: 200 },
  { label: "3%", value: 300 },
  { label: "5%", value: 500 },
  { label: "10%", value: 1000 },
  { label: "20%", value: 2000 },
];

const QUICK_AMOUNTS = [10, 25, 50, 100];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function ordinal(d: number) {
  if (d === 1 || d === 21 || d === 31) return `${d}st`;
  if (d === 2 || d === 22) return `${d}nd`;
  if (d === 3 || d === 23) return `${d}rd`;
  return `${d}th`;
}

function formatExpiry(durationSecs: number): string {
  const d = new Date(Date.now() + durationSecs * 1000);
  const day = ordinal(d.getUTCDate());
  const month = MONTHS[d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${hh}:${mm} UTC`;
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.85rem",
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text-primary)",
  fontSize: "0.875rem",
  fontWeight: 600,
  cursor: "pointer",
  outline: "none",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23444' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.75rem center",
  paddingRight: "2rem",
};

export default function CreatePage() {
  const { address, isConnected } = useAccount();

  const [asset, setAsset] = useState("");
  const [band, setBand] = useState(300);
  const [duration, setDuration] = useState(24 * 60 * 60);
  const [side, setSide] = useState<boolean>(true);
  const [amountStr, setAmountStr] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "creating" | "done">("idle");
  const [error, setError] = useState("");

  const { data: assets } = useReadContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getWhitelistedAssets" });
  const { data: minDeposit } = useReadContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "minCreatorDeposit" });
  const { data: usdcAddress } = useReadContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "collateralToken" });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress as Address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && FACTORY ? [address, FACTORY] : undefined,
    query: { enabled: !!address && !!usdcAddress },
  });
  const { data: usdcBalance } = useReadContract({
    address: usdcAddress as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!usdcAddress },
  });
  const { data: feedAddress } = useReadContract({
    address: FACTORY,
    abi: FACTORY_ABI,
    functionName: "assetFeeds",
    args: asset ? [asset] : undefined,
    query: { enabled: !!asset },
  });
  const { data: feedDecimals } = useReadContract({
    address: feedAddress as Address,
    abi: CHAINLINK_ABI,
    functionName: "decimals",
    query: { enabled: !!feedAddress },
  });
  const { data: roundData } = useReadContract({
    address: feedAddress as Address,
    abi: CHAINLINK_ABI,
    functionName: "latestRoundData",
    query: { enabled: !!feedAddress, refetchInterval: 30_000 },
  });

  useEffect(() => {
    if (assets && (assets as string[]).length > 0 && !asset) setAsset((assets as string[])[0]);
  }, [assets, asset]);

  const { writeContract, data: txHash, isPending: walletPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isMining, isSuccess, isError: txFailed } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } });
  const lastHandledHash = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isSuccess || !txHash || txHash === lastHandledHash.current) return;
    lastHandledHash.current = txHash;
    if (step === "approving") {
      refetchAllowance().then(() => setStep("idle"));
    } else if (step === "creating") {
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

  const amountUsdc = amountStr ? parseUnits(amountStr, 6) : 0n;
  const minDepositNum = minDeposit ? Number(minDeposit) / 1e6 : 5;
  const needsApproval = !allowance || (allowance as bigint) < amountUsdc;
  const busy = walletPending || isMining;

  const balanceNum = usdcBalance ? Number(usdcBalance) / 1e6 : null;
  const currentPrice = roundData && feedDecimals != null
    ? Number((roundData as [bigint, bigint, bigint, bigint, bigint])[1]) / Math.pow(10, feedDecimals as number)
    : null;
  const lowerBound = currentPrice != null ? currentPrice * (1 - band / 10000) : null;
  const upperBound = currentPrice != null ? currentPrice * (1 + band / 10000) : null;

  const amountNum = Number(amountStr) || 0;
  const canSubmit = !!asset && !!amountStr && amountNum >= minDepositNum && (balanceNum === null || amountNum <= balanceNum);

  const boundTokenName = asset ? `${asset} ±${band / 100}% BOUND` : "";
  const boundTokenSymbol = asset ? `${asset}BOUND` : "";
  const breakTokenName = asset ? `${asset} ±${band / 100}% BREAK` : "";
  const breakTokenSymbol = asset ? `${asset}BREAK` : "";

  function handleApprove() {
    if (!usdcAddress) return;
    setError(""); setStep("approving");
    writeContract({ address: usdcAddress as Address, abi: ERC20_ABI, functionName: "approve", args: [FACTORY, amountUsdc] });
  }

  function handleCreate() {
    if (!canSubmit) return setError(`Minimum deposit is $${minDepositNum} USDC`);
    setError(""); setStep("creating");
    writeContract({
      address: FACTORY, abi: FACTORY_ABI, functionName: "createMarket",
      args: [asset, BigInt(band), BigInt(duration), side, amountUsdc,
             boundTokenName, boundTokenSymbol, breakTokenName, breakTokenSymbol],
    });
  }

  if (step === "done") {
    return (
      <div style={{ maxWidth: 480, margin: "6rem auto", textAlign: "center" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>✦</div>
        <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1.3rem", marginBottom: "0.5rem" }}>
          Market is live
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "2rem", lineHeight: 1.6 }}>
          Your {asset} ±{band / 100}% market is PENDING.<br />
          It activates once the opposing side hits 50% of your stake.
        </div>
        <button
          onClick={() => { setStep("idle"); setAmountStr(""); }}
          style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "0.75rem 2rem", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem" }}
        >
          Open another
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>

      {/* Floating header */}
      <div style={{
        marginBottom: "1rem",
        padding: "1rem 1.25rem",
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.65rem" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 13.5l4.5-4.5 4 4 4.5-5.5 4 4" />
          </svg>
          <span style={{ color: "var(--text-muted)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.12em" }}>Heading</span>
        </div>
        <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1.1rem", lineHeight: 1.45 }}>
          {asset ? (
            <>
              <span style={{ color: "var(--accent)" }}>{asset}</span>
              {" "}BREAK/BOUND ${lowerBound != null ? lowerBound.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "…"} — ${upperBound != null ? upperBound.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "…"} by{" "}
              <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>{formatExpiry(duration)}</span>
              {"?"}
            </>
          ) : (
            <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: "0.95rem" }}>
              Select an asset to preview your market
            </span>
          )}
        </div>
      </div>

      {/* Main panel */}
      <div style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 20,
        overflow: "hidden",
      }}>

        {/* Asset + Band + Duration row */}
        <div className="create-selects" style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border-subtle)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em", marginBottom: "0.6rem" }}>ASSET</div>
            <select value={asset} onChange={(e) => setAsset(e.target.value)} style={selectStyle}>
              {(assets as string[] | undefined)?.map((a) => (
                <option key={a} value={a}>{a} / USD</option>
              ))}
              {!assets && <option>Loading…</option>}
            </select>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em", marginBottom: "0.6rem" }}>BAND</div>
            <select value={band} onChange={(e) => setBand(Number(e.target.value))} style={selectStyle}>
              {BAND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>±{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em", marginBottom: "0.6rem" }}>DURATION</div>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={selectStyle}>
              {DURATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Live price + range */}
        <div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-secondary)" }}>
          {currentPrice != null ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", marginBottom: "0.2rem" }}>START PRICE</div>
                <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1rem", fontFamily: "var(--font-geist-mono)" }}>
                  ${currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.08em", marginBottom: "0.2rem" }}>LOWER</div>
                  <div style={{ color: "#22C55E", fontWeight: 600, fontSize: "0.82rem", fontFamily: "var(--font-geist-mono)" }}>
                    ${lowerBound!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div style={{ flex: 1, height: 2, background: "linear-gradient(90deg, #22C55E, var(--accent), #EF4444)", borderRadius: 2, opacity: 0.6 }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.08em", marginBottom: "0.2rem" }}>UPPER</div>
                  <div style={{ color: "#EF4444", fontWeight: 600, fontSize: "0.82rem", fontFamily: "var(--font-geist-mono)" }}>
                    ${upperBound!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
              {asset ? "Fetching price…" : "Select an asset"}
            </div>
          )}
        </div>

        {/* BOUND / BREAK hero selector */}
        <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ padding: "0.85rem 1.25rem 0.6rem", color: "var(--text-muted)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em" }}>
            YOUR POSITION
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <button
              onClick={() => setSide(true)}
              style={{
                padding: "0.85rem 1.25rem",
                border: "none",
                borderRight: "1px solid var(--border-subtle)",
                background: side ? "rgba(0,82,255,0.08)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s",
                position: "relative",
              }}
            >
              {side && (
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "var(--accent)", borderRadius: "0 0 2px 2px" }} />
              )}
              <div style={{ color: side ? "var(--accent)" : "var(--text-secondary)", fontWeight: 800, fontSize: "1.1rem", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
                BOUND
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", lineHeight: 1.5 }}>
                Price stays within ±{band / 100}%
              </div>
            </button>
            <button
              onClick={() => setSide(false)}
              style={{
                padding: "0.85rem 1.25rem",
                border: "none",
                background: !side ? "rgba(0,82,255,0.08)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s",
                position: "relative",
              }}
            >
              {!side && (
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "var(--accent)", borderRadius: "0 0 2px 2px" }} />
              )}
              <div style={{ color: !side ? "var(--accent)" : "var(--text-secondary)", fontWeight: 800, fontSize: "1.1rem", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
                BREAK
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", lineHeight: 1.5 }}>
                Price breaks outside ±{band / 100}%
              </div>
            </button>
          </div>
        </div>

        {/* Amount input */}
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.1em", marginBottom: "0.6rem" }}>
            OPENING STAKE
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <input
              type="number"
              min={minDepositNum}
              step="1"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text-primary)",
                fontSize: "2rem",
                fontWeight: 700,
                fontFamily: "var(--font-geist-mono)",
                width: "100%",
              }}
            />
            <span style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "0.3rem 0.7rem",
              color: "var(--text-secondary)",
              fontSize: "0.8rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}>
              USDC
            </span>
          </div>
          {/* Quick amounts + balance */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
            {QUICK_AMOUNTS.map((a) => {
              const overBalance = balanceNum !== null && a > balanceNum;
              return (
                <button key={a} onClick={() => !overBalance && setAmountStr(String(a))} style={{
                  padding: "0.25rem 0.6rem",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: overBalance ? "var(--border)" : "var(--text-muted)",
                  fontSize: "0.72rem",
                  cursor: overBalance ? "not-allowed" : "pointer",
                }}>
                  ${a}
                </button>
              );
            })}
            {balanceNum !== null && (
              <button
                onClick={() => setAmountStr(balanceNum.toFixed(2))}
                style={{
                  padding: "0.25rem 0.6rem",
                  borderRadius: 6,
                  border: "1px solid var(--accent-border)",
                  background: "var(--accent-dim)",
                  color: "var(--accent)",
                  fontSize: "0.72rem",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                MAX
              </button>
            )}
            <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: "0.72rem" }}>
              {balanceNum !== null
                ? `Balance: $${balanceNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `min $${minDepositNum}`}
            </span>
          </div>
          {balanceNum !== null && amountNum > balanceNum && (
            <div style={{ color: "#EF4444", fontSize: "0.72rem", marginTop: "0.4rem" }}>
              Exceeds your USDC balance
            </div>
          )}
        </div>

        {/* Summary row */}
        {asset && (
          <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--border-subtle)", display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
            {[
              { k: "Asset", v: `${asset} / USD` },
              { k: "Band", v: `±${band / 100}%` },
              { k: "Duration", v: DURATION_OPTIONS.find(o => o.value === duration)?.label ?? "" },
              { k: "Side", v: side ? "BOUND" : "BREAK", accent: true },
            ].map(({ k, v, accent }) => (
              <div key={k}>
                <div style={{ color: "var(--text-muted)", fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.08em", marginBottom: "0.2rem" }}>{k}</div>
                <div style={{ color: accent ? "var(--accent)" : "var(--text-primary)", fontWeight: 700, fontSize: "0.8rem" }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div style={{ padding: "1rem 1.25rem" }}>
          {error && (
            <div style={{ color: "#EF4444", fontSize: "0.78rem", marginBottom: "0.75rem" }}>{error}</div>
          )}
          {!isConnected ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>
              Connect your wallet to continue
            </div>
          ) : needsApproval ? (
            <button onClick={handleApprove} disabled={busy || !canSubmit} style={ctaStyle(busy || !canSubmit)}>
              {walletPending ? "Check wallet…" : step === "approving" ? "Approving…" : "Approve USDC"}
            </button>
          ) : (
            <button onClick={handleCreate} disabled={busy || !canSubmit} style={ctaStyle(busy || !canSubmit)}>
              {walletPending ? "Check wallet…" : step === "creating" ? "Opening market…" : "Open Market"}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

function ctaStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "0.9rem",
    borderRadius: 12,
    border: "none",
    background: disabled ? "var(--border)" : "var(--accent)",
    color: disabled ? "var(--text-muted)" : "#fff",
    fontWeight: 700,
    fontSize: "0.95rem",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : "0 0 24px rgba(0,82,255,0.35)",
    transition: "all 0.15s",
    letterSpacing: "0.03em",
  };
}
