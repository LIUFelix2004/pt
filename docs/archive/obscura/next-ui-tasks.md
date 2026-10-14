# 下一步：UI 重做与中英文（交付给 agent 的执行指令）

## 当前状态（已实测确认，不是推测）

| 任务 | 状态 |
|---|---|
| 任务 3 · 品牌重命名 Obscura / 暗匣 | ✅ 已完成并验证 |
| 任务 4 · MCP 打包下载 | ✅ 已完成并验证（三处 SHA-256 一致，单文件可握手） |
| **任务 2 · UI 重做** | ❌ **未开始** |
| **任务 1 · 中英文** | ❌ **未开始** |

`apps/web` 目前：**没有 Tailwind、没有 shadcn、没有 next-intl**，
是 354 行手写 CSS（`app/globals.css`）。所以任务 2 必须从技术栈迁移做起。

**顺序不能变：先做任务 2，再做任务 1。** 任务 2 会重写几乎每个组件，
先做 i18n 等于把要扔掉的组件的字符串抽了一遍。

---

## 全局约束：以下任何一条被破坏，改动即为不合格

1. **`node packages/mcp-server/scripts/smoke.mjs` 必须继续全过**，其中两条是红线：
   不暴露任何通用转账工具、没有任何工具接受调用方指定的目标地址。
2. **前端保持只读，绝不能出现 mint / 投标按钮。** 投标只能从用户自己的 agent 发起。
   唯一允许连钱包的页面是 `/create`（项目方建拍卖）。
3. **不可信文案的视觉围栏必须保留且是全页最醒目的元素。** 弱化它 = 安全退化。
4. 现有测试全绿：

```bash
npm run typecheck --workspaces --if-present
cd contracts && npx hardhat test
npm run test -w @obscura/api
npm run test -w @obscura/mcp
node packages/mcp-server/scripts/smoke.mjs
node packages/mcp-server/scripts/bundle-smoke.mjs
```

---

# 任务 2 · UI 重做（赛博朋克 + 21st.dev）

## 2.1 先铺底座，铺完先验证再往下

> `apps/web` 现在没有 Tailwind 也没有 shadcn，而 21st.dev 的组件是
> **shadcn 注册表格式，基于 React + Tailwind + Radix**，不能直接贴。
>
> 在 `apps/web` 里安装 Tailwind v4 与 shadcn/ui，跑 `npx shadcn@latest init`，
> 生成 `components.json` 与 `lib/utils.ts` 的 `cn()`，把主题写成 CSS 变量。
>
> **这一步做完，先跑 `npx next build` 确认通过，再动任何组件。**
> 底座没铺稳就改组件，出问题时你分不清是 Tailwind 配置错了还是组件写错了。

## 2.2 引入 21st.dev 组件

> 两种方式选一种：
> - 逐个用组件页面给出的 `npx shadcn@latest add "<21st.dev 组件 URL>"` 安装
> - 或装 21st.dev 的 Magic MCP（`npx @21st-dev/cli@latest install claude --api-key <KEY>`，
>   需要先注册拿 key），然后用 `/ui <描述>` 让 agent 生成
>
> **⚠ 授权必须逐个记录。** 21st.dev 是社区投稿目录，组件作者各不相同，
> 站点没有统一授权声明。每引入一个组件，就在 `apps/web/COMPONENTS.md` 记下
> 组件名、作者、来源 URL、授权条款。**授权不明的组件不要用。**

## 2.3 赛博朋克主题：四条硬约束不许为视觉让步

> 主色调走赛博朋克（深底 + 霓虹强调，青/洋红/酸绿一类），但：
>
> **(a) 对比度必须实测达到 WCAG AA**（正文 4.5:1，大字 3:1）。
> 霓虹色在纯黑上经常不达标，用于文字时要提亮。**用工具量，不要目测。**
>
> **(b) 不可信文案区块必须是全页最刺眼的元素。**
> 它现在靠黄色虚线框脱颖而出。如果整页都在发光，它就淹没了——这是安全退化，不是审美问题。
> 给它保留一个**独占色相**，其余装饰性辉光一律避开这个色相。
>
> **(c) 六个拍卖阶段不能只靠颜色区分。** 必须同时有文字标签（现在已有，保持），
> 保证色盲用户可用。
>
> **(d) 加 `prefers-reduced-motion` 支持。** 赛博朋克风常用扫描线、辉光呼吸、
> 故障闪烁，这些对前庭敏感人群不友好，必须能被系统设置关掉。

## 2.4 四个路由，逐个迁移，每个都有必须保留的东西

