"use client";

import { useState, useMemo } from "react";
import type { MarketData } from "@/lib/contracts";
import MarketCard from "./MarketCard";
import AssetSelect from "./AssetSelect";
import FilterSelect from "./FilterSelect";
import TradingPanel from "./TradingPanel";

const DURATION_OPTIONS = ["All durations", "< 4h", "4h – 3d", "> 3d"];
const DURATION_TESTS = [
  () => true,
  (s: number) => s < 4 * 3600,
  (s: number) => s >= 4 * 3600 && s <= 3 * 86400,
  (s: number) => s > 3 * 86400,
];

const BAND_OPTIONS = ["All bands", "≤ 2%", "3 – 5%", "≥ 10%"];
const BAND_TESTS = [
  () => true,
  (b: number) => b <= 200,
  (b: number) => b >= 300 && b <= 500,
  (b: number) => b >= 1000,
];

function approxBandBps(m: MarketData) {
  if (m.startPrice === 0n) return 0;
  return Math.round((Number(m.upperBound - m.startPrice) / Number(m.startPrice)) * 10000);
}

function durationSecs(m: MarketData) {
  return Number(m.expiryTimestamp - m.creationTimestamp);
}

export default function MarketsClient({ markets }: { markets: MarketData[] }) {
  const [asset, setAsset] = useState("All assets");
  const [duration, setDuration] = useState(0);
  const [band, setBand] = useState(0);
  const [tradePanel, setTradePanel] = useState<{ market: MarketData; side: "BOUND" | "BREAK" } | null>(null);

  const filtered = useMemo(() => markets.filter(m => {
    if (asset !== "All assets" && m.asset !== asset) return false;
    if (!DURATION_TESTS[duration](durationSecs(m))) return false;
    if (!BAND_TESTS[band](approxBandBps(m))) return false;
    return true;
  }), [markets, asset, duration, band]);

  const isFiltered = asset !== "All assets" || duration !== 0 || band !== 0;

  return (
    <>
      <div className="markets-filters" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <AssetSelect value={asset} onChange={setAsset} />
        <FilterSelect options={DURATION_OPTIONS} value={duration} onChange={setDuration} />
        <FilterSelect options={BAND_OPTIONS} value={band} onChange={setBand} />
        {isFiltered && (
          <button
            onClick={() => { setAsset("All assets"); setDuration(0); setBand(0); }}
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.78rem", cursor: "pointer", padding: "0.45rem 0.25rem", whiteSpace: "nowrap" }}
          >
            Clear
          </button>
        )}
        <span className="filter-count" style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
          {filtered.length} market{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
          No markets match these filters
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
          {filtered.map(m => (
            <MarketCard key={m.address} market={m} onTrade={side => setTradePanel({ market: m, side })} />
          ))}
        </div>
      )}

      {tradePanel && (
        <TradingPanel
          market={tradePanel.market}
          side={tradePanel.side}
          onClose={() => setTradePanel(null)}
        />
      )}
    </>
  );
}
