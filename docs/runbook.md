# 运维手册（Portus）

## 本地

```bash
npm install
npm run chain                       # 终端 1
npm run contracts:deploy            # 部署 Factory + 测试用 MockWETH / MockUSD + 一个演示发射
npm run sync-env -- 31337           # 写入 PORTUS_* 地址
npm run dev:api                     # 终端 2，http://127.0.0.1:8787
npm run dev:web                     # 终端 3，http://localhost:3456
```

可选：`npm run demo-states:local` 造出各阶段的发射；`npm run finalize:local` 让 keeper 跑一轮；`npm run e2e` 跑完整端到端断言。

> Next 16 开发服务器默认只接受 `localhost` 来源，用 `127.0.0.1:3456` 打开会导致部分脚本 403、页面无法交互。

## 本地链演示（无需 MetaMask）

本地链（31337）上，网页会额外出现两样**仅本地可用**的工具：

- **本地测试账户 #0–#4**：Hardhat 节点自带的已解锁账户，交易与 EIP-712 签名都由节点完成，不需要浏览器插件。私钥是公开的，只能用于本地链。
- **本地演示工具**（发射详情页）：领取 100 测试 WETH；把链上时间快进到认购开始 / 公开阶段 / 认购结束。

演示脚本（约 3 分钟）：

1. 首页：介绍四个卖点，列表里有覆盖全部阶段的发射。
2. `/create`：连接 #0 → 填名称、目标 FDV（如 20 WETH）、时长 1 小时，白名单填 #1、#2 各 5 WETH → 勾选两项确认 → 创建。页面依次完成上链、白名单签名上传、文案签名上传。
3. 打开新发射：断开后连接 #1 →「快进到认购开始」→ 认购 5 WETH（先授权再认购）。
4. 切换到 #2 →「领取 100 测试 WETH」→ 认购 5 WETH。总额 10 > 目标 7，超额认购。
5. 「快进到认购结束」→「调用 finalize」：池子按 (7 WETH, 3.5 亿) 开盘，开盘价 = 认购价。
6. 「领取」：#2 拿到 1.75 亿代币 + 退款 1.5 WETH（超出的 3 WETH 按比例退回）。
7. 「交易」买入 1 WETH：手续费 0.01 WETH 进 FeeSink，储备与 K 线更新。页面底部 LP 锁定证明显示 Locker 份额 = 总份额。

> 快进会让链上时间领先于本机时钟，页面倒计时以链上时间为准。想要干净的演示状态：重启 `npm run chain` → `npm run contracts:deploy` → 重启 API（换一个新的 `DATABASE_PATH`）。

## 经济系统的运维（keeper 与奖励发布）

- **keeper**（`npm run keeper`）每轮：结算到期发射、清扫零头；国库回购模式刷新观测并尝试回购，回馈模式每 24h 划入 Distributor；飞轮每池每日检查点、按报价资产开轮 → 提名前 10 → 12h 后执行。全部是无许可调用，`KEEPER_ECONOMY=false` 可关闭。
- **奖励发布**（`npm run rewards`，平台侧，需 `ROOT_PUBLISHER_PRIVATE_KEY`）：对每个已开盘发射的激励池（以及回馈模式的国库奖励池）重建上一个完整 24h 窗口的数据，按雷达权重计算，写入 `REWARDS_DIR`（默认 `data/rewards/<chainId>/<token>/<asset>/<epoch>.json`，必须公开托管），再发布根。`--dry` 只计算不发布。
- 本地演示：`npm run demo-states:local` 会模拟一周交易与飞轮检查点；随后跑两三轮 keeper（中间用页面"快进"或 `evm_increaseTime`），再跑一次 `npm run rewards`，即可在网页上看到分账、回购、飞轮排名与可领取奖励。

## 测试网（Robinhood Chain Testnet，46630）

**部署前须用户明确批准。**

1. `.env` 设置 `CHAIN_ID=46630`、`RPC_URL`（建议自有节点）、`DEPLOYER_PRIVATE_KEY`（新生成，非 Hardhat 默认）、`PORTUS_QUOTE_ADMIN` / `PORTUS_ECOSYSTEM` / `PORTUS_ROOT_PUBLISHER`（多签地址）、`KEEPER_PRIVATE_KEY`。
2. `npm run preflight`，全部通过后：
3. `npm run contracts:deploy:robinhood-testnet -- --confirm`（或 `DEPLOY_CONFIRM=yes`）。不带确认时脚本只打印参数，不发交易。
4. `npm run sync-env -- 46630`。
5. 每个候选报价资产先跑准入检测：`QUOTE_ASSET=0x… HOLDER=0x… npx hardhat run scripts/check-quote-asset.ts --network <fork>`。结论为 BLOCK 的不上架；可冻结的以 `freezable=true` 上架。然后由 quoteAdmin 多签调用 `setQuoteAsset`（含价格来源与飞轮流动性门槛；WETH 等地址必须来自官方渠道，见规格 N9）。
6. 验证合约：Robinhood Chain 浏览器为 Blockscout，Hardhat 3 插件支持情况待确认（N10）；可先走 Sourcify 或浏览器页面上传。
7. 启动 API 与 keeper（`npm run keeper`）。

## 主网

`deploy.ts` 对 chainId 1 与 4663 默认拒绝：合约不可升级，必须先完成外部审计。审计完成后设 `PORTUS_MAINNET_AUDITED=yes` 才会放行。

## 监控

| 项 | 方法 |
|---|---|
| 未结算的发射 | `GET /launches?phase=AWAITING_FINALIZE` 非空且持续超过一轮 keeper 间隔 |
| keeper 余额 | keeper 日志 `low balance`（阈值 `KEEPER_LOW_BALANCE_ETH`） |
| 索引落后 | `GET /health` 的 `indexedBlock` 与链头差距；响应头 `x-portus-index: stale` |
| 部署不一致 | `GET /health` 的 `deploymentMismatch` 非空 → 重启进程 |
| FeeSink 收入 | 由 `FeePaid` / `Finalized.quoteDustToSink` / `DustSwept` / `Skimmed` 事件汇总 |

## 常见问题

- **createLaunch 回滚 `InvalidSchedule`**：开始时间早于出块时间。链上时间可能比本机时钟快，开始时间至少留 30–60 秒余量。
- **`PriceNotGranular`**：募集目标不满足 `r·10⁶ ≤ R`。前端会自动对齐；脚本里用 `alignRaiseTarget()`。
- **白名单上传 422**：名单重建的 Merkle 根与链上不一致。名单里的上限必须是创建时用于计算根的同一份（基础单位）。
