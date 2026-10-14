# 前端改版与品牌化：交付给 agent 的执行指令

四项改动：品牌命名、UI 重做、中英文切换、MCP 打包下载。

每条任务都是自包含的，可以整段复制给 agent。**但执行顺序不能变**，理由见下。

---

## 零、品牌决策

### 推荐名称：**OBSCURA**（中文：暗匣）

理由：名字直接来自产品的核心机制——**出价在揭示前是被遮蔽的**（obscured）。
不是随便挑一个酷词，而是能一句话解释清楚的：「你的出价被封在暗匣里，开盘一起打开。」
赛博朋克视觉天然贴合，中英文都好念，`暗匣` 两个字在中文语境里干净且不土。

避开了两类坑：一是 `Dark*` 前缀在加密语境里容易联想到暗网、影响资金类产品的信任；
二是 `Agent*` 前缀目前极度拥挤。

**备选：** NOCTIS、UMBRA、VEIL。

### ⚠ 命名可用性必须由你确认，我无法可靠验证

我查过 npm，但那个检查**结论不可靠**——`npm view @obscura/core` 返回 404 只能说明那个具体包不存在，
**不能证明 scope 没被占用**。另外我知道市面上至少有一个 Obscura VPN 产品在用这个词。

定稿前请自己确认三件事：

1. npm scope：登录后访问 `npmjs.com/org/obscura`，或用 `npm publish --dry-run` 试探
2. 域名：obscura.xyz / obscura.fi 之类是否可注册
3. 商标：至少查一下目标市场的加密/金融类别是否已被注册

**这三项任意一项不通过，就换备选名。** 下面所有指令里的 `obscura` 都当作占位符，
一旦换名，全局替换即可。

### 命名映射表

| 位置 | 现在 | 改为 |
|---|---|---|
| 产品名 | Agent Launchpad | Obscura |
| 中文名 | （无） | 暗匣 |
| npm scope | `@launchpad/*` | `@obscura/*` |
| 根包名 | `agent-launchpad` | `obscura` |
| MCP server `name` | `agent-launchpad` | `obscura` |
| MCP 包名 | `@launchpad/mcp-server` | `@obscura/mcp` |
| MCP 可执行文件 | `launchpad-mcp` | `obscura-mcp` |
| `.mcp.json` 键名 | `launchpad` | `obscura` |
| 环境变量前缀 | `LAUNCHPAD_*` | `OBSCURA_*` |
| 本地状态目录 | `~/.launchpad` | `~/.obscura` |

---

## 一、执行顺序（不要打乱）

```
任务 3 品牌重命名  ──▶  任务 2 UI 重做  ──▶  任务 1 中英文  ──▶  任务 4 打包下载
```

**为什么是这个顺序：**

- **品牌必须最先做。** 否则你会去翻译和重新设计一批马上要被改名的字符串，返工两遍。
- **UI 重做必须早于 i18n。** UI 重做会重写几乎每个组件，先抽字符串等于把要扔掉的组件的
  字符串抽了一遍。i18n 应该在**最终的**组件上做。
- **打包下载放最后。** 它打包的是改名后的 MCP，下载按钮要放在重做后的页面上。

---

## 二、全局约束：以下任何一条被破坏，改动即为不合格

无论做哪项任务，agent 都必须保证：

1. **`node packages/mcp-server/scripts/smoke.mjs` 全部通过**，其中两条安全断言是红线：
   不暴露任何通用转账工具、没有任何工具接受调用方指定的目标地址。
2. **前端保持只读，绝不能出现 mint / 投标按钮。** 这是产品设计，不是遗漏——
   投标只能从用户自己的 agent 发起。唯一允许连钱包的页面是 `/create`（项目方建拍卖）。
3. **不可信文案的视觉围栏必须保留且醒目。** `analyze_launch` 和详情页会把项目方撰写的
   文案展示出来，那是攻击面。围栏弱化 = 安全退化。
4. **现有测试全绿：**

```bash
npm run typecheck --workspaces --if-present
cd contracts && npx hardhat test
npm run test -w @obscura/api
npm run test -w @obscura/mcp-server
node packages/mcp-server/scripts/smoke.mjs
```

---

## 任务 3 · 品牌重命名（最先做）

