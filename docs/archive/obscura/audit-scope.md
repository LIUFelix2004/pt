# Audit scope（审计范围）

目标：为 `AgentRegistry`、`LaunchpadAuction`、`LaunchToken` 提供完整审计范围。所有价格单位均为 wei/1e18 token 基元；`WAD = 1e18`。

## 1. 合约调用图

```
                    ┌────────────────────────────┐
                    │        deployer / owner     │
                    │ transferOwnership, setParameters, │
                    │ setQuotaOverride, setPersonhoodVerifier
                    └──────────────┬─────────────┘
                                   │
   ┌───────────────────────────────▼───────────────────────────────┐
   │                      AgentRegistry                            │
   │ register() / register(bytes) / requestExit / withdrawStake    │
   │ isRegistered / quotaOf / participantOf                        │
   └───────────────┬───────────────────────────────────────────────┘
                   │ registry.isRegistered / quotaOf
   ┌───────────────▼───────────────────────────────────────────────┐
   │                      LaunchpadAuction                         │
   │ createAuction        (token escrow via SafeERC20)             │
   │ commit / reveal / settle* / claim / sweepForfeited            │
   │ withdrawProceeds / reclaimUnsold                              │
   │ * settle() [legacy] 或 分批：submitSettlementBatch            │
   │   finalizeClearing submitAllocationBatch finalizeSettlement   │
   └───────────────────────────────────────────────────────────────┘
```

## 2. external 函数前置条件与不变量

### AgentRegistry

| 函数 | 前置 | 不变量 |
|---|---|---|
| `register()` | verifier==0；未注册；`msg.value==stakeRequirement` | 一人一槽（按地址） |
| `register(bytes)` | verifier==0 或 `verify(msg.sender,proof)`；未注册；正确质押 | 同上 |
| `requestExit` | 已注册；未在退出中 | 立即失活，冷却后取回 |
| `withdrawStake` | 已注册；已请求退出；冷却期到 | 退款后槽位删除 |
| `setQuotaOverride` / `setParameters` / `setPersonhoodVerifier` | owner | 只影响后续查询/注册 |
| `quotaOf` | 已注册且未退出 | 绑定 address，绝不绑定 agent 实例 |

### LaunchpadAuction

| 函数 | 前置 | 不变量 |
|---|---|---|
| `createAuction` | 非零 supply/floor；窗口有序 | 代币 escrow 完成；id 单调 |
| `commit` | phase==COMMIT；已注册；未重复；value>0 | 抵押 = price×amount/WAD 下限 |
| `reveal` | phase==REVEAL；hash 匹配；price≥floor；amount≤quota；deposit 充足 | revealed 计数/需求累加 |
| `settle`（legacy） | phase==SETTLING | 清算价唯一性：`D(p)≥S` 且 `D(>p)<S`（或认购不足仅 floor） |
| 分批结算 4 函数 | 见 `docs/DEVELOPMENT` 1.1 | 批间价格单调递减；每 bidder 恰好一次；`totalAllocated` 与实际舍入一致 |
| `claim` | SETTLED；已 reveal；未 claim | 分配+退款精确；不会重复支付 |
| `sweepForfeited` | SETTLED；creator | 只没收未 reveal 押金，且不重复 |
| `withdrawProceeds` / `reclaimUnsold` | SETTLED；creator；幂等 | 余额/代币精确减少 |

核心数学不变量：**合法清算价 p** 满足 `D(p) ≥ S` 且 `D(下一个更高投标价) < S`；随机输入下必须仍成立（fuzz 测试守护）。

## 3. 资金流向

### ETH
```
bidder --commit(value=deposit)--> contract
  deposit ≥ price×amount/WAD
contract --claim(退款部分)--> bidder          # 高于清算价按统一价，低于全额退
contract --sweepForfeited--> creator          # 未 reveal 押金（creator 手动或后台）
contract --withdrawProceeds--> creator        # proceeds（settled 后）
```
不变量：`合约ETH = Σ deposit - Σ(claim 退款) - Σ(sweep) - proceeds`，最终归零。

### ERC20（LaunchToken 或项目方 token）
```
creator --approve--> auction --createAuction(transferFrom)--> contract   # 全部 supply
contract --claim(transfer)--> winner         # 分配额（超额认购按比例，向下取整）
contract --reclaimUnsold--> creator          # unsold + 舍入 dust
```

## 4. 信任假设清单

1. **`AgentRegistry.owner` 可信**：可改 quota、参数、verifier；公网应为多签 + timelock。
2. **`personhoodVerifier` 可信**：负责唯一性/nullifier/重放域；Registry 只信任 bool。
3. **创建者**：可创建拍卖、没收未揭示押金、提取 proceeds；不存在 creator 转移，因此签名以"提交时链上 creator"为准。
4. **API 操作者**：持有 SQLite 与域名；可读 copy，但**永远不持有 bid salts**。
5. **MCP 进程**：持有用户签名密钥与 salts；是"使用自己 agent"规则的信任边界。
6. **无预言机**：结算由链下提交 + 链上验证，无外部数据源。

## 5. 自识别高风险区域

- **结算的极大值验证**：清算价唯一性依赖 `D(p)≥S ∧ D(>p)<S`；批量路径验证"批间价格单调"与"恰处理一次"，任何跳过/重复都会 revert。
- **按比例分配舍入**：每 bidder 独立向下取整；`totalAllocated` 用实际舍入和，`reclaimUnsold` 返还 dust（否则 token 永久锁死）。
- **未揭示押金没收路径**：`sweepForfeited` 只应没收未 reveal；重复 sweep 幂等。
- **创建者提取路径**：`withdrawProceeds`/`reclaimUnsold` 的 creator 校验与幂等。
- **commit-reveal 密钥分离**：salts 只在用户本机，操作者不可提前开标。

## 6. 静态分析工具

- **Slither**：`slither . --filter-paths "contracts"`（需 Python 工具链；当前环境未安装）。
- **Mythril**：`myth analyze contracts/contracts/LaunchpadAuction.sol`（需 solc 与 Python 工具链）。

**环境状态**：本机无法运行以上工具（无网络安装、执行器故障）。运行命令已给出；拿到报告后逐条判断：
- 真问题 → 修复并补测试；
- 误报 → 记录理由（例如 `safeTransfer` 包裹的返回值、OZ 库已知行为、int 溢出在 0.8.28 checked 下不可能）。

## 7. 测试证据基线

- Hardhat 单元 + 分批结算 + fuzz：`npm test -w @obscura/contracts`。
- Solidity 覆盖率：`npm run coverage -w @obscura/contracts`（当前约 90% 行）。
- API EIP-712 鉴权 + 索引器：`npm test -w @obscura/api`。
- MCP（daemon/pending）：`npm test -w @obscura/mcp`。
- 生命周期 E2E：`cd contracts && npx hardhat run scripts/e2e.ts --network localhost`。
