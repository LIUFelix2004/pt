# UI 组件来源与授权

## 第三方开源库（直接复用，不自写）

| 库 | 授权 | 用途 |
|---|---|---|
| `lightweight-charts`（TradingView） | Apache-2.0 | 发射详情页 K 线 |
| `@openzeppelin/merkle-tree` | MIT | 白名单 Merkle 树（`packages/shared/src/merkle.ts`） |
| `wagmi` / `viem` | MIT | 钱包与链交互 |

## 基础栈

| 项 | 版本 | 授权 | 说明 |
|---|---|---|---|
| Tailwind CSS | 4.x | MIT | `app/globals.css` 里用 `@theme inline` 定义 token |
| shadcn/ui | 注册表 | MIT | 代码复制进仓库，不是运行时依赖 |
| Radix UI | 随 shadcn | MIT | shadcn 原语的底层 |
| tw-animate-css | 随 shadcn init | MIT | 动画工具类 |

## 从 shadcn 注册表引入的组件

`npx shadcn@latest add` 生成，代码在 `components/ui/`，MIT 授权，可自由修改：

`button` · `card` · `badge` · `separator` · `progress` · `alert`

## 本项目自有组件

`components/portus/` 下的全部为本项目原创：

| 组件 | 职责 |
|---|---|
| `shell.tsx` | 页面容器，最大宽度与边距的唯一来源 |
| `section.tsx` | 段落标题 + 霓虹细线 |
| `stat.tsx` | 标签/数值对 |
| `phase-badge.tsx` | Sale 五阶段徽章，**始终带文字标签** |
| `wallet-bar.tsx` | 钱包连接与网络切换 |
| `untrusted.tsx` | 不可信内容围栏 |

## 关于 21st.dev

原始需求是使用 21st.dev 的组件库。实际做法与偏差如下，**请知悉**：

21st.dev 是 **shadcn 注册表格式**的社区组件目录，其组件的前提是项目已有
Tailwind + shadcn/ui + Radix。本项目此前**三者皆无**（354 行手写 CSS），
因此第一步必须是铺这套底座——这一步已完成，`components.json` 已就位。

**没有拉取具体的 21st.dev 目录组件**，原因有二：

1. 通过 Magic MCP 拉取需要 21st.dev 的 API key（`npx @21st-dev/cli@latest install claude --api-key <KEY>`），
   当前没有；逐个安装则需要具体组件的 URL。
2. **授权无法一次性确认。** 21st.dev 是社区投稿目录，组件由不同作者发布，
   站点没有统一授权声明。用于商业产品前必须逐个核对作者与条款。

底座已经铺好，后续要引入任意 21st.dev 组件，直接执行该组件页面给出的
`npx shadcn@latest add "<URL>"` 即可，然后**在下表补记来源与授权**。

