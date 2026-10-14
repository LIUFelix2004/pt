# Portus Fly.io hosting (API + Keeper)

| File | Purpose |
| --- | --- |
| `Dockerfile` | Node 22 image; `TARGET=api` or `TARGET=keeper` |
| `.dockerignore` | Exclude secrets, web source, node_modules |
| `fly.api.toml` | App `portus-api`, Volume `/data`, health `/health` |
| `fly.keeper.toml` | App `portus-keeper`, worker only |
| `fly-deploy-notes.sh` | Command cheat sheet |

## Blockers before deploy

1. `fly auth login` (browser) on a machine with flyctl
2. Fly account + payment method
3. Fund keeper `0x2593CCdbBe752fF9Aa1a5Fe3c8615818a8877cb0` (~0.02 ETH)
4. `fly secrets set` with production `RPC_URL`, contract addresses, `KEEPER_PRIVATE_KEY` (and later `ROOT_PUBLISHER_PRIVATE_KEY` for rewards cron)

Do **not** change Pages `PORTUS_API_ORIGIN` until `https://portus-api.fly.dev/health` works and cutover is confirmed.

Planned public API URL after create: `https://portus-api.fly.dev`