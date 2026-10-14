# Portus

A token launchpad built around one guarantee: **the pool opens at exactly the
subscription price, with its liquidity locked forever, and raised funds never
reach anyone's wallet.**

```
whitelist / public subscription at a fixed price
        │  window closes
        ▼
finalize()  — anyone can call it; one transaction:
        ├─ fund the pool at price p, initialise it, book the LP to the Locker
        ├─ send the incentive allocation to the IncentiveVault
        └─ burn everything not needed
        ▼
claim()  — tokens, plus a pro-rata refund of any oversubscription
swap     — constant-product pool, fee charged in the quote asset only
           fee → FeeSplitter: ecosystem 20% · flywheel 20% · creator 0–40% · treasury rest
treasury — buyback-and-burn (TWAP-guarded) or 24h TWAB rewards, fixed at creation
radar    — incentive pool released daily; LP mining · holding · rebate · single-level invite
flywheel — top 10 by 7-day TWAP market cap per quote asset, bought back and burned
```

> **Status:** main line and economy complete. Contracts are **unaudited**, so
> the deploy script refuses mainnets until an external audit. Local chain and
> Robinhood Chain Testnet only.

Full specification, maths and the list of deliberate deviations from the plan:
[docs/portus-spec.md](docs/portus-spec.md).

---

## How it works

| | |
|---|---|
| **Fixed supply** | Every launch mints 10⁹ tokens once, all to its Sale. No owner, no mint, no pause. |
| **Supply split** | `qSale = qLP = S·(1−x)/2`, `qInc = S·x` (x ≤ 30%). Taking the incentive pool half from each side is what makes the opening price equal the subscription price. |
| **Price** | `p = R / qSale`, kept as the reduced fraction `r/s`. Creation requires `r·10⁶ ≤ R`, which bounds rounding dust to R/10⁶. |
| **Filled (C ≥ R)** | Pool gets `(R, qLP)`; each subscriber gets `c·qSale/C` tokens and `c·(C−R)/C` back. |
| **Below target** | `REFUND`: everyone gets `c` back and the whole supply burns. `SHRINK`: the pool opens at the same price with `(k·r, k·s)`, `k = ⌊C/r⌋`, subject to a minimum fill. |
| **Pool** | Single pair, `x·y=k`, internal reserves (donations cannot move the price), fee 1–5% in the quote asset sent straight to the FeeSink, UniV2-style TWAP accumulators. No add/remove liquidity, no admin. |
| **Permissions** | The only privileged role is `quoteAdmin` (a multisig), which curates quote assets for *future* launches. Nobody can change an existing launch. |

Removed from the Obscura design, deliberately: `withdrawProceeds`,
`reclaimUnsold`, `sweepForfeited`, the AgentRegistry owner functions, and the
personhood mock. Tests assert none of these selectors exist.

---

## Repository

```
contracts/          PortusFactory, PortusSale, PortusPool, PortusLocker, LaunchToken,
                    PortusFeeSplitter, PortusTreasury, PortusDistributor,
                    PortusFlywheel (+ deployer libraries)
packages/shared/    ABIs, chains, pricing.ts (contract maths mirrored in TS),
                    merkle.ts (OpenZeppelin StandardMerkleTree), EIP-712 types
apps/api/           Hono + SQLite event index; creator-signed copy & whitelist
apps/keeper/        permissionless duties (finalize, buybacks, flywheel) + the
                    radar / TWAB reward calculator and root publisher
apps/web/           Next.js: browse, create, subscribe, claim, trade
frozen/mcp-server/  the Obscura agent server, frozen (see frozen/README.md)
docs/               spec, whitepaper, runbook, audit scope; docs/archive/obscura
```

## Quickstart (local)

```bash
npm install
```

```bash
npm run chain
```

In a second terminal:

```bash
npm run contracts:deploy
```

```bash
npm run sync-env -- 31337
```

Then run the API and the web app (separate terminals) and open http://localhost:3456:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Optional: populate every launch phase for UI work, and run the keeper once:

```bash
npm run demo-states:local
```

```bash
npm run finalize:local
```

## Tests

```bash
npm test
```

- `contracts/`: unit tests F/T/S/P/A from the spec, edge guards, and a seeded
  invariant fuzz (I-01…I-12). `npm run test:fuzz:ci -w @portus/contracts` runs
  the CI size (500 launches × 50 steps).
- `npm run e2e` runs FILLED, SHRUNK and REFUNDED end to end on a local chain and
  checks every number against `packages/shared/src/pricing.ts`.

## Chains

| Chain | id | Use |
|---|---|---|
| Hardhat | 31337 | development |
| Robinhood Chain Testnet | 46630 | preferred testnet |
| Robinhood Chain | 4663 | mainnet — refused for phase 1 |
| Ethereum | 1 | mainnet — refused for phase 1 |

Robinhood Chain values come from its official docs and were checked with
`eth_chainId`; its public RPCs are rate-limited, so use your own provider. WETH
addresses are deliberately left unset until confirmed from an official source.

## Security model in one paragraph

Raised funds can only go to the pool or back to subscribers; rounding dust goes
to the FeeSink. There is no owner, proxy, pause or upgrade anywhere. Everything
off-chain is untrusted: creator copy is fenced as untrusted in the UI, whitelist
proofs are re-verified in the browser against the on-chain root, and the
keeper holds no privilege. See [docs/audit-scope.md](docs/audit-scope.md).
