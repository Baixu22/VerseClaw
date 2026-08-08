---
version: v0.3
name: Codex-Design-System-For-ClawX
description: A dark-first, token-driven developer-tool design system distilled from the OpenAI Codex Electron desktop client. Brand voltage comes from a single accent blue (#339cff) on near-black gray surfaces; surfaces and overlays use color-mix(in oklab) for perceptually uniform transparency; corner radii are scaled 1.25× (composer 25px, dropdown 20px, list-row 12.5px); type runs the system sans stack at a compact 14px base with mono accents for code and terminal; all themes are switched by token only — no per-component dark: variant pairing. v0.2 adds deep-dive specs for motion orchestration (stagger engine, three-track animation, asymmetric enter/exit), interaction state machines (Button/Dropdown/List/Composer with full ARIA + keyboard nav), and production implementation guide (engineering checklists, quality gates, a11y acceptance, performance budgets, risk management). v0.3 adds 12 subsystem specs (15-26) covering conversation rendering, layout architecture, settings/forms/overlays, states/icons/a11y, command palette, onboarding/first-run, avatars/identity, data visualization, plugins/PDF, voice dictation/presentation, collaboration/chips/modals, and worktree/review/mermaid/terminal — completing the full enterprise design system coverage.

colors:
  # ── Base palette (raw hex, declared once) ──
  gray-0: "#ffffff"
  gray-50: "#f9f9f9"
  gray-75: "#f3f3f3"
  gray-100: "#ededed"
  gray-300: "#afafaf"
  gray-500: "#5d5d5d"
  gray-550: "#4f4f4f"
  gray-600: "#414141"
  gray-700: "#303030"
  gray-750: "#282828"
  gray-800: "#212121"
  gray-900: "#181818"
  gray-1000: "#0d0d0d"

  green-300: "#40c977"
  green-400: "#04b84c"
  green-500: "#00a240"
  green-700: "#00692a"

  red-300: "#ff6764"
  red-400: "#fa423e"
  red-500: "#e02e2a"
  red-600: "#ba2623"
  red-900: "#4d100e"

  orange-300: "#ff8549"
  orange-400: "#fb6a22"
  orange-500: "#e25507"
  orange-700: "#923b0f"

  yellow-300: "#ffd240"
  yellow-400: "#ffc300"

  blue-50: "#e5f3ff"
  blue-100: "#99ceff"
  blue-300: "#339cff"
  blue-400: "#0285ff"
  blue-900: "#00284d"

  purple-300: "#ad7bf9"
  purple-400: "#924ff7"

  pink-400: "#ff66ad"

  # ── Dark theme semantic surface role ──
  surface-dark-canvas: "{colors.gray-900}"
  surface-dark-under: "#000000"
  surface-dark-editor: "{colors.gray-800}"
  surface-dark-elevated: "{colors.gray-750}"
  surface-dark-elevated-glass: "color-mix(in oklab, {colors.gray-800} 96%, transparent)"
  surface-dark-elevated-secondary: "color-mix(in oklab, {colors.gray-0} 3%, transparent)"

  # ── Light theme semantic surface role ──
  surface-light-canvas: "{colors.gray-0}"
  surface-light-under: "{colors.gray-50}"
  surface-light-elevated: "color-mix(in oklab, {colors.gray-0} 70%, transparent)"
  surface-light-elevated-opaque: "{colors.gray-0}"
  surface-light-elevated-secondary: "color-mix(in oklab, {colors.text-foreground-light} 2%, transparent)"

  # ── Brand / accent ──
  accent-brand: "{colors.blue-300}"
  accent-brand-strong: "{colors.blue-400}"
  accent-brand-tint: "{colors.blue-50}"
  accent-brand-deep: "{colors.blue-900}"

  # ── Status ──
  status-success: "{colors.green-500}"
  status-warning: "{colors.orange-500}"
  status-error: "{colors.red-500}"
  status-info: "{colors.blue-400}"

  # ── Text on dark ──
  text-foreground-dark: "{colors.gray-0}"
  text-foreground-secondary-dark: "color-mix(in oklab, {colors.gray-0} 70%, transparent)"
  text-foreground-tertiary-dark: "color-mix(in oklab, {colors.gray-0} 50%, transparent)"

  # ── Text on light ──
  text-foreground-light: "#1a1c1f"
  text-foreground-secondary-light: "color-mix(in oklab, #1a1c1f 70%, transparent)"
  text-foreground-tertiary-light: "color-mix(in oklab, #1a1c1f 50%, transparent)"

  # ── Border (hairline) ──
  border-dark: "color-mix(in oklab, {colors.gray-0} 8%, transparent)"
  border-dark-heavy: "color-mix(in oklab, {colors.gray-0} 12%, transparent)"
  border-light: "color-mix(in oklab, #1a1c1f 8%, transparent)"
  border-light-heavy: "color-mix(in oklab, #1a1c1f 12%, transparent)"

typography:
  font-sans-default: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  font-openai-sans: "'OpenAI Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  font-mono-default: "ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"

  text-xs: 11px
  text-sm: 12px
  text-base: 14px
  text-lg: 16px
  text-xl: 28px
  text-2xl: 36px
  text-3xl: 48px

  text-heading-sm: 18px
  text-heading-md: 20px
  text-heading-lg: 24px

  font-weight-light: 300
  font-weight-normal: 400
  font-weight-medium: 500
  font-weight-semibold: 600
  font-weight-bold: 700

  leading-tight: 1.25
  leading-snug: 1.375
  leading-normal: 1.5
  leading-relaxed: 1.625

  tracking-tight: -0.025em
  tracking-normal: 0em
  tracking-wide: 0.025em

rounded:
  2xs-base: 2px
  xs-base: 4px
  sm-base: 6px
  md-base: 8px
  lg-base: 10px
  xl-base: 12px
  2xl-base: 16px
  3xl-base: 20px
  4xl-base: 24px
  full: 9999px

  2xs: 2.5px
  xs: 5px
  sm: 7.5px
  md: 10px
  lg: 12.5px
  xl: 15px
  2xl: 20px
  3xl: 25px
  4xl: 30px

spacing:
  base: 4px
  row-x: 8px
  row-y: 6px
  list-row-min-height: 32px
  toolbar-height: 46px
  toolbar-sm-height: 36px
  toolbar-pane-height: 40px
  composer-button: 28px
  composer-button-sm: 20px
  composer-button-gap: 4px
  composer-single-line-radius: 22px
  token-sidebar-min: 240px
  token-sidebar-max: 520px

shadows:
  hairline: "0px 0px 0px 0.5px rgba(0, 0, 0, 0.1)"
  sm: "0px 1px 2px -1px rgba(0, 0, 0, 0.08)"
  md: "0px 2px 4px -1px rgba(0, 0, 0, 0.08)"
  md-stronger: "0px 2px 4px -1px rgba(0, 0, 0, 0.13)"
  lg: "0px 4px 8px -2px rgba(0, 0, 0, 0.1)"
  xl: "0px 8px 16px -4px rgba(0, 0, 0, 0.12)"
  2xl: "0px 16px 32px -8px rgba(0, 0, 0, 0.19)"
  xl-spread: "0 0 0 0.5px var(--color-border), 0px 8px 16px -4px rgba(0, 0, 0, 0.12)"

blur:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 40px
  3xl: 64px

motion:
  default-duration: 0.15s
  relaxed-duration: 0.3s
  default-easing: cubic-bezier(0.4, 0, 0.2, 1)
  ease-enter: cubic-bezier(0.19, 1, 0.22, 1)
  ease-enter-snappy: cubic-bezier(0.23, 1, 0.32, 1)
  ease-out: cubic-bezier(0, 0, 0.2, 1)
  ease-in: cubic-bezier(0.4, 0, 1, 1)

components:
  dropdown-shell:
    backgroundColor: "var(--color-background-elevated-primary)"
    color: "var(--color-text-foreground)"
    borderRadius: "{rounded.2xl}"
    boxShadow: "{shadows.xl-spread}"
    backdropFilter: "blur({blur.sm})"
    padding: "4px"
  dropdown-item:
    borderRadius: "{rounded.lg}"
    paddingLeft: "{spacing.row-x}"
    paddingRight: "{spacing.row-x}"
    paddingTop: "{spacing.row-y}"
    paddingBottom: "{spacing.row-y}"
    minHeight: "{spacing.list-row-min-height}"
    fontSize: "{typography.text-sm}"
  dropdown-width-sidebar-overflow: 188px
  dropdown-width-project-action: 200px
  dropdown-width-project-picker: 280px
  dropdown-width-mode-switch: "min(260px, var(--sidebar-w-16, 260px))"

  button-primary:
    backgroundColor: "var(--color-background-button-primary)"
    color: "var(--color-text-button-primary)"
    borderRadius: "{rounded.md}"
  button-secondary:
    backgroundColor: "var(--color-background-button-secondary)"
    color: "var(--color-text-button-secondary)"
    borderRadius: "{rounded.md}"
  button-tertiary:
    backgroundColor: "transparent"
    color: "var(--color-text-button-tertiary)"
    borderRadius: "{rounded.md}"
  button-icon:
    borderRadius: "{rounded.md}"
    size: 32px

  composer-shell-multi:
    borderRadius: "{rounded.3xl}"
    backgroundColor: "var(--color-background-elevated-primary)"
    boxShadow: "{shadows.md-stronger}"
  composer-shell-single:
    borderRadius: 22px
    backgroundColor: "var(--color-background-elevated-primary)"
  composer-button:
    size: "{spacing.composer-button}"
    borderRadius: "{rounded.md}"
  composer-button-sm:
    size: "{spacing.composer-button-sm}"
  composer-button-gap: "{spacing.composer-button-gap}"

  card-surface:
    backgroundColor: "var(--color-background-elevated-primary)"
    borderRadius: "{rounded.2xl}"
    boxShadow: "{shadows.md}"
    padding: 16px
  card-surface-flat:
    backgroundColor: "var(--color-background-elevated-secondary)"
    borderRadius: "{rounded.xl}"
    padding: 12px

  list-row:
    minHeight: "{spacing.list-row-min-height}"
    paddingLeft: "{spacing.row-x}"
    paddingRight: "{spacing.row-x}"
    borderRadius: "{rounded.lg}"
    hoverOverlay: "color-mix(in oklab, var(--gray-0) 5%, transparent)"
---

## Overview

Codex 的界面是被设计成一台 **安静的开发者工作台**：默认是深色的 `#181818` 画布，所有重量都压在内容上 —— 文本、代码、diff —— 而不是装饰。不像 Airtable 那样每隔两屏丢一张 signature card 来制造品牌节奏，Codex 的品牌电压来自 **单一品牌色 `#339cff`** 在一片近黑灰度上的稀有出现：它只在用户可点按的强调位（发送按钮悬浮态、被选中的 tab 底线、可点击的链接、focus ring）出现，从不当背景墙纸。整套体系里你能在任何位置看到这一抹蓝，但永远只在"这里需要你做决定"的位置。

**Surface 的语言是 `color-mix(in oklab)`**，不是 `rgba`。每一次浮层、按钮 hover、状态条都不是用一个固定 alpha 的颜色刷上去的，而是用 `color-mix(in oklab, <base> <pct>%, transparent)` 在 OKLab 颜色空间里做感知均匀的混合。这带来的视觉差异是：在深色底上 8% 的白叠加不会看起来像"灰雾"，而是像"灯光"—— 这正是 Mac 原生玻璃面板的感觉。所有的按钮 hover、行 hover、elevated surface 都遵循这条规则，**禁止使用 `rgba()`**。

**圆角是分阶的，而且整体放大了 1.25 倍**。Codex 的 `--corner-radius-scale: 1.25` 是一条全局乘数：基础 Tailwind 的 `1rem`（16px）`2xl` 在 Codex 里实际是 `20px`，而 `3xl` 是 `25px`。这条 scale 决定了 Codex 比"标准 Tailwind 应用"更圆润、更软，但又没到 iOS 那种过度圆润的程度。它形成了 **三级圆角节奏**：

- **3xl (25px)** — Composer 输入区容器（最大表面，最圆）
- **2xl (20px)** — 标准浮层：dropdown、popover、dialog、surface card
- **lg (12.5px)** — 列表行、dropdown item、按钮（最小表面，最紧）

**这套 1.25× 圆角是 ClawX 当前最大的结构性病根之一**：Composer 容器被某次改动改成了 `25px`，但下拉菜单被另一套代码改成了 `15px`（`xl`）甚至 `12px`（手写值），所以浮层"陷进"Composer 里看起来错位。详见 [10-current-audit.md](./10-current-audit.md)。

**字体是系统栈，base 是 14px 而不是 16px**。Codex 用的是 `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` —— 平台原生字体栈，让 Mac 用户看到 SF、Windows 用户看到 Segoe UI，从不打包 web font。base 字号是 `14px`（`--text-base`），不是常规的 `16px`，这是 **开发者工具密度** 的决定：14px 让一屏能塞下更多代码、更多 diff、更多 turn。次级字号是 `12px`（`--text-sm`），用于 dropdown item、toolbar、caption；最小是 `11px`（`--text-xs`），仅用于 chip / badge / 元信息。Mono 字体栈是 `ui-monospace, SFMono-Regular, ...`，所有 code、terminal、diff 行内联都用它。

**主题切换是 token-only 的**。Codex 在 `:root` 上声明 `color-scheme`，然后在 `.electron-dark` / `.electron-light` 选择器下重新定义同一组 `--color-*` 语义 token。**组件 CSS 里禁止出现 `dark:bg-*` 这种双声明** —— 任何组件只引用语义 token，暗色逻辑全部走 `:root` 切换。这是 ClawX 当前第二个大问题：大量 `dark:` 前缀的双声明散落在组件层，导致主题切换时颜色"半残"。

**Type voice 是低调的**。Display 字号最大到 `48px`，但 weight 永远不超过 `500`（medium）；正文 14px 永远是 `400`（normal）；按钮和 tab label 才上 `500`。强调来自字号和颜色对比，**从不来自加粗**。这是 Codex 与"标准 SaaS 营销页"最大的分野 —— 它不靠 weight 抢眼球，它靠结构、留白、和那一抹蓝。

**Key Characteristics:**
- 主 canvas 是 `{colors.gray-900}`（#181818），不是纯黑。Editor/code 区是 `{colors.gray-800}`（#212121）。Under-canvas 才是纯黑 `#000`。这条三层灰阶决定了"画布—工作区—背景"的层级感。
- Elevated surface 是 `{colors.gray-800}` 的 `color-mix(in oklab, gray-800 96%, transparent)` ≈ `#212121f5` —— **半透明 + 8px backdrop-blur**，让 dropdown 浮在 canvas 上时透出底色，这是 Mac 原生面板质感。
- 按钮只有 **三种变体 + 一种 icon**：primary（深色填充）/ secondary（淡灰填充）/ tertiary（透明 hover 出灰）/ icon（32×32 方形）。**没有第四种**，所有按钮必须落到这四种之一。
- Dropdown 只有一种 recipe：`bg-token-dropdown-background` + `rounded-2xl`(20px) + `shadow-xl-spread` + `backdrop-blur-sm`(8px) + `4px padding`。**所有菜单共用一份 CSS**（`web/src/codex-dropdown.css`），按宽度区分用途（188px / 200px / 280px / min(260px, sidebar-16)）。
- Composer 容器圆角 `25px`（3xl）；Composer 内部按钮 `28px` 直径 + `10px` 圆角；Composer 内部按钮之间 `4px` gap。这套数字是 **硬编码常量**，不要在组件里自由发挥。
- 阴影只有 6 阶 + 1 个 hairline（`0 0 0 0.5px border`）。所有 dropdown 用 `xl-spread`（hairline + xl 复合），所有 surface card 用 `md`，所有 hover lift 用 `lg`。**禁止自定义 shadow**。
- 动画默认 `0.15s` / `cubic-bezier(0.4, 0, 0.2, 1)`，进入动画用 `ease-enter`（`cubic-bezier(0.19, 1, 0.22, 1)` —— 强减速）。所有动画必须带 `@media (prefers-reduced-motion: reduce)` 旁路。
- 图标统一 Lucide 24×24 stroke（`codex-icons/*.svg`，189 个），`stroke-width: 2`，`h-4 w-4`（16px）用于 menu item / toolbar，`h-5 w-5`（20px）用于 nav rail。**禁止混用其他图标集**。

## How this maps to ClawX

ClawX 当前的样式体系是"porto + 自由发挥"的混合产物：早期为了快速对齐 Codex，从 `FakeCoding-main` 拷贝了大量 ported CSS（`codex-sidebar.css` / `codex-composer-menu.css` / `codex-settings-controls.css`），但每拷贝一份都引入了 **独立的 token 前缀**（`--sp-*` / `--ccm-*` / `--cdx-*` / `--material-*` / `--surface-*` / `--cwh-*` 共 13+ 套），加上后来为不同 dropdown 各自手写的样式（5 套 dropdown 各自为政、5 套 button 系统不匹配），形成了 **结构性错乱**：

1. **同一个语义被 5 个 token 表达**：`--sp-menu-bg` / `--ccm-surface` / `--cdx-dropdown-bg` / `--material-elevated` / `--surface-modal` 实际都是 `color-mix(in oklab, gray-800 96%, transparent)`，但散落在 5 个文件里，改一处改不动其他四处。
2. **z-index 完全无规范**：12 个不同 z-index 散落在组件里（`z-10` / `z-20` / `z-30` / `z-40` / `z-50` / `z-100` / `z-200` / `z-999` / `z-1000` / `z-9999` ...），dropdown 弹层和 modal 抢同一层级时谁赢看运气。
3. **圆角体系脱节**：Composer 容器是 `25px`（对的，符合 3xl），但 dropdown 被改成 `15px`（应为 20px）甚至 `12px`（手写），list-row 被改成 `8px`（应为 12.5px），导致浮层"陷进"容器、行高节奏断裂。
4. **dark: 双声明**：大量组件层使用 `bg-white dark:bg-gray-900` 这种 Tailwind 双前缀，没有走 token 切换，主题切换时颜色"半残"。

**迁移策略不是推倒重来**，而是先建立 **统一 token 层 + z-index 阶 + 单一下拉基类 + 单一按钮变体**，再把现有 ported CSS 逐步重定向到统一层。详见 [11-migration-roadmap.md](./11-migration-roadmap.md) 的 5 阶段路线图。

## File map

| 文档 | 角色 | 何时阅读 |
|---|---|---|
| [01-design-philosophy.md](./01-design-philosophy.md) | Codex 设计哲学 20 条 | 决策前先读，避免战术争论 |
| [02-tokens.md](./02-tokens.md) | 全量 token 参考（按分组） | 实施时查表 |
| [03-colors.md](./03-colors.md) | 颜色系统（palette + semantic + dark/light） | 上色时查表 |
| [04-typography.md](./04-typography.md) | 字体系统（family / size / weight / line-height） | 排版时查表 |
| [05-spacing-shapes-elevation.md](./05-spacing-shapes-elevation.md) | 间距 + 圆角 + 阴影 + 模糊 | 布局与卡片时查表 |
| [06-motion.md](./06-motion.md) | 动画与过渡 + reduced-motion | 动效时查表 |
| [07-components.md](./07-components.md) | 组件规范（dropdown / button / card / list 等） | 实施组件时查表 |
| [08-composer-subsystem.md](./08-composer-subsystem.md) | Composer 输入区子系统深入 | 改 Composer 时必读 |
| [09-theme-and-dark-mode.md](./09-theme-and-dark-mode.md) | 主题切换策略与暗色模式 | 涉及主题时必读 |
| [10-current-audit.md](./10-current-audit.md) | ClawX 当前样式现状诊断（P0/P1/P2 问题清单） | 决定迁移优先级时读 |
| [11-migration-roadmap.md](./11-migration-roadmap.md) | 迁移路线图（分阶段 + 验收清单） | 落地执行时读 |
| [12-motion-depth.md](./12-motion-depth.md) | **动效深度规范**（stagger 引擎 / 三轨编排 / 不对称矩阵 / 退让策略 / 性能预算） | 复杂动效编排、流式渲染、性能优化时必读 |
| [13-interaction-state-machine.md](./13-interaction-state-machine.md) | **交互状态机**（Button / Dropdown / List / Composer / Disabled / Loading 状态机 + ARIA + 键盘导航） | 设计/实现组件交互时必读 |
| [14-production-implementation-guide.md](./14-production-implementation-guide.md) | **生产实现指南**（工程清单 / 质量门 / 测试策略 / 性能预算 / a11y 验收 / 代码评审 / 风险管理） | 工程落地、PR 评审、发布前必读 |
| [15-conversation-rendering.md](./15-conversation-rendering.md) | **对话渲染系统**（Markdown / 代码块 / diff / 流式渲染 / shimmer） | 改对话/消息渲染时必读 |
| [16-layout-architecture.md](./16-layout-architecture.md) | **布局架构**（容器查询 / 侧边栏 / 响应式策略 / 三层 shell） | 涉及布局/响应式时必读 |
| [17-settings-forms-overlays.md](./17-settings-forms-overlays.md) | **设置与表单**（Settings 页 / 表单控件 / 浮层 / 模态框） | 改设置/表单时必读 |
| [18-states-icons-a11y.md](./18-states-icons-a11y.md) | **状态/图标/无障碍**（加载/空/错误状态 / Lucide 图标 / ARIA / reduced-motion） | 涉及状态/图标/a11y 时必读 |
| [19-command-palette-system.md](./19-command-palette-system.md) | **命令面板系统**（cmdk / Hotkey Window / Quick Chat / 窗口缩放适配） | 改命令面板/快捷键时必读 |
| [20-onboarding-first-run-experience.md](./20-onboarding-first-run-experience.md) | **引导与首次运行**（ bouncing arrow / Codex↔ChatGPT 过渡 / hljs 代码高亮 / 侧边栏滚动渐隐） | 改引导/首次运行时必读 |
| [21-avatars-identity-system.md](./21-avatars-identity-system.md) | **头像与身份系统**（玻璃胶囊材质 / 活动栈 mask 渐隐 / Profile 加载扫光 / 编辑徽章） | 改头像/身份/Profile 时必读 |
| [22-data-visualization-progress.md](./22-data-visualization-progress.md) | **数据可视化与进度**（Recharts 主题 / 进度环 SVG 动画 / Tooltip / Legend / 滚动容器） | 改图表/进度时必读 |
| [23-plugins-extensions-grid.md](./23-plugins-extensions-grid.md) | **插件/扩展网格/PDF 预览**（容器查询网格 / PDF.js 文本层 / Box 布局原语） | 改插件页/PDF 时必读 |
| [24-voice-dictation-presentation.md](./24-voice-dictation-presentation.md) | **语音听写与演示面板**（录音浮球玻璃材质 / 听写暗色主题覆盖 / Popcorn 三态响应式） | 改语音/演示时必读 |
| [25-collaboration-chips-modals.md](./25-collaboration-chips-modals.md) | **协作/芯片/限流/邀请模态**（芯片入场动画 / 点阵呼吸场 / Blurple 扫光 / 三段式主题 token） | 改协作/限流/模态时必读 |
| [26-worktree-review-mermaid.md](./26-worktree-review-mermaid.md) | **工作树/审查/Mermaid/终端**（进度条形变 / ANSI 16 色板 / Mermaid 容器查询宽块 / Markdown 排版 / Carlito 字体 / Radix 浮层） | 改代码工作流/Mermaid/终端时必读 |

## Source of truth

| 来源 | 角色 | 可信度 |
|---|---|---|
| `FakeCoding-main/CODEX-UI-RESOURCE-MAP.md` | UI 区域 → 真实资源映射 | 100%（CDP + ASAR 双源） |
| `FakeCoding-main/codex-reference/tokens.css` | 1137 个 token 全量 | 100%（PostCSS 原始输出） |
| `FakeCoding-main/codex-reference/css/*.css` | 45 个组件 CSS | 100%（MSIX 提取） |
| `FakeCoding-main/codex-conversation-render/css-all/prettified/` | 美化版 CSS | 100%（prettifier 输出） |
| `FakeCoding-main/codex-pure-source/runtime-dom/` | 运行时 DOM 快照 | 100%（CDP 抓取） |
| `FakeCoding-main/codex-design-system.css` | 综合可读版（带注释） | 高（人为整理，与 tokens.css 一致） |
| `FakeCoding-main/codex-reference/ALIGNMENT.md` | 1:1 对齐工作流 | 高（实测值） |
| `FakeCoding-main/codex-reference/DROPDOWN.md` | Dropdown 实测值 | 100%（CDP 抓取） |

> ClawX 现状诊断（[10-current-audit.md](./10-current-audit.md)）的证据来自对 `c:\Users\27933\Desktop\clawx\ClawX-ui-polish` 仓库的只读检查，文件路径 + 行号已标注。

## Versioning & maintenance

- 本规范是 **活文档**，每次组件改造后应同步更新对应章节
- 每次更新时同步检查 [10-current-audit.md](./10-current-audit.md) 中的问题清单是否已解决
- 新增 token 时必须同步登记到 [02-tokens.md](./02-tokens.md)
- 重大改动（涉及 token 体系或主题策略）需要 review，避免破坏迁移一致性
- 版本号变更遵循：token/主题/组件 recipe 结构变化 → minor；新增/澄清条目 → patch
