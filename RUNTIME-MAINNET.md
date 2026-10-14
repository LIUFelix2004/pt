# Portus mainnet API + keeper (user PC interim via Cloudflare quick tunnel)
# Updated: 2026-10-12 (Pages /api reverse-proxy)
# Public site: https://portus-app.pages.dev/
# Browser calls: https://portus-app.pages.dev/api/*  (same-origin proxy)
# Upstream origin (Pages env PORTUS_API_ORIGIN): https://please-shelter-accepting-por.trycloudflare.com
# Local API: http://127.0.0.1:8787
#
# IMPORTANT — tunnel URL changes:
#   Quick tunnel hostname changes whenever cloudflared restarts.
#   Update Pages production env PORTUS_API_ORIGIN to the new origin
#   (wrangler.toml [vars] + redeploy Functions, or dashboard Variables).
#   Frontend rebuild is NOT required for a URL-only origin change, because
#   the browser only talks to https://portus-app.pages.dev/api.
#
# PC must stay awake; sleep/hibernate kills API/keeper/tunnel.

# Restart API:
#   cd D:\Lauchpad\apps\api
#   node --env-file=../../.env dist/index.js

# Restart keeper:
#   cd D:\Lauchpad\apps\keeper
#   node --env-file=D:\Lauchpad\.env D:\Lauchpad\node_modules\tsx\dist\cli.mjs src/index.ts

# Restart tunnel (new URL! then update PORTUS_API_ORIGIN):
#   cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
#   # copy the https://*.trycloudflare.com URL
#   # set Pages env PORTUS_API_ORIGIN=<new-url> and redeploy pages (functions/vars)
#   cd D:\Lauchpad\apps\web
#   # edit wrangler.toml [vars] PORTUS_API_ORIGIN, then:
#   wrangler pages deploy out --project-name portus-app --commit-dirty=true

# Pages API proxy source:
#   D:\Lauchpad\apps\web\functions\api\[[path]].ts
#   strips /api prefix → {PORTUS_API_ORIGIN}{path}

# Publish radar rewards (needs ROOT_PUBLISHER key + funded publisher wallet):
#   cd D:\Lauchpad && npm run rewards

# Fund keeper gas: 0x2593CCdbBe752fF9Aa1a5Fe3c8615818a8877cb0