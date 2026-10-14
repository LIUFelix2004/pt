# 测试网

## 首选：Robinhood Chain Testnet

| 项 | 值 | 来源 |
|---|---|---|
| chainId | 46630 | 官方文档；`eth_chainId` 返回 `0xb626` |
| 公共 RPC | `https://rpc.testnet.chain.robinhood.com` | 官方文档（限流，不建议生产使用） |
| 浏览器 | `https://explorer.testnet.chain.robinhood.com` | 官方文档 |
| 类型 | 基于 Arbitrum 的 L2，ETH 作 gas | 官方文档 |
| 水龙头 | 待确认 | — |
| WETH 地址 | 待确认（N9），不凭记忆填写 | — |
| Cancun `TSTORE` 支持 | 待确认（N7）；合约目前使用非 transient 的 `ReentrancyGuard`，不受影响 | — |

Hardhat 网络名 `robinhood-testnet`，`chainType: "generic"`。部署步骤见 [runbook.md](runbook.md)。

## 以太坊测试网

Sepolia 已于 2026-09-30 停止支持；继任测试网的名称与 chainId 待从以太坊官方公告确认（N8），确认后在 `packages/shared/src/chains.ts` 与 `contracts/hardhat.config.ts` 各加一项即可。

## 旧部署

Obscura 在 Sepolia 上的部署记录保存在 `deployments/archive-obscura/`，只读。若旧拍卖仍有未揭示投标，其盐值在 `~/.obscura/commits.json`，`npm run reset` 不会删除它。
