# 后续开发方案指令

每条任务都是**自包含的**，可以直接整段复制给 agent 执行，不需要额外补充上下文。
按阶段顺序做；Phase 0 全部完成前不要考虑上主网。

执行前先让 agent 读 `README.md` 和 `packages/mcp-server/src/policy.ts`，
这两个文件定义了整个项目的设计约束。

每条任务完成后的通用验收动作：

```bash
npm run typecheck --workspaces --if-present
cd contracts && npx hardhat run scripts/e2e.ts --network localhost
node packages/mcp-server/scripts/smoke.mjs
```

> **当前部署目标是 Sepolia 测试网**，流程见 `docs/testnet.md`。
> 任务 2.3 带截止日期（Sepolia 2026-09-30 停机），排期时优先处理。

---

## Phase 0 — 上线阻断项

这四条不做完，系统不能碰真钱。

### 0.1 给 launch copy 写入加签名鉴权

> 当前 `apps/api/src/index.ts` 的 `PUT /launches/:id/copy` 完全没有鉴权，任何人都能覆盖任何
> 拍卖的项目介绍。这个介绍会通过 MCP 的 `analyze_launch` 进入用户 agent 的上下文，
> 是提示词注入的直接入口。
>
> 请改成：请求体必须附带一个 EIP-712 签名，签名内容包含 auctionId、copy 的 keccak256 哈希、
> 以及一个防重放的 nonce。服务端用 viem 的 `verifyTypedData` 验签，并从
> `LaunchpadAuction.auctionOf(auctionId).creator` 读取该拍卖的创建者地址，
> 要求签名者必须等于 creator。nonce 存在 SQLite 里，用过即失效。
>
> 同时在 `apps/api/src/` 下加一个 `auth.test.ts` 风格的验证脚本（用 node:test），
> 覆盖：正确签名通过、错误签名者拒绝、nonce 重放拒绝、拍卖不存在拒绝。

### 0.2 给 AgentRegistry 加真实的女巫防御

> `contracts/contracts/AgentRegistry.sol` 目前只靠质押挡女巫，但一个地址成本极低，
> 攻击者可以批量注册来放大额度。README 里已经把这条标为已知缺口。
>
> 请增加一个可插拔的身份验证接口 `IPersonhoodVerifier`，包含
> `function verify(address account, bytes calldata proof) external view returns (bool)`。
> `AgentRegistry` 增加一个可由 owner 设置的 verifier 地址；当 verifier 非零时，
> `register()` 必须额外接收 proof 参数并通过验证。verifier 为零地址时退回当前的纯质押模式，
> 保证本地开发不受影响。
>
> 再写一个 `MockPersonhoodVerifier` 用于测试，以及一份 `docs/personhood.md`，
> 对比 World ID、Gitcoin Passport 两种接入方案的集成成本和隐私影响，给出推荐。
> 注意 `quotaOf` 必须继续按人绑定，绝不能按 agent 实例绑定。

### 0.3 补齐合约单元测试

> `contracts/` 目前只有 `scripts/e2e.ts` 一个正向场景，没有单元测试。
>
> 请在 `contracts/test/` 下用 Hardhat 3 + viem 写完整测试套件，覆盖：
>
> - `AgentRegistry`：质押金额错误、重复注册、退出冷却期未到、退出中不算已注册、quota override
> - `LaunchpadAuction` 阶段控制：每个函数在错误 phase 下都必须 revert
> - `commit`：未注册被拒、重复 commit 被拒、零金额被拒
> - `reveal`：哈希不匹配、低于底价、超出 quota、抵押不足、重复 reveal、salt 错误
> - `settle`：提交错误清算价必须 revert（分别构造偏高、偏低、非投标价三种情况）；
>   认购不足时只有底价能通过；超额认购时的极大值性验证
> - `claim`：未揭示者领取被拒、重复领取被拒、亏损方全额退款、按比例分配的舍入方向
> - `sweepForfeited` / `withdrawProceeds` / `reclaimUnsold` 的权限与重复调用
>
> 补充两个边界场景：全部投标都恰好等于清算价、以及只有一个投标者。
> 目标行覆盖率 90% 以上，用 `solidity-coverage` 或 Hardhat 3 内置覆盖率统计并把结果写进 README。

### 0.4 对结算逻辑做 fuzz 测试

> `LaunchpadAuction.settle()` 的正确性依赖一个数学性质：合法清算价 p 满足
> `D(p) >= S` 且 `D(下一个更高的投标价) < S`。这个性质必须在随机输入下也成立。
>
> 请写一个 fuzz 测试（Hardhat 3 支持 Solidity 测试，用 `forge-std` 风格的 `vm.assume` 或
> 在 TypeScript 侧生成随机场景均可），随机生成 2~50 个投标的价格和数量，
> 用 `apps/api/src/chain.ts` 里的 `computeClearingPrice` 算出候选价，
> 断言：该价格能被 `settle()` 接受，且任何其他价格都会 revert。
> 再断言所有人的分配额之和不超过 supply，且合约里不会残留无法提取的 ETH。

