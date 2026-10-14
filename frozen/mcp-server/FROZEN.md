# Frozen: Obscura MCP server

This package is **frozen** (decision D2). It is kept as-is for reference, but it is
not in the npm workspaces, so it is not installed, type-checked, built or tested,
and it is not shipped with Portus.

## Why

It is written against the removed Obscura contracts (`LaunchpadAuction`,
`AgentRegistry`): commit/reveal bids, local salt storage, the reveal daemon, and an
ABI that no longer exists in `@portus/shared`. Its imports still say
`@obscura/shared`, which no longer resolves.

## What reviving it requires (P11)

1. Rewrite the tools for Portus: `list_launches`, `analyze_launch`, `subscribe`
   (fetching and locally re-verifying the whitelist proof against the on-chain
   root), `claim`, and `swap` (with slippage and deadline).
2. Update `src/policy.ts`: the `ALLOWED` function allowlist and target resolution
   must name Portus sale and pool functions, with targets resolved only from the
   factory's `launchAt` / `launchOf`, never from tool arguments or creator copy.
3. Keep the two safety assertions in `scripts/smoke.mjs`: no generic transfer tool,
   and no tool accepts a caller-specified destination.
4. Keep the per-transaction spend cap, enforced before signing.

Its environment variables are listed in `.env.example` in this folder.
