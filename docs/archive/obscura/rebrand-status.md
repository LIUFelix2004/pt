# Obscura 品牌迁移执行状态

来源：`docs/rebrand-frontend-tasks.md`（任务 3）。以下为本次执行状态，供验收与恢复执行器后继续时对照。

## 已完成（代码与文档）

| 项 | 状态 | 位置 |
|---|---|---|
| 产品名 Agent Launchpad → **Obscura（暗匣）** | ✅ | README 标题/描述、`layout.tsx` metadata 与页头 |
| npm scope `@obscura/*` → `@obscura/*` | ✅ | shared / mcp / api / web / keeper / contracts 六个 `package.json` + 全部 workspace 引用 |
| 根包名 `agent-launchpad` → `obscura` | ✅ | `package.json` |
| MCP `name` → `obscura` | ✅ | `src/index.ts` `new McpServer` |
| MCP 包名 → `@obscura/mcp`、bin → `obscura-mcp` | ✅ | `packages/mcp-server/package.json` |
| `.mcp.json` 键 `launchpad` → `obscura` | ✅ | `.mcp.json` |
| 环境变量 `LAUNCHPAD_*` → `OBSCURA_*`（**回退旧名+弃用警告**） | ✅ | `packages/shared/src/env.ts::legacyEnv`；`addresses.ts` / `config.ts` / `signer.ts` / api `chain.ts` / `keeper` 全部接入；`.env.example` 只写新名；`sync-env.mjs` 写新名并清理旧键 |
| 状态目录 `~/.launchpad` → `~/.obscura`（**自动迁移，复制不移动**） | ✅ | `store.ts::migrateIfNeeded` + `config.ts` 默认值 |
| 升级步骤说明（旧 MCP 宿主需重新批准） | ✅ | README、`docs/testnet.md`、`docs/demo-sepolia.md` |
| 文档命令/包名/路径更新 | ✅ | README、testnet、runbook、audit-scope、key-management、demo-sepolia（personhood/DEVELOPMENT 无品牌引用） |
| `AuctionPhase` 枚举值未动（合约镜像） | ✅ | — |

## 待执行器恢复后

1. **`npm install`**：重新生成 `package-lock.json`（当前仍含 `@obscura/*` 旧引用），并安装 `esbuild`（任务 4 的 `bundle` 依赖）及任务 2/1 的 `tailwindcss`/`shadcn`/`next-intl`。
2. **验证迁移**（任务 3 验收）：
   - 删除 `~/.obscura`，用旧 `~/.launchpad` 启动 MCP → 迁移日志出现、salt 可读；
   - 用旧 `LAUNCHPAD_*` env 启动 → 弃用警告出现、功能正常；
   - 全量命令：`npm run typecheck --workspaces --if-present`、各 workspace `npm test`、`node packages/mcp-server/scripts/smoke.mjs`。
3. **任务 2**（UI 重做，需 Tailwind v4 + shadcn init 与 `npx next build` 验证）。
4. **任务 1**（next-intl 中英双语）。
5. **任务 4 运行验证**：`npm run bundle -w @obscura/mcp` → 安全扫描 + SHA-256 → `node packages/mcp-server/scripts/bundle-smoke.mjs` → 下载页 `/download` 可用。

## 已知风险

- `package-lock.json` 未手动改（体量巨大），必须靠 `npm install` 重新生成；在重生成前任何 `npm ci` 都会失败。
- 命名可用性（npm scope / 域名 / 商标）需人工确认，见 `docs/rebrand-frontend-tasks.md` 开头。
