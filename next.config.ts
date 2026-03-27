import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pino-pretty", "lokijs", "encoding"],
  webpack: (config) => {
    config.externals.push(
      "pino-pretty",
      "lokijs",
      "encoding",
      // optional wagmi connector peer deps — not used by connectkit
      "@walletconnect/ethereum-provider",
      "@safe-global/safe-apps-sdk",
      "@safe-global/safe-apps-provider",
      "@base-org/account",
      "@metamask/connect-evm",
      "porto",
      "porto/internal",
    );
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "assets.coingecko.com" },
      { protocol: "https", hostname: "coin-images.coingecko.com" },
    ],
  },
};

export default nextConfig;
