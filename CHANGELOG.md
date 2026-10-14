# Changelog

## 0.4.0 — Mint-mining launches (RADR-style) (2026-10-10)

- **Added** a second launch kind next to the standard sale: `PortusFactory.createMintLaunch` deploys
  `PortusMintToken` (initial supply minted once; only the Emission can mint, capped cumulatively),
  `PortusTaxPool` (token-side buy/sell tax with burn + recipients, anti-dump levy above a price-impact
  threshold, no LP shares, `sync`) and `PortusEmission` (monthly-compounding schedule, permissionless
  `mintDaily` into the Distributor). The sale is the existing `PortusSale` (half sold, half paired).
- **Changed** `PortusDistributor.available(token, token)` now also counts tokens funded by the launch's
  funder (the Emission). Factory events: `MintLaunch`, `MintTaxSet`; flags `isMintPool`, `emissionOf`.
- Rewards: `mintDayAllocation` (static by holding rank, dynamic by single-level referral power).
  Keeper runs `mintDaily` and syncs stray quote into the pool. API exposes `kind` and `mint`.
- Web: issuance-model choice on the create page, mint-mode fields, mint panel on the launch page,
  token-tax quotes in the trade panel. See `docs/mint-mode.md`.
- Private keys are accepted with or without `0x` in the keeper and reward publisher too.

## 0.3.1 — Sepolia test deployment (2026-10-10)

- **Added** Sepolia (11155111) back to the supported chains for test deployments (`SEPOLIA_RPC_URL`).
- **Added** `TestWETH` (`tWETH`, mint ≤ 10 per call, testnet only) and `PORTUS_TEST_WETH=yes` /
  `SEED_DEMO_LAUNCH=true` in `deploy.ts` for public testnets.
- `DEPLOYER_PRIVATE_KEY` is accepted with or without the `0x` prefix.
- Deployed to Sepolia: see `deployments/11155111.json`.

## 0.3.0 — Economy per the Portus docs (2026-10-10)

- **Added** `PortusFeeSplitter` (four-way split: ecosystem 20% / flywheel 20% / creator 0–40% / treasury rest),
  `PortusTreasury` (per launch; TWAP-guarded buyback-and-burn or 24h TWAB rewards),
  `PortusDistributor` (daily incentive release, treasury rewards, Merkle claims with a 24h challenge
  period, single-level referral binding) and `PortusFlywheel` (7-day TWAP top-10 per quote asset, burn).
- **Changed** `PortusPool`: fees and skimmed quote go to the FeeSplitter; third-party
  `addLiquidity` / `removeLiquidity`; genesis LP tracked as `lockedShares`.
- **Changed** `PortusSale`: SHRINK keeps the incentive pool whole (docs: burn only (1−f)(1−x)S);
  dust goes to the launch Treasury.
- **Changed** `PortusFactory`: constructor takes `(quoteAdmin, ecosystem, rootPublisher)`;
  `LaunchParams` gains `creatorRecipient`, `releaseMode`, `releaseRateBps`; `treasuryMode` is now
  enforced (0 buyback, 1 rewards); `setQuoteAsset` gains `priceSource`, `minPoolLiquidity`;
  new events `LaunchEconomics`, `QuoteAssetChecks`.
- **Removed from use** `IncentiveVault`, `FeeSink` (sources still in the tree, pending archive).
- Keeper runs the permissionless economy duties; `npm run rewards` computes and publishes reward roots.
- Web: economy panel, my rewards, liquidity, `/me` (fee claims, invite link), `/flywheel`.

## 0.2.0 — Obscura → Portus (2026-10-09)

Breaking rewrite of the main line. Pre-change sources are kept in
`docs/archive/obscura/` and `deployments/archive-obscura/`.

### Contracts
- **Removed:** `LaunchpadAuction` (commit/reveal, uniform clearing price, batch
  settlement, forfeiture), `AgentRegistry`, `IPersonhoodVerifier`,
  `MockPersonhoodVerifier`, and with them `withdrawProceeds`, `reclaimUnsold`,
  `sweepForfeited` and every `onlyOwner` function.
- **Added:** `PortusFactory`, `PortusSale`, `PortusPool`, `PortusLocker`,
  `IncentiveVault` (placeholder), `FeeSink` (placeholder), deployer libraries.
- **Changed:** `LaunchToken` — fixed supply minted once, burnable, no owner.

### Packages and environment
- Package scope `@obscura/*` → `@portus/*`; root package `obscura` → `portus`.
- `packages/mcp-server` moved to `frozen/mcp-server` and removed from the workspaces.
- Env removed: `OBSCURA_AUCTION_ADDRESS`, `NEXT_PUBLIC_OBSCURA_AUCTION_ADDRESS`,
  `OBSCURA_REGISTRY_ADDRESS`, `SEPOLIA_RPC_URL`, `BASE_SEPOLIA_RPC_URL`,
  `BASE_RPC_URL`, `BASESCAN_API_KEY`, `COMMIT_MINUTES`, `REVEAL_MINUTES`,
  `SEED_DEMO_AUCTION`. MCP variables moved to `frozen/mcp-server/.env.example`.
- Env added: `PORTUS_FACTORY_ADDRESS`, `PORTUS_LOCKER_ADDRESS`,
  `PORTUS_INCENTIVE_VAULT_ADDRESS`, `PORTUS_FEE_SINK_ADDRESS`,
  `NEXT_PUBLIC_PORTUS_FACTORY_ADDRESS`, `PORTUS_QUOTE_ADMIN`,
  `ROBINHOOD_TESTNET_RPC_URL`, `ROBINHOOD_RPC_URL`, `ETHEREUM_RPC_URL`,
  `BLOCKSCOUT_API_KEY`, `SALE_MINUTES`, `SEED_DEMO_LAUNCH`, `NEXT_PUBLIC_DOCS_URL`.
- Chains: Sepolia / Base Sepolia / Base removed; Robinhood Chain Testnet (46630),
  Robinhood Chain (4663) and Ethereum (1) added.

### API
- EIP-712 domain `"Agent Launchpad Copy"` → `"Portus Launch Copy"`, bound to the
  factory. Launches are keyed by token address, not auction id. New
  `WhitelistAuthorization` upload, checked against the on-chain Merkle root.
- New database (`./data/portus.sqlite`); the Obscura database is not migrated.

### Web
- `/download` (MCP bundle) removed. Launch pages move from `/launch/[id]` to
  `/launch/[token]` and gain subscribe, claim, finalize and trade panels.
