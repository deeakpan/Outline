import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

export { baseSepolia };

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL ?? undefined),
});
