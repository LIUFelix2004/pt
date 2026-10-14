# Runbook：部署、验证与监控

## 1. 主网部署流程

### 前置

- 新密钥：`npm run newkey`，两份独立密钥（部署者 + 投标者/keeper）。
- 配置 `.env`：`CHAIN_ID`、`RPC_URL`、`DEPLOYER_PRIVATE_KEY`、`LAUNCHPAD_PRIVATE_KEY`、`PERSONHOOD_VERIFIER_ADDRESS`。
- 非本地网络默认**拒绝 stake-only 注册**；确需临时例外设置 `ALLOW_STAKE_ONLY_REGISTRATION=true`（测试网专用）。
- 预算检查：部署脚本在花钱前检查密钥安全、余额（≥0.05 ETH）与链已知。

### 部署

```bash
npm run contracts:deploy            # 本地
npm run contracts:deploy:sepolia    # Sepolia
```

输出写入 `deployments/<chainId>.json`（含 `personhoodVerifier` 地址）。

### 配置同步

```bash
npm run sync-env -- <chainId>
```

只改链相关键（CHAIN_ID / RPC_URL / 两个合约地址 / NEXT_PUBLIC_ 镜像），不碰私钥。

### 合约验证（Etherscan/Sourcify）

```bash
cd contracts
npx hardhat verify --network <net> <AgentRegistry> <stake> <quota> <cooldown>
npx hardhat verify --network <net> <LaunchpadAuction> <AgentRegistry>
```

配 `ETHERSCAN_API_KEY` 走 Etherscan；否则 Sourcify（免 key）。

### owner 多签移交

`AgentRegistry` 是 `Ownable`。上线前把 owner 移交给多签：

1. 部署/设置多签（Safe 等）。
2. 用 deployer 调用 `transferOwnership(多签地址)`。
3. 多签确认后，`setParameters` / `setPersonhoodVerifier` / `setQuotaOverride` 只经多签执行。
4. 验证 `owner()` 返回多签地址，且多签可正常执行一次 setter。

`LaunchpadAuction` 无 owner（permissionless settle 是设计），不需移交。

## 2. 兜底结算 keeper

结算无权限，因此必须有人调 `settle`。`apps/keeper` 是兜底：

```bash
cd apps/keeper
KEEPER_PRIVATE_KEY=0x... CHAIN_ID=11155111 RPC_URL=... \
OBSCURA_AUCTION_ADDRESS=0x... npm start
```

- 默认每 60 秒扫描一次；`KEEPER_INTERVAL_SECONDS` 可调。
- `KEEPER_ONE_SHOT=true` 时执行一轮后退出，适合 cron：
  `*/5 * * * * cd /path && KEEPER_ONE_SHOT=true ... npm start`
- 对每个 SETTLING 拍卖：从 `Revealed` 事件重建订单簿 → 分批 `submitSettlementBatch`（价格降序）→ `finalizeClearing` → 分批 `submitAllocationBatch` → `finalizeSettlement`。
- 单笔交易 gas 有界；进度通过 `settlementStateOf` 断点续传。

## 3. 监控告警

监控至少覆盖：

| 告警 | 条件 | 处置 |
|---|---|---|
| 结算卡死 | 拍卖进入 SETTLING 超过 N 分钟仍未 SETTLED | 检查 keeper 是否在跑；手动驱动 `drive.ts` 或重启 keeper |
| 合约余额不符 | 合约 ETH 余额 ≠ 账面 proceeds + 未 sweep 押金 | 审计未 reveal 押金、claim 路径 |
| 揭示率异常低 | 某拍卖 bidCount / commitCount 显著偏低 | 检查前端/MCP 是否故障；通知用户 |
| 公钥泄漏 | 公网使用公开测试密钥 | `assertKeyIsSafeForChain` 已硬拦；监控交易来源 |

Keeper 输出打到 stdout/stderr，接入 systemd/journald 或容器日志采集即可。建议对 keeper 增加 process supervisor（systemd unit、pm2 或 Kubernetes Deployment）。

## 4. 故障排查

- **拍卖停在 SETTLING**：无人调 settle → 跑 keeper 或 `npm run drive:<net>`。
- **commit 后 reveal 找不到 commitment**：RPC 限流导致交易未上链 → 用自有 RPC 重试；monitor mempool。
- **API 返回陈旧状态**：索引器同步失败会回源查链；检查 `indexedAtBlock` 新鲜度与 indexer 日志。