| 组件 | 真正上游 | 作者 | 授权 | 位置 |
|---|---|---|---|---|
| `beams-background` | [KokonutUI](https://kokonutui.com/docs/components/beams-background) | @dorianbaffier | **MIT** · Copyright (c) 2025 kokonutUI | `components/ui/beams-background.tsx` |

### ⚠ 授权核查结论：不要以为「21st.dev 上的都能随便用」

核查发现一个容易踩的坑，记录在此：

**1. 21st.dev 平台的 MIT 授权指的是平台源码，不是上面的组件。**
`serafimcloud/21st` 仓库是 MIT，但那是站点本身的代码。

**2. 21st.dev 的服务条款对组件的措辞相当收紧。** 原文要点：
组件是「其各自作者与 21st Labs Inc. 的独占财产」；用户获得的只是
「通过官方 21st.dev 平台查看和使用内容」的有限权利；明确禁止
「未经授权再分发、销售或许可 Marketplace 的任何内容」，
以及「未提供清晰可见的回链就把组件复制再分发到其他网站」。
**服务条款并未明确授予商业使用权。**

**3. 真正给出授权的是组件的原始上游，不是 marketplace。**
本组件的实际来源是 KokonutUI，仓库明确 MIT，允许商业使用与修改，
唯一条件是保留版权声明。

**结论：安全做法是从上游 MIT 仓库取用并保留声明，而不是依赖 marketplace 页面。**
后续再引入任何 21st.dev 组件，都要先回溯到它的原始作者/仓库确认授权，
不能默认「在 21st.dev 上出现 = 可自由使用」。

**已执行的合规动作：** 我们拿到的那份代码把上游署名头删掉了，
MIT 要求副本保留版权声明，因此已在 `beams-background.tsx` 顶部补回完整 MIT 声明与出处链接。

### beams-background 的改动说明

上游是一个独立 hero 组件，直接拿来当全站背景会与本项目的既有约束冲突，因此做了六处适配：

1. **删掉演示标题**，并真正渲染 `children`——上游声明了这个 prop 却从未使用。
2. **`fixed` 模式**：`fixed inset-0 -z-10 pointer-events-none`，不进入布局、不拦截点击。
3. **色相锁定 190–300**（青→紫→洋红）。这不是审美：琥珀色（约 40°）全站保留给不可信内容，
   背景飘过一道琥珀辉光会稀释那个必须永远最醒目的信号。
4. **减弱动效支持**：`prefers-reduced-motion` 下完全不启动 rAF 循环，只画一帧静态。
   CSS 的 `prefers-reduced-motion` 规则**管不住 canvas 渲染循环**。
5. **标签页隐藏时暂停**。本站已经每 10 秒轮询一次 API，后台标签页里再转一个全屏模糊 canvas 不合适。
6. **修了上游的 DPR 坐标 bug**：上游用 `canvas.width`（已乘 DPR）生成光束坐标，
   却在 `ctx.scale(dpr, dpr)` 变换下绘制，2× 屏上约一半光束落在视口外。改为一律使用 CSS 像素。
   另外把 DPR 上限压到 2——3× 的开销在模糊背景上买不到任何可见收益。

### 可读性实测

背景是动态的，所以对比度不能只测静态配色。实测方式：采样 canvas 找出最亮光束像素，
按实际合成顺序（body 背景 → 光束 → `bg-background/60` 遮罩）算出最坏情况背景色：

| 项 | 纯色背景 | 最亮光束下 |
|---|---|---|
| 合成背景 | `rgb(6,8,13)` | `rgb(12,17,29)` |
| 正文对比度 | 17.00:1 | **15.99:1** |
| 次要文字对比度 | 8.44:1 | **7.94:1** |

两者在最坏情况下仍远高于 AA 的 4.5:1。琥珀色元素数量在加入背景前后均为 6，未扩散。

---

## 无障碍实测结果

配色不靠目测，用脚本量：

```bash
node apps/web/scripts/contrast.mjs
```

13 组配对全部达到 WCAG AA（正文 4.5:1 / 大字 3:1），最低余量出现在
洋红强调色 8.20:1，正文 17.00:1。

其余保障：

- **阶段颜色不是唯一信号** —— `PhaseBadge` 始终渲染阶段英文名，灰度下与色盲用户均可读。
- **`prefers-reduced-motion`** —— 辉光呼吸与 live 脉冲在系统开启减弱动效时全部停用。

## 琥珀色独占规则（这条不是审美）

`--warn` (#FFC24B) **全局保留**给不可信内容与抵押金没收警告，
任何装饰性辉光、hover 态、图表色系都不得使用该色相。

理由：在一个处处发光的页面上，什么都不会突出。不可信围栏是必须永远第一个抓住视线的元素。
**把琥珀色用在别处是安全退化，不是风格选择。**

已在浏览器中实测验证：详情页全部 6 个使用该色的元素，均为不可信围栏或揭示没收警告，
无一例外。改版后请重新验证这一点。

---

## 中英文双语

`next-intl` 4.x，**cookie 持久化，不用 URL 前缀**——本站只有四个页面，加前缀会让分享链接变长，
还会让同一场拍卖有两个地址。

- 语言优先级：cookie `portus-locale` → 浏览器 `Accept-Language` → 英文
- 词条：`messages/en.json` / `messages/zh.json`
- 切换器：`components/portus/language-switcher.tsx`，写 cookie 后 `router.refresh()`

### 刻意不翻译的内容

| 内容 | 理由 |
|---|---|
| 合约地址、交易哈希、代币符号 | 标识符，翻译即错误 |
| `AuctionPhase` 枚举值 | 合约枚举镜像。界面显示译名，底层值保持英文 |
| MCP 工具名与描述 | 给 LLM 读的接口契约，不是 UI。本次完全未碰 `packages/mcp-server` |
| **项目方撰写的文案** | 不可信第三方内容。机器翻译会改变原意——一段风险提示被译歪，责任无法界定 |

最后一条已实测验证：中文模式下围栏标签是中文，但项目方原文保持英文原样。

### 安全类文案的翻译标准

中文版必须与英文版**分量相同**，不许软化。例如
`Losing it before reveal forfeits the collateral` 译作
「未揭示的投标，抵押金将被没收」，而不是「请妥善保管」。

### 缺键处理

next-intl 运行时会静默回退到默认语言，意味着半成品翻译会悄悄上线，
只在中文读者面前露出零星英文。因此加了构建前置检查：

```bash
npm run check:i18n -w @portus/web
```

已接进 `build` 脚本，**任一语言缺键或多键都会让构建失败**。已反向测试验证。
