const hre = require("hardhat");

const FACTORY_ADDRESS = "0xd2470de0c563786C486D411846c3869700DeabCA";

const CHAINLINK_FEEDS = {
  "ETH":   "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  "BTC":   "0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298",
  "CBETH": "0x3c65e28D357a37589e1C7C86044a9f44dDC17134",
  "DAI":   "0xD1092a65338d049DB68D7Be6bD89d17a0929945e",
  "LINK":  "0xb113F5A928BCfF189C998ab20d753a47F9dE5A61",
  "USDC":  "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const factory = await hre.ethers.getContractAt("OutlineMarketFactory", FACTORY_ADDRESS);

  let nonce = await hre.ethers.provider.getTransactionCount(deployer.address, "latest");
  console.log("Starting nonce:", nonce);

  for (const [asset, feed] of Object.entries(CHAINLINK_FEEDS)) {
    // Skip if already whitelisted
    const already = await factory.isAssetWhitelisted(asset);
    if (already) {
      console.log(`  ${asset} already whitelisted, skipping`);
      continue;
    }

    console.log(`  Whitelisting ${asset}...`);
    const tx = await factory.whitelistAsset(asset, feed, { nonce: nonce++ });
    await tx.wait();
    console.log(`  ${asset} ✓`);
    await sleep(2000); // 2s gap between txs
  }

  console.log("\n✓ All assets whitelisted");
  console.log("─".repeat(50));
  console.log("MockUSDC:            ", "0x62060dFA6A6E6340DC2bDCC0b7c8c8cb97f6d5ad");
  console.log("MockMorphoVault:     ", "0x2fCE71a1A8137B69C872959294bF0Bf90D1AE8c2");
  console.log("OutlineMarketFactory:", FACTORY_ADDRESS);
  console.log("─".repeat(50));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
