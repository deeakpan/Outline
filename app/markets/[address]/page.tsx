import { getMarket } from "@/lib/contracts";
import { notFound } from "next/navigation";
import { type Address } from "viem";
import MarketPageClient from "./MarketPageClient";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;

  try {
    const market = await getMarket(address as Address);
    return <MarketPageClient market={market} />;
  } catch {
    notFound();
  }
}
