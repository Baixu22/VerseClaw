---
doc: 16-layout-architecture
name: Layout Architecture & Responsive Strategy
category: Layout
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/tokens.css
  - codex-reference/css/app-shell-DJDX7Pvr.css
  - codex-reference/css/app-main-DtaE1-1W.css
  - codex-reference/css/composer-layout-B6-UZ6B5.css
  - codex-reference/css/composer-footer-DqStEw03.css
  - codex-reference/css/composer-top-menu-chrome-6VQM8Ikp.css
  - codex-reference/css/thread-user-message-navigation-rail-CZzXjFhl.css
  - codex-reference/css/thread-page-bottom-panel-state-BrqwKW_G.css
  - codex-reference/css/local-conversation-item-navigation-BgnmFabe.css
  - codex-reference/css/app-VS6Z-TiK.css
  - codex-reference/meta/classes.json
  - codex-pure-source/runtime-dom/stylesheets-rules.json
  - codex-pure-source/runtime-dom/css-tokens-computed.json
  - codex-pure-source/runtime-dom/thread-container.json
  - codex-pure-source/runtime-dom/thread-dom.html
  - codex-design-system.css
  - CODEX-UI-RESOURCE-MAP.md
  - codex-reference/ALIGNMENT.md
  - codex-reference/DROPDOWN.md
---

# 16 — Layout Architecture & Responsive Strategy

> Codex 的布局架构用 **flex + 容器查询（Container Queries）** 取代传统的 CSS Grid + 媒体查询。本文规定了应用外壳结构、侧边栏、主内容区、右栏、工具栏的完整布局规范，以及容器查询驱动的响应式策略。

---

## 目录

