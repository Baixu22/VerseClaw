# 01 — Codex 设计哲学

> 决策前先读。任何样式/组件/token 决策都不得违反这 20 条。当两条看似冲突时，**前面的优先**（编号即优先级）。
>
> 来源：`FakeCoding-main/codex-reference/tokens.css`（1137 token）+ `codex-design-system.css`（综合可读版）+ `codex-reference/ALIGNMENT.md`（实测值）+ 45 个组件 CSS。

---

## 1. Dark-first，light 是覆盖层

Codex 的设计是 **在暗色环境里完成的**。`#181818` 是 canvas，`#212121` 是 editor，`#000` 是 under-canvas。所有 token 的"原始定义"是暗色值；light 主题通过 `.electron-light` 选择器 **覆盖** 同名 token 实现，不是相反。

**含义**：当你设计一个新组件，先在暗色下把它做到位，再回头补 light 覆盖。**永远不要先做 light 再补 dark** —— 那会迫使你用 `rgba` 替代 `color-mix`，破坏原则 #3。

**Do**：
```css
:root { color-scheme: dark; --color-text-foreground: var(--gray-0); }
.electron-light { --color-text-foreground: #1a1c1f; }
```

**Don't**：
```css
.element { color: #1a1c1f; }              /* 直接硬编码 light 值 */
.dark .element { color: #fff; }            /* 组件层 dark: 双声明 */
```

---

## 2. Token-first，hex 只出现一次

每一个 hex 值在整份规范里 **只允许出现一次** —— 在 token 定义处（`tokens.css` 的 `--gray-900: #181818`）。其余所有地方 —— 组件 CSS、Tailwind 类、内联 style —— 都必须引用 token，不得重复出现 hex。

**含义**：改一个颜色 = 改一行。ClawX 当前的病根就是 `#212121f5` 这个值被复制到了 5 个不同前缀的 token（`--sp-menu-bg` / `--ccm-surface` / `--cdx-dropdown-bg` / `--material-elevated` / `--surface-modal`），改一处改不动其他四处。

**Do**：
```css
.dropdown { background: var(--color-background-elevated-primary); }
```

**Don't**：
```css
.dropdown { background: color-mix(in oklab, #212121 96%, transparent); }  /* hex 重复 */
```

> **lint 规则**：`styles.css` 的 hex count 必须为 0（FakeCoding 的 ALIGNMENT.md 实测已达标，ClawX 未达标）。见 [10-current-audit.md](./10-current-audit.md)。

---

## 3. `color-mix(in oklab)`，禁用 `rgba`

所有透明叠加必须用 `color-mix(in oklab, <base> <pct>%, transparent)`，**禁止 `rgba()` / `#RRGGBBAA`**。原因：OKLab 是感知均匀颜色空间，8% 白在暗色底上看起来像"灯光"而不是"灰雾"；sRGB 的 `rgba` 在低 alpha 时会出现脏灰感。

**典型比例**（暗色主题）：

| 用途 | 表达式 | 视觉效果 |
|---|---|---|
| 行 hover | `color-mix(in oklab, gray-0 5%, transparent)` | 微微发亮 |
| 按钮 secondary | `color-mix(in oklab, gray-0 5%, transparent)` | 淡灰填充 |
| 按钮 tertiary hover | `color-mix(in oklab, gray-0 7%, transparent)` | 悬浮加深 |
| elevated primary | `color-mix(in oklab, gray-800 96%, transparent)` | 半透明面板 |
| border hairline | `color-mix(in oklab, gray-0 8%, transparent)` | 0.5px 描边 |
| border heavy | `color-mix(in oklab, gray-0 12%, transparent)` | 分隔线 |

**Do**：
```css
.row:hover { background: color-mix(in oklab, var(--gray-0) 5%, transparent); }
```

**Don't**：
```css
.row:hover { background: rgba(255,255,255,0.05); }   /* 脏灰感 */
```

---

## 4. 三层灰阶，禁用纯黑当 canvas

canvas 永远是 `#181818`（`gray-900`），不是 `#000`。editor/code 区是 `#212121`（`gray-800`）。**纯黑 `#000` 只用在 under-canvas**（窗口背景、视频区域），不上 UI 表面。

