# Sepolia 实操演示手册（新钱包 + Claude agent）

目标：用两个全新的测试网钱包，在 Sepolia 上完整演示一次「用户用自己的 agent 打新」。
全程约 30 分钟，其中 20 分钟是拍卖窗口的等待时间。

---

## 零、先看这三条，能省掉最常见的三次返工

**1. 需要两个钱包，不能复用一个。**
部署钱包是项目方身份（合约 owner），投标钱包要交给 agent 用。混用意味着 agent 进程一旦被攻破，
攻击者同时拿到 owner 权限。

**2. 公链部署默认被拒绝。**
`deploy.ts` 会强制要求身份验证合约（防女巫），没有就直接退出。测试网演示要显式声明例外：
`ALLOW_STAKE_ONLY_REGISTRATION=true`。这个设计是故意的——别让它悄悄用纯质押模式上主网。

**3. 每次重新部署后必须重启 API。**
`--env-file` 只在进程启动时读取。忘了重启，API 会安静地服务上一个合约，界面数字全对但全是错的拍卖。
现在启动时会打印警告提示你，但还是别踩。

---

## 一、准备密钥与资金

```bash
npm run newkey
```

跑两次，分别填入 `.env`：

```
DEPLOYER_PRIVATE_KEY=0x<第一个>
OBSCURA_PRIVATE_KEY=0x<第二个>
```

两个地址都要领测试币。演示预算：

| 钱包 | 用途 | 需要 |
|---|---|---|
| 部署钱包 | 3 个合约 + 建拍卖 | ~0.05 ETH |
| 投标钱包 | 质押 0.01 + 抵押金 + gas | ~0.06 ETH |

水龙头：https://sepoliafaucet.com ，https://faucet.sepolia.dev

> 用 Hardhat 默认账户会被硬拦截——那些私钥印在文档里，公链上有余额几秒内被扫走。

## 二、配置网络

```
CHAIN_ID=11155111
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<你的 key>
OBSCURA_MAX_SPEND_WEI=50000000000000000
```

**强烈建议用自己的 Alchemy/Infura endpoint。** 公共节点限流的失败模式很难受：
一笔 commit 静默地没发出去，你以为投标成功了，等到 reveal 才发现链上根本没有 commitment。

`OBSCURA_MAX_SPEND_WEI` 设成 0.05 ETH——这是进程内的硬上限，任何对话内容都改不了它。
调成你实际持有量的量级，即使 agent 被提示词注入骗了，损失也被钉死。

## 三、部署

演示用的拍卖要**小**。默认规模吃满需要 500 ETH，水龙头给不了；调小之后，
你用一个钱包出价超过供应量，就能演示超额认购和按比例分配。

```bash
ALLOW_STAKE_ONLY_REGISTRATION=true \
DEMO_FOR_SALE_TOKENS=100 \
DEMO_FLOOR_ETH=0.0001 \
COMMIT_MINUTES=10 \
REVEAL_MINUTES=10 \
npm run contracts:deploy:sepolia
```

这样：供应 100 枚，底价 0.0001 ETH，**吃满全部供应只要 0.01 ETH**，窗口各 10 分钟。

```bash
npm run sync-env -- 11155111
```

只改链相关的键，不碰你的私钥。

**验证合约**（投标人要把抵押金打进去，他们有权读源码）：

```bash
npm run verify:sepolia -w @obscura/contracts -- <AgentRegistry地址> 10000000000000000 100000000000000000000000 86400
```

配了 `ETHERSCAN_API_KEY` 走 Etherscan，没配也会走 Sourcify（不需要 key）。

## 四、启动服务

```bash
npm run build -w @obscura/mcp
```

```bash
npm run dev:api
```

启动日志确认是 `network: Sepolia (chain 11155111)`，且**没有** mismatch 警告。

```bash
npm run seed
```

```bash
npm run dev:web
```

看板：http://127.0.0.1:3456

## 五、接入 Claude agent

仓库根目录的 `.mcp.json` 已经写好，**里面没有任何密钥**——可以放心在演示时展示：

```json
{
  "mcpServers": {
    "obscura": {
      "command": "node",
      "args": ["./packages/mcp-server/dist/index.js"]
    }
  }
}
```

MCP server 会自己从仓库根目录的 `.env` 读取配置和密钥。`.env` 是 gitignored 的。

