# Obscura MVP 全流程手册（卸载 → 从 0 到 1）

一份从零重建整套系统的操作手册。所有指令均已实测存在。

---

## ⚠ 开始前：三样东西不能删

| 文件 | 内容 | 删掉的后果 |
|---|---|---|
| `.env` | 两把有余额的 Sepolia 密钥 | **丢失约 3 ETH 测试币，以及已部署合约的 owner 权限** |
| `~/.obscura/commits.json` | 投标 salt（唯一副本） | 未揭示的投标**永远无法揭示，抵押金被没收** |
| `deployments/*.json` | 已部署的合约地址 | 需要重新部署，前端/API/MCP 全部要重配 |

`npm run reset` **默认不碰这三样**。`.env` 在任何参数下都不会被删——要删请自己动手。

---

# 第一部分 · 卸载

```bash
npm run reset
```

停掉所有服务（8545 / 8787 / 3456），清掉构建产物、Hardhat 编译缓存、本地数据库、`.bids`。

需要连依赖一起清：

```bash
npm run reset -- --hard
```

额外删除 `node_modules` 和 `package-lock.json`（约 964 MB）。

彻底清空到出厂状态：

```bash
npm run reset -- --wipe-state
```

再额外删除 `deployments/` 和 `~/.obscura/commits.json`。
**存在未揭示投标时这条会拒绝执行**——salt 是唯一副本，删了钱就没了。

---

# 第二部分 · 本地从 0 到 1（推荐先走这条）

零风险、零成本、可反复重来。需要四个终端。

### 1. 安装与构建

```bash
npm install
```

```bash
npm run build
```

### 2. 起本地链（终端 1，保持运行）

```bash
npm run chain
```

### 3. 部署合约（终端 2）

```bash
npm run contracts:deploy
```

```bash
npm run sync-env -- 31337
```

`sync-env` 只改链相关的键，不碰你的私钥。

### 4. 起 API（终端 3，保持运行）

```bash
npm run dev:api
```

```bash
npm run seed
```

### 5. 起前端（终端 4，保持运行）

```bash
npm run dev:web
```

看板：**http://127.0.0.1:3456**（右上角可切中英文）

### 6. 走完整拍卖生命周期

一条命令跑完全部数学验证（含超额认购与按比例分配）：

```bash
cd contracts && npx hardhat run scripts/e2e.ts --network localhost
```

或者用阶段感知的驱动脚本手动推进：

```bash
npm run drive:local
```

### 7. 用真实 MCP 客户端演示 agent 打新

```bash
node packages/mcp-server/scripts/agent-demo.mjs
```

完整跑一遍：注册 → **超上限被拒** → 投标 → 揭示 → keeper 结算 → 领取。

---

# 第三部分 · Sepolia 测试网从 0 到 1

### 1. 生成两把密钥

```bash
npm run newkey
```

跑两次，分别填进 `.env`：

```
DEPLOYER_PRIVATE_KEY=0x<第一把>
OBSCURA_PRIVATE_KEY=0x<第二把>
```

**必须是两把。** 部署钱包是合约 owner，投标钱包交给 agent 用；混用意味着 agent 进程被攻破就等于 owner 权限一起丢。

### 2. 配网络

```
CHAIN_ID=11155111
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<你的key>
OBSCURA_MAX_SPEND_WEI=50000000000000000
```

**强烈建议用自己的 RPC。** 公共节点限流的失败模式很难受：一笔 commit 静默没发出去，你以为投标成功了，到 reveal 才发现链上没有 commitment。

### 3. 充值并自查

水龙头：https://sepoliafaucet.com · https://faucet.sepolia.dev

部署钱包约 0.05 ETH，投标钱包约 0.06 ETH。

```bash
npm run preflight
```

检查 RPC 可达性、链 ID 匹配、两个钱包余额、`.env` 与部署记录是否同步。两个都 ✓ 才继续。

### 4. 部署

```bash
ALLOW_STAKE_ONLY_REGISTRATION=true DEMO_FOR_SALE_TOKENS=100 DEMO_FLOOR_ETH=0.0001 COMMIT_MINUTES=20 REVEAL_MINUTES=120 npm run contracts:deploy:sepolia
```

- `ALLOW_STAKE_ONLY_REGISTRATION=true` — **公链部署默认被拒绝**，必须显式声明使用纯质押模式（防止它悄悄上主网）
- 规模调小后**吃满全部供应只要 0.01 ETH**，水龙头的量完全够
- **reveal 给足 2 小时**，理由见下方「已知陷阱」

```bash
npm run sync-env -- 11155111
```

### 5. 验证合约源码

```bash
npm run verify:sepolia -w @obscura/contracts -- <AgentRegistry地址> 10000000000000000 100000000000000000000000 86400
```

配了 `ETHERSCAN_API_KEY` 走 Etherscan，没配也会走 Sourcify。

### 6. 起服务

```bash
npm run dev:api
```

```bash
npm run seed
```

```bash
npm run dev:web
```

### 7. 挂上自动揭示守护 ← 别跳过

```bash
npm run daemon
```

每 30 秒检查一次，**reveal 窗口一开就自动揭示**，参数只从本地 commit 存储读取。

### 8. 接入 Claude agent

```bash
npm run build -w @obscura/mcp
```

在**终端**（不是 claude.ai 网页版）里：

```bash
cd D:\Lauchpad
```

```bash
claude
```

批准 `obscura`，用 `/mcp` 确认已连接。仓库根目录的 `.mcp.json` **不含任何密钥**，可以放心展示。

### 9. 演示对话

> 用 obscura 查一下我的状态

