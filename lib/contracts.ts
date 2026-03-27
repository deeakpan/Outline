import { publicClient } from "./client";
import { FACTORY_ABI, MARKET_ABI } from "./abis";
import { type Address } from "viem";

const FACTORY = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address;

export type MarketStatus = "PENDING" | "LIVE" | "SETTLED" | "CANCELLED";

const STATUS_MAP: MarketStatus[] = ["PENDING", "LIVE", "SETTLED", "CANCELLED"];

export interface MarketData {
  address: Address;
  asset: string;
  lowerBound: bigint;
  upperBound: bigint;
  startPrice: bigint;
  expiryTimestamp: bigint;
  creationTimestamp: bigint;
  status: MarketStatus;
  boundPool: bigint;
  breakPool: bigint;
  creatorSide: boolean;
}

export async function getMarketAddresses(): Promise<Address[]> {
  const addresses = await publicClient.readContract({
    address: FACTORY,
    abi: FACTORY_ABI,
    functionName: "getAllMarkets",
  });
  return addresses as Address[];
}

export async function getMarket(address: Address): Promise<MarketData> {
  const [config, statusRaw, boundPool, breakPool, creatorSide] = await Promise.all([
    publicClient.readContract({ address, abi: MARKET_ABI, functionName: "marketConfig" }),
    publicClient.readContract({ address, abi: MARKET_ABI, functionName: "status" }),
    publicClient.readContract({ address, abi: MARKET_ABI, functionName: "boundPool" }),
    publicClient.readContract({ address, abi: MARKET_ABI, functionName: "breakPool" }),
    publicClient.readContract({ address, abi: MARKET_ABI, functionName: "creatorSide" }),
  ]);

  const [asset, lowerBound, upperBound, expiryTimestamp, creationTimestamp, startPrice] = config as [string, bigint, bigint, bigint, bigint, bigint, boolean];

  return {
    address,
    asset,
    lowerBound,
    upperBound,
    startPrice,
    expiryTimestamp,
    creationTimestamp,
    status: STATUS_MAP[statusRaw as number] ?? "PENDING",
    boundPool: boundPool as bigint,
    breakPool: breakPool as bigint,
    creatorSide: creatorSide as boolean,
  };
}

export async function getAllMarkets(): Promise<MarketData[]> {
  const addresses = await getMarketAddresses();
  if (addresses.length === 0) return [];
  return Promise.all(addresses.map(getMarket));
}

export function formatUSDC(amount: bigint): string {
  const n = Number(amount) / 1e6;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPrice(amount: bigint): string {
  return (Number(amount) / 1e6).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