**含义**：`#000` 作为 canvas 会让 elevated surface（`#212121`）看起来"浮得太高"、对比过强；`#181818` 让 elevated 和 canvas 的差是 **感知均匀的一档**，而不是两档。这是 Mac 原生窗口质感的来源。

**层级**：
```
under-canvas  #000        ← 窗口背景 / 视频
canvas        #181818     ← 主 UI 表面
editor        #212121     ← 代码 / diff 区
elevated      #282828      ← 不透明浮层 fallback
elevated-glass #212121f5  ← 半透明浮层（color-mix gray-800 96%）
```

---

## 5. 单一品牌色 `#339cff`，禁用第二强调色

整套体系里 **只有一个 brand color**：`{colors.blue-300}`（`#339cff`）。它出现在：

- 发送按钮 hover 态
- 被选中的 tab 底线 / 选中态填充
- 可点击链接文本
- focus ring（`outline-color`）
- accent 背景上的图标（`--color-icon-accent`）

**从不**当大面积背景。`{colors.blue-400}`（`#0285ff`）只在 dark 主题的 accent **填充** 上用（更亮，因为要补偿暗底）。`{colors.blue-50}`（`#e5f3ff`）只在 light 主题的 accent 背景上用（极淡，作为 chip 背景）。**这三档之外没有第四种蓝**。

**含义**：不要为"次要操作"发明第二个强调色（绿/紫/橙当 CTA）。次要操作走 secondary/tertiary 按钮变体（灰），不走"另一个彩色"。状态色（success/warning/error）只在 **状态语义** 上用，不当 CTA。

---

## 6. 1.25× 圆角缩放，三级节奏

`--corner-radius-scale: 1.25` 是全局乘数。基础值（Tailwind 标准）× 1.25 = Codex 实际值：

| 用途 | base | × 1.25 | 实际 |
|---|---|---|---|
| chip / badge | 2px (2xs) | 2.5px | 2.5px |
| 小按钮 / 输入框 | 4px (xs) | 5px | 5px |
| 表单输入 | 6px (sm) | 7.5px | 7.5px |
| 按钮 / 卡片 | 8px (md) | 10px | **10px** |
| 列表行 / dropdown item | 10px (lg) | 12.5px | **12.5px** |
| 小 dropdown | 12px (xl) | 15px | 15px |
| **标准 dropdown / popover** | 16px (2xl) | 20px | **20px** |
| **Composer 容器** | 20px (3xl) | 25px | **25px** |
| 大 dialog | 24px (4xl) | 30px | 30px |

**三级节奏**（这是必须背下来的）：
- **3xl (25px)** — 最大表面（Composer）
- **2xl (20px)** — 标准浮层（dropdown / popover / dialog / card）
- **lg (12.5px)** — 最小表面（list row / item / button）

**含义**：禁止出现 `8px`、`12px`、`16px` 这种"标准 Tailwind 值"—— 它们在 Codex 体系里是错的（应是 10/15/20）。禁止 Composer 用 25px 但 dropdown 用 15px —— 浮层会"陷进"容器。

---

## 7. 字体系统栈，base 14px

字体栈是 `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` —— **平台原生**，从不打包 web font（KaTeX 字体例外，是数学公式必需）。base 字号 `14px`（不是 16px），这是 **开发者工具密度** 的决定。

**字号阶**：

| token | px | 用途 |
|---|---|---|
| `--text-xs` | 11 | chip / badge / 元信息 |
| `--text-sm` | 12 | dropdown item / toolbar / caption |
| `--text-base` | **14** | 正文 / 消息气泡 / 代码块 |
| `--text-lg` | 16 | 小标题 |
| `--text-heading-sm` | 18 | 二级标题 |
| `--text-heading-md` | 20 | 一级标题（页面 H1） |
| `--text-heading-lg` | 24 | 大标题 |
| `--text-xl` | 28 | display |
| `--text-2xl` | 36 | 大 display |
| `--text-3xl` | 48 | 最大 display |

**含义**：禁用 `16px` 作为正文 base —— 那是 SaaS 营销页密度，不是开发工具。禁用 web font 包（除 KaTeX）。Mono 字体栈只在 code / terminal / diff 行内联用。

