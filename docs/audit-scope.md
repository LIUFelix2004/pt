# 审计范围（Portus 阶段 1）

> 规格与证明：[portus-spec.md](portus-spec.md)。Obscura 时期的审计范围归档于 `archive/obscura/audit-scope.md`。

## 范围内

| 文件 | 说明 |
|---|---|
| `contracts/contracts/PortusFactory.sol` | 参数边界、部署顺序、报价资产白名单 |
| `contracts/contracts/PortusSale.sol` | 认购、结算、领取、零头 |
| `contracts/contracts/PortusPool.sol` | 恒定乘积池、手续费、TWAP、skim |
| `contracts/contracts/PortusLocker.sol` | LP 记录所有人 |
| `contracts/contracts/PortusFeeSplitter.sol` | 四方分账（全平台一个） |
| `contracts/contracts/PortusTreasury.sol` | 每币国库：TWAP 护栏回购 / 划入回馈 |
| `contracts/contracts/PortusDistributor.sol` | 激励释放、国库回馈、Merkle 领取、单层邀请绑定 |
| `contracts/contracts/PortusFlywheel.sol` | 检查点、7 日 TWAP 市值、提名排名、回购销毁 |
| `contracts/contracts/LaunchToken.sol` | 固定总量代币 |
| `contracts/contracts/PortusMintToken.sol` | 铸币模式代币：首发一次铸出，之后只有 Emission 能铸，累计封顶 |
| `contracts/contracts/PortusTaxPool.sol` | 铸币模式池子：代币侧买卖税、防暴跌附加扣款、无 LP 份额、`sync` |
| `contracts/contracts/PortusEmission.sol` | 铸币节奏（月复利、月内线性）、`mintDaily` → Distributor |
| `contracts/contracts/libraries/PortusDeployers.sol`、`PortusMath.sol` | 部署库（DELEGATECALL 执行 `new`）、gcd / 向上取整 |
| `contracts/contracts/interfaces/*` | 类型、事件、错误 |

编译器 0.8.28，optimizer 200 runs，evmVersion cancun；OpenZeppelin 5.6。

## 调用图与资金流

```
creator ──createLaunch──▶ Factory ─(delegatecall lib)─▶ new Token / Pool / Sale / Treasury
                                   └─ Pool.bindSale(sale) · Token.transfer(sale, S)
                                   └─ Locker.registerPool · FeeSplitter.register · Distributor.register
subscriber ──subscribe / subscribePublic──▶ Sale     (quote in, balance-diff checked)
anyone ──finalize──▶ Sale ─▶ quote+tokens → Pool ─▶ Pool.initialize ─▶ Locker.notifyLocked
                          ├─ incentive tokens → Distributor
                          ├─ quote dust → Treasury
                          └─ burn
anyone ──claim / claimFor──▶ Sale ─▶ tokens + refund → account
anyone ──sweepDust──▶ Sale ─▶ burn tokens · quote → Treasury        (only after all claims)
trader ──buy / sell──▶ Pool ─▶ fee → FeeSplitter.onFee · output → `to`
LP ──addLiquidity / removeLiquidity──▶ Pool         (own shares only; lockedShares never redeemable)
anyone ──skim──▶ Pool ─▶ excess quote → FeeSplitter · excess tokens → burn
```

募集款的去向只有三处：Pool、认购者、该币 Treasury（零头）。

经济模块资金流：

```
Pool ──fee (quote)──▶ FeeSplitter ─┬─ 20% booked: ecosystem ──claim──▶ ecosystem
                                    ├─ 20% booked: flywheel ──claim──▶ Flywheel ──buy+burn──▶ Pools
                                    ├─ c   booked: creator ──claim──▶ creator recipient
                                    └─ rest pushed ──▶ Treasury ─┬─ BUYBACK: buy+burn (TWAP guard)
                                                                 └─ REWARDS: ──▶ Distributor
Sale ──incentive tokens──▶ Distributor ──(released daily)── roots by rootPublisher ──claim──▶ users
```

## 不变量（测试：`contracts/test/invariants.fuzz.test.ts`）

I-01 偿付性 · I-02 报价资产守恒 · I-03 代币守恒 · I-04 开盘价 `Q·s == T·r` · I-05 无人低于 p 成交 · I-06 零头上界 · I-07 每份额价值不减（含第三方加 / 撤池）· I-08 储备 ≤ 余额 · I-09 创世 LP 永久锁定 · I-10 总量只减不增 · I-11 结算只发生一次 · I-12 无特权提款 · I-13 FeeSplitter 余额 ≥ 记账应付。

本地已运行 500 次随机发射 × 每次 50 步（含第三方加池 / 撤池），全部通过（种子 24301）。

## 信任假设

1. `quoteAdmin` 只影响**之后**的发射；若被盗，最坏结果是允许一个恶意 ERC-20 作为新发射的报价资产。
2. 报价资产自身：可冻结地址的资产（`freezable`）合约无法防御；转账税 / 重基代币由余额差检查拒绝；回调型代币由 `ReentrancyGuard` 阻止重入（测试 S-21）。
3. `rootPublisher`（多签）决定每期奖励的分配对象与数额，但受限于：总额 ≤ 已释放 / 已注资且未分配额度；24h 异议期；单期领取 ≤ 声明总额。数据集必须公开以便复算。
4. 国库与飞轮回购依赖池子 TWAP；TWAP 可被长时间、高成本的操纵影响，护栏只限制单次影响与频率。
5. 主网部署在外部审计前被 `deploy.ts` 拒绝。
6. 部署库以 DELEGATECALL 在 Factory 上下文执行：库地址在 Factory 部署时链接并固定；直接调用库函数会被 Solidity 的 library call protection 拒绝。

## 自识别高风险区

1. `PortusSale._settlement`：三种结果的分支条件与金额；`finalize` 的原子性与一次性。
2. `PortusSale._entitlement` / `sweepDust`：偿付性、零头不得侵占未领取者、重入。
3. `PortusPool`：手续费与输出的取整方向、2^112 边界、内部储备与 `skim`、TWAP 溢出语义。
4. `PortusFactory._validate`：粒度条件、FDV 交叉相乘、时间与公开阶段规则。
5. **权限面**：确认权限矩阵与代码一致；确认 Obscura 的特权路径全部不存在；确认 Locker 无转出路径，FeeSplitter / Treasury / Distributor / Flywheel 只有文档列出的入口（测试 A-03）。
7. **铸币模式**（`docs/mint-mode.md`）：节奏计算与上限、`mintDaily` 只能铸一次每日额度、税额与防暴跌扣款的取整、`sync` 不能被用来操纵（无 LP 份额）、Distributor 代币奖池同时计入激励释放与 Emission 注资。
6. **经济模块**：FeeSplitter 记账与实时推送的一致性；Treasury 回购护栏与观测刷新（不可被反复重置）；Distributor 释放曲线（递减模式的 WAD 幂运算）与根额度约束；Flywheel 提名替换逻辑、TWAP 检查点环形缓冲、`try/catch` 跳过路径不残留授权。

## 范围外

前端、API、keeper、冻结的 MCP 服务、报价资产合约本身、目标链排序器与跨链桥的安全性。

## 已知未完成

- 未进行外部审计。
- Slither / Mythril 未在本环境执行（未安装）。
- 覆盖率：总体 96.98%（含已废弃待移除的 IncentiveVault / FeeSink 两个 0% 文件）；新经济模块 FeeSplitter / Treasury / Distributor 为 100%，Flywheel 97.83%，Pool 98.69%，剩余为不可达的防御分支。
