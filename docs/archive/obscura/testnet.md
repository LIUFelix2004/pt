# 部署到以太坊测试网

## 先读这段：Sepolia 的时间表

**Sepolia 的 end-of-life 是 2026-09-30。**

Phase 2.3 要求从官方资料确认 Sepolia 的继任测试网，但当前环境无法访问网络，因而不能在“不凭猜测”的约束下确认名称、chain id、RPC、浏览器、faucet 或生命周期。

**不要把 Hoodi 直接填成 Sepolia 继任网。** Hoodi 的历史官方定位是 Holesky 的继任验证者/协议测试网；除非 ethereum.org 和 eth-clients 发布新的明确公告，否则不能据此完成 dApp 测试网迁移。

恢复联网后必须同时核验：

- https://ethereum.org/en/developers/docs/networks/
- https://github.com/eth-clients

确认后再修改 `packages/shared/src/chains.ts`、`contracts/hardhat.config.ts`、`scripts/sync-env.mjs`，部署、验证并使用 `drive.ts` 完成完整生命周期。当前代码继续保留 Sepolia，避免引入未经确认的链配置。

---

## Base（Base Sepolia / Base 主网）

Base 支持已加入链注册表与 Hardhat 配置：

| | Base Sepolia (84532) | Base 主网 (8453) |
|---|---|---|
| RPC 默认 | `https://sepolia.base.org` | `https://mainnet.base.org` |
| 浏览器 | `https://sepolia.basescan.org` | `https://basescan.org` |
| 出块 | 2 秒 | 2 秒 |
| 验证 | Basescan（`BASESCAN_API_KEY`） | Basescan（`BASESCAN_API_KEY`） |

```bash
npm run contracts:deploy:base-sepolia
npm run sync-env -- 84532
npm run verify:base-sepolia -w @obscura/contracts
npm run drive:base-sepolia -w @obscura/contracts
```

注意：Base 出块 2 秒，MCP 的确认数策略按链上时间（约 24 秒）计算，Base 需要约 12 个确认才报告成功。Base 主网部署需要真实资金，必须完成 Phase 0 全部上线阻断项并经审计后再考虑。

---

## 部署步骤

### 1. 生成部署密钥

绝对不要用 Hardhat 默认账户。它的私钥印在文档里，公链上有余额会在几秒内被扫走。
代码里有硬性拦截，但别指望它——从一开始就用干净的密钥。

```bash
npm run newkey
```

把输出填进 `.env`：

```
DEPLOYER_PRIVATE_KEY=0x<刚生成的>
```

投标用的密钥要**另外生成一个**，不要复用部署密钥：

```
OBSCURA_PRIVATE_KEY=0x<再生成一个>
```

理由：部署密钥是项目方身份，投标密钥会交给 agent 用。两者混用意味着
agent 的进程一旦被攻破，攻击者同时拿到了合约 owner 权限。

### 2. 领测试币

两个地址都要有余额。部署大约需要 0.05 ETH，投标另算（抵押金按出价 × 数量计）。

- https://sepoliafaucet.com
- https://faucet.sepolia.dev

### 3. 配置 RPC

公共节点限流很凶，而且**失败模式很难受**：一笔 commit 静默地没发出去，
你以为投标成功了，结果 reveal 时才发现根本没有 commitment。

强烈建议用自己的 endpoint：

```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<你的 key>
```

不填会退回 `https://ethereum-sepolia-rpc.publicnode.com`，只适合试一下。

### 4. 部署

```bash
npm run contracts:deploy:sepolia
```

脚本会在花钱之前做这些检查：密钥不是公开测试密钥、余额够、链已知。
任何一条不满足就直接退出，不会部署到一半。

输出会写进 `deployments/11155111.json`，并打印浏览器链接和验证命令。

### 5. 同步配置

```bash
npm run sync-env -- 11155111
```

只改链相关的键（CHAIN_ID / RPC_URL / 两个合约地址 / NEXT_PUBLIC_ 镜像），
**不会碰你的私钥**。已经填过的自定义 RPC 也会保留。

### 6. 验证合约

