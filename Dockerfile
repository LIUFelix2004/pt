# Portus API / Keeper — Node 22 (node:sqlite) on Fly.io
# Build: docker build --build-arg TARGET=api|keeper -t portus .
FROM node:22-bookworm-slim

ARG TARGET=api
ENV PORTUS_TARGET=${TARGET}

WORKDIR /app

# Workspace manifests (web/contracts: package.json only so npm workspaces resolve)
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/keeper/package.json apps/keeper/tsconfig.json ./apps/keeper/
COPY apps/web/package.json ./apps/web/
COPY contracts/package.json ./contracts/

# Install root + shared + api + keeper (tsx/typescript from root for build & keeper)
RUN npm ci --workspace=@portus/shared --workspace=@portus/api --workspace=@portus/keeper --include-workspace-root

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/keeper ./apps/keeper
COPY deployments ./deployments

RUN npm run build -w @portus/shared -w @portus/api \
  && mkdir -p /data/rewards \
  && chown -R node:node /app /data

ENV DATABASE_PATH=/data/portus-mainnet.sqlite \
    REWARDS_DIR=/data/rewards \
    API_PORT=8787 \
    NODE_ENV=production

EXPOSE 8787
USER node

# Secrets come from Fly env (fly secrets set). Do not bake .env into the image.
CMD ["sh", "-c", "if [ \"$PORTUS_TARGET\" = \"keeper\" ]; then exec ./node_modules/.bin/tsx apps/keeper/src/index.ts; else exec node apps/api/dist/index.js; fi"]