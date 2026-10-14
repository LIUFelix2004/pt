# Obscura（暗匣）

A token launchpad where bidding happens **only from the user's own AI agent**
(OpenClaw, Codex, Claude Code, or any MCP host), settled by an on-chain
sealed-bid batch auction. Your bid stays sealed in the dark box (暗匣) until the
auction opens.

---

## The one thing to understand first

**"You must use your own agent" is not cryptographically enforceable.**

An agent is an ordinary MCP/HTTP client. Any request it can make, a shell script
can also make. MCP's `clientInfo` is a self-reported string and is trivially
forged. There is no TEE attestation, no vendor signature over agent runtimes, and
no hardware root of trust that could prove "this call came from Codex."

So the agent requirement buys **distribution and friction, not security**. Every
piece of actual sybil resistance in this codebase lives on-chain in
`AgentRegistry`, and is deliberately independent of how a transaction was
produced. Do not ship marketing that describes the agent gate as a security
guarantee.

What *is* real, and what makes this different from a web dApp: the transaction is
built and signed **inside the user's own agent runtime, on their own machine,
with a key the operator never sees**.

## Why a batch auction

Agent latency is variable — LLM inference plus MCP round-trips is seconds to tens
of seconds. Under a first-come-first-served mint, a plain script wins every gas
race and the product rule collapses on day one.

A uniform-price batch auction removes time from the competition entirely:

- Bids are **sealed** during the commit window, so there is nothing to front-run.
- Every bid in the window is equivalent regardless of when it lands.
- Everyone pays the **same clearing price**, so bidding your true maximum is safe.

The batch-auction choice and the agent-only rule are load-bearing for each other.

---

## Architecture

```
   ┌─────────────────────────────┐
   │  User's own machine         │
   │                             │
   │  OpenClaw / Codex / Claude  │
   │  Code  ── MCP stdio ──┐     │
   │                       ▼     │
   │            packages/mcp-server        ← signs here, key never leaves
   │              · policy.ts (allowlist)  │
   │              · store.ts  (bid salts)  │
   └───────────────┬──────────────┬────────┘
                   │              │
          reads    │              │  writes (commit / reveal / claim)
        apps/api   │              │
                   ▼              ▼
       ┌───────────────┐   ┌─────────────────────┐
       │  apps/api     │   │  contracts/         │
       │  Hono+SQLite  │──▶│  LaunchpadAuction   │  ← source of truth
       │  copy only    │   │  AgentRegistry      │
       └───────┬───────┘   └─────────────────────┘
               │
               ▼
        apps/web (read-only dashboard — no mint button, by design)
```

The dashboard and launch detail routes remain read-only. The sole browser-wallet boundary is `/create`: project creators approve token escrow, call `createAuction`, then sign the EIP-712 project copy. Bidders never connect a wallet to the site because bid signing stays inside their own MCP runtime, where destination and spend policy are enforceable.

**Trust boundaries**

| Component | Holds | Trusted for |
|---|---|---|
| `contracts/` | escrowed tokens + collateral | everything — sole source of truth |
| `packages/mcp-server` | user's private key, bid salts | nothing external; enforces local policy |
| `apps/api` | creator-written copy | nothing; its output is fenced as untrusted |
| `apps/web` | nothing | dashboard display; `/create` asks a creator wallet to sign explicit auction/copy actions |

The API deliberately **never** holds bid salts. If the operator held salts, they
could open every sealed bid early, which would defeat commit-reveal entirely.

---

## Quickstart (local)

```bash
npm install
```

```bash
npm run chain
```

```bash
npm run contracts:deploy
```

```bash
npm run sync-env -- 31337
```

```bash
npm run dev:api
```

```bash
npm run seed
```

```bash
npm run dev:web
```

- Web dashboard — http://127.0.0.1:3456
- API — http://127.0.0.1:8787

## Deploying to Sepolia

Base Sepolia (84532) and Base (8453) are also configured — see
[docs/testnet.md](docs/testnet.md). Full walkthrough in
[docs/testnet.md](docs/testnet.md). The short version:

```bash
npm run newkey
```

Put it in `.env` as `DEPLOYER_PRIVATE_KEY`, generate a **second** key for
`OBSCURA_PRIVATE_KEY`, fund both from a faucet, set `SEPOLIA_RPC_URL`, then:

```bash
npm run contracts:deploy:sepolia
```

```bash
npm run sync-env -- 11155111
```

Two things that bite people:

- **`settle()` is permissionless, so nobody is obliged to call it.** An auction
  sits in SETTLING until someone does. `contracts/scripts/drive.ts` reconstructs
  the order book from `Revealed` events, computes the clearing price, and submits
  it — run it on a timer and it is your keeper.
- **Sepolia reaches end of life on 2026-09-30.** A successor testnet is running
  in parallel. Chain selection is pure configuration here, so migrating means
  adding one entry to `packages/shared/src/chains.ts` and redeploying — no
  business code hardcodes a chain.

### Verify it actually works

Full auction lifecycle with assertions on the settlement maths:

```bash
cd contracts && npx hardhat run scripts/e2e.ts --network localhost
```

Contract unit and deterministic randomized tests, including coverage:

```bash
npm test -w @obscura/contracts
npm run coverage -w @obscura/contracts
```

The current Hardhat 3 report is **90.24% Solidity line coverage** and **91.84% statement coverage** overall after adding the multi-transaction settlement state machine (`AgentRegistry` 97.73% lines, `LaunchpadAuction` 88.44% lines). The HTML report is generated at `contracts/coverage/html/index.html`.

MCP unit tests (daemon entry, pending-action ordering, reveal warnings, keystore round-trip) and a server driven exactly as an agent host would drive it:

```bash
npm test -w @obscura/mcp
npm run build -w @obscura/mcp
node packages/mcp-server/scripts/smoke.mjs
```

Key storage is pluggable (`env` / `keystore` / `external`) — see `docs/key-management.md`.

Fallback settlement keeper and runbook:

```bash
npm run keeper
cat docs/runbook.md
```

On a public network there is no time travel, so drive an auction across its real
windows instead — the script is phase-aware and safe to re-run:

```bash
npm run drive:sepolia -w @obscura/contracts
```

### Wire the MCP server into your agent

```bash
npm run build -w @obscura/mcp
```

> **No-repo install:** `npm run bundle -w @obscura/mcp` builds a single-file
> `obscura-mcp.mjs` plus `obscura-mcp.zip` (env template, host snippet, README,
> LICENSE) with a printed SHA-256. The web download page at `/download` serves
> the zip with its checksum; the bundle smoke test
> (`node packages/mcp-server/scripts/bundle-smoke.mjs`) verifies the single file
> exposes exactly the intended tool set. Artifacts are gitignored.

Then register it with your MCP host:

```json
{
  "mcpServers": {
    "obscura": {
      "command": "node",
      "args": ["D:/Lauchpad/packages/mcp-server/dist/index.js"],
      "env": {
        "RPC_URL": "http://127.0.0.1:8545",
        "CHAIN_ID": "31337",
        "OBSCURA_REGISTRY_ADDRESS": "0x...",
        "OBSCURA_AUCTION_ADDRESS": "0x...",
        "OBSCURA_PRIVATE_KEY": "0x...",
        "OBSCURA_MAX_SPEND_WEI": "1000000000000000000"
      }
    }
  }
}
```

> If you had `launchpad` configured as the server key before the rebrand,
> rename the key to `obscura` and re-approve the server in your MCP host.

Then talk to your agent: *"register me for the launchpad"*, *"analyze launch #0
and place a sealed bid for 1000 tokens at up to 0.002 ETH"*, and later
*"reveal my bid on launch #0"*.

---

## Security model

The threat this design takes most seriously: **`analyze_launch` pulls
creator-written text into the agent's context.** A creator, or a poisoned
upstream source, can embed instructions aimed at the agent reading it. Combine
that with an agent holding a private key and you have a prompt-injection
drain path.

Four mitigations, in order of importance:

1. **No general-purpose transaction tool exists.** There is no `send`,
   `transfer`, or `call_contract`. An injected instruction has no tool to call.
2. **No tool accepts a destination address.** Targets are resolved from frozen
   config in `policy.ts`, never from tool arguments or network data.
3. **A hard spend cap** (`OBSCURA_MAX_SPEND_WEI`) is enforced in-process before
   any signature. Nothing said inside a conversation can raise it.