投标人要把抵押金打进这个合约，他们有权读到源码。

```bash
cd contracts
npx hardhat verify --network sepolia <AgentRegistry地址> 10000000000000000 100000000000000000000000 86400
npx hardhat verify --network sepolia <LaunchpadAuction地址> <AgentRegistry地址>
```

配了 `ETHERSCAN_API_KEY` 就走 Etherscan，没配也会走 Sourcify（不需要 key）。

### 7. 启动服务

```bash
npm run dev:api
npm run seed
npm run dev:web
```

API 启动时会打印当前网络，确认是 Sepolia 而不是 localhost 再往下走。

---

## 在测试网上驱动一场拍卖

本地可以用 `evm_increaseTime` 快进，测试网不行——真实时间必须真的流逝。
用阶段感知的驱动脚本，随时可以重复运行：

```bash
cd contracts

# 查看当前状态（不发交易）
npx hardhat run scripts/drive.ts --network sepolia

# 在 commit 窗口内投标
BID_PRICE=0.002 BID_AMOUNT=1000 npx hardhat run scripts/drive.ts --network sepolia
```

脚本会根据当前 phase 自动做该做的事，并告诉你下次什么时候回来。

### settle 必须有人调

这是最容易被忽略的一点：**`settle()` 是无权限的，也就意味着没有任何人有义务调用它。**
reveal 窗口关闭后，拍卖会一直停在 SETTLING，直到有人发这笔交易。

`drive.ts` 在 SETTLING 阶段会从 `Revealed` 事件重建订单簿、算出清算价并提交。
把它挂到定时任务上就是一个 keeper：

```bash
npm run drive:sepolia
```

算错了不要紧——合约会独立验证清算价，错的直接 revert，不会把拍卖结算错。

生产环境需要一个正式的兜底 keeper，见 `DEVELOPMENT.md` 任务 3.4。

---

## 把 MCP server 接到测试网

```json
{
  "mcpServers": {
    "obscura": {
      "command": "node",
      "args": ["D:/Lauchpad/packages/mcp-server/dist/index.js"],
      "env": {
        "CHAIN_ID": "11155111",
        "RPC_URL": "https://eth-sepolia.g.alchemy.com/v2/<key>",
        "OBSCURA_REGISTRY_ADDRESS": "0x...",
        "OBSCURA_AUCTION_ADDRESS": "0x...",
        "OBSCURA_PRIVATE_KEY": "0x<投标用的独立密钥>",
        "OBSCURA_MAX_SPEND_WEI": "100000000000000000"
      }
    }
  }
}
```

> 旧版 MCP 宿主里服务器键是 `launchpad`，env 前缀是 `LAUNCHPAD_*`——升级后键名改为
> `obscura`（需要重新批准），env 优先读 `OBSCURA_*` 并回退旧名（带弃用警告）。

注意 `OBSCURA_MAX_SPEND_WEI` 调成了 0.1 ETH。测试网上水龙头给的额度有限，
把上限设成你实际持有量的量级，这样即使 agent 被提示词注入骗了，
损失也被钉死在一个你能承受的数字上。

MCP server 在公链上会等 2 个确认才报告成功。理由是 1 个确认下交易仍可能被重组，
而对 commit 来说，报告成功却被重组意味着本地存了一个链上不存在的投标的 salt。

---

## 与本地开发的行为差异

| | 本地 (31337) | Sepolia (11155111) |
|---|---|---|
| 时间推进 | `evm_increaseTime` 秒级快进 | 真实时间，12 秒一个块 |
| 确认数 | 1 | 2 |
| 默认拍卖窗口 | 60 分钟 | 30 分钟 |
| 公开测试密钥 | 允许 | **拒绝签名** |
| RPC | 有默认值 | 必须显式配置 |
| 完整生命周期测试 | `scripts/e2e.ts` 一把跑完 | `scripts/drive.ts` 分多次驱动 |

窗口时长可以在部署时用 `COMMIT_MINUTES` / `REVEAL_MINUTES` 调整。
调试时设成 5 分钟能大幅加快迭代，但别忘了改回来。