---

## 8. Weight 上限 500，强调来自字号不来自加粗

`font-weight` 永远不超过 `500`（medium）。display 用 `400`，正文用 `400`，按钮/tab label 用 `500`。**没有 `600`（semibold）和 `700`（bold）的用武之地**。

**含义**：要强调一句话，**换字号或换颜色**，不要 `font-bold`。这是 Codex 与"标准 SaaS"最大的分野 —— 它不靠 weight 抢眼球，它靠结构、留白、和那一抹蓝。

**Do**：
```tsx
<h1 className="text-heading-md font-medium">标题</h1>
<p className="text-base">正文</p>
```

**Don't**：
```tsx
<h1 className="text-xl font-bold">标题</h1>     {/* weight 太重 */}
<strong className="font-semibold">强调</strong>  {/* 用 weight 强调是错的 */}
```

---

## 9. 组件只引语义 token，禁用 `dark:` 双声明

组件 CSS 里 **禁止出现** `dark:bg-*` / `dark:text-*` / `dark:border-*` 这种 Tailwind 双前缀。所有暗色逻辑走 `:root` 选择器切换 `--color-*` 语义 token，组件只引用语义 token。

**含义**：当用户切主题，组件不需要重新计算 —— 它引用的 `var(--color-text-foreground)` 在 dark 下是 `#fff`，在 light 下是 `#1a1c1f`，自动跟着变。ClawX 当前的 `dark:` 双声明是主题"半残"的根源。

**Do**：
```tsx
<div className="bg-token-dropdown-background text-token-foreground" />
```

**Don't**：
```tsx
<div className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white" />
```

---

## 10. Dropdown 只有一种 recipe

所有 dropdown —— sidebar overflow menu、project action、project picker、mode switch、settings 子菜单、@mention list —— 共用 **同一份 CSS**（`web/src/codex-dropdown.css`），只在 **宽度** 上区分用途。

**唯一 recipe**：
```css
.dropdown {
  background: var(--color-background-elevated-primary);   /* color-mix gray-800 96% */
  color: var(--color-text-foreground);
  border-radius: var(--radius-2xl);                        /* 20px */
  box-shadow: var(--shadow-xl-spread);                    /* hairline + xl */
  backdrop-filter: blur(8px);
  padding: 4px;
}
.dropdown__item {
  border-radius: var(--radius-lg);                        /* 12.5px */
  padding: 6px 8px;                                        /* row-y row-x */
  min-height: 32px;
  font-size: 12px;                                         /* text-sm */
}
```

**宽度区分**（这是唯一允许的差异）：

| 上下文 | 宽度 |
|---|---|
| sidebar overflow（整理 / ⋯） | 188px |
| project action | 200px |
| project picker | 280px |
| mode switch | `min(260px, var(--sidebar-w-16))` |

**含义**：禁止为某个 dropdown 单独写一份 CSS。FakeCoding 的 `codex-dropdown.css` 是 **唯一来源**（ALIGNMENT.md 实测）。ClawX 当前的 5 套 dropdown 各自为政必须收敛到这一份。

---

## 11. 按钮只有三种变体 + 一种 icon

整个体系 **只有四种按钮**：

| 变体 | 背景 | 文字 | 用途 |
|---|---|---|---|
| primary | `button-primary`（dark: `gray-1000`，light: `text-foreground`） | `on-primary`（dark: `gray-1000` 反相，light: `gray-0`） | 主操作（发送 / 确认） |
| secondary | `button-secondary`（`color-mix gray-0 5%`） | `text-foreground` | 次要操作（取消） |
| tertiary | transparent，hover 出灰 | `text-button-tertiary`（`gray-500`） | 工具栏图标按钮 |
| icon | transparent，hover 出灰，方形 | — | 32×32 图标按钮 |

**没有第四种**。所有按钮必须落到这四种之一。Composer 内部按钮（28px 圆形）是 icon 的特化尺寸，不是新变体。

**含义**：禁用 `bg-blue-500 text-white` 这种"彩色按钮"—— 主操作走 primary（深色填充），不是蓝色填充。蓝色只在 **状态** 上用（链接 / focus / 选中态）。

---

