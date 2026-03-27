<p align="center">
  <img src="public/bluelogo.jpg" alt="Outline" width="80" />
</p>

<h1 align="center">Outline Markets</h1>

<p align="center">Range prediction markets with yield on Base</p>

---

## What is Outline?

Outline is a decentralised prediction market protocol where users bet on whether an asset's price will **stay within** (BOUND) or **break outside** (BREAK) a defined price band by a set expiry.

Every deposit earns yield via **Morpho vaults** while the market is live. At settlement, winners split the pool; losers keep their accrued yield.

## How it works

1. **Create** — seed both sides 50/50, pick an asset, band width (±%), and duration. Market goes LIVE immediately.
2. **Trade** — join BOUND or BREAK with USDC. One side per wallet. Token prices shift as pools fill.
3. **Settle** — after expiry, anyone calls `settle()`. Chainlink feeds the final price. Winners redeem tokens for USDC; losers claim yield.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 App Router, wagmi v3, viem, ConnectKit |
| Contracts | Solidity 0.8.24, Hardhat — Base Sepolia |
| Yield | Morpho ERC-4626 vaults |
| Oracles | Chainlink price feeds |

## Getting started

```bash
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_FACTORY_ADDRESS + RPC URL
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Contracts

Source lives in [`contracts/`](contracts/contracts/). Deploy fresh:

```bash
cd contracts
npm install
npx hardhat run scripts/deploy-fresh.js --network baseSepolia
```
