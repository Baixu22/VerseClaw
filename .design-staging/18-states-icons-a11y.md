---
doc: 18-states-icons-a11y
name: Loading, Empty, Error States, Icon System & Accessibility
category: Foundations
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/css/shimmer-lines-yjvWUHPT.css
  - codex-reference/css/profile-CQjDNzte.css
  - codex-reference/css/thinking-shimmer-C-5BnEUj.css
  - codex-reference/css/progression-donut-DkjcVlU6.css
  - codex-reference/css/scroll-to-bottom-buton-CQcpasM2.pretty.css
  - codex-reference/css/at-mention-list-BAjTVsT9.css
  - codex-reference/css/cmdk-uRuhKLE-.css
  - codex-reference/css/composer-approval-request-card-IKpIrw8U.css
  - codex-reference/css/themeseg.tmp.txt
  - codex-icons/ (189 SVG icons)
  - codex-pure-source/runtime-dom/stylesheets-rules.json
  - codex-design-system.css
---

# 18 — Loading, Empty, Error States, Icon System & Accessibility

> 状态系统（加载/空/错误）、图标系统、无障碍模式是 Codex 企业级落地的"隐形基础设施"。本文规定了所有状态视觉规范、Lucide 图标约定、ARIA 模式、焦点管理和 reduced-motion 策略。

---

## 目录