---

## Phase 1 — 正确性与规模

### 1.1 突破 1000 个投标的结算上限

> `LaunchpadAuction` 现在用 `MAX_REVEALED_BIDS = 1000` 限制 `settle()` 的扫描规模，
> 超过就无法揭示。这个上限对真实规模的打新不够。
>
> 请改造成 Gnosis EasyAuction 的模式：结算者链下把所有揭示的投标按价格降序排序后分批提交，
> 合约验证每一批相对上一批是单调递减的，累加需求量，最终确定清算价。
> 这样单笔交易的 gas 有界，总投标数不再受限。
>
> 参考实现读 https://github.com/gnosis/ido-contracts 的 `EasyAuction.sol`，
> 但不要直接抄——我们是 commit-reveal 加密封投标，它是明文限价单，
> 排序验证的部分可以借鉴，准入和揭示逻辑必须保留我们自己的。
>
> 改完后必须保证 0.3 和 0.4 的测试仍然全绿，并把 `MAX_REVEALED_BIDS` 移除。

### 1.2 用事件索引替代全量轮询

> `apps/api/src/chain.ts` 的 `readAuction` 每次 HTTP 请求都要打三次 RPC，
> `GET /launches` 更是对每个拍卖循环调用，拍卖一多就会打爆 RPC 节点。
>
> 请加一个事件索引器：监听 `AuctionCreated` / `Committed` / `Revealed` / `Settled` / `Claimed`，
> 写入 SQLite，并记录已同步到的区块高度，重启后从断点续传。HTTP 接口改为读本地索引。
>
> 关键约束：索引必须是 **read-through** 的——`analyze_launch` 返回给 agent 的
> 链上事实字段（phase、clearingPrice、totalRevealedDemand）在索引落后时必须回源查链，
> 绝不能让 agent 基于陈旧数据出价。在响应里加一个 `indexedAtBlock` 字段暴露新鲜度。

### 1.3 未揭示保证金的处理与展示

> `sweepForfeited` 现在要求创建者手动传入地址数组，实际没人会去调。
>
> 请在 `apps/api` 加一个后台任务，拍卖进入 SETTLED 后自动找出所有 committed 但未 revealed 的地址，
> 生成待清算列表。前端 `apps/web/app/launch/[id]/page.tsx` 增加一块展示：
> 本次拍卖有多少笔未揭示、涉及多少保证金。
>
> 同时在 MCP server 的 `my_status` 里增加警告：如果本地 `commits.json` 里有
> 已 commit 但未 reveal、且 reveal 窗口即将关闭的记录，必须显著提示。

---

## Phase 2 — 产品完善

### 2.1 创建拍卖的完整流程

> 现在只能通过 `contracts/scripts/deploy.ts` 硬编码创建拍卖。
>
> 请为项目方做一条完整链路：`apps/web` 增加 `/create` 页面（这个页面**需要**钱包连接，
> 用 wagmi + viem，注意这是唯一允许连钱包的页面，投标端必须保持只读）。
> 表单收集 token 地址、出售量、底价、时间窗口，调用 `createAuction`，
> 成功后引导项目方用 0.1 的签名接口提交项目介绍。
>
> 在 `README.md` 的架构图里补上这条链路，并说明为什么创建端可以连钱包而投标端不行。

### 2.2 给 MCP 增加揭示守护

> 用户最容易踩的坑：commit 之后忘了 reveal，保证金直接没收。
>
> 请给 `packages/mcp-server` 增加一个 `pending_actions` 工具，返回当前所有
> 需要用户在截止前处理的动作（待揭示的投标、可领取的分配），按紧急程度排序。
> 工具描述里要写清楚这个应该被定期调用。
>
> 另外提供一个独立的守护进程 `packages/mcp-server/src/daemon.ts`，
> 可选启用，在 reveal 窗口打开时自动执行 reveal。
> 注意：自动 reveal 只使用本地已存储的 salt，不接受任何外部输入决定参数，
> 必须走 `policy.ts` 的 `assertAllowed`。在 README 的安全模型章节说明它的权限边界。

### 2.3 迁移到 Sepolia 的继任测试网 ⏰ 有截止日期

