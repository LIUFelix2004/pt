# 密钥管理（Portus）

Portus 主线只有三类密钥，且都不持有用户资金的控制权。

| 角色 | 环境变量 | 权限 | 建议 |
|---|---|---|---|
| deployer | `DEPLOYER_PRIVATE_KEY` | 部署 Factory 与部署库；**部署后无任何权限** | 每个网络单独生成；只放够部署的 gas |
| keeper | `KEEPER_PRIVATE_KEY` | 无合约特权，只是代为调用 `finalize` / `sweepDust` | 热钱包，余额保持小额，低余额告警 |
| quoteAdmin | `PORTUS_QUOTE_ADMIN`（地址） | 维护今后可用的报价资产与 FDV 边界 | **多签**；不在任何服务器上存私钥（是否加时间锁待定，D11） |

通用规则：

- 生成：`npm run newkey`。
- 所有签名入口（deploy、keeper）在非本地链遇到 Hardhat 默认助记词地址时直接拒绝（`assertKeyIsSafeForChain`）；`npm run preflight` 也会检查。
- `.env` 不进版本库，`npm run reset` 在任何参数下都不会删除它。
- 创建者签名（EIP-712 白名单 / 文案授权）在创建者自己的钱包里完成，服务器只验证签名。

Obscura 时期的 bidder / MCP 签名器说明已随 MCP 服务冻结，见 `frozen/mcp-server/` 与 `archive/obscura/key-management.md`。
