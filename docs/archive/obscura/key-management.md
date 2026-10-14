# 私钥管理

MCP server 通过 `Signer` 抽象签名，`chain.ts` 只依赖接口，不依赖具体存储。选择方式由环境变量 `OBSCURA_SIGNER` 决定（旧名 `LAUNCHPAD_SIGNER` 仍可用，会有弃用警告）：

| `OBSCURA_SIGNER` | 密钥来源 | 适用 |
|---|---|---|
| `env`（默认） | `OBSCURA_PRIVATE_KEY` 明文环境变量 | 本地开发。启动时打印警告。 |
| `keystore` | scrypt + AES-256-GCM 加密的 keystore 文件，口令经 `OBSCURA_KEYSTORE_PASS` 提供；解密后密钥只驻留内存 | 个人生产使用 |
| `external` | 签名请求以 JSON 文件形式写入目录，由硬件钱包/离线机器签名后回填；本机从不持有私钥 | 最高安全等级 |

## env（仅开发）

```text
OBSCURA_SIGNER=env
OBSCURA_PRIVATE_KEY=0x...
```

`signer.ts` 在启动时打印警告。任何公网部署都不应使用此模式。

## keystore

生成 keystore（只执行一次，脚本读 `OBSCURA_PRIVATE_KEY` 并写出加密文件）：

```bash
OBSCURA_KEYSTORE_PATH=/path/to/signer.keystore \
OBSCURA_KEYSTORE_PASS='<强口令>' \
node packages/mcp-server/scripts/keystore.mjs create
```

运行 MCP：

```text
OBSCURA_SIGNER=keystore
OBSCURA_KEYSTORE_PATH=/path/to/signer.keystore
OBSCURA_KEYSTORE_PASS='<强口令>'
```

实现细节（`packages/mcp-server/src/signer.ts`）：

- KDF：scrypt（N=32768, r=8, p=1），16 字节随机 salt；
- 加密：AES-256-GCM，12 字节随机 IV；
- 密文只包含私钥字节，keystore 文件权限 `0600`；
- 进程内解密一次并缓存于内存，明文密钥不落盘、不打印、不进入任何日志。

## external（硬件钱包 / 离线签名）

```text
OBSCURA_SIGNER=external
OBSCURA_EXTERNAL_ADDRESS=0x<硬件钱包地址>
OBSCURA_EXTERNAL_DIR=./.sign-requests   # 可选，默认 ./sign-requests
```

工作方式：

1. MCP 需要签名时，把 `{operation, message|transaction|typedData}` 写入 `<dir>/<id>.request.json`；
2. 外部签名者（用户在自己的硬件钱包/安全机器上）读取请求，签名后写入 `<dir>/<id>.response.json`；
3. MCP 轮询到回填后广播交易，120 秒超时。

本机从不接触私钥；签名请求与回填文件应放在受控目录中，操作者负责在签名前核对请求内容。

---

## EIP-7702 session key 评估

EIP-7702 允许用户用一个 **session key**（或"delegation"）授权代理账户，代替把长期私钥交给 agent。把它用在 launchpad 上是否能把 `OBSCURA_MAX_SPEND_WEI` 从进程内软限制变成链上硬约束，取决于授权能否限定：

1. **目标合约**：授权应只对 `LaunchpadAuction`（和 `AgentRegistry` 的 register）生效。EIP-7702 授权本身是账户级，但配合委托合约内的访问控制可以限定到指定目标与 selector。
2. **方法白名单**：只允许 `commit`、`reveal`、`claim`（以及注册所需调用）。委托逻辑可以按 selector 过滤。
3. **金额上限**：可在委托合约里按 auction/累计限额限制 msg.value 与单笔 transfer；这比进程内 spend cap 强，因为它是链上不可绕过的。
4. **过期时间**：授权可带到期时间，commit 后仍需在 reveal 窗口内完成 reveal，因此过期时间必须覆盖拍卖窗口（或按 auction 动态批准）。

结论：

- **可行且值得做**：EIP-7702 能把“spend cap”变成链上硬约束，同时避免把长期私钥暴露给 agent 进程。
- **代价**：需要额外的授权合约与 UX（用户主钱包授权 session key）；硬分叉依赖（EIP-7702 已在 Pectra 上线，主网可用）；授权粒度设计错误会引入新的攻击面（如授权泄漏、delegation 冲突）。
- **建议**：Phase 3.1 的 `external` signer 已经覆盖“本机不持私钥”的最低要求。EIP-7702 作为后续升级项：先实现 session-key 授权合约 + 链上 spend cap，再替换 `env` signer 作为默认模式。当前 `maxSpendWei` 进程内校验继续保留为纵深防御，不能作为唯一边界。

**信任边界提醒**：无论哪种 Signer，`assertKeyIsSafeForChain` 都在签名前检查公网不允许使用公开测试密钥；keystore/external 模式同样执行该检查。
