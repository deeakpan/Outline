const hre = require("hardhat");

// Reuse existing MockUSDC and MockMorphoVault from prior run
const USDC_ADDRESS  = "0x62060dFA6A6E6340DC2bDCC0b7c8c8cb97f6d5ad";
const VAULT_ADDRESS = "0x2fCE71a1A8137B69C872959294bF0Bf90D1AE8c2";

const CHAINLINK_FEEDS = {
  "ETH":   "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  "BTC":   "0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298",
  "CBETH": "0x3c65e28D357a37589e1C7C86044a9f44dDC17134",
  "DAI":   "0xD1092a65338d049DB68D7Be6bD89d17a0929945e",
  "LINK":  "0xb113F5A928BCfF189C998ab20d753a47F9dE5A61",
  "USDC":  "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165",
};

async function main() {
  const provider = new hre.ethers.JsonRpcProvider(
    process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org"
  );
  const wallet = new hre.ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log("Deploying with:", wallet.address);
  console.log("ETH balance:", hre.ethers.formatEther(await provider.getBalance(wallet.address)));

  // Manually track nonce to avoid provider caching issues
  let nonce = await provider.getTransactionCount(wallet.address, "latest");
  console.log("Starting nonce:", nonce);

  // 1. Deploy factory
  console.log("\nDeploying OutlineMarketFactory...");
  const Factory = await hre.ethers.getContractFactory("OutlineMarketFactory", wallet);
  const factory = await Factory.deploy(USDC_ADDRESS, VAULT_ADDRESS, wallet.address, { nonce: nonce++ });
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("OutlineMarketFactory deployed:", factoryAddress);

  // 3. Deploy order book
  console.log("\nDeploying OutlineOrderBook...");
  const OrderBook = await hre.ethers.getContractFactory("OutlineOrderBook", wallet);
  const orderBook = await OrderBook.deploy(USDC_ADDRESS, factoryAddress, wallet.address, { nonce: nonce++ });
  await orderBook.waitForDeployment();
  const orderBookAddress = await orderBook.getAddress();
  console.log("OutlineOrderBook deployed:", orderBookAddress);

  console.log("\n✓ Contracts deployed. Run whitelist next:");
  console.log(`npx hardhat run scripts/whitelist-assets.js --network baseSepolia`);
  console.log("\n─".repeat(50));
  console.log("MockUSDC:            ", USDC_ADDRESS);
  console.log("MockMorphoVault:     ", VAULT_ADDRESS);
  console.log("OutlineMarketFactory:", factoryAddress);
  console.log("OutlineOrderBook:    ", orderBookAddress);
  console.log("─".repeat(50));
  console.log("\nVerify:");
  console.log(`npx hardhat verify --network baseSepolia ${factoryAddress} "${USDC_ADDRESS}" "${VAULT_ADDRESS}" "${wallet.address}"`);
  console.log(`npx hardhat verify --network baseSepolia ${orderBookAddress} "${USDC_ADDRESS}" "${factoryAddress}" "${wallet.address}"`);
}

main().catch((err) => { console.error(err); process.exit(1); });
