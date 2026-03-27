import { getAllMarkets } from "@/lib/contracts";
import type { MarketData } from "@/lib/contracts";
import MarketsClient from "./components/MarketsClient";

export default async function MarketsPage() {
  let markets: MarketData[] = [];
  let error: string | null = null;
  try { markets = await getAllMarkets(); }
  catch { error = "Could not load markets. Check your RPC connection."; }

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1.4rem" }}>Markets</h1>
      </div>

      {error ? (
        <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "1rem", color: "#EF4444", fontSize: "0.875rem" }}>
          {error}
        </div>
      ) : markets.length === 0 ? (
        <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-secondary)" }}>No markets yet</div>
          <div style={{ fontSize: "0.875rem" }}>Be the first to <a href="/create" style={{ color: "var(--accent)" }}>create a market</a></div>
        </div>
      ) : (
        <MarketsClient markets={markets} />
      )}
    </div>
  );
}