> 把项目从 `Agent Launchpad` 全面更名为 `Obscura`（中文：暗匣）。参照
> `docs/rebrand-frontend-tasks.md` 的命名映射表，逐项替换。涉及约 33 个文件。
>
> 需要改的位置至少包括：所有 `package.json` 的 `name` 与 workspace 依赖引用、
> `packages/mcp-server/src/index.ts` 里 `new McpServer({ name })`、`bin` 名称、
> 根目录 `.mcp.json` 的服务器键名、README/DEVELOPMENT/docs 全部文档、
> 前端 `layout.tsx` 的 `metadata.title` 和页头。
>
> **以下三条是破坏性变更，必须按指定方式做向后兼容，不许直接改掉：**
>
> **(a) 本地状态目录 `~/.launchpad` —— 直接改名会让用户丢钱。**
> 这个目录存的是密封投标的 salt，是唯一副本。如果有人正处在 commit 与 reveal 之间，
> 改名会让 salt 找不到，抵押金直接被没收。
> 正确做法：新默认值为 `~/.obscura`，但 `store.ts` 读取时若新目录不存在而 `~/.launchpad`
> 存在，则自动迁移（复制而非移动，保留原件），并在 stderr 打印一次迁移说明。
>
> **(b) 环境变量 `LAUNCHPAD_*` —— 直接改名会让所有现有 `.env` 和 MCP 配置失效。**
> 正确做法：优先读 `OBSCURA_*`，回退读 `LAUNCHPAD_*`；命中旧名时打印一次弃用警告，
> 说明新名字。`.env.example` 只写新名。写一个小工具函数集中处理，别在各处重复 `??`。
>
> **(c) `.mcp.json` 的服务器键从 `launchpad` 改为 `obscura`。**
> 用户已有的 MCP 宿主配置会失效，需要重新批准。在 README 和 `docs/demo-sepolia.md`
> 里明确写出这个升级步骤。
>
> 另外注意：`AuctionPhase` 的枚举值（PENDING/COMMIT/REVEAL/SETTLING/SETTLED/CANCELLED）
> 是合约枚举的镜像，**不是品牌字符串，一个字都不能动**。
>
> 完成后跑一遍全局约束里的五条命令，并额外确认：删掉 `~/.obscura` 后用旧的
> `~/.launchpad` 启动 MCP，迁移逻辑生效且 salt 可用。

---

## 任务 2 · UI 重做（赛博朋克 + 21st.dev）

> ### 前置条件：当前前端没有 Tailwind，也没有 shadcn
>
> `apps/web` 目前是 330 行手写 CSS（`app/globals.css`），依赖里只有 next/react/wagmi/viem。
> 而 21st.dev 的组件是 **shadcn 注册表格式，基于 React + Tailwind + Radix**。
> 所以必须先做技术栈迁移，不能直接贴组件。
>
> **第一步 — 铺底座：**
> 在 `apps/web` 安装并初始化 Tailwind v4 与 shadcn/ui（`npx shadcn@latest init`），
> 配置 `components.json`、`lib/utils.ts` 的 `cn()`、以及 CSS 变量主题。
> 确认 `npx next build` 通过后再往下走。
>
> **第二步 — 引入 21st.dev 组件：**
> 两种方式选一种，推荐前者：
> - 逐个用各组件页面提供的 `npx shadcn@latest add "<21st.dev 组件 URL>"` 安装
> - 或安装 21st.dev 的 Magic MCP（`npx @21st-dev/cli@latest install claude --api-key <KEY>`，需注册拿 key），
>   然后用 `/ui <描述>` 让 agent 直接生成
>
> **⚠ 授权务必逐个确认。** 21st.dev 是社区投稿目录，组件由不同作者发布，
> **站点首页没有统一的授权声明**。每引入一个组件，记录其作者与授权条款到
> `apps/web/COMPONENTS.md`；授权不明的组件不要用于商业产品。
>
> **第三步 — 赛博朋克主题，但有硬约束：**
>
> 主色调走赛博朋克（深色底 + 霓虹强调色，青/洋红/酸绿一类），但以下四条不许为了视觉牺牲：
>
> 1. **对比度必须达到 WCAG AA（正文 4.5:1，大字 3:1）。** 霓虹色在纯黑上常常不达标，
>    强调色用于文字时要提亮。做完用工具实测，不要目测。
> 2. **不可信文案区块必须仍然是页面上最刺眼的东西。** 现在它靠黄色虚线框脱颖而出。
>    如果整个页面都是霓虹发光，它就淹没了——这是安全退化。给它保留独占的警告色，
>    其余装饰性发光效果一律避开这个色相。
> 3. **六个拍卖阶段的颜色必须对色盲用户可区分。** 不能只靠颜色传达阶段，
>    必须同时有文字标签（现在已经有，保持）。
> 4. **不要加 mint / 投标按钮。** 见全局约束第 2 条。
>
> **第四步 — 保留现有功能，一个都不能少：**
> 首页的实时阶段统计条与 10 秒刷新、详情页的窗口倒计时、`indexedAtBlock` 新鲜度标注、
> 未揭示保证金台账、MCP 接入代码片段、`/create` 建拍卖表单。
>
> 完成后跑全局约束的五条命令，外加 `npx next build`，并在三种视口（375 / 768 / 1280）
> 下确认无横向滚动。

---

## 任务 1 · 中英文切换