1. [应用外壳结构](#1-应用外壳结构)
2. [侧边栏（左面板）](#2-侧边栏左面板)
3. [工具栏 / 头部](#3-工具栏--头部)
4. [右栏 / 右面板](#4-右栏--右面板)
5. [容器查询策略](#5-容器查询策略)
6. [断点系统](#6-断点系统)
7. [主内容区](#7-主内容区)
8. [Z-Index 层级](#8-z-index-层级)
9. [滚动容器](#9-滚动容器)

---

## 1. 应用外壳结构

### 1.1 三区域布局

Codex 使用 **flex 布局**（非 CSS Grid）构建外壳，每个面板是 flex 子项：

```
┌─────────────────────────────────────────────────────────────┐
│ A. App Shell / Window / Boot                                │
├───────────┬─────────────────────────────┬───────────────────┤
│           │  C. Top Header / Toolbar     │                   │
│  B. Left  │  (title / model / dropdown) │  F. Right Rail    │
│  Sidebar  ├─────────────────────────────┤  (Summary / Side  │
│           │  D. Conversation Thread      │   Panel)          │
│           ├─────────────────────────────┤                   │
│           │  E. Composer                 │                   │
├───────────┴─────────────────────────────┴───────────────────┤
│ G. Bottom Panel (Terminal)                                  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 外壳类名

| 类名 | 用途 | 来源 |
|------|------|------|
| `.app-shell-left-panel` | 侧边栏容器 | app-VS6Z-TiK.css |
| `.app-shell-main-content-viewport` | 主内容视口 | app-shell-DJDX7Pvr.css |
| `.app-shell-main-content-frame` | 视口内框架 | — |
| `.app-shell-main-content-top-fade` | 顶部渐隐叠层 | — |
| `.app-header-tint` | 头部色调背景 | — |
| `.app-header-divider` | 头部分割线 | — |

### 1.3 布局数据属性

| 属性 | 值 | 效果 |
|------|-----|------|
| `data-app-shell-header-edge-scroll` | `"true"` | 滚动到边缘时禁用 titlebar 色调 |
| `data-app-shell-main-content-layout` | `"full-bleed"` | 全出血布局（顶部偏移归零） |
| `data-app-shell-main-content-layout` | `"thread-edge-scroll"` | 线程边缘滚动模式（宽屏） |
| `data-app-shell-main-content-top-fade` | `"visible"` / `"full-bleed"` | 控制顶部渐隐透明度 |

### 1.4 主内容视口 token

```css
.app-shell-main-content-viewport {
  --app-shell-main-content-frame-top-offset: var(--height-toolbar);  /* 46px */
  --thread-content-top-inset: calc(var(--spacing) * 8);               /* 32px */
  --thread-floating-content-top-inset: calc(var(--spacing) * 3);      /* 12px */
  --thread-floating-content-bottom-inset: calc(var(--spacing) * 3);   /* 12px */
  container: app-shell-main-content / inline-size;
}
```

**关键**：视口建立了名为 `app-shell-main-content` 的容器查询上下文，类型为 `inline-size`。所有主内容区的响应式行为都基于此容器，而非视口。

### 1.5 全出血覆写

```css
[data-app-shell-main-content-layout="full-bleed"] .app-shell-main-content-frame {
  --app-shell-main-content-frame-top-offset: 0px;
}
```

### 1.6 Tailwind 图层顺序

```css
@layer theme, base, components, utilities;
```

工具类始终覆盖组件类 → 组件类覆盖基础类 → 基础类覆盖主题。

---

## 2. 侧边栏（左面板）

### 2.1 宽度 token

```css
--spacing-token-sidebar: clamp(240px, 275px, min(520px, calc(100vw - 320px)));
```

| 视口宽度 | 侧边栏实际宽度 |
|----------|---------------|
| < 560px | `100vw - 320px`（被 clamp 下限保护为 ≥240px） |
| 560–595px | 240px → 275px 之间缩放 |
| 595–840px | 275px（preferred） |
| > 840px | 可增长至 520px |

**应用方式**：Tailwind 工具类 `w-token-sidebar`（宽度）+ `pl-token-sidebar`（左 padding 偏移）。

### 2.2 侧边栏容器

```css
.app-shell-left-panel {
  background: var(--color-token-editor-background);
  /* color-mix 降级 */
  background: color-mix(in srgb, var(--color-token-editor-background) 70%, transparent);
  overflow: visible;
  position: relative;
}
/* ::after 延伸背景以覆盖相邻圆角 */
.app-shell-left-panel::after {
  inset: 0 calc(-1 * var(--radius-2xl)) 0 auto;   /* 右延 16px */
  width: var(--radius-2xl);                         /* 16px 宽条 */
  background: inherit;
  content: "";
  pointer-events: none;
  position: absolute;
}
```

### 2.3 侧边栏阴影

```css
--elevation-sidebar: 0 0 0 .5px rgba(255, 255, 255, 0.156),
                     0 3px 7.5px #00000008,
                     0 0 16px #00000005;
```

三层：hairline + 近距 + 远距漫射。

### 2.4 滚动渐隐遮罩

侧边栏使用线性渐变 mask 在顶部和底部淡出内容：

```css
._headerFadeMask_13q70_1 {
  --edge-fade-distance: calc(var(--spacing) * 10);                              /* 40px */
  --sidebar-scroll-footer-edge: calc(100% - var(--sidebar-footer-height));
  --sidebar-scroll-footer-fade-distance: calc(var(--spacing) * 10);              /* 40px */
  --sidebar-scroll-header-mask-distance:
    var(--sidebar-scroll-header-fade-distance,
         var(--sidebar-scroll-header-spacing, calc(var(--spacing) * 2)));         /* 8px 默认 */
  --sidebar-scroll-mask-image:
    linear-gradient(to bottom,
      transparent 0,
      transparent var(--sidebar-scroll-header-mask-start),
      black calc(var(--sidebar-scroll-header-mask-start) + var(--sidebar-scroll-header-mask-distance)),
      black var(--sidebar-scroll-footer-fade-start),
      #000000e0 calc(var(--sidebar-scroll-footer-edge) - var(--spacing) * 6),
      #00000085 calc(var(--sidebar-scroll-footer-edge) - var(--spacing) * 3),
      #0000002e calc(var(--sidebar-scroll-footer-edge) - var(--spacing)),
      transparent var(--sidebar-scroll-footer-edge),
      transparent 100%);
  mask-image: var(--sidebar-scroll-mask-image);
  mask-size: 100% 100%;
  mask-repeat: no-repeat;
}
```

**遮罩分段**：
- 顶部：小淡出（默认 8px）
- 中间：实色（可见区）
- 底部：阶梯式淡出（40px 距离，4 步透明度递减）

**滚动驱动动画支持时**：
```css
@supports (animation-timeline: --scroll-fade) {
  ._headerFadeMask_13q70_1 {
    --sidebar-scroll-footer-fade-distance: var(--bottom-fade);
  }
}
```

### 2.5 面板缩放

```css
.panel-animated [data-panel] {
  will-change: flex-grow, max-width;
  transition: flex-grow var(--transition-duration-relaxed) var(--ease-basic),
              max-width var(--transition-duration-relaxed) var(--ease-basic);
}
.panel-animated.panel-dragging [data-panel] {
  transition: none;   /* 拖拽时即时反馈 */
}
@media (prefers-reduced-motion: reduce) {
  .panel-animated [data-panel] { transition: none; }
}
```

- 缩放通过 `flex-grow` + `max-width` 过渡
- 时长：`var(--transition-duration-relaxed)` = 0.3s
- 拖拽中禁用过渡

### 2.6 侧边栏下拉宽度

| 上下文 | 宽度 |
|--------|------|
| 溢出菜单（整理/⋯） | 188px |
| 项目操作菜单 | 200px |
| 项目选择器 | 280px |
| 模式切换 | `min(260px, sidebar-width - 16px)` |

---

## 3. 工具栏 / 头部

### 3.1 高度 token

```css
--height-toolbar:      46px;
--height-toolbar-sm:   36px;
--height-toolbar-pane: 40px;
--inset-toolbar:       var(--height-toolbar);      /* 46px */
--inset-toolbar-sm:    var(--height-toolbar-sm);   /* 36px */
--padding-toolbar:     calc(var(--spacing) * 4);    /* 16px 水平 */
```

### 3.2 Tailwind 工具类

| 类名 | 映射 |
|------|------|
| `h-toolbar` | `height: var(--height-toolbar)` = 46px |
| `h-toolbar-pane` | `height: var(--height-toolbar-pane)` = 40px |
| `h-toolbar-sm` | `height: var(--height-toolbar-sm)` = 36px |
| `min-h-toolbar` | `min-height: var(--height-toolbar)` |
| `px-toolbar` | `padding-left/right: var(--padding-toolbar)` = 16px |
| `top-toolbar` | `top: var(--height-toolbar)` |
| `top-toolbar-sm` | `top: var(--height-toolbar-sm)` |

### 3.3 头部色调

```css
.app-header-tint {
  background-color: var(--codex-titlebar-tint, transparent);
}
.app-header-tint[data-app-shell-header-edge-scroll="true"] {
  background-color: rgba(0, 0, 0, 0);   /* 滚到边缘时透明 */
}
```

### 3.4 导航行高

```css
--height-token-nav-row: calc(var(--text-base) * 1.5 + var(--padding-row-y) * 2);
/* = 14 * 1.5 + 4 * 2 = 29px 默认, 31px Electron 模式 */
```

### 3.5 头部内容

头部包含：对话标题 + 下拉、模型选择器、推理强度滑块、面包屑、右面板切换、溢出菜单。

---

## 4. 右栏 / 右面板

### 4.1 右栏结构

右栏（摘要面板/侧面板）没有独立的 CSS chunk，其布局是外壳 chrome 的一部分。

**关键资源**：
- `thread-side-panel-tabs.js` — 侧面板标签
- `thread-panel-toggle-button.js` — 面板切换按钮
- `toggle-thread-summary-panel.js` — 摘要面板切换
- `thread-user-message-navigation-rail` — 消息导航栏

### 4.2 右栏入场动画

```css
@keyframes right-panel-composer-overlay-enter {
  0%   { opacity: 0; }
  100% { opacity: 1; }
}
```

### 4.3 消息导航栏

右侧消息标记栏使用 `--marker-progress` 变量（0 到 1）驱动横向填充：

```css
._marker_1q3nl_1 {
  --marker-progress: 0;
  width: 26px;
  transform: scaleX(calc(.2308 + .7692 * var(--marker-progress)));
  transform-origin: 0;
  transition: transform .16s linear(0, .398 10%, .682 20%, .843 30%, .925 40%, .972 50%, 1.004 60%, 1.008 70%, 1.003 80%, 1);
}
```

**聚焦行周围标记递减进度**：0.7 → 0.4 → 0.2，形成"聚光灯"效果。

### 4.4 侧边栏悬停预览

```css
._positioner_1b9wx_1 {
  width: clamp(0px,
    calc(var(--radix-tooltip-trigger-width, 0px) - 64px),
    var(--radix-tooltip-content-available-width, 100vw));
  height: min(420px,
    var(--radix-tooltip-content-available-height, 420px),
    calc(100vh - 16px));
  pointer-events: none;
}
```

悬停预览最大高度 420px 或 `100vh - 16px`。

---

## 5. 容器查询策略

**核心原则**：Codex **不使用视口 `@media` 查询做布局**。所有响应式行为基于容器查询。仅 `prefers-color-scheme`、`prefers-reduced-motion`、`hover:hover`、`pointer:fine` 使用 `@media`。

### 5.1 容器上下文

| 容器名 | 声明 | 文件 |
|--------|------|------|
| `app-shell-main-content` | `container: app-shell-main-content / inline-size` | `.app-shell-main-content-viewport` |
| `composer-footer` | `container: composer-footer / inline-size` | `._footer_uoylu_2` |
| `thread-content` | `[container-name:thread-content] [container-type:inline-size]` | 运行时 Tailwind 任意属性 |
| （匿名） | `container-type: inline-size` | `._container_3x1p4_1` |

### 5.2 主内容容器查询

```css
@container app-shell-main-content (width >= 96rem) {   /* 1536px */
  [data-app-shell-main-content-layout="thread-edge-scroll"] .app-shell-main-content-frame {
    --app-shell-main-content-frame-top-offset: 0px;
    --thread-content-top-inset: calc(var(--height-toolbar) + var(--spacing) * 8);
    --thread-floating-content-top-inset: calc(var(--height-toolbar) + var(--spacing) * 3);
  }
}
```

≥1536px 时切换到"线程边缘滚动"模式。

### 5.3 Composer 底部容器查询（渐进式标签隐藏）

| 容器宽度 | 效果 |
|----------|------|
| `<= 300px` | 隐藏 `_labelXs` + `_projectClearButton`，悬停时显示清除图标 |
| `<= 420px` | Electron: 隐藏 `_secondaryChevron` |
| `<= 440px` | 隐藏 `_labelSm` |
| `<= 475px` | Electron: 隐藏 `_labelSm` + `_labelXs` + `_projectClearButton` |
| `<= 480px` | Electron: 隐藏 `_secondaryLabel` |

### 5.4 线程内容容器查询

```css
@container thread-content (width >= 50rem) {   /* 800px */
  ._actions_1ac5h_1 {
    pointer-events: auto;
    left: 100%;
    right: auto;
  }
}
```

线程宽于 800px 时，操作按钮移到内容右侧外缘。

### 5.5 匿名网格容器查询

```css
._container_3x1p4_1 { container-type: inline-size; }
._grid_3x1p4_9 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
@container (width >= 581px) {
  ._grid_3x1p4_9 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

581px 处从 1 列切到 2 列。

---

## 6. 断点系统

所有断点都是 **容器查询阈值**，不是视口断点：

| 阈值 | 类型 | 目标 | 效果 |
|------|------|------|------|
| **300px** | `<=` | composer-footer | 隐藏额外标签，悬停显示清除图标 |
| **420px** | `<=` | composer-footer (electron) | 隐藏次要箭头 |
| **440px** | `<=` | composer-footer | 隐藏 `_labelSm` |
| **475px** | `<=` | composer-footer (electron) | 隐藏标签和清除按钮 |
| **480px** | `<=` | composer-footer (electron) | 隐藏次要标签 |
| **581px** | `>=` | 匿名网格 | 1 列 → 2 列 |
| **50rem (800px)** | `>=` | thread-content | 操作移到左侧外缘 |
| **96rem (1536px)** | `>=` | app-shell-main-content | 启用 thread-edge-scroll 模式 |

### 容器尺寸 Token

```css
--container-3xs: 16rem;   /* 256px */
--container-xs:  20rem;   /* 320px */
--container-sm:  24rem;   /* 384px */
--container-md:  28rem;   /* 448px */
--container-lg:  32rem;   /* 512px */
--container-xl:  36rem;   /* 576px */
--container-2xl: 42rem;   /* 672px */
--container-3xl: 48rem;   /* 768px */
--container-4xl: 56rem;   /* 896px */
--container-5xl: 64rem;   /* 1024px */
```

`--thread-content-max-width: 48rem`（768px）和 `--markdown-wide-block-max-width: 56rem`（896px）引用此尺度。

---

## 7. 主内容区

### 7.1 线程内容最大宽度

```css
[data-codex-window-type="electron"] body {
  --thread-content-max-width:           48rem;    /* 768px */
  --markdown-wide-block-max-width:      56rem;    /* 896px */
  --padding-panel-base:                 calc(var(--spacing) * 5);    /* 20px */
  --padding-row-y:                      calc(var(--spacing) * 1.25);  /* 5px */
  --spacing-token-button-composer-sm:   calc(var(--spacing) * 7);    /* 28px */
  --text-heading-md:                    18px;
}
```

### 7.2 Composer 相邻最大宽度

```css
--composer-inline-overhang: calc(var(--spacing) * 6);    /* 24px — 每侧超出 24px */
--home-composer-inline-inset: calc(var(--spacing) * 3.25); /* 13px */
--composer-adjacent-max-width:
  calc(var(--thread-content-max-width)
       + var(--composer-inline-overhang)
       + var(--composer-inline-overhang)
       - var(--home-composer-inline-inset)
       - var(--home-composer-inline-inset));
/* = 768 + 24 + 24 - 13 - 13 = 790px */
```

### 7.3 Composer 圆角

```css
--composer-border-radius: var(--radius-3xl);    /* 25px */
```

### 7.4 线程滚动容器

运行时 DOM class string：

```tsx
<div className="thread-scroll-container relative h-full
     overflow-x-hidden overflow-y-auto
     [overflow-anchor:none]
     [scroll-padding-bottom:var(--thread-scroll-padding-bottom,0px)]
     electron:[scrollbar-gutter:stable_both-edges]
     pt-(--thread-content-top-inset)
     [container-name:thread-content]
     [container-type:inline-size]
     focus:outline-none
     flex flex-col-reverse">
```

**关键特性**：
- **反向 flex 列**（`flex flex-col-reverse`）— 内容锚定底部
- **稳定滚动条槽**（`scrollbar-gutter: stable both-edges`）— 滚动条出现/消失时布局不抖
- **无滚动锚定**（`overflow-anchor: none`）
- **容器查询上下文** 通过 Tailwind 任意属性内联声明
- **顶部 padding** 来自 `--thread-content-top-inset`（默认 32px）
- **底部滚动 padding** 来自 `--thread-scroll-padding-bottom`（运行时 = 130px，为 composer 留位）

### 7.5 内容包装器

```tsx
<div className="mx-auto w-full max-w-(--thread-content-max-width)
     px-toolbar relative flex flex-1 shrink-0 flex-col pb-8"
     data-mcp-app-portal-target="true">
  {/* 对话内容 */}
</div>
```

- 水平居中（`mx-auto`）
- 最大宽度 = `--thread-content-max-width`（768px）
- 水平 padding = `--padding-toolbar`（16px）
- 底部 padding 8（32px）

### 7.6 Composer 底部容器（粘性）

```tsx
<div className="sticky bottom-0 z-10 mt-auto w-full pb-4"
     data-thread-scroll-footer="true">
  {/* Composer */}
</div>
```

Composer 粘性固定在底部，`z-index: 10`。

### 7.7 用户消息气泡布局

```tsx
<div className="bg-token-foreground/5 max-w-[77%] min-w-0
     overflow-hidden break-words rounded-2xl px-3 py-2">
```

- 最大宽度 = 容器的 77%
- `rounded-2xl`（20px）
- `px-3 py-2`（12px / 8px）
- 右对齐（父级 `flex flex-col items-end`）

### 7.8 滚到底部按钮

```tsx
<button className="... absolute z-30 flex h-8 w-8 ...
     bottom-[calc(100%+6*var(--spacing))]"   /* composer 上方 24px */
```

---

## 8. Z-Index 层级

### 8.1 Z-Index Token

```css
--max-app-overlay-z-index: 2147480000;    /* 接近 2^31-1，留给模态遮罩 */
```

### 8.2 Tailwind Z-Index 工具类

可用层级：`z-0` / `z-1` / `z-2` / `z-3` / `z-10` / `z-20` / `z-30` / `z-40` / `z-50`。

### 8.3 运行时堆叠上下文

| 元素 | z-index | 来源 |
|------|---------|------|
| 模态遮罩（全屏覆层） | `2147480000` | `--max-app-overlay-z-index` |
| 滚到底部按钮 | 30 | Tailwind `z-30` |
| Composer 底部（粘性） | 10 | Tailwind `z-10` |
| Composer 内部内容 | 10 | Tailwind `z-10` |
| Composer 背景渐变 | 0 | Tailwind `z-0` |

### 8.4 终端（xterm）Z-Index

| 元素 | z-index |
|------|---------|
| `.xterm-helper-textarea` | -5 |
| `.xterm-decoration-top` | 2 |
| `.xterm-helpers` | 5 |
| `.xterm-decoration` | 6 |
| `.xterm-decoration-top-layer` | 7 |
| `.xterm-decoration-overview-ruler` | 8 |
| `.xterm-accessibility` / `.xterm-message` | 10 |

### 8.5 ClawX 统一 Z-Index 阶（建议）

基于 Codex 模式，ClawX 应建立以下层级：

| 层级 | z-index | 用途 |
|------|---------|------|
| `--z-base` | 0 | 背景元素 |
| `--z-content` | 10 | 粘性底部、内容层 |
| `--z-sticky` | 20 | 粘性头部、粘性列 |
| `--z-dropdown` | 30 | 下拉菜单、弹出层 |
| `--z-overlay` | 40 | 工具提示、悬停卡 |
| `--z-modal` | 50 | 模态对话框 |
| `--z-max-overlay` | 2147480000 | 全屏遮罩 |

---

## 9. 滚动容器

### 9.1 主线程滚动容器

```tsx
<div className="thread-scroll-container ... overflow-y-auto
     electron:[scrollbar-gutter:stable_both-edges]
     flex flex-col-reverse
     [scroll-padding-bottom:var(--thread-scroll-padding-bottom,0px)]">
```

**聚焦覆写**：
```css
[&:has([data-thread-scroll-footer='true']:focus-within)]:[scroll-padding-bottom:0px]
```

Composer 获焦时滚动 padding 归零。

### 9.2 通用滚动条样式

```css
:is(.overflow-auto, .overflow-scroll, .overflow-x-auto, .overflow-y-auto) {
  scrollbar-color: var(--color-token-scrollbar-slider-background) transparent;
}
:is(.overflow-auto, .overflow-scroll, ...) :hover {
  scrollbar-color: var(--color-token-scrollbar-slider-hover-background) transparent;
}
:is(.overflow-auto, .overflow-scroll, ...):active {
  scrollbar-color: var(--color-token-scrollbar-slider-active-background) transparent;
}
```

三态滚动条：默认 / 悬停 / 激活。

### 9.3 终端滚动条

```css
[data-codex-xterm] .xterm-viewport {
  scrollbar-color: var(--color-token-scrollbar-slider-background)
                   var(--vscode-terminal-background);
}
[data-codex-xterm] .xterm-viewport::-webkit-scrollbar { width: 10px; height: 10px; }
[data-codex-xterm] .xterm-viewport::-webkit-scrollbar-thumb {
  background-color: var(--color-token-scrollbar-slider-background);
}
[data-codex-xterm] .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-token-scrollbar-slider-hover-background);
}
[data-codex-xterm] .xterm-viewport::-webkit-scrollbar-thumb:active {
  background-color: var(--color-token-scrollbar-slider-active-background);
}
```

终端滚动条 10px 宽。

### 9.4 滚动驱动边缘渐隐

Codex 使用现代 **scroll-driven animations** 做边缘渐隐：

```css
@property --top-fade    { syntax: "<length>"; inherits: false; initial-value: 0; }
@property --bottom-fade { syntax: "<length>"; inherits: false; initial-value: 0; }

@keyframes edge-fade {
  0%   { --top-fade: 0; --bottom-fade: var(--edge-fade-distance, 1rem); }
  99%  { --top-fade: var(--edge-fade-distance, 1rem); --bottom-fade: 0; }
  100% { --top-fade: var(--edge-fade-distance, 1rem); --bottom-fade: 0; }
}

@supports (animation-timeline: --scroll-fade) {
  .vertical-scroll-fade-mask {
    mask: linear-gradient(to bottom in oklch,
      oklch(60% 0 0/0),
      oklch(85% 0 0) var(--top-fade) calc(100% - var(--bottom-fade)),
      oklch(60% 0 0/0));
    animation-name: edge-fade;
    animation-timeline: scroll(self y);
  }
}
```

**组件类**：`.vertical-scroll-fade-mask` / `.horizontal-scroll-fade-mask` / `.vertical-scroll-fade-mask-top` / `.vertical-scroll-fade-mask-bottom`。

### 9.5 其他滚动容器

- **ProseMirror 编辑器**：`max-h-[25dvh] overflow-y-auto`（最大 25% 视口高度）
- **Composer 顶部托盘**：`overflow-y-auto`，`max-height: var(--composer-top-tray-max-height, 177px)`
- **设置导航**：标准 `overflow-scroll`，用 VS Code `--vscode-list-*` token

---

## 10. 窗口缩放

### 10.1 缩放 Token

```css
--codex-window-zoom: 1;    /* 默认不缩放 */
```

### 10.2 缩放视口

```css
._zoomedViewport_1d7n0_1 {
  height: calc(100vh / var(--codex-window-zoom));
  width:  calc(100vw / var(--codex-window-zoom));
  zoom:    var(--codex-window-zoom);
}
```

用户缩放 Electron 窗口时，视口除以缩放因子再应用 CSS `zoom`，保持坐标一致。

### 10.3 Electron Body 覆写

```css
[data-codex-window-type="electron"] {
  background: transparent;
  overflow: hidden;                    /* body 不滚动 */
}
[data-codex-window-type="electron"] body {
  --cursor-interaction: default;
  overscroll-behavior: none;           /* 禁用反弹/过度滚动 */
  overflow: hidden;
}
[data-codex-window-type="electron"][data-codex-history-swipe-navigation] body {
  overscroll-behavior: auto none;      /* 允许水平滑动导航 */
}
```

### 10.4 紧凑窗口

`.compact-window` 类存在于类注册表中，用于窄窗口模式。

---

## Do / Don't

### Do
- 用容器查询（`@container`）做组件级响应式，不用视口 `@media`
- 侧边栏用 `clamp()` 控制宽度范围（240–520px）
- 线程滚动容器用 `flex flex-col-reverse` 锚定底部
- 用 `scrollbar-gutter: stable both-edges` 防止滚动条出现/消失时布局抖动
- 面板缩放用 `flex-grow` + `max-width` 过渡（0.3s），拖拽时禁用过渡
- 用 `mask-image` 线性渐变做侧边栏顶部/底部内容淡出
- 支持 `animation-timeline: scroll()` 时用滚动驱动边缘渐隐

### Don't
- 不要用 CSS Grid 做外壳布局 — Codex 全用 flex
- 不要在 body 上设置滚动 — Electron body `overflow: hidden`
- 不要用 `overscroll-behavior: auto` — 会引入反弹
- 不要用视口断点（`@media (max-width: ...)`）做布局 — 用容器查询
- 不要给 z-index 用任意数字 — 用统一 token 阶
- 不要在主题切换时用 `.dark` 类 — 用 `.electron-dark` / `.electron-light`