1. [加载状态](#1-加载状态)
2. [空状态](#2-空状态)
3. [错误状态](#3-错误状态)
4. [图标系统](#4-图标系统)
5. [无障碍模式](#5-无障碍模式)
6. [Reduced Motion 策略](#6-reduced-motion-策略)
7. [选区与高亮](#7-选区与高亮)

---

## 1. 加载状态

### 1.1 Skeleton Shimmer — 块/列表加载

```css
._loadingResultsShimmer_h3w7l_1 {
  --loading-results-shimmer-base:
    color-mix(in srgb, var(--color-token-description-foreground) 10%, transparent);
  --loading-results-shimmer-highlight:
    color-mix(in srgb, var(--color-token-description-foreground) 16%, transparent);
  background-color: var(--loading-results-shimmer-base);
  overflow: hidden;
  position: relative;
}
._loadingResultsShimmer_h3w7l_1::before {
  content: "";
  pointer-events: none;
  background: linear-gradient(90deg,
    transparent 0%,
    var(--loading-results-shimmer-highlight) 50%,
    transparent 100%);
  animation: 3s linear infinite _loadingResultsShimmer_h3w7l_1;
  animation-delay: var(--loading-results-shimmer-delay, 0s);
  position: absolute;
  inset: 0;
  transform: translate(-100%);
  will-change: transform;
}
@keyframes _loadingResultsShimmer_h3w7l_1 {
  0% { transform: translate(-100%); }
  to { transform: translate(100%); }
}
```

| 属性 | 值 |
|------|-----|
| 基础色 | `description-foreground` @ 10% |
| 高光色 | `description-foreground` @ 16% |
| 扫光时长 | 3s linear infinite |
| 扫光方向 | X 轴 -100% → 100% |
| 延迟 | `var(--loading-results-shimmer-delay, 0s)` |

### 1.2 Profile 页面 Skeleton — 全块扫光

```css
._profileLoadingBlock_17kdy_1 {
  --profile-loading-shimmer-highlight: #ffffffbf;     /* light: 白色 75% */
  background-color: color-mix(in srgb,
    var(--color-token-description-foreground) 7%,
    var(--color-token-main-surface-primary));
  background-image: linear-gradient(90deg,
    transparent 34%,
    var(--profile-loading-shimmer-highlight) 50%,
    transparent 66%);
  background-position: -100vw 0;
  background-size: 100vw 100vh;
  background-attachment: fixed;
  animation: 2.6s steps(48, end) infinite _profile-loading-page-sweep_17kdy_1;
}
/* Dark 覆写 */
.dark ._profileLoadingBlock_17kdy_1,
.electron-dark ._profileLoadingBlock_17kdy_1 {
  --profile-loading-shimmer-highlight:
    color-mix(in srgb, var(--color-token-description-foreground) 13%,
      var(--color-token-main-surface-primary));
}
@keyframes _profile-loading-page-sweep_17kdy_1 {
  to { background-position: 100vw 0; }
}
```

| 属性 | 值 |
|------|-----|
| 基础色 | `description-foreground` @ 7% 混 `main-surface-primary` |
| 高光色（light） | `#ffffffbf`（白 75%） |
| 高光色（dark） | `description-foreground` @ 13% 混 `main-surface-primary` |
| 扫光时长 | 2.6s `steps(48, end)` infinite |
| 扫光位置 | X: -100vw → 100vw |
| 背景尺寸 | `100vw 100vh` + `fixed` |

### 1.3 节奏式文本 Shimmer — "思考中"

> 详见 [15-conversation-rendering.md](./15-conversation-rendering.md) §4.3。节奏式 shimmer 每 4 秒扫一次，不是连续 shimmer。

**关键时序**：
- 单次扫光：1s `steps(48, end)`
- 周期：4000ms（`setInterval`）
- 首次延迟：600ms
- 扫光位移：sweep `translate(-50% → 125%)`，highlight `translate(50% → -125%)`

### 1.4 Spinner（加载图标）

**SVG**（`codex-icons/loader.svg`）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2v4"/>
  <path d="m16.2 7.8 2.9-2.9"/>
  <path d="M18 12h4"/>
  <path d="m16.2 16.2 2.9 2.9"/>
  <path d="M12 18v4"/>
  <path d="m4.9 19.1 2.9-2.9"/>
  <path d="M2 12h4"/>
  <path d="m4.9 4.9 2.9 2.9"/>
</svg>
```

8 条径向辐条，旋转动画：

```css
@keyframes spin { 100% { transform: rotate(360deg); } }
```

### 1.5 圆形进度（Donut）

```css
._fillOnMount_1crzc_1 {
  animation: _progression-donut-fill_1crzc_1
    var(--transition-duration-relaxed) ease-out backwards;
}
@keyframes _progression-donut-fill_1crzc_1 {
  0% { stroke-dashoffset: 100px; }
}
```

- 使用 SVG `stroke-dashoffset` 从 100px 动画到 0
- 时长：`var(--transition-duration-relaxed)` = 0.3s
- 缓动：ease-out
- fill-mode：backwards

### 1.6 工作点波浪（Working Dots）

> 详见 [15-conversation-rendering.md](./15-conversation-rendering.md) §8.6。

三个点，staggered 波浪：

```css
@keyframes _working-dot-wave_99dwr_1 {
  0%, 10%, to { transform: translateY(0); }
  25%         { transform: translateY(1.2px); }
  55%         { transform: translateY(-2px); }
  70%         { transform: translateY(0); }
}
@media (prefers-reduced-motion: no-preference) {
  ._waveDot_99dwr_43 {
    animation: _working-dot-wave_99dwr_1 1s ease-in-out infinite;
  }
  ._waveDot_99dwr_43:nth-child(2) { animation-delay: 0.1s; }
  ._waveDot_99dwr_43:nth-child(3) { animation-delay: 0.2s; }
}
```

**注意**：这是 **opt-in** 策略 — 只在 `prefers-reduced-motion: no-preference` 下启用。

### 1.7 脉冲点（Pulsing Dot）

```css
._pulsingDot_108am_3 {
  background-color: currentcolor;
  border-radius: 50%;
  width: 0.75rem;     /* 12px */
  height: 0.75rem;
  display: inline-block;
}
._pulseSize_108am_1, ._pulsingDot_108am_3 {
  animation: 1.25s ease-in-out infinite _pulsing-dot-pulse-size_108am_1;
}
@keyframes _pulsing-dot-pulse-size_108am_1 {
  0%, 100% { transform: scale(1); }
  50%       { transform: scale(1.25); }
}
```

### 1.8 装饰点阵（Decorative Dots Field）

```css
._dots_1888p_1 {
  opacity: 0.38;
  animation: 1.75s ease-in-out infinite _dot-field-opacity_1888p_1;
  mask-image: linear-gradient(to left top,
    rgba(0,0,0,0) 0%,
    rgb(0,0,0) 30%,
    rgb(0,0,0) 70%,
    rgba(0,0,0,0) 100%);
}
```

### 1.9 加载状态总表

| 组件 | 时长 | 缓动 | 迭代 | 策略 |
|------|------|------|------|------|
| 块 skeleton | 3s | linear | infinite | disable on reduce |
| Profile skeleton | 2.6s | `steps(48,end)` | infinite | disable on reduce |
| 节奏 shimmer | 1s | `steps(48,end)` | 1（每 4s 重复） | disable on reduce |
| 写作块 shimmer | 2s | linear | infinite | disable on reduce |
| Spinner | — | — | infinite | — |
| 圆形进度 | 0.3s | ease-out | 1 (backwards) | disable on reduce |
| 工作点波浪 | 1s | ease-in-out | infinite | opt-in (no-preference) |
| 脉冲点 | 1.25s | ease-in-out | infinite | disable on reduce |
| 装饰点阵 | 1.75s | ease-in-out | infinite | disable on reduce |

---

## 2. 空状态

### 2.1 命令面板空状态（cmdk）

```css
[cmdk-empty], [data-cmdk-empty] {
  padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2.5);
  min-height: calc(var(--spacing) * 8);     /* 32px */
  color: var(--color-token-description-foreground);
  white-space: pre-wrap;
  text-align: center;
  align-items: center;
  line-height: 1.4;
  display: flex;
}
/* 空状态项 — 明确非交互 */
[cmdk-item][data-command-menu-empty-state="true"],
[cmdk-item][data-command-menu-empty-state="true"]:hover,
[cmdk-item][data-command-menu-empty-state="true"]:focus-visible,
[cmdk-item][data-command-menu-empty-state="true"]:active {
  cursor: default;
  opacity: 1;
  background-color: transparent;     /* 无悬停背景 */
}
```

**空状态规则**：
- 颜色：`--color-token-description-foreground`（描述色，比前景色弱）
- 对齐：居中（`text-align: center` + `align-items: center`）
- `white-space: pre-wrap`（保留换行）
- 行高：1.4
- min-height：32px
- **非交互**：`cursor: default`，`opacity: 1`，透明背景，无 hover/focus/active 状态

### 2.2 命令面板加载状态

```css
[cmdk-item][data-command-menu-loading="true"],
[cmdk-item][data-command-menu-loading="true"]:hover {
  cursor: default;
  opacity: 0.6;
  background-color: transparent;
}
```

加载项：`opacity: 0.6`，非交互。

### 2.3 禁用/不可用项

```css
[cmdk-item][aria-disabled="true"],
[cmdk-item][data-disabled="true"] {
  cursor: default;
  opacity: 0.25;    /* 比加载态更弱 */
}
```

### 2.4 Agent Identicon 空格/填充扫描

```css
._emptyScanCell_1mxht_1 {
  opacity: 0;
  animation: 1s step-end infinite _agentIdenticonEmptyScan_1mxht_1;
}
._filledScanCell_1mxht_11 {
  animation: 1s step-end infinite _agentIdenticonFilledScan_1mxht_11;
}
@keyframes _agentIdenticonEmptyScan_1mxht_1 {
  0%, 20%        { opacity: 1; }
  20.001%, to    { opacity: 0; }
}
@keyframes _agentIdenticonFilledScan_1mxht_11 {
  0%, 20%        { opacity: 0; }
  20.001%, to    { opacity: 1; }
}
```

交替闪烁的扫描动画，模拟"扫描中"效果。

---

## 3. 错误状态

### 3.1 错误 Token 定义

**Dark 主题**（`.electron-dark`）：

| Token | 解析 | Hex |
|-------|------|-----|
| `--color-background-status-error` | `var(--red-900)` | `#4d100e` |
| `--color-background-danger-active` | `color-mix(in oklab, var(--red-400) 36%, transparent)` | — |
| `--color-text-error` | `var(--red-300)` | `#ff6764` |
| `--color-icon-error` | `var(--red-300)` | `#ff6764` |
| `--color-border-error` | `color-mix(in oklab, var(--red-400) 40%, transparent)` | — |

**Light 主题**（`.electron-light`）：

| Token | 解析 | Hex |
|-------|------|-----|
| `--color-background-status-error` | `var(--red-50)` | `#ffd9d9` |
| `--color-background-danger-active` | `color-mix(in oklab, var(--red-500) 90%, transparent)` | — |
| `--color-text-error` | `var(--red-500)` | `#e02e2a` |
| `--color-icon-error` | `var(--red-500)` | `#e02e2a` |
| `--color-border-error` | `color-mix(in oklab, var(--red-500) 15%, transparent)` | — |

### 3.2 基础红色调色板

```css
--red-50:  #ffd9d9;
--red-300: #ff6764;
--red-400: #fa423e;
--red-500: #e02e2a;
--red-600: #ba2623;
--red-900: #4d100e;
```

### 3.3 VS Code 错误桥接

```css
--vscode-inputValidation-errorBackground:  var(--color-background-status-error);
--vscode-inputValidation-errorBorder:      var(--color-border-error);
--vscode-editorError-foreground:           var(--color-text-error);
--vscode-list-invalidItemForeground:       var(--color-text-error);
--vscode-list-errorForeground:            var(--color-text-error);
--vscode-statusBarItem-errorBackground:    var(--color-background-status-error);
--vscode-statusBarItem-errorForeground:   var(--color-text-error);
--vscode-debugExceptionWidget-border:     var(--color-border-error);
--vscode-debugExceptionWidget-background:  var(--color-background-status-error);
```

### 3.4 Magic-Edit 删除线错误色

```css
[data-me-role="orig"] [data-me-change="delta"] {
  color: var(--oai-wb-text-tertiary);
  text-decoration: line-through 1px rgba(239, 68, 68, 0.8);
}
.dark [data-me-role="orig"] [data-me-change="delta"] {
  text-decoration-color: rgba(248, 113, 113, 0.8);
}
```

### 3.5 错误应用规则

| 场景 | 背景 | 边框 | 文字 |
|------|------|------|------|
| 表单输入错误 | `--color-background-status-error` | `--color-border-error` | `--color-text-error` |
| 列表无效项 | — | — | `--color-text-error` |
| 编辑器错误标记 | — | — | `--color-text-error` |
| 状态栏错误 | `--color-background-status-error` | — | `--color-text-error` |
| 调试异常 | `--color-background-status-error` | `--color-border-error` | — |

**关键**：错误边框用 `color-mix(in oklab, ...)` 透明叠加，不用固定 hex。

---

## 4. 图标系统

### 4.1 通用 SVG 约定

**每个 `codex-icons/` 中的 SVG 都遵循此属性集**：

```svg
<svg xmlns="http://www.w3.org/2000/svg"
     width="24" height="24"
     viewBox="0 0 24 24"
     fill="none"
     stroke="currentColor"
     stroke-width="2"
     stroke-linecap="round"
     stroke-linejoin="round">
  <!-- paths -->
</svg>
```

| 属性 | 值 | 说明 |
|------|-----|------|
| viewBox | `0 0 24 24` | 24×24 网格 |
| fill | `none` | 描边图标，非填充 |
| stroke | `currentColor` | 颜色继承自父级 `color` token |
| stroke-width | `2` | 统一描边宽度 |
| stroke-linecap | `round` | 圆头线帽 |
| stroke-linejoin | `round` | 圆角连接 |

### 4.2 渲染尺寸（由容器 CSS 控制）

| 上下文 | 尺寸 | 来源 |
|--------|------|------|
| 菜单项 / 工具栏 | `h-4 w-4` = 16px | 全局约定 |
| 导航栏 | `h-5 w-5` = 20px | 全局约定 |
| 模型选择器切换图标 | 12px | `._ViewToggleIcon_15yqt_163` |
| 快速模式图标 | 16px | `._FastModeIcon_15yqt_789` |
| 内联快速图标 | 14px | `._ModelPickerTriggerInlineFastIcon_1w4ob_157` |
| 代码块复制按钮 | `icon-xs` | `iconClassName="icon-xs"` |

### 4.3 验证图标结构

| 图标 | 文件 | 路径 |
|------|------|------|
| `check` | `codex-icons/check.svg` | `M20 6 9 17l-5-5` |
| `x` | `codex-icons/x.svg` | `M18 6 6 18` + `m6 6 12 12` |
| `info` | `codex-icons/info.svg` | 圆 `cx=12 cy=12 r=10` + `M12 16v-4` + `M12 8h.01` |
| `circle-check` | `codex-icons/circle-check.svg` | 圆 `r=10` + `m9 12 2 2 4-4` |
| `chevron-down` | `codex-icons/chevron-down.svg` | `m6 9 6 6 6-6` |
| `ellipsis` | `codex-icons/ellipsis.svg` | 3 圆 `r=1` at (12,12),(19,12),(5,12) |
| `ellipsis-vertical` | `codex-icons/ellipsis-vertical.svg` | 3 圆 `r=1` at (12,12),(12,5),(12,19) |
| `loader` | `codex-icons/loader.svg` | 8 条径向辐条 |

### 4.4 图标使用规则

**Do**：
- 用 Lucide 24×24 stroke 图标，`stroke-width: 2`
- 颜色用 `currentColor`，由父级 `color` token 控制
- 渲染尺寸用 CSS `width`/`height`（12/14/16/20px）
- linecap 和 linejoin 统一 `round`

**Don't**：
- 不要混用其他图标集（Material Icons / Heroicons / Feather）
- 不要用 `fill` 图标 — Codex 全部是 stroke-based
- 不要在 SVG 里硬编码颜色 — 用 `currentColor`
- 不要改 `stroke-width` — 统一 `2`

---

## 5. 无障碍模式

### 5.1 视觉隐藏 / 屏幕阅读器专用

```css
._KeyboardControl_15yqt_333,
._KeyboardAnnouncement_15yqt_335 {
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  border: 0 !important;
  width: 1px !important;
  height: 1px !important;
  margin: -1px !important;
  padding: 0 !important;
  position: absolute !important;
}
._KeyboardControl_15yqt_333 {
  min-height: 1px !important;
}
```

**视觉隐藏规则**：
- `clip-path: inset(50%)` + 1px 尺寸 + 绝对定位
- `white-space: nowrap`（防止换行影响布局）
- `pointer-events: none`（不拦截交互）

### 5.2 ARIA 属性使用

| 属性 | 用途 | CSS 选择器示例 |
|------|------|---------------|
| `aria-disabled` | 禁用项 | `[cmdk-item][aria-disabled="true"] { opacity: .25 }` |
| `aria-selected` | 选中项 | `[cmdk-item][aria-selected="true"] { background: hover-bg }` |
| `aria-expanded` | 展开/折叠 | `[aria-expanded="true"] { outline: 2px solid ring-color }` |
| `aria-current` | 当前页/项 | `[aria-current="true"]` marker 样式 |
| `data-disabled` | 禁用（data 等价） | `[data-disabled="true"]` |
| `data-selected` | 选中（data 等价） | `[data-selected="true"]` |
| `data-state` | 开/关状态 | `[data-state="open"]` / `[data-state="entering"]` |

### 5.3 Focus-Visible 模式

```css
/* 命令面板 */
[cmdk-dialog]:focus-visible { outline: none; }
[cmdk-item]:focus-visible {
  background-color: var(--color-token-list-hover-background);
  opacity: 1;
}
[cmdk-list]:focus-visible { outline: none; }
[cmdk-input]:focus-visible { outline: none; }

/* 项目清除按钮 — 聚焦时显示父图标 */
._projectClearButton_uoylu_2:focus-visible [data-project-selector-icon] {
  opacity: 1;
}

/* 数字输入 — 聚焦时移除阴影 */
._numericInput_491xx_1:focus-visible {
  box-shadow: none;
  outline: none;
}
```

### 5.4 Composer 导航焦点环

```css
:is([data-composer-navigation-highlight],
    [data-composer-navigation-selected][aria-expanded="true"]) {
  outline: 2px solid var(--composer-navigation-ring-color);
  outline-offset: 2px;
  box-shadow:
    0 0 0 1px var(--composer-navigation-edge-color),
    0 0 var(--composer-navigation-glow-radius) var(--composer-navigation-glow-color);
}
```

**选中展开态颜色**：
```css
--composer-navigation-ring-color:  #00ff4c;
--composer-navigation-edge-color:  #00b335;
--composer-navigation-glow-color:  #00ff4c8c;
--composer-navigation-glow-radius: 16px;
```

**焦点环规范**：
- `outline: 2px solid` + `outline-offset: 2px`
- 可选发光：`box-shadow` 带 glow 颜色和半径

### 5.5 焦点环 Token

| 场景 | Token |
|------|-------|
| 通用焦点 | `--color-token-focus-border` = `--color-border-focus` = `var(--blue-300)` = `#339cff` |
| Composer 导航 | `--composer-navigation-ring-color`（绿色系） |
| 输入验证信息 | `--color-border-focus` |

### 5.6 键盘导航

- cmdk 列表使用 **roving tabindex**
- 箭头键在列表项间移动
- `Enter` 选择
- `Escape` 关闭
- 滚到底部按钮 `tabIndex`：可见时 `undefined`，隐藏时 `-1`

---

## 6. Reduced Motion 策略

Codex 同时使用 **禁用策略**（`reduce`）和 **opt-in 策略**（`no-preference`）。

### 6.1 禁用策略

`@media (prefers-reduced-motion: reduce)` 下设置：
```css
animation: auto ease 0s 1 normal none running none;
```

**所有被禁用的动画**：

| 组件 | 文件 | 禁用内容 |
|------|------|----------|
| 启动加载器 | stylesheets-rules.json:19 | `.startup-loader__logo` / `.startup-loader__overlay` |
| 空/填充扫描格 | at-mention-list.css | `._emptyScanCell_` / `._filledScanCell_` |
| 圆形进度 | progression-donut.css | `._fillOnMount_1crzc_1` |
| 加载 shimmer | stylesheets-rules.json:336 | `._loadingResultsShimmer_h3w7l_1::before` |
| 节奏 shimmer | thinking-shimmer.css | sweep + highlight |
| Profile 加载 | profile.css | `._profileLoadingBlock_17kdy_1`（同时 `background-image: none`） |
| 装饰点阵 | stylesheets-rules.json:528 | `._dots_1888p_1` |
| Chip 入场 | stylesheets-rules.json:531 | `._chip_lj1sl_1[data-animate-entrance]` |
| 脉冲点 | stylesheets-rules.json:996 | `._pulseSize_108am_1` / `._pulsingDot_108am_3` |
| Composer 导航蛇 | stylesheets-rules.json:1011 | `::after { display: none }` |
| Diff 统计 | stylesheets-rules.json:849 | `transition: none` |
| 标记 | stylesheets-rules.json:1030 | `transition-duration: 0s` |

### 6.2 Data 属性 Reduced-Motion Opt-Out

```css
._Menu_15yqt_1[data-reduced-motion="true"] {
  transition: none;
}
._Menu_15yqt_1[data-reduced-motion="true"] ._ViewTrack_15yqt_7,
._Menu_15yqt_1[data-reduced-motion="true"] ._ViewToggle_15yqt_19 {
  transition: none;
}
._ModelPickerTriggerContent_1w4ob_1._ReducedMotion_1w4ob_15 {
  transition: none;
}
._ModelPickerDropdownContent_1w4ob_203._ReducedMotion_1w4ob_15 {
  animation: none;
}
._UltraUsageWarningText_15yqt_65 {
  animation: none;
}
```

### 6.3 Opt-In 策略

工作点波浪只在 `prefers-reduced-motion: no-preference` 下启用：

```css
@media (prefers-reduced-motion: no-preference) {
  ._waveDot_99dwr_43 {
    animation: _working-dot-wave_99dwr_1 1s ease-in-out infinite;
  }
}
```

### 6.4 Reduced Motion 实现规则

**规则**：
1. 每个无限循环动画 **必须** 有 `@media (prefers-reduced-motion: reduce)` 禁用
2. Shimmer 类动画禁用时 **同时** 禁用 `animation` 和 `background-image`（否则残留静态渐变）
3. 工作点波浪等"装饰性微动"用 **opt-in**（`no-preference`）而非 opt-out
4. 过渡（`transition`）在 reduce 下设为 `none` 或 `duration: 0s`
5. 组件可暴露 `data-reduced-motion="true"` 属性，让 JS 也能控制

---

## 7. 选区与高亮

### 7.1 编辑器选区

```css
[data-pierre-editor-annotation]::selection {
  background-color: var(--color-token-editor-selection-background, Highlight);
}
[data-pierre-editor-annotation] ::selection {
  background-color: var(--color-token-editor-selection-background, Highlight);
}
```

### 7.2 ProseMirror 选区

```css
.ProseMirror .placeholder::selection {
  color: inherit;
  background: transparent;
}
.ProseMirror-hideselection ::selection { background: transparent; }
.ProseMirror-hideselection { caret-color: transparent; }
```

### 7.3 链接选区

```css
[text-link-href]::selection {
  color: highlighttext;
}
```

### 7.4 Magic-Edit 选区高亮

```css
._editor_11vxc_8 .ProseMirror .magic-edit-selection {
  background-color: var(--oai-wb-selection);
}
._editor_11vxc_8 .ProseMirror p .selection-highlight {
  padding-top: 0.28em;
  padding-bottom: 0.28em;
}
/* 选中段落末尾标记 */
.ProseMirror p.isSelectedEnd::after {
  content: "\200b";       /* 零宽空格 */
  background-color: var(--oai-wb-selection);
  margin-inline-end: -6px;
  padding-inline-end: 6px;
}
```

### 7.5 终端选区

```css
.xterm .xterm-accessibility-tree:not(.debug) ::selection {
  color: transparent;
}
```

### 7.6 标注选区 Chip

```css
._selectionChip_qwapy_1 {
  border-color: color-mix(in srgb,
    var(--browser-sidebar-annotation-selection-color) 42%,
    transparent);
  background-color: color-mix(in srgb,
    var(--browser-sidebar-annotation-selection-color) 10%,
    var(--color-token-input-background));
}
```

---

## Do / Don't

### Do
- 加载 shimmer 用 `color-mix` 叠加 `description-foreground`，不用固定灰
- Profile skeleton 用 `steps(48, end)` 而非 linear — 步进感更自然
- 空状态用 `description-foreground` 色 + 居中 + `white-space: pre-wrap`
- 错误边框用 `color-mix(in oklab, ...)` 透明叠加
- 图标统一 Lucide 24×24 stroke，`stroke-width: 2`，`currentColor`
- 视觉隐藏用 `clip-path: inset(50%)` + 1px + absolute
- 焦点环用 `outline: 2px solid` + `outline-offset: 2px`
- 每个无限动画都带 `@media (prefers-reduced-motion: reduce)` 禁用
- shimmer 禁用时同时禁用 `animation` 和 `background-image`
- 装饰性微动用 opt-in（`no-preference`）策略

### Don't
- 不要给空状态项加 hover 背景 — 空状态是非交互的
- 不要给错误边框用固定 hex — 用 `color-mix(in oklab)` 透明叠加
- 不要混用图标集 — 只用 Lucide
- 不要在 SVG 里硬编码颜色 — 用 `currentColor`
- 不要在 reduce 下只禁用 `animation` 而留着 `background-image` — shimmer 会残留静态渐变
- 不要给工作点波浪用 opt-out — 用 opt-in（`no-preference`）
- 不要用 `display: none` 做视觉隐藏 — 屏幕阅读器也会跳过
