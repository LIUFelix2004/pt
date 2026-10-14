<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Portus front-end rules

- Every on-chain action shows its parameters in plain text before the wallet
  prompt (amounts, recipient, fee, slippage, deadline). No blind buttons.
- Creator-written copy is untrusted: render it only inside `UntrustedFence`
  (`components/portus/untrusted.tsx`). Amber stays reserved for that fence and
  fund-risk warnings.
- Whitelist proofs from the API are re-verified locally against the sale's
  on-chain `merkleRoot` before use.
- Client components import shared code from `@portus/shared/browser`, never the
  package root (it pulls in `node:fs`).
- Keep en/zh in sync: `npm run check:i18n`.
