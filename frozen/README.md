# frozen/

Code kept for reference but taken out of the main line (decision D2).

| Path | What | Why frozen |
|---|---|---|
| `mcp-server/` | Obscura's local MCP signing server for AI agents | Built for the removed sealed-bid auction ABI |

Nothing here is in the npm workspaces: it is not installed, type-checked, built
or tested, and it ships with nothing. Reviving the MCP server is phase P11; what
that requires is in `mcp-server/FROZEN.md`.