## 12. 阴影只有 6 阶 + 1 hairline，禁用自定义

阴影是 **封闭集合**：

| token | 值 | 用途 |
|---|---|---|
| `--shadow-hairline` | `0 0 0 0.5px rgba(0,0,0,0.1)` | hairline 描边（输入框/dropdown 边） |
| `--shadow-sm` | `0 1px 2px -1px rgba(0,0,0,0.08)` | 极浅 |
| `--shadow-md` | `0 2px 4px -1px rgba(0,0,0,0.08)` | surface card |
| `--shadow-md-stronger` | `0 2px 4px -1px rgba(0,0,0,0.13)` | composer 容器 |
| `--shadow-lg` | `0 4px 8px -2px rgba(0,0,0,0.1)` | hover lift |
| `--shadow-xl` | `0 8px 16px -4px rgba(0,0,0,0.12)` | dropdown |
| `--shadow-2xl` | `0 16px 32px -8px rgba(0,0,0,0.19)` | modal / 大 dialog |
| `--shadow-xl-spread` | `hairline + xl` 复合 | **所有 dropdown 标配** |

**含义**：禁止 `box-shadow: 0 4px 12px rgba(0,0,0,0.15)` 这种手写值。dropdown 永远用 `xl-spread`（带 hairline），card 用 `md`，hover lift 用 `lg`，modal 用 `2xl`。

---

## 13. z-index 是阶不是数字

z-index 不是自由数字，是 **5 阶语义层**：

| 阶 | token | 数值 | 用途 |
|---|---|---|---|
| base | `--z-base` | 0 | 默认流 |
| raised | `--z-raised` | 10 | sticky header / composer 容器 |
| dropdown | `--z-dropdown` | 30 | dropdown / popover |
| modal | `--z-modal` | 50 | modal / dialog |
| toast | `--z-toast` | 100 | toast / 通知 |

**含义**：禁止 `z-9999`、`z-[99999]` 这种"留足余量"的写法。dropdown 必须用 `--z-dropdown`（30），modal 必须 `--z-modal`（50），toast 必须 `--z-toast`（100）。ClawX 当前的 12 个散落 z-index 必须收敛到这 5 阶。见 [10-current-audit.md](./10-current-audit.md)。

---

## 14. 图标统一 Lucide 24×24 stroke，禁用混用

图标集是 **唯一** 的 Lucide（`codex-icons/*.svg`，189 个），`viewBox="0 0 24 24"`，`stroke-width="2"`，`stroke="currentColor"`。尺寸只有两档：

| Tailwind 类 | px | 用途 |
|---|---|---|
| `h-4 w-4` | 16 | menu item / toolbar / chip 内 |
| `h-5 w-5` | 20 | nav rail / 大按钮 |

**含义**：禁止混用 Heroicons / Feather / Material Icons / 自绘 SVG。Codex 用 Lucide 是因为它的 stroke 风格（2px 圆头）和 `currentColor` 继承跟得上 `text-*` token 切换。如果需要新图标，**从 Lucide 加**，不要自绘。

---

## 15. 动画 0.15s 默认，必须带 reduced-motion 旁路

所有 transition 默认 `0.15s` + `cubic-bezier(0.4, 0, 0.2, 1)`。进入动画用 `ease-enter`（`cubic-bezier(0.19, 1, 0.22, 1)`，强减速）。**每一个 animation 必须带 `@media (prefers-reduced-motion: reduce)` 旁路**，把动画时长压到 `0.01ms` 或关闭。

**含义**：禁用 `transition: all 0.3s ease` 这种笼统写法（要列具体 property）。禁用 `animation-duration: 1s` 这种长动画（除 shimmer 周期性动画例外）。reduced-motion 是无障碍红线，不是可选。

**Do**：
```css
.row { transition: background-color 0.15s cubic-bezier(0.4,0,0.2,1); }
@media (prefers-reduced-motion: reduce) {
  .row { transition-duration: 0.01ms; }
}
```

---

## 16. 间距 4px 基线，row 32px 最小高度

`--spacing: 0.25rem`（4px）是基线。所有间距是 4 的倍数：4 / 8 / 12 / 16 / 24 / 32 / 48。列表行 / dropdown item 最小高度 `32px`（`spacing * 8`）。toolbar 高度 `46px`。composer 内部按钮 `28px`，按钮 gap `4px`。