> 帮我注册成为 obscura 参与者

> 分析一下 launch #N，告诉我值不值得参与

> 帮我投一个 1000 枚、最高价 0.001 ETH 的标   ← **会被硬上限拒绝，这是高光**

> 那改成投 150 枚、最高价 0.0002 ETH

daemon 会自动揭示。之后：

```bash
KEEPER_ONE_SHOT=true npm run keeper
```

> 领取我的份额

### 10. 窗口过期了？开新场，不用重新部署

```bash
COMMIT_MINUTES=20 REVEAL_MINUTES=120 npm run new-auction:sepolia
```

复用现有合约和代币，**自动回收已结算拍卖里未售出的代币**。注册资格、看板、MCP 配置全都不用动。

---

# 第四部分 · 指令速查

### 生命周期

| 指令 | 作用 |
|---|---|
| `npm run reset` | 卸载（保留密钥/salt/部署记录） |
| `npm run reset -- --hard` | additionally 删 node_modules |
| `npm run reset -- --wipe-state` | additionally 删部署记录与 salt（有未揭示投标时拒绝） |
| `npm install` / `npm run build` | 安装 / 全量构建 |

### 链与合约

| 指令 | 作用 |
|---|---|
| `npm run chain` | 起本地 Hardhat 节点 |
| `npm run contracts:deploy` | 部署到本地 |
| `npm run contracts:deploy:sepolia` | 部署到 Sepolia |
| `npm run new-auction:local` / `:sepolia` | 在现有合约上开新拍卖 |
| `npm run sync-env -- <chainId>` | 同步部署地址进 `.env` |
| `npm run preflight` | 部署前就绪自查 |
| `npm run newkey` | 生成一把新私钥 |

### 服务

| 指令 | 作用 |
|---|---|
| `npm run dev:api` | API（8787） |
| `npm run dev:web` | 前端（3456） |
| `npm run seed` / `npm run seed -- <id>` | 写入演示文案 |
| `npm run daemon` | **自动揭示守护（常驻）** |
| `npm run keeper` | 结算 keeper（`KEEPER_ONE_SHOT=true` 跑一次） |

### 驱动与演示

| 指令 | 作用 |
|---|---|
| `npm run drive:local` / `:sepolia` | 阶段感知驱动脚本，可反复运行 |
| `node packages/mcp-server/scripts/agent-demo.mjs` | 完整 agent 打新演示 |
| `npm run bundle` | 打包可下载的单文件 MCP |

### 验证

| 指令 | 作用 |
|---|---|
| `npm run typecheck` | 全 6 包类型检查 |
| `npm run test` | 全工作区测试 |
| `npm test -w @obscura/contracts` | 19 个合约测试 |
| `npm run coverage -w @obscura/contracts` | 覆盖率（90.24% 行） |
| `npm run smoke` | MCP 冒烟（含 2 条安全断言） |
| `node packages/mcp-server/scripts/bundle-smoke.mjs` | 打包产物冒烟 |
| `npm run check:i18n -w @obscura/web` | 中英文词条一致性 |
| `npm run check:contrast -w @obscura/web` | WCAG AA 对比度 |

---

# 第五部分 · 已知陷阱（都是实测踩出来的）

| 现象 | 原因 |
|---|---|
| 部署报 `requires PERSONHOOD_VERIFIER_ADDRESS` | 公链部署需显式加 `ALLOW_STAKE_ONLY_REGISTRATION=true` |
| 界面阶段/笔数不对 | **重新部署后没重启 API**。`--env-file` 只在进程启动时读取，启动日志有 mismatch 警告 |
| `NotRegistered()` | 换了新部署，注册表是新的，要重新质押 |
| `WrongPhase()` | 窗口已过 |
| 拍卖卡在 SETTLING | 正常——`settle` 无权限，必须有人跑 keeper |
| 揭示报 `no local commit found` | salt 文件被删或换了机器，抵押金将被没收 |
| `/mcp` 看不到 obscura | 会话在 `.mcp.json` 创建之前就开了；新开会话。**Connectors 面板里永远没有它** |
| agent 拒绝调用工具 | 见下 |

### 三个非显而易见的坑

**1. 项目 MCP 不在任何设置界面里。**
Settings → Connectors 和 Directory 都是账号级的托管连接器。`obscura` 是你硬盘上的文件，只能在会话里用 `/mcp` 看。找不到是对的——**能出现在云端目录里的连接器，私钥就不在你手上了**。

**2. 「必须揭示」是最大的资金风险，而且已经真实发生过。**
第一次 Sepolia 实测：投标成功、会话结束、人走开，17 小时后 0.05 ETH 因未揭示被没收。文档里写满了警告，警告没能阻止它。
**所以 daemon 不是可选项**，reveal 窗口也别设太短。

**3. agent 可能拒绝执行会动资金的工具。**
守规矩的 agent 会把「质押保证金」理解成无边界转账而拒绝。修法不是绕过它，而是**把已有的约束讲给它听**——工具描述里现在带有「安全信封」：目标地址启动时冻结、函数在白名单内、硬上限对话内改不了、当前是无价值的测试网。这些都是真话，且由代码强制。

---

# 第六部分 · 完整验收

```bash
npm run typecheck && npm run test && npm run smoke && npm run check:i18n -w @obscura/web && npm run check:contrast -w @obscura/web
```

预期：类型 0 错误 · 合约 19 passing · API 8 passing · MCP 9 passing · 冒烟 ALL CHECKS PASSED · 词条 97 keys 同步 · 对比度 13/13 达 AA。

**注意：整套系统未经审计，仅限测试网。**
