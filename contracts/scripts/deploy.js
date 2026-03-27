const hre = require("hardhat");

// Chainlink price feeds on Base Sepolia
// https://docs.chain.link/data-feeds/price-feeds/addresses?network=base&page=1
const CHAINLINK_FEEDS = {
  "ETH":      "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1", // ETH/USD
  "BTC":      "0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298", // BTC/USD
  "CBETH":    "0x3c65e28D357a37589e1C7C86044a9f44dDC17134", // CBETH/USD
  "DAI":      "0xD1092a65338d049DB68D7Be6bD89d17a0929945e", // DAI/USD
  "LINK":     "0xb113F5A928BCfF189C998ab20d753a47F9dE5A61", // LINK/USD
  "USDC":     "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165", // USDC/USD
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("ETH balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)));

  // 1. Deploy MockUSDC
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("\nMockUSDC deployed:", usdcAddress);

  // 2. Deploy MockMorphoVault
  const MockMorphoVault = await hre.ethers.getContractFactory("MockMorphoVault");
  const vault = await MockMorphoVault.deploy(usdcAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("MockMorphoVault deployed:", vaultAddress);

  // 3. Authorize vault to mint (for 1% yield bonus on redeem)
  await (await usdc.addMinter(vaultAddress)).wait();
  console.log("MockMorphoVault authorized as minter");

  // 4. Mint yourself 5M USDC for testing
  const mintAmount = hre.ethers.parseUnits("5000000", 6); // 5M USDC
  await (await usdc.mint(deployer.address, mintAmount)).wait();
  console.log("Minted 5,000,000 USDC to", deployer.address);

  // 4. Deploy factory
  const Factory = await hre.ethers.getContractFactory("OutlineMarketFactory");
  const factory = await Factory.deploy(usdcAddress, vaultAddress, deployer.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("OutlineMarketFactory deployed:", factoryAddress);

  // 5. Whitelist assets
  console.log("\nWhitelisting assets...");
  for (const [asset, feed] of Object.entries(CHAINLINK_FEEDS)) {
    await (await factory.whitelistAsset(asset, feed)).wait();
    console.log(`  ${asset} → ${feed}`);
  }

  // 6. Deploy OrderBook
  const OrderBook = await hre.ethers.getContractFactory("OutlineOrderBook");
  const orderBook = await OrderBook.deploy(usdcAddress, factoryAddress, deployer.address);
  await orderBook.waitForDeployment();
  const orderBookAddress = await orderBook.getAddress();
  console.log("OutlineOrderBook deployed:", orderBookAddress);

  console.log("\n✓ Deployment complete");
  console.log("─".repeat(50));
  console.log("MockUSDC:            ", usdcAddress);
  console.log("MockMorphoVault:     ", vaultAddress);
  console.log("OutlineMarketFactory:", factoryAddress);
  console.log("OutlineOrderBook:    ", orderBookAddress);
  console.log("─".repeat(50));
  console.log("\nVerify contracts:");
  console.log(`npx hardhat verify --network baseSepolia ${usdcAddress}`);
  console.log(`npx hardhat verify --network baseSepolia ${vaultAddress} "${usdcAddress}"`);
  console.log(`npx hardhat verify --network baseSepolia ${factoryAddress} "${usdcAddress}" "${vaultAddress}" "${deployer.address}"`);
  console.log(`npx hardhat verify --network baseSepolia ${orderBookAddress} "${usdcAddress}" "${factoryAddress}" "${deployer.address}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