**含义**：禁止 `padding: 7px 11px` 这种非 4 倍数值（除非是 row-y 的 `6px`，它是 `1.5×4` 的半档，用于垂直居中视觉补偿）。row hover 的 5.2% 白覆盖是实测值（ALIGNMENT.md），不是随便选的。

---

## 17. blur 8px 是玻璃标配，禁用 4px 以下

`backdrop-blur-sm`（8px）是 dropdown / popover / glass surface 的标配。`blur-xs`（4px）只用于极浅 hover 效果。**禁用 `blur(2px)` 以下** —— 太浅看不出玻璃感，反而像 bug。

**含义**：所有 elevated-glass surface（半透明浮层）必须 `backdrop-filter: blur(8px)` + `color-mix 96%`。两个一起才形成 Mac 原生面板质感。少一个都不到位。

---

## 18. 内容驱动布局，禁用装饰性元素

界面元素的显隐和布局由 **内容** 决定，不由"为了好看"加装饰。没有渐变背景、没有 mesh、没有装饰性 SVG（除了 onboarding 动画）、没有"为了平衡留白而加的插画"。每屏只有：文本、代码、diff、按钮、必要的图标。

**含义**：禁用 `bg-gradient-to-r from-blue-500 to-purple-500` 这种装饰渐变。禁用 hero 区大插画（除 onboarding）。空状态用极简的图标 + 一句话，不用大插画。

---

## 19. 紧凑密度，信息优先于留白

密度是开发者工具的核心。**一屏要塞下尽可能多的信息**，而不是"呼吸感"。padding 偏紧（行 6px/8px，card 16px），gap 偏小（4px），字号偏小（base 14px）。留白只用在 **分隔不同语义块** 时，不用在"让按钮看起来更舒服"。

**含义**：禁用 `p-8`（32px）作为常规 padding（除非 dialog 主区）。禁用 `gap-6`（24px）作为按钮间 gap。按钮间永远 `4px`，card padding `16px`，行 padding `6px 8px`。

---

## 20. 单一来源，禁用并行 token 前缀

所有 token 的 **唯一来源** 是 `tokens.css`（REF）或 `codex-tokens.css`（FakeCoding bridge）。**禁止** 引入新的 token 前缀（`--sp-*` / `--ccm-*` / `--cdx-*` / `--material-*` / `--surface-*` / `--cwh-*`）—— 这些是 ClawX 当前的病根。新增 token 必须落到官方前缀（`--color-*` / `--radius-*` / `--shadow-*` / `--spacing-*` / `--text-*` / `--font-*`）。

**含义**：FakeCoding 的 `codex-tokens.css` 是 bridge —— 它把官方 token + FakeCoding 别名（alias 到官方值）放一起。新增别名必须 `=` 官方值，不是新建一份。ClawX 的迁移第一步就是把 13+ 套前缀 **收敛到 `--color-*` 一套**。见 [11-migration-roadmap.md](./11-migration-roadmap.md)。

---

## 决策快速参考

当你在纠结一个样式决策时，按顺序问自己：

1. **这是 token 决定还是组件决定？** → token 决定的，去查 [02-tokens.md](./02-tokens.md)，不要在组件层硬编码。
2. **这个颜色是 brand / status / surface / text / border 哪一类？** → 只能落到这五类之一，不能"另起一个色"。
3. **这个圆角是 25 / 20 / 12.5 哪一档？** → 必须落到这三档之一（或更小档），不能 `16px`。
4. **这个按钮是 primary / secondary / tertiary / icon 哪一种？** → 必须落到这四种之一，不能"彩色 CTA"。
5. **这个 dropdown 用了统一 recipe 吗？** → 必须用 `codex-dropdown.css`，不能单写。
6. **这个动画带 reduced-motion 旁路了吗？** → 必须带。
7. **这个 z-index 用了语义阶吗？** → 必须用 `--z-*`，不能 `z-9999`。
8. **这个 hex 只在 token 定义处出现一次吗？** → 必须是。

如果任何一条答"否"，回头改 —— 不要带着违规继续。
