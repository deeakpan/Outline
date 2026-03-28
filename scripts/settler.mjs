/**
 * Outline Settler
 *
 * - Listens via WebSocket for MarketCreated events on the factory
 * - Persists tracked markets to scripts/markets.json
 * - Every 20s checks which markets have expired and calls settle()
 *
 * Required env vars (copy from .env.local or set directly):
 *   FACTORY_ADDRESS          - factory contract address
 *   WS_RPC_URL               - WebSocket RPC endpoint (wss://...)
 *   RPC_URL                  - HTTP RPC for reads/writes
 *   SETTLER_PRIVATE_KEY      - private key of the settler wallet (0x...)
 */

import { createPublicClient, createWalletClient, webSocket, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
// Load .env.local from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim();
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS ?? process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
const WS_RPC_URL      = process.env.WS_RPC_URL;
const RPC_URL         = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";
const PRIVATE_KEY     = process.env.SETTLER_PRIVATE_KEY;
const MARKETS_FILE    = join(__dirname, "markets.json");
const CHECK_INTERVAL  = 20_000; // 20 seconds

if (!FACTORY_ADDRESS) throw new Error("Missing FACTORY_ADDRESS");
if (!WS_RPC_URL)      throw new Error("Missing WS_RPC_URL (needs wss:// endpoint)");
if (!PRIVATE_KEY)     throw new Error("Missing SETTLER_PRIVATE_KEY");

// ── ABIs ─────────────────────────────────────────────────────────────────────

const FACTORY_ABI = parseAbi([
  "event MarketCreated(address indexed market, address indexed creator, address indexed boundToken, address breakToken, string asset, uint256 lowerBound, uint256 upperBound, uint256 expiryTimestamp, bool creatorSide)",
  "function getAllMarkets() view returns (address[])",
]);

const MARKET_ABI = parseAbi([
  "function settle() nonpayable",
  "function status() view returns (uint8)",
  "function marketConfig() view returns (string asset, uint256 lowerBound, uint256 upperBound, uint256 expiryTimestamp, uint256 creationTimestamp, uint256 startPrice, bool initialized)",
]);

// status enum: 0=PENDING, 1=LIVE, 2=SETTLED, 3=CANCELLED
const STATUS = ["PENDING", "LIVE", "SETTLED", "CANCELLED"];

// ── Persistence ───────────────────────────────────────────────────────────────

function loadMarkets() {
  if (!existsSync(MARKETS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(MARKETS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveMarkets(markets) {
  writeFileSync(MARKETS_FILE, JSON.stringify(markets, null, 2));
}

/** markets = { [address]: { address, asset, expiryTimestamp, addedAt } } */
let markets = loadMarkets();

function addMarket(address, asset, expiryTimestamp) {
  const addr = address.toLowerCase();
  if (markets[addr]) return;
  markets[addr] = { address: addr, asset, expiryTimestamp: Number(expiryTimestamp), addedAt: Date.now() };
  saveMarkets(markets);
  console.log(`[+] Tracked market ${addr} (${asset}, expires ${new Date(Number(expiryTimestamp) * 1000).toISOString()})`);
}

// ── Clients ───────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const wsClient = createPublicClient({
  chain: baseSepolia,
  transport: webSocket(WS_RPC_URL),
});

const walletClient = createWalletClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
  account,
});

// ── Seed from chain ───────────────────────────────────────────────────────────

async function seedExistingMarkets() {
  console.log("[*] Fetching existing markets from chain...");
  try {
    const addresses = await publicClient.readContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "getAllMarkets",
    });

    for (const addr of addresses) {
      if (markets[addr.toLowerCase()]) continue;
      try {
        const cfg = await publicClient.readContract({
          address: addr,
          abi: MARKET_ABI,
          functionName: "marketConfig",
        });
        addMarket(addr, cfg[0], cfg[3]); // asset, expiryTimestamp
      } catch (e) {
        console.warn(`[!] Could not fetch config for ${addr}: ${e.message}`);
      }
    }
    console.log(`[*] Seeded ${addresses.length} markets`);
  } catch (e) {
    console.warn(`[!] Seed failed: ${e.message}`);
  }
}

// ── WebSocket listener ────────────────────────────────────────────────────────

function startListener() {
  console.log("[*] Listening for MarketCreated events via WebSocket...");

  wsClient.watchContractEvent({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    eventName: "MarketCreated",
    onLogs: (logs) => {
      for (const log of logs) {
        const { market, asset, expiryTimestamp } = log.args;
        addMarket(market, asset, expiryTimestamp);
      }
    },
    onError: (err) => {
      console.error("[!] WebSocket error:", err.message);
    },
  });
}

// ── Settle loop ───────────────────────────────────────────────────────────────

async function checkAndSettle() {
  const now = Math.floor(Date.now() / 1000);
  const candidates = Object.values(markets).filter(m => m.expiryTimestamp <= now);

  if (candidates.length === 0) {
    console.log(`[~] No expired markets to settle (${Object.keys(markets).length} tracked)`);
    return;
  }

  console.log(`[*] Checking ${candidates.length} expired market(s)...`);

  for (const market of candidates) {
    try {
      const statusRaw = await publicClient.readContract({
        address: market.address,
        abi: MARKET_ABI,
        functionName: "status",
      });

      const statusStr = STATUS[statusRaw] ?? "UNKNOWN";

      if (statusStr !== "LIVE") {
        console.log(`[=] ${market.address} (${market.asset}) is ${statusStr} — skipping`);
        continue;
      }

      console.log(`[>] Settling ${market.address} (${market.asset})...`);
      const hash = await walletClient.writeContract({
        address: market.address,
        abi: MARKET_ABI,
        functionName: "settle",
        args: [],
      });
      console.log(`[✓] Settle tx sent: ${hash}`);
    } catch (e) {
      console.error(`[!] Failed to settle ${market.address}: ${e.message}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[*] Settler wallet: ${account.address}`);
  console.log(`[*] Factory: ${FACTORY_ADDRESS}`);

  await seedExistingMarkets();
  startListener();

  // Run once immediately, then every 20s
  await checkAndSettle();
  setInterval(checkAndSettle, CHECK_INTERVAL);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
