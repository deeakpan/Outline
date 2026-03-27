const hre = require("hardhat");

// Already deployed
const USDC_ADDRESS   = "0x62060dFA6A6E6340DC2bDCC0b7c8c8cb97f6d5ad";
const VAULT_ADDRESS  = "0x2fCE71a1A8137B69C872959294bF0Bf90D1AE8c2";

const CHAINLINK_FEEDS = {
  "ETH":   "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  "BTC":   "0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298",
  "CBETH": "0x3c65e28D357a37589e1C7C86044a9f44dDC17134",
  "DAI":   "0xD1092a65338d049DB68D7Be6bD89d17a0929945e",
  "LINK":  "0xb113F5A928BCfF189C998ab20d753a47F9dE5A61",
  "USDC":  "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165",
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Continuing deployment with:", deployer.address);

  const usdc  = await hre.ethers.getContractAt("MockUSDC", USDC_ADDRESS);
  const vault = await hre.ethers.getContractAt("MockMorphoVault", VAULT_ADDRESS);

  // Mint 5M USDC to deployer
  console.log("Minting 5,000,000 USDC to", deployer.address);
  await (await usdc.mint(deployer.address, hre.ethers.parseUnits("5000000", 6))).wait();
  console.log("Done");

  // Deploy factory
  console.log("\nDeploying OutlineMarketFactory...");
  const Factory = await hre.ethers.getContractFactory("OutlineMarketFactory");
  const factory = await Factory.deploy(USDC_ADDRESS, VAULT_ADDRESS, deployer.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("OutlineMarketFactory deployed:", factoryAddress);

  // Whitelist assets
  console.log("\nWhitelisting assets...");
  for (const [asset, feed] of Object.entries(CHAINLINK_FEEDS)) {
    await (await factory.whitelistAsset(asset, feed)).wait();
    console.log(`  ${asset} → ${feed}`);
  }

  console.log("\n✓ Deployment complete");
  console.log("─".repeat(50));
  console.log("MockUSDC:            ", USDC_ADDRESS);
  console.log("MockMorphoVault:     ", VAULT_ADDRESS);
  console.log("OutlineMarketFactory:", factoryAddress);
  console.log("─".repeat(50));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