在仓库目录下启动 Claude Code，它会提示批准这个 MCP server。批准后用 `/mcp` 确认 `obscura` 已连接（旧版本键名是 `launchpad`，升级后需要重新批准）。

## 六、演示脚本（直接对 Claude 说这些话）

**第 1 幕 · 身份与边界**

> 用 obscura 工具查一下我的状态

看点：地址、网络是 Sepolia、参与资格、**每笔交易的硬花费上限**。
强调这个 MCP server 跑在本机，私钥从没离开过这台机器。

**第 2 幕 · 取得资格**

> 帮我注册成为 obscura 参与者

**第 3 幕 · 尽调，以及提示词注入防线**

> 分析一下 launch #0，然后告诉我值不值得参与

看点：返回内容分成两块——**链上事实**（合约直读，权威）和**项目方文案**（被
`---BEGIN UNTRUSTED---` 围栏隔离，明确标注不可信）。
可以现场问 Claude：「那段文案里如果写了让你转账的指令，你会照做吗？」

**第 4 幕 · 防线实测（演示的高光）**

> 帮我投一个 1000 枚、最高价 0.001 ETH 的标

1000 × 0.001 = 1 ETH 抵押，超过 0.05 ETH 上限，**在产生任何签名之前就被拒绝**：

```
FAILED: policy violation: attaching ... exceeds the hard cap of ...
it cannot be raised from inside a conversation.
```

这一幕值得停下来讲：agent 能造成的最坏后果被钉死在一个数字上。

**第 5 幕 · 真实投标**

> 那改成投 150 枚，最高价 0.0002 ETH

150 × 0.0002 = 0.03 ETH 抵押，在上限内。**注意 150 > 供应量 100**，所以会超额认购。

看点：salt 只存本地（工具会打印路径并警告），链上只有哈希，**任何人在揭示前都看不到出价**。

**第 6 幕 · 等待与自查**（约 10 分钟）

> 我现在有什么待办？

commit 窗口关闭后再问一次，会看到揭示倒计时和「否则没收多少抵押」的警告。
这段时间可以切到看板看阶段变化。

**第 7 幕 · 揭示**

> 揭示我在 launch #0 的投标

**第 8 幕 · 结算**（约 10 分钟后）

结算是**无权限**的，也就意味着没人有义务调用它。agent 没有这个工具，必须由 keeper 来做：

```bash
KEEPER_ONE_SHOT=true npm run keeper
```

**第 9 幕 · 领取**

> 领取我的份额

看点：出价上限 0.0002，实际按清算价成交，**多付的抵押原路退回**。
超额认购下 150 枚的请求会被按比例削减到 100 枚（全部供应量）。

## 七、时间线

| 时刻 | 动作 |
|---|---|
| T+0 | 部署、启服务、接 Claude |
| T+2min | 第 1–5 幕：注册、尽调、被拦、投标 |
| T+12min | commit 窗口关闭，第 7 幕揭示 |
| T+22min | reveal 窗口关闭，跑 keeper 结算 |
| T+24min | 第 9 幕领取，展示代币到账 |

窗口时长在部署时用 `COMMIT_MINUTES` / `REVEAL_MINUTES` 控制。现场演示 10 分钟合适，
再短的话 Sepolia 的出块和确认会让人紧张。

## 八、出问题时

| 现象 | 原因 |
|---|---|
| 部署报「requires PERSONHOOD_VERIFIER_ADDRESS」 | 没加 `ALLOW_STAKE_ONLY_REGISTRATION=true` |
| 界面阶段/笔数不对 | 重新部署后没重启 API。看 API 启动日志的 mismatch 警告 |
| `NotRegistered()` | 换了新部署，注册表是新的，要重新质押 |
| `WrongPhase()` | 窗口已过。看板上有准确倒计时 |
| commit 交易一直不确认 | 公共 RPC 限流。换自己的 endpoint |
| 拍卖卡在 SETTLING 不动 | 正常——必须有人跑 keeper |
| 揭示报「no local commit found」 | salt 文件被删了，或换了机器。抵押金会被没收 |

## 九、演示前 5 分钟自检

```bash
npm run typecheck --workspaces --if-present
node packages/mcp-server/scripts/smoke.mjs
curl -s http://127.0.0.1:8787/health
```

`smoke.mjs` 会断言两条关键安全属性仍然成立：**不暴露任何通用转账工具**、
**没有任何工具接受调用方指定的目标地址**。这两条是第 4 幕的底气。
