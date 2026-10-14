# Portus 开发进度

规格：[docs/portus-spec.md](docs/portus-spec.md)（§7 为阶段计划与验收标准）。Obscura 时期的开发记录在 `docs/archive/obscura/DEVELOPMENT.md`。

## 主线

| 阶段 | 内容 | 状态 | 验收情况 |
|---|---|---|---|
| P0 骨架与改名 | 冻结 MCP、删除拍卖 / 注册表 / 真人证明、改名 Portus、链配置 | ✅ | `npm run typecheck` 通过；旧文件移入 `docs/archive/obscura/`、`frozen/`、`deployments/archive-obscura/`；`.env` 未读写。仓库此前无 git 提交，未建基线 commit |
| P1 主线合约 | Factory / Sale / Pool / Locker / Vault / FeeSink / Token | ✅ | 编译无警告；全部合约 < 24 KB（Factory 8.7 KB，借助部署库）；无 §4.2 选择器 |
| P2 主线测试 | §5.1 用例、§5.2 不变量 | ✅（Slither 除外） | 56 项通过；覆盖率 98.48%（Sale 100%，Pool 97.78%，见规格 X14）；fuzz 500×50 通过；**Slither 未运行**（本机未安装） |
| P3 部署脚本与共享包 | deploy / new-launch / merkle / e2e / pricing / merkle | ✅ | `npm run e2e` 跑通 FILLED / SHRUNK / REFUNDED；pricing.ts 与合约对拍；公网需 `--confirm`，主网直接拒绝 |
| P4 API / 索引器 / keeper | §6.1–§6.4 | ✅（keeper 无自动化测试） | 12 项测试，API 覆盖率 92%；白名单根不一致拒绝入库；重放幂等；keeper 本地自动 finalize |
| P5 前端 + i18n | §6.5–§6.6 | ✅ | 构建通过；en/zh 键一致；对比度通过；本地链上用网页完整走通创建→白名单认购→快进→结算→领取→买入（本地测试钱包）；MetaMask 交互未实测 |
| P6 测试网与文档 | Robinhood Testnet 部署、文档 | 文档 ✅；**部署未做** | 测试网部署需用户批准 |

## 经济系统（按 Portus 文档补齐，2026-10-10）

| 阶段 | 内容 | 状态 | 验收情况 |
|---|---|---|---|
| P7 FeeSplitter | 四方分账、创建者 / 生态领取 | ✅ | FS-01..04；本地网页领取实测 |
| P8 Treasury | 回购（TWAP 护栏）/ TWAB 回馈 | ✅ | TR-01..06；keeper 本地实测回购与划入 |
| P9 Distributor | 激励释放、Merkle 领取、雷达计算器、单层邀请 | ✅ | DI-01..07、calc 5 项；本地发布并网页领取 |
| P10 Flywheel | 检查点、提名排名、回购销毁 | ✅ | FW-01..06；keeper 本地跑通一整轮 |
| 第三方 LP | 加池 / 撤池，LP 挖矿 | ✅ | LP-01..04；fuzz 500×50 含加撤池 |
| 报价资产三道检查 | 新字段 + 准入检测脚本 | ✅ | 本地 mock 实测 |

决策与对照：`docs/p7-p10-decisions.md`；偏差：规格 X24–X32。

## 后续阶段

P11 MCP 复活（可选）· P12 外部审计与主网。

## 待拍板（规格 §7.3）

D7、D8、D9、D11、D12、N1–N12。代码中按"默认"一栏实现，其中 N4（缩量时激励按 C/R 缩放）、N5（认购不可撤回）、N7（使用非 transient 重入锁）、N9（WETH 地址留空）直接影响当前行为。