> 给 `apps/web` 加中英文双语，默认跟随浏览器语言，可手动切换并记住选择。
>
> 用 `next-intl`（对 Next.js App Router 的服务端组件支持最完整）。
> 语言选择用 cookie 持久化，不要用 URL 前缀路由——这个站页面很少，加前缀反而让
> 分享出去的链接变复杂。语言切换器放页头。
>
> **以下内容不要翻译，逐条都有理由：**
>
> - **合约地址、交易哈希、代币符号** —— 标识符，翻译即错误。
> - **`AuctionPhase` 枚举值**（PENDING/COMMIT/REVEAL/...）—— 合约枚举的镜像。
>   界面上可以显示译名，但底层值必须保持英文原样，且译名要和阶段语义严格对应。
> - **MCP 工具名与工具描述**（`packages/mcp-server`）—— 那些文本是给 LLM 读的，
>   是接口契约的一部分，不是给人看的 UI。保持英文，本任务完全不碰 mcp-server。
> - **项目方撰写的文案本身**（`launch.copy.description`）—— 这是不可信的第三方内容。
>   机器翻译它会改变原意，一段本来写着风险提示的文字被译歪，责任无法界定。
>   原样展示，只翻译它外面的警告框。
>
> **必须翻译且要格外用心的：** 不可信文案的警告横幅、未揭示保证金的没收警告、
> 各阶段的说明文字。这些是安全信息，中文版必须和英文版一样有分量，不能因为翻译而变软。
>
> 数字与时间用 `Intl.NumberFormat` / `Intl.DateTimeFormat` 按 locale 格式化。
> 注意代币数量是 bigint，不要为了格式化把它转成 Number。
>
> 完成后确认：两种语言下所有页面无缺失键（构建时报错而非运行时静默回退英文），
> 且切换语言后刷新页面选择仍然保留。

---

## 任务 4 · MCP 打包下载

> 让用户能在网站上一键下载 MCP server，不必 clone 仓库。
>
> **第一步 — 打包：**
> 在 `packages/mcp-server` 加一个 `bundle` 脚本，用 esbuild 打成单文件
> （`--bundle --platform=node --format=esm --target=node22`），产物为 `dist/obscura-mcp.mjs`。
> 再打成 zip，内含：
> - `obscura-mcp.mjs`（单文件，无需 npm install）
> - `.env.example`（配置模板，**不含任何密钥**）
> - `mcp.json`（可直接粘贴的宿主配置片段）
> - `README.md`（安装、配置、安全说明）
> - `LICENSE`
>
> **第二步 — 三条安全要求，缺一不可：**
>
> 1. **产物绝不能包含任何密钥。** 加一个构建后校验步骤，扫描产物中的
>    `0x[0-9a-f]{64}` 模式和 `PRIVATE_KEY=` 后跟非空值，命中就让构建失败。
>    这个校验要作为测试跑，不是只在 CI 里。
> 2. **页面必须显示 zip 的 SHA-256，zip 内也附一份。** 用户下载的是一个会拿到他们私钥的
>    程序，必须给他们校验的手段。
> 3. **产物在构建时生成，不要提交进仓库。** 加进 `.gitignore`。
>
> **第三步 — 提供下载：**
> 用 Next.js 的 Route Handler（`app/download/route.ts`）返回 zip，
> 设置 `Content-Disposition: attachment`。不要用 `<a download>` 指向内联 blob。
> 下载页要写清楚：这个程序会在你的机器上运行、会读取你配置的私钥、
> 私钥不会发送给任何服务器、以及校验 SHA-256 的方法。
>
> **第四步 — 冒烟测试：**
> 加一个测试，实际执行打包出的单文件（`node dist/obscura-mcp.mjs`），
> 完成 MCP 握手并列出工具，断言工具集与 `smoke.mjs` 期望的一致。
> 打包很容易漏依赖，而漏了只有在用户手里才会暴露。
>
> 完成后确认：从 zip 解压到能在 Claude Code 里连上，全程不需要 clone 仓库、
> 不需要 npm install。

---

## 三、验收清单

四项全部完成后，逐条确认：

- [ ] 品牌名已确认可用（npm scope / 域名 / 商标三项均已自查）
- [ ] 旧的 `~/.launchpad` 目录能自动迁移，salt 不丢
- [ ] 旧的 `LAUNCHPAD_*` 环境变量仍可用，并有弃用警告
- [ ] `smoke.mjs` 两条安全断言通过
- [ ] 前端无 mint 按钮
- [ ] 不可信文案围栏在新设计下仍是页面最醒目元素
- [ ] 对比度实测达 WCAG AA
- [ ] 中英文切换可用且持久化，安全类文案两种语言分量一致
- [ ] 下载包不含密钥（有自动校验）
- [ ] 下载包解压即可用，单文件能完成 MCP 握手
- [ ] `apps/web/COMPONENTS.md` 记录了每个 21st.dev 组件的作者与授权
- [ ] 全局约束的五条命令全绿