> **Sepolia 的 end-of-life 是 2026-09-30**，继任测试网已在 2026 年上线并与之并行运行。
> 本任务必须在过渡期内完成，不能等 Sepolia 停机。
>
> 多链基础设施已经就绪（`packages/shared/src/chains.ts` 是链注册表，
> `deployments/<chainId>.json` 按链分文件，`npm run sync-env -- <chainId>` 切换配置），
> 所以迁移是配置工作而不是重构。
>
> 请先确认继任测试网的官方名称和 chain id（查 ethereum.org 的网络文档和
> eth-clients 的 GitHub organization，**不要凭猜测填**），然后：
> 在 `chains.ts` 加一个条目（含 explorerUrl、blockTime、faucetUrl、endOfLife），
> 在 `contracts/hardhat.config.ts` 加对应 network，
> 在 `scripts/sync-env.mjs` 的 `CHAIN_DEFAULTS` 加默认 RPC，
> 部署并验证合约，更新 `docs/testnet.md`。
>
> 加完后跑一遍 `npx hardhat run scripts/drive.ts --network <新网络>` 走完整生命周期，
> 确认没有任何地方硬编码了 11155111。

### 2.4 增加 Base 支持

> 在 `chains.ts` 加 Base Sepolia (84532) 和 Base 主网 (8453)。
> Base 出块 2 秒，`blockTime` 要相应调整，确认数策略也要重新评估
> （`packages/mcp-server/src/index.ts` 的 `confirmations()` 目前是本地 1、其他 2）。
>
> 注意 Base 的区块浏览器是 Basescan，验证需要单独的 API key，
> `contracts/hardhat.config.ts` 的 verify 配置要支持按网络区分 key。

---

## Phase 3 — 生产化

### 3.1 私钥管理升级

> 现在 `LAUNCHPAD_PRIVATE_KEY` 是环境变量里的明文私钥，只适合本地开发。
>
> 请设计并实现一个 `Signer` 抽象，`packages/mcp-server/src/chain.ts` 依赖接口而非具体实现，
> 提供三种实现：明文环境变量（仅 dev，启动时打印警告）、
> 加密 keystore 文件（首次使用时提示输入口令，解密后只驻留内存）、
> 以及外部签名器（把待签交易输出给用户，由用户在硬件钱包上确认后回填）。
>
> 在 `docs/key-management.md` 里评估用 EIP-7702 session key 替代长期私钥的可行性：
> 用户的主钱包通过 7702 授权一个仅限本拍卖合约、仅限 commit/reveal/claim 三个 selector、
> 带金额上限和过期时间的 session key 给 agent。分析这样能否让
> `LAUNCHPAD_MAX_SPEND_WEI` 从进程内软限制变成链上硬约束。

### 3.2 前端实时化

> `apps/web` 现在是 `force-dynamic` 的服务端渲染，用户要手动刷新才能看到状态变化。
>
> 请加上：拍卖阶段的实时倒计时、认购率进度条的自动刷新（轮询 API 或 SSE）、
> 阶段切换时的视觉提示。保持**只读**的设计原则不变——不要因为加了交互就顺手加投标按钮。
>
> 另外补上响应式布局，`apps/web/app/globals.css` 现在在窄屏下 `.stats` 网格会挤。

### 3.3 审计准备

> 请生成一份 `docs/audit-scope.md`，内容包括：
> 所有合约的完整调用图、每个 external 函数的前置条件与不变量、
> 资金流向图（ETH 和 ERC20 分别画）、已知的信任假设清单、
> 以及我们自己识别出的高风险区域（结算的极大值验证、按比例分配的舍入、
> 未揭示保证金的没收路径、创建者提取路径）。
>
> 同时跑一遍 Slither 和 Mythril，把结果连同我们对每条告警的判断（真问题 / 误报及理由）
> 一起写进文档。

### 3.4 部署与监控

> 写 `docs/runbook.md` 和对应脚本：主网部署流程（含 owner 多签移交）、
> 合约验证（Etherscan/Basescan）、以及监控告警。
>
> 监控至少覆盖：拍卖进入 SETTLING 超过 N 分钟仍未结算（需要有人调 `settle`）、
> 合约 ETH 余额与账面 proceeds 不符、单个拍卖揭示率异常低（可能是前端或 MCP 故障）。
> 结算是无权限的，所以要额外跑一个兜底 keeper 自动结算，代码放 `apps/keeper/`。

---

## 建议的执行顺序

```
0.3 ──▶ 0.4 ──▶ 0.1 ──▶ 0.2        先有测试网，再改逻辑
              │
              ▼
        1.1 ──▶ 1.2 ──▶ 1.3
              │
              ▼
        2.1 ──▶ 2.2 ──▶ 2.3
              │
              ▼
        3.1 ──▶ 3.2 ──▶ 3.3 ──▶ 3.4
```

先做 0.3（单元测试）再做其他，是因为后面每一条都会改合约，
没有测试网做保护的改动等于盲改。
