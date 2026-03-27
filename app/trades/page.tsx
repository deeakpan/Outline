import { getAllMarkets } from "@/lib/contracts";
import TradesClient from "./TradesClient";

export default async function TradesPage() {
  let markets = [];
  try { markets = await getAllMarkets(); } catch {}
  return <TradesClient markets={markets} />;
}