4. **Untrusted copy is fenced** with explicit markers before entering context.

A fifth guard covers a different mistake entirely: signing on a public network
with a key from the Hardhat/Anvil default mnemonic. Those private keys are
published in documentation, so any balance they hold is swept within seconds.
`assertKeyIsSafeForChain` refuses at boot **and** immediately before signing, in
both the MCP server and the deploy script.

`packages/mcp-server/scripts/smoke.mjs` asserts (1) and (2) automatically, so a
future tool addition that breaks them fails the smoke test.

The optional reveal daemon (`npm run daemon -w @obscura/mcp`) is deliberately one-shot so an operator can schedule it. It reads price, amount, and salt only from the local `commits.json`, accepts no bid parameters, targets only the configured auction contract, and still passes through `policy.ts::assertAllowed`. It cannot create or modify bids; it can only reveal an already-signed local commitment during the on-chain REVEAL phase.

The `pending_actions` MCP tool should be called periodically. It sorts approaching reveal deadlines ahead of claimable settled auctions, while `my_status` also emits a prominent forfeiture warning.

The worst outcome prompt injection can still produce is a **bad bid**, bounded by
the spend cap. That is the deliberate ceiling.

### Known gaps before mainnet

These are real and unfixed — see `DEVELOPMENT.md` for the sequenced work.

- `AgentRegistry` supports a pluggable proof-of-personhood verifier. Zero verifier
  is intentionally stake-only for local development; public deployments require
  an explicit verifier unless the operator opts into a testnet exception. The
  adapter remains trusted for account binding, uniqueness/nullifier consumption,
  and replay-domain correctness; see `docs/personhood.md`.
- Creator copy writes require an EIP-712 signature bound to chain, auction
  contract, auction id, content hash, and a single-use SQLite nonce. Copy remains
  fenced as untrusted because authentication does not make its contents safe.
- Large auctions use permissionless, price-descending settlement batches followed
  by bounded allocation batches. Every revealed bidder must be submitted exactly
  once; cross-batch monotonicity and duplicate processing are verified on-chain.
- Contract unit and randomized settlement tests now cover the Phase 0 paths and
  the batched settlement state machine. **90%+ Solidity line coverage** is
  measured via `npm run coverage -w @obscura/contracts`, but the project still
  needs an independent audit (scope in `docs/audit-scope.md`).
- A signer abstraction (`env` / `keystore` / `external`) replaces plaintext-key
  usage for production; `env` remains the default for local dev only.
- A fallback settlement keeper lives in `apps/keeper/` (see `docs/runbook.md`).
- Nothing here has been audited.

---

## Layout

```
contracts/              Hardhat 3 + OpenZeppelin 5
  contracts/            Registry, auction, token, personhood interface + mock
  scripts/deploy.ts     chain-aware deploy + optional demo auction
  scripts/drive.ts      phase-aware auction driver / keeper (works on testnets)
  scripts/e2e.ts        full lifecycle with maths assertions (local only)
  scripts/export-abi.mjs regenerates packages/shared/src/abi.ts

packages/shared/
  chains.ts             chain registry + the dev-key guard. Add networks here.
  addresses.ts          frozen deployment resolution
packages/mcp-server/    the agent surface — read policy.ts before adding a tool
apps/api/               Hono + node:sqlite; creator copy + event indexer
apps/web/               Next.js 16, read-only dashboard (+ /create creator wallet)
apps/keeper/            permissionless fallback settlement keeper
docs/key-management.md  signer choices (env / keystore / external) + EIP-7702
docs/runbook.md         deployment, verification, monitoring runbook
docs/audit-scope.md     audit scope: call graph, invariants, funds flow
scripts/sync-env.mjs    copies a deployment's addresses into .env
deployments/<chainId>.json   deploy output, one file per network
docs/testnet.md         Sepolia walkthrough + migration plan
docs/personhood.md      verifier choices, privacy, uniqueness, and trust model
```

## Toolchain notes

- **npm workspaces**, not pnpm/yarn — nothing extra to install.
- **Hardhat 3**, not Foundry — pure npm, no external toolchain on Windows.
- **`node:sqlite`**, not better-sqlite3 — no native compilation.
- Web runs on **3456**, not 3000, to avoid colliding with other local projects.
