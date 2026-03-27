import { getAllMarkets } from "@/lib/contracts";
import type { MarketData } from "@/lib/contracts";
import TradesClient from "./TradesClient";

export default async function TradesPage() {
  let markets: MarketData[] = [];
  try { markets = await getAllMarkets(); } catch {}
  return <TradesClient markets={markets} />;
}
