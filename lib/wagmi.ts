"use client";

import { createConfig, http } from "wagmi";
import { baseSepolia } from "./client";
import { injected, coinbaseWallet } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [
    injected(),
    coinbaseWallet({
      appName: "Outline Markets",
      preference: { options: "smartWalletOnly" },
    }),
  ],
  transports: {
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org"),
  },
});