> 用绞杀者模式：一次转换一个路由，`globals.css` 留到最后一个路由转完再删。
> 每转完一个就跑一次 `npx next build`。
>
> **`/`（首页）** — 必须保留：
> 顶部实时阶段统计条（六个阶段计数 + 每 10 秒刷新 + `refreshes every 10s · <时间戳>`）、
> 只读说明横幅、拍卖卡片的四项指标（FOR SALE / FLOOR / REVEALED BIDS / CLEARING PRICE）、
> 认购率进度条。客户端组件在 `app/live-index.tsx`。
>
> **`/launch/[id]`（详情页）** — 必须保留：
> 实时阶段面板与窗口倒计时（`closes in 8h 22m` 这类）、`indexed through block N` 新鲜度标注、
> ON-CHAIN STATE 指标网格、超额/不足认购的解释文字、
> **UNREVEALED COLLATERAL 未揭示保证金台账**、
> **UNTRUSTED 项目方文案围栏**、HOW TO BID 的 mcp.json 代码片段。
> 客户端组件在 `app/launch/[id]/live-launch.tsx`。
>
> **`/create`** — 项目方建拍卖表单 + 钱包连接。这是唯一允许连钱包的页面。
>
> **`/download`** — 必须保留：信任模型清单（「你正在下载一个会持有你私钥的程序」那一段）、
> SHA-256 展示与校验方法、下载按钮指向 `/download/mcp`。
> **这页的文字是安全信息，重做视觉时一个字都不要删。**

## 2.5 任务 2 验收

> - `npx next build` 通过
> - 375 / 768 / 1280 三种视口下无横向滚动
> - 对比度用工具实测并把结果记在 `apps/web/COMPONENTS.md`
> - 不可信围栏仍是全页最醒目元素（截图对比前后）
> - 无 mint 按钮
> - 全局约束的六条命令全绿

---

# 任务 1 · 中英文切换（任务 2 完成后再做）

> 给 `apps/web` 加中英双语，默认跟随浏览器语言，可手动切换并记住选择。
> 用 `next-intl`（对 App Router 服务端组件支持最完整）。
> **用 cookie 持久化，不要用 URL 前缀路由**——这个站页面很少，加前缀只会让分享出去的链接变复杂。
> 语言切换器放页头。
>
> ## 不要翻译的内容，每条都有理由
>
> - **合约地址、交易哈希、代币符号** —— 标识符，翻译即错误。
> - **`AuctionPhase` 枚举值**（PENDING / COMMIT / REVEAL / SETTLING / SETTLED / CANCELLED）
>   —— 合约枚举的镜像。界面可以显示译名，但**底层值必须保持英文原样**，
>   且译名要和阶段语义严格对应。
> - **MCP 工具名与工具描述**（`packages/mcp-server`）—— 那些文本是给 LLM 读的，
>   是接口契约的一部分，不是 UI。保持英文，本任务完全不碰 mcp-server。
> - **项目方撰写的文案本身**（`launch.copy.description`）—— 这是不可信的第三方内容。
>   机器翻译会改变原意；一段本来写着风险提示的文字被译歪，责任无法界定。
>   **原样展示，只翻译它外面的警告框。**
>
> ## 必须翻译且要格外用心的
>
> 不可信文案的警告横幅、未揭示保证金的没收警告、各阶段说明文字、
> `/download` 页的信任模型清单。
> **这些是安全信息，中文版必须和英文版一样有分量，不能因为翻译而变软。**
> 例如 "Losing it before reveal forfeits the collateral" 要译成
> 「在揭示前丢失它，抵押金将被没收」，不要软化成「请妥善保管」。
>
> ## 格式化
>
> 数字与时间用 `Intl.NumberFormat` / `Intl.DateTimeFormat` 按 locale 格式化。
> **注意代币数量是 bigint，不要为了格式化把它转成 Number**——会丢精度。
>
> ## 任务 1 验收
>
> - 两种语言下所有页面无缺失键，且缺键要在**构建时报错**，不能运行时静默回退英文
> - 切换语言后刷新页面，选择仍然保留
> - 安全类文案两种语言分量一致（人工逐条对照，不要机翻了事）
> - 全局约束的六条命令全绿

---

## 交给 agent 前提醒它的两件事

1. **每一步做完就构建一次。** 这个项目此前连续三轮出现「静态写完但从未运行」的情况，
   代价是注释里一个 `*/`、一个 route/page 冲突就让整个包编译不过。
   宁可多跑几次 `npx next build`。
2. **`.env` 里还是旧的 `LAUNCHPAD_*` 变量名**，运行时会刷弃用警告。
   不影响功能，但如果你在做界面截图对比，先把 `.env` 改成 `OBSCURA_*` 会清爽很多。
