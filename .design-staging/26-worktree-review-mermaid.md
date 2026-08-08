---
doc: 26-worktree-review-mermaid
name: Worktree, Code Review, Mermaid & Terminal Systems
category: Subsystems
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/css/worktree-init-row-DRsY3oC1.css
  - codex-reference/css/worktree-init-tool-activities-CxuoHau6.css
  - codex-reference/css/review-file-source-tab-Bk2_mA09.css
  - codex-reference/css/mermaid-diagram-shell-Bvc_FFGx.css
  - codex-reference/css/remote-text-edit-session-CW-aJKLZ.css
  - codex-reference/css/local-conversation-item-navigation-BgnmFabe.css
  - codex-reference/css/themeseg.tmp.txt (token 体系)
---

# 26 — Worktree, Code Review, Mermaid & Terminal Systems

> 工作树初始化进度条、ANSI 终端调色板、Mermaid 图表渲染系统、远程文本编辑字体、本地会话导航浮层——这五个子系统展示了 Codex 在"代码工作流"层面的设计深度。本文规定进度条形变动画、ANSI 16 色板、Mermaid 容器查询宽块策略、Markdown 排版系统、以及 Radix Tooltip 浮层定位。

---

## 目录

1. [工作树初始化进度条](#1-工作树初始化进度条)
2. [ANSI 终端调色板](#2-ansi-终端调色板)
3. [代码审查标签页](#3-代码审查标签页)
4. [Mermaid 图表与 Markdown 渲染系统](#4-mermaid-图表与-markdown-渲染系统)
5. [远程文本编辑字体](#5-远程文本编辑字体)
6. [本地会话导航浮层](#6-本地会话导航浮层)
7. [系统级洞察](#7-系统级洞察)
8. [Do / Don't](#do--dont)

---

## 1. 工作树初始化进度条

### 1.1 完整源码

```css
/* worktree-init-row-DRsY3oC1.css */

._statusPillProgress_5zp72_1 {
  opacity: 0;
  transform-origin: 0;
  animation-name: _statusPillProgress_5zp72_1;
  animation-timing-function: linear;
  animation-fill-mode: both;
}

@keyframes _statusPillProgress_5zp72_1 {
  0%    { opacity: 0; transform: scaleX(1); }
  .001% { opacity: 1; transform: scaleX(1); }
  to    { opacity: 1; transform: scaleX(0); }
}
```

### 1.2 动画状态机

| 阶段 | opacity | scaleX | 说明 |
|---|---|---|---|
| 0% | 0 | 1 | 不可见 + 满宽（预备态） |
| 0.001% | 1 | 1 | 立即可见 + 满宽（起始态） |
| 100% | 1 | 0 | 可见 + 零宽（消耗完毕） |

### 1.3 关键设计点

| 属性 | 值 | 说明 |
|---|---|---|
| `transform-origin` | `0`（左上角） | 水平从左向右收缩 |
| `animation-timing-function` | `linear` | 线性匀速（时间均匀流逝） |
| `animation-fill-mode` | `both` | 保留起始态与终态 |
| `animation-duration` | JS 注入 | 对应剩余任务时长 |
| `animation-delay` | JS 控制 | 默认 0s |

> **瞬间跳变设计**：`0% → 0.001%` 的 opacity 跳变是刻意设计——进度条在动画开始的瞬间从透明切到可见，避免淡入干扰对"进度推进"的感知。
>
> **scaleX 而非 width**：利用 GPU 合成层，避免 layout reflow。进度条**从右向左消解**，营造"剩余时间被吃掉"的视觉隐喻。

---

## 2. ANSI 终端调色板

### 2.1 16 色 ANSI 色板

```css
/* worktree-init-tool-activities-CxuoHau6.css */

.ansi-red-fg {
  color: #f66;                                            /* fallback */
  color: var(--color-token-terminal-ansi-red) !important;  /* 优先级覆盖 */
}
```

### 2.2 完整色板表

| ANSI 色 | 类名 | 硬编码 fallback | Token 引用 |
|---|---|---|---|
| black | `.ansi-black-fg` / `-bg` | `#000` | `--color-token-terminal-ansi-black` |
| red | `.ansi-red-fg` / `-bg` | `#f66` | `--color-token-terminal-ansi-red` |
| green | `.ansi-green-fg` / `-bg` | `#94f494` | `--color-token-terminal-ansi-green` |
| yellow | `.ansi-yellow-fg` / `-bg` | `#f4f47b` | `--color-token-terminal-ansi-yellow` |
| blue | `.ansi-blue-fg` / `-bg` | `#9e9eff` | `--color-token-terminal-ansi-blue` |
| magenta | `.ansi-magenta-fg` / `-bg` | `#db6bdb` | `--color-token-terminal-ansi-magenta` |
| cyan | `.ansi-cyan-fg` / `-bg` | `#81eeee` | `--color-token-terminal-ansi-cyan` |
| white | `.ansi-white-fg` / `-bg` | `#d6d6d6` | `--color-token-terminal-ansi-white` |
| bright-black | `.ansi-bright-black-fg` | `#6e6e6e` | （无） |
| bright-red | `.ansi-bright-red-fg` | `#ffa8a8` | （无） |
| bright-green | `.ansi-bright-green-fg` | `#0f0` | （无） |
| bright-yellow | `.ansi-bright-yellow-fg` | `#ffffa8` | （无） |
| bright-blue | `.ansi-bright-blue-fg` | `#9494ff` | （无） |
| bright-magenta | `.ansi-bright-magenta-fg` | `#ffb3ff` | （无） |
| bright-cyan | `.ansi-bright-cyan-fg` | `#adffff` | （无） |
| bright-white | `.ansi-bright-white-fg` | `#fff` | （无） |

### 2.3 应用规则

- **双声明 + `!important`**：先写硬编码 fallback，再用 CSS 变量 + `!important` 覆盖
- **bright 系列仅 foreground**：终端高强度色通常只用于文本
- **fallback 取自 xterm.js 经典配色**：低饱和度版，长时间阅读不刺眼

---

## 3. 代码审查标签页

```css
/* review-file-source-tab-Bk2_mA09.css */

._root_19jz8_1 input:focus {
  outline: none !important;
}
```

> **焦点抑制策略**：用 `!important` 强制移除 input 聚焦时的浏览器默认 outline。焦点样式必须由 JS 内联样式或同容器的其他 CSS 模块提供可见焦点指示，否则违反 WCAG 2.4.7。

---

## 4. Mermaid 图表与 Markdown 渲染系统

### 4.1 Keyframes

```css
/* mermaid-diagram-shell-Bvc_FFGx.css */

@keyframes _fade-in_l45ev_1 { to { opacity: 1; } }

@keyframes _fade-in-marker_l45ev_1 { 0% { color: #0000; } }

@keyframes _image-enter_l45ev_1 {
  0% { opacity: 0; transform: scale(.98); }
  to { opacity: 1; transform: scale(1); }
}
```

| 动画名 | 起始态 | 终止态 | 用途 |
|---|---|---|---|
| `_fade-in` | opacity 0 | opacity 1 | 通用块级元素淡入 |
| `_fade-in-marker` | color transparent | 继承 color | 列表 marker 颜色淡入 |
| `_image-enter` | opacity 0, scale 0.98 | opacity 1, scale 1 | 图片入场 |

### 4.2 容器查询宽块策略

```css
._mermaidWideBlock_l45ev_65 {
  --wide-block-container-max-width: max(
    100%,
    calc(100cqi
      - (var(--padding-toolbar) * 2)
      - var(--thread-wide-block-inline-shift, 0px)
      - var(--thread-wide-block-inline-shift, 0px))
  );
  --wide-block-width: min(
    max(100%, var(--mermaid-natural-block-width, 100%)),
    var(--markdown-wide-block-max-width),
    var(--wide-block-container-max-width)
  );
  margin-left: calc((100% - var(--wide-block-width)) / 2);
  width: var(--wide-block-width);
  max-width: none;
}

._mediaWideBlock_l45ev_49 {
  --wide-block-container-max-width: max(
    100%,
    calc(50cqi + 50%
      - var(--padding-toolbar)
      - var(--thread-wide-block-inline-shift, 0px))
  );
  margin-left: 0;
  width: var(--wide-block-width);
  max-width: none;
}
```

### 4.3 Mermaid vs Media 宽度策略对比

| 维度 | Mermaid 宽块 | Media 宽块 |
|---|---|---|
| 容器最大宽 | `100cqi - 2*toolbar - 2*shift` | `50cqi + 50% - toolbar - shift` |
| 宽度下限 | `max(100%, natural)` | — |
| 宽度上限 | `min(自然宽, markdown上限, 容器上限)` | `min(markdown上限, 容器上限)` |
| 横向对齐 | 居中（`margin-left: (100% - width)/2`） | 左对齐（`margin-left: 0`） |

> **Mermaid 策略**：图表优先尝试 100% 宽度，再尝试自然宽度，但被 markdown 上限和容器上限双向钳制。居中对齐保证图表在窄线程中视觉重心稳定。
>
> **Media 策略**：使用 `50cqi + 50%` 混合公式——一半跟随容器查询宽度，一半跟随父级百分比宽度，使媒体块在响应式伸缩时更平滑。

### 4.4 Markdown 内容根排版

```css
._markdownContent_l45ev_131 {
  --markdown-font-size: var(--codex-chat-font-size);
  --markdown-line-height: calc(var(--markdown-font-size) + 8px);
  --thread-content-max-width: 40rem;    /* 640px */
  color: var(--text-primary);
  font-size: var(--markdown-font-size);
  line-height: var(--markdown-line-height);
  overflow-wrap: anywhere;
}

._markdownContent_l45ev_131 > :first-child { margin-top: 0; }
._markdownContent_l45ev_131 > :last-child  { margin-bottom: 0; }
```

| 属性 | 值 | 说明 |
|---|---|---|
| 字号 | `var(--codex-chat-font-size)` | 跟随用户设置 |
| 行高公式 | `font-size + 8px` | 如 16px 字号 → 24px 行高（1.5 比例） |
| 内容最大宽度 | `40rem`（640px） | 阅读最优宽度 |
| `overflow-wrap` | `anywhere` | 长 URL/代码可任意字符断行 |

### 4.5 排版元素尺寸表

| 元素 | font-size | line-height | margin | 其他 |
|---|---|---|---|---|
| 段落 | 继承 | 继承 | `0 0 0.6875rem` (11px) | `display: flow-root` |
| 小号文本 | 12px | 20px | — | — |
| H1 | 24px | 1.25 (30px) | `20px 0 10px`, weight 600 | — |
| H2 | 20px | 1.25 (25px) | 同上 | — |
| H3 / H4 | 17px | 22px | 同上 | — |
| H5 / H6 | 15px | 20px | 同上 | — |
| 列表 | 继承 | 继承 | padding-inline-start 21px | list-style-position: outside |
| 引用块 | 继承 | 24px | padding-block 8px, padding-inline-start 24px | 左侧 4px 装饰条, 2px 圆角 |
| 水平线 | — | — | `28px 0` | border-top 1px solid border-medium |
| 代码块 | 继承 | 20px | margin-block 14px | — |
| 表格 | 14px | — | — | border-spacing 0, table-layout auto |

### 4.6 列表嵌套 marker

| 层级 | ul marker | ol marker |
|---|---|---|
| 一级 | `disc` | `decimal` |
| 二级 | `circle` | — |
| 三级+ | `square` | — |
| task list | `none`（自定义 checkbox） | — |

### 4.7 任务列表网格布局

```css
._taskListItem_l45ev_419:has(> p) {
  grid-template-columns: auto minmax(0, 1fr);
  display: grid;
}
._taskListItem_l45ev_419:has(> p) > :not(:first-child) {
  grid-column: 2;
}
```

CSS Grid 二列布局：第一列 `auto`（checkbox），第二列 `minmax(0, 1fr)`（内容可收缩）。`:has(> p)` 确保仅当直接子元素是段落时启用网格。

### 4.8 表格 24 网格列宽系统

```css
._table_l45ev_571 [data-col-size=sm] {
  min-width: calc(40rem * 4 / 24);
  max-width: calc(40rem * 6 / 24);
}
._table_l45ev_571 [data-col-size=md] {
  min-width: calc(40rem * 6 / 24);
  max-width: calc(40rem * 8 / 24);
}
._table_l45ev_571 [data-col-size=lg] {
  min-width: calc(40rem * 8 / 24);
  max-width: calc(40rem * 12 / 24);
}
._table_l45ev_571 [data-col-size=xl] {
  min-width: calc(40rem * 14 / 24);
  max-width: calc(40rem * 18 / 24);
}
```

| 列尺寸 | min（640px 基准） | max |
|---|---|---|
| sm | 106.67px (4/24) | 160px (6/24) |
| md | 160px (6/24) | 213.33px (8/24) |
| lg | 213.33px (8/24) | 320px (12/24) |
| xl | 373.33px (14/24) | 480px (18/24) |

### 4.9 表格容器溢出策略

```css
._tableContainer_l45ev_571 {
  width: calc(100% + (var(--thread-content-margin, 24px) * 2));
  margin-inline: calc(var(--thread-content-margin, 24px) * -1);
  scrollbar-width: thin;
  overflow-x: auto;
}
```

负 margin 撑满线程内容边距，`scrollbar-width: thin` 提供细滚动条。

### 4.10 内联代码样式

```css
._markdownContent_l45ev_131 ._inlineMarkdown_l45ev_793 {
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  background: color-mix(in srgb,
    var(--color-token-list-hover-background) 60%,
    var(--color-token-foreground) 6%);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
  word-break: break-word;
  border-radius: 6px;
  padding: 1px 6px;
  font-size: .92em;
  display: inline;
}
```

| 属性 | 值 | 说明 |
|---|---|---|
| `box-decoration-break` | `clone` | 多行内联代码每行独立背景圆角 |
| 背景 | `list-hover 60% + foreground 6%` | 微妙灰底 |
| 字号 | `0.92em` | 略小于正文 |
| 圆角 | `6px` | — |
| padding | `1px 6px` | — |

### 4.11 Mermaid 图表渲染

```css
._mermaidSurface_l45ev_757 {
  --mermaid-surface-background: var(--color-token-bg-primary);
  background-color: var(--mermaid-surface-background);
}

._mermaidBlock_l45ev_767:not([data-mermaid-overflow]) ._mermaidExpandButton_l45ev_767 {
  display: none;
}

._codeBlockPlaceholder_l45ev_775 {
  border-radius: var(--radius-lg);
  background: var(--color-token-text-code-block-background);
  font-size: var(--codex-chat-code-font-size);
  padding: 8px;
  line-height: 20px;
  overflow-x: auto;
}
```

**渲染关键点**：
1. **主题适配**：背景绑定 `--color-token-bg-primary`，自动跟随 dark/light
2. **溢出控制状态机**：默认展开按钮隐藏，`data-mermaid-overflow` 属性存在时显示
3. **占位符**：`var(--radius-lg)` 圆角 + 代码字号 + 8px padding + 横向滚动

### 4.12 动画应用规则

```css
._markdownRoot_l45ev_871 ._fadeIn_l45ev_871,
._markdownRoot_l45ev_871 hr,
._markdownRoot_l45ev_871 li,
._markdownRoot_l45ev_871 tr,
._markdownRoot_l45ev_871 blockquote {
  opacity: 0;
  animation: _fade-in_l45ev_1
    var(--duration, var(--transition-duration-basic))
    var(--fade-easing, cubic-bezier(.37, .55, .86, .88))
    forwards;
  animation-delay: var(--fade-delay, 0s);
}

._markdownRoot_l45ev_871 ._imageEnter_l45ev_905 {
  transform-origin: 50%;
  animation: .18s ease-out both _image-enter_l45ev_1;
}
```

| 元素 | 动画 | duration | easing | fill |
|---|---|---|---|---|
| 通用块（hr/li/tr/blockquote） | fade-in | `var(--duration, basic)` | `cubic-bezier(.37,.55,.86,.88)` | `forwards` |
| 列表 marker | fade-in-marker | 同上 | 同上 | `forwards` |
| 图片 | image-enter | **0.18s** | `ease-out` | `both` |

> **Easing 分析**：`cubic-bezier(.37, .55, .86, .88)` — 起步平缓（37%/55%），中段加速，末段（86%/88%）几乎线性收尾。属于"快速进入 + 平稳停止"的入场曲线。

### 4.13 Reduced-motion 策略

```css
@media (prefers-reduced-motion: reduce) {
  ._markdownRoot_l45ev_871 ._fadeIn_l45ev_871,
  ._markdownRoot_l45ev_871 hr,
  ._markdownRoot_l45ev_871 li,
  ._markdownRoot_l45ev_871 tr,
  ._markdownRoot_l45ev_871 blockquote,
  ._markdownRoot_l45ev_871 ._imageEnter_l45ev_905 {
    --duration: 0s;
    opacity: 1;
    animation-duration: 0s;
    transform: scale(1);
    animation-delay: 0s !important;
  }
  ._markdownRoot_l45ev_871 ._fadeListDecoration_l45ev_893::marker {
    animation-duration: 0s;
    animation-delay: 0s !important;
  }
}
```

**五重短路**：
1. `--duration: 0s` — CSS 变量短路
2. `opacity: 1` — 直接显示终态
3. `animation-duration: 0s` — 双保险
4. `transform: scale(1)` — 图片重置
5. `animation-delay: 0s !important` — 强制消除延迟

---

## 5. 远程文本编辑字体

### 5.1 Carlito 字体策略

```css
/* remote-text-edit-session-CW-aJKLZ.css */

@font-face {
  font-family: 'Carlito';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(...) format('woff2');
  unicode-range: U+0-FF, ...;    /* latin 子集 */
}
```

| 属性 | 值 | 说明 |
|---|---|---|
| `font-family` | `Carlito` | Calibri 的度量兼容替代品 |
| `font-display` | `swap` | 先显示回退字体，加载后切换 |
| `font-weight` | 400 / 700 | regular + bold |
| 格式 | woff2 + woff | 现代浏览器 + IE11 回退 |
| 文件数 | 28 | 2 weight × 7 subset × 2 format |

### 5.2 Unicode 子集划分

| 子集 | 用途 |
|---|---|
| latin | 基本拉丁 + 标点 + 货币 |
| latin-ext | 拉丁扩展（中欧/西欧特殊字符） |
| cyrillic | 基本西里尔（俄语等） |
| cyrillic-ext | 西里尔扩展 |
| greek | 基本希腊语 |
| greek-ext | 希腊语扩展 |
| vietnamese | 越南语 |

> **设计意图**：Carlito 与 Microsoft Calibri **度量完全兼容**（同字宽、行高、x-height）。远程编辑 .docx 时，Linux 服务端无 Calibri 授权，使用 Carlito 保证排版像素级一致。
>
> **按 unicode-range 分包**：浏览器仅下载当前页面用到的子集，未使用的西里尔/希腊/越南语子集不会加载。

---

## 6. 本地会话导航浮层

### 6.1 完整源码

```css
/* local-conversation-item-navigation-BgnmFabe.css */

._positioner_1b9wx_1 {
  width: clamp(0px,
    calc(var(--radix-tooltip-trigger-width, 0px) - 64px),
    var(--radix-tooltip-content-available-width, 100vw));
  height: min(420px,
    var(--radix-tooltip-content-available-height, 420px),
    calc(100vh - 16px));
  pointer-events: none;
  flex-direction: column;
  justify-content: flex-end;
  display: flex;
  overflow: visible;
}

._positioner_1b9wx_1[data-side=bottom] {
  justify-content: flex-start;
}
._positioner_1b9wx_1[data-side=bottom] ._surface_1b9wx_45 {
  align-self: flex-start;
}

._surface_1b9wx_45 {
  pointer-events: auto;
  align-self: flex-end;
  width: 100%;
  max-height: 100%;
}
```

### 6.2 尺寸规范

| 属性 | 公式 | 含义 |
|---|---|---|
| **width** | `clamp(0px, trigger-width - 64px, available-width)` | 浮层比触发器窄 64px（两侧各 32px） |
| **height** | `min(420px, available-height, 100vh - 16px)` | 三重最小值 |
| **width 默认** | trigger 未设置 → `0px - 64px = -64px` → clamp 下限 0px | 容错 |
| **height 默认** | available-height 未设置 → 420px | 容错 |

### 6.3 关键数值

| 数值 | 含义 |
|---|---|
| 64px | 浮层比触发器窄的量（两侧各 32px 内缩） |
| 420px | 浮层最大高度（约 20-25 行会话预览） |
| 16px | 视口底部安全留白 |

### 6.4 双侧定位状态机

| `data-side` | `justify-content` | `surface align-self` | 含义 |
|---|---|---|---|
| （未设置 / `top`） | `flex-end` | `flex-end` | 浮层在触发器**下方**，内容贴底 |
| `bottom` | `flex-start` | `flex-start` | 浮层在触发器**上方**，内容贴顶 |

### 6.5 指针事件策略

```css
._positioner_1b9wx_1 { pointer-events: none; }    /* 容器穿透 */
._surface_1b9wx_45  { pointer-events: auto; }      /* 内容捕获 */
```

> **经典 Popover 模式**：positioner 占据可用空间但不拦截鼠标，只有 surface 内容响应交互。允许鼠标"穿过"浮层空白区域到达下方元素。

---

## 7. 系统级洞察

### 7.1 响应式策略分层

| 场景 | 机制 | 原因 |
|---|---|---|
| 组件内响应式（网格列数、面板形态） | **容器查询**（`cqi`） | 组件可嵌入任意容器 |
| 浮层尺寸约束（tooltip 高度） | **视口查询**（`vh`） | 浮层需要全局视口约束 |
| 字体加载 | 无 | 字体不依赖容器/视口 |

### 7.2 CSS 变量分层

| 层级 | 前缀 | 定义位置 | 例子 |
|---|---|---|---|
| L1 基础色阶 | `--gray-*` / `--blue-*` | 主题层 | `--gray-900` |
| L2 语义 token | `--color-token-*` | 主题层 | `--color-token-text-primary` |
| L3 组件局部 | `--markdown-*` / `--mermaid-*` | 组件根 | `--markdown-font-size` |
| L4 一次性 | `--duration` / `--fade-delay` | 内联或父级 | `--fade-delay: 0s` |

### 7.3 工程实践总结

1. **CSS Modules 隔离**：所有类名带 hash 后缀，避免全局污染
2. **`!important` 谨慎使用**：仅用于 ANSI 色覆盖、outline 抑制、reduced-motion delay 清除
3. **`color-mix` + `@supports` 渐进增强**：所有现代颜色函数都有 fallback 链
4. **动画优先用 transform/opacity**：进度条用 scaleX、图片入场用 scale、淡入用 opacity
5. **容器查询优先于媒体查询**：内容组件用 cqi，浮层用 vh
6. **字体分包 + unicode-range**：按需加载
7. **`:has()` 选择器**：任务列表项用 `:has(> p)` 启用网格
8. **`box-decoration-break: clone`**：内联代码多行场景关键

### 7.4 Reduced-motion 覆盖矩阵

| 组件 | 是否处理 | 处理方式 |
|---|---|---|
| 状态药丸进度条 | ❌ | 需在容器层补齐 |
| ANSI 终端 | N/A | 无动画 |
| 审查标签页 | N/A | 无动画 |
| **Mermaid/Markdown** | ✅ | 完整五重短路 |
| 远程编辑字体 | N/A | 无动画 |
| 会话导航浮层 | N/A | 无动画 |

---

## 8. Do / Don't

### Do

- 进度条用 `scaleX` + `transform-origin: 0` + `linear` 匀速
- 进度条入场用 `0% → 0.001%` 瞬间跳变（避免淡入干扰进度感知）
- ANSI 色用双声明 + `!important`（fallback + token 覆盖）
- Mermaid 宽块用容器查询 `100cqi` + 居中对齐
- Markdown 行高用 `font-size + 8px` 公式
- 表格列宽用 24 网格比例系统
- 内联代码用 `box-decoration-break: clone`
- 浮层 positioner 用 `pointer-events: none`，surface 用 `auto`
- Carlito 字体用 `font-display: swap` + unicode-range 分包

### Don't

- 不要用 `width` 变化做进度条（用 `scaleX` 避免 reflow）
- 不要在 reduced-motion 下保留进度条动画（需短路）
- 不要用媒体查询驱动 Mermaid 宽度（用容器查询 cqi）
- 不要在 Markdown 中硬编码行高（用 `font-size + 8px` 公式）
- 不要让内联代码跨行时背景断裂（用 `box-decoration-break: clone`）
- 不要让浮层 positioner 拦截鼠标（`pointer-events: none`）
- 不要在远程编辑中用系统默认 Calibri（用 Carlito 度量兼容替代）

---

## 来源

- `FakeCoding-main/codex-reference/css/worktree-init-row-DRsY3oC1.css`（进度条）
- `FakeCoding-main/codex-reference/css/worktree-init-tool-activities-CxuoHau6.css`（ANSI 色板）
- `FakeCoding-main/codex-reference/css/review-file-source-tab-Bk2_mA09.css`（审查标签页）
- `FakeCoding-main/codex-reference/css/mermaid-diagram-shell-Bvc_FFGx.css`（Mermaid + Markdown）
- `FakeCoding-main/codex-reference/css/remote-text-edit-session-CW-aJKLZ.css`（Carlito 字体）
- `FakeCoding-main/codex-reference/css/local-conversation-item-navigation-BgnmFabe.css`（导航浮层）
- `FakeCoding-main/codex-reference/css/themeseg.tmp.txt`（token 体系）
