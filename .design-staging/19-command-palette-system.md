---
doc: 19-command-palette-system
name: Command Palette, Process Manager, Hotkey Window & Quick Chat
category: Components
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/tokens.css
  - codex-reference/css/cmdk-uRuhKLE-.css
  - codex-reference/css/hotkey-window-home-page-B0ifEJ1s.css
  - codex-reference/css/quick-chat-window-Knu7u6SP.css
  - codex-reference/css/app-main-DtaE1-1W.css
  - codex-reference/css/composer-top-menu-chrome-6VQM8Ikp.css
  - codex-pure-source/runtime-dom/stylesheets-rules.json
  - codex-design-system.css
---

# 19 — Command Palette, Process Manager, Hotkey Window & Quick Chat

> Command palette（cmdk）是 Codex 把"菜单 / 搜索 / 命令面板"三者合并的 **统一行动入口**。它不是一个 dropdown、也不是一个 dialog，而是一个 **具有 list 语义的 floating surface**，支持键盘导航、模糊搜索、loading 态、empty 态。
>
> 本文规范三种 cmdk 变体（标准 / 全局 / 进程管理器），以及两个相关浮动窗口（Hotkey Window Home / Quick Chat Window），构成 Codex 的 **快速行动子系统**。所有变体共享同一份 `cmdk-uRuhKLE-.css`，通过容器类名区分尺寸与视觉差异。

---

## 目录

1. [设计哲学](#1-设计哲学)
2. [三种 cmdk 变体](#2-三种-cmdk-变体)
3. [Root 容器规范](#3-root-容器规范)
4. [cmdk-item 状态机](#4-cmdk-item-状态机)
5. [cmdk-list 与滚动](#5-cmdk-list-与滚动)
6. [cmdk-input 输入框](#6-cmdk-input-输入框)
7. [Empty State](#7-empty-state)
8. [Hotkey Window Home](#8-hotkey-window-home)
9. [Quick Chat Window](#9-quick-chat-window)
10. [Window Zoom 适配](#10-window-zoom-适配)
11. [性能模式](#11-性能模式)
12. [键盘导航](#12-键盘导航)
13. [无障碍](#13-无障碍)
14. [Do / Don't](#14-do--dont)

---

## 1. 设计哲学

### 1.1 三合一行动入口

Codex 没有"菜单栏 / 命令面板 / 搜索框"三个独立组件，而是 **一个 cmdk 容器** 通过不同 trigger 触发不同 scope：

| 触发源 | Scope | 容器类 | 列表高度 |
|--------|-------|--------|----------|
| `Cmd+K` / `Ctrl+K` | 当前上下文命令 | `.command-menu-dialog` | min(300px, 90vh-64px) |
| 全局快捷键 | 跨窗口全局命令 | `.global-command-menu-dialog` | min(440px, 90vh-64px) |
| 进程管理入口 | 后台进程列表 | `.process-manager-dialog` | 276px（固定内容） |

### 1.2 与 Dropdown 的分野

cmdk 与 [07-components.md](./07-components.md) 中的 dropdown 共享 token，但**不是 dropdown**：

| 维度 | Dropdown | cmdk |
|------|----------|------|
| 触发 | 点击 trigger | 键盘快捷键 / 全局热键 |
| 宽度 | 固定（188/200/280px） | 响应式（min(520px, 92vw)） |
| 高度 | 内容撑开 | 最大 90vh，内部滚动 |
| 圆角 | `--radius-2xl` (20px) | `--radius-3xl` (25px) — 比 dropdown 更圆 |
| 阴影 | `--shadow-xl-spread` | `--shadow-2xl` — 比 dropdown 更重 |
| 输入 | 无 | 有（搜索 / 命令） |
| 键盘 | 上下键 + Enter | 上下键 + Enter + 字母筛选 |
| 焦点陷阱 | 是 | 是（更强：input 自动聚焦） |

### 1.3 与 Composer 的关系

Hotkey Window Home 与 Quick Chat Window 都**复用 Composer 容器**，但通过专属类名重写其外观：

```css
/* Hotkey Window Home 复用 Composer 但去掉边框 */
._composerSurface_wq94q_43 {
  --composer-border-radius: 0px;   /* 覆盖 Composer 默认圆角 */
  box-shadow: none;
  border: none;
  position: relative;
}
```

---

## 2. 三种 cmdk 变体

### 2.1 标准 Command Menu（`.command-menu-dialog`）

最常见的 cmdk 形态，用于当前窗口的命令面板：

```css
.command-menu-dialog {
  --command-menu-list-max-height: min(300px, max(120px, calc(90vh / var(--codex-window-zoom,1) - 64px)));
  --command-menu-max-height: calc(var(--command-menu-list-max-height) + 64px);
  top: max(
    calc(var(--spacing) * 4 / var(--codex-window-zoom,1)),
    calc((100vh / var(--codex-window-zoom,1) - var(--command-menu-max-height)) / 2)
  );
  width: min(520px, calc(92vw / var(--codex-window-zoom,1)));
  zoom: var(--codex-window-zoom,1);
}

.command-menu-dialog [cmdk-root] {
  box-shadow: var(--shadow-2xl);
  background-color: var(--color-token-dropdown-background);
  border-radius: var(--radius-2xl);
  -webkit-backdrop-filter: none;       /* 注意：dialog 容器关闭 blur */
  backdrop-filter: none;
  max-height: var(--command-menu-max-height);
  border-color: #0000;                 /* 默认透明边框 */
  overflow: hidden;
}

.electron-dark .command-menu-dialog [cmdk-root] {
  border-color: var(--color-token-border);  /* 暗色恢复 hairline 边框 */
}
```

**几何要点**：
- 宽度：`min(520px, 92vw / zoom)` — 上限 520px，窄屏自适应
- 列表最大高度：`min(300px, 90vh/zoom - 64px)` — 上限 300px，留 64px 给 input/header
- 顶部偏移：`max(16px, (90vh - max-height) / 2)` — 优先居中，但最小留 16px 顶部
- 圆角：`--radius-2xl`（20px）—— **比 root 默认的 3xl (25px) 小一档**
- 阴影：`--shadow-2xl`（最重阴影）
- backdrop-filter：**关闭**（dialog 已有 curtain 提供背景模糊）

### 2.2 全局 Command Menu（`.global-command-menu-dialog`）

跨窗口全局命令面板，列表更长：

```css
.global-command-menu-dialog {
  --command-menu-list-max-height: min(440px, max(120px, calc(90vh / var(--codex-window-zoom,1) - 64px)));
}
```

**唯一差异**：列表上限从 300px → 440px。其余几何、视觉完全相同。

### 2.3 进程管理器（`.process-manager-dialog`）

后台进程列表，**结构不同**：

```css
.process-manager-dialog {
  top: max(
    calc(var(--spacing) * 8 / var(--codex-window-zoom,1)),
    calc((100vh / var(--codex-window-zoom,1) - 276px) / 2)
  );
  width: min(640px, calc(92vw / var(--codex-window-zoom,1)));
  zoom: var(--codex-window-zoom,1);
}

.process-manager-dialog [cmdk-root] {
  border-color: var(--color-token-border);
  border-radius: var(--radius-3xl);    /* 25px — 比 command-menu 更圆 */
  box-shadow: var(--shadow-2xl);
  gap: 0;                              /* 取消 root 默认 gap */
  padding: 0;                          /* 取消 root 默认 padding */
  overflow: hidden;
}
```

**与 command-menu 的差异**：
- 宽度：640px（vs 520px）— 更宽以容纳进程信息
- 圆角：`--radius-3xl`（25px）— 比 command-menu 的 2xl (20px) 大一档
- 内容高度：固定 276px（vs 动态 max-height）
- gap/padding：归零 — 内容自行控制间距
- border：始终有 hairline（不依赖主题）

---

## 3. Root 容器规范

### 3.1 默认 Root（非 dialog 包装时）

```css
[cmdk-root],
[data-cmdk-root] {
  gap: var(--spacing);                                   /* 4px */
  background-color: var(--color-token-dropdown-background);
  background-color: color-mix(in oklab, var(--color-token-dropdown-background) 95%, transparent);
  min-width: 100%;
  color: var(--color-token-foreground);
  border: 1px solid var(--color-token-border);
  border-radius: var(--radius-3xl);                     /* 25px */
  padding: var(--spacing);                              /* 4px */
  font-size: var(--text-sm);                            /* 12px */
  -webkit-backdrop-filter: blur(8px);                   /* 注意：默认开启 blur */
  backdrop-filter: blur(8px);
  -webkit-user-select: none;
  user-select: none;
  z-index: 1000;
  opacity: 1;
  flex-direction: column;
  display: flex;
  transform: translateZ(0);                            /* GPU 加速 */
}
```

### 3.2 Electron 字号覆盖

```css
[data-codex-window-type="electron"] [cmdk-root],
[data-codex-window-type="electron"] [data-cmdk-root] {
  font-size: var(--text-base);   /* 14px — Electron 比 web 大一档 */
}
```

### 3.3 三层背景策略

cmdk 容器使用**三层叠加**保证视觉层级：

| 层 | 用途 | 实现 |
|----|------|------|
| 1. base color | `--color-token-dropdown-background` | `background-color` 第一条声明 |
| 2. perceptual blend | `color-mix(in oklab, dropdown 95%, transparent)` | `background-color` 第二条声明（覆盖第一条） |
| 3. backdrop blur | `blur(8px)` 透出底色 | `backdrop-filter` |

**注意**：dialog 包装时第 3 层关闭（curtain 已提供模糊），但 root 包装时保留。

---

## 4. cmdk-item 状态机

### 4.1 默认状态

```css
[cmdk-item] {
  content-visibility: auto;                              /* 性能：懒渲染 */
  border-radius: var(--radius-lg);                      /* 12.5px */
  width: 100%;
  cursor: var(--cursor-interaction);
  color: var(--color-token-foreground);
  padding: var(--padding-row-y) var(--padding-row-x);
  min-height: calc(var(--spacing) * 6);                 /* 24px 最小高度 */
  -webkit-user-select: none;
  user-select: none;
  opacity: .75;                                          /* 默认 75% 透明度 */
  outline: none;
  flex-direction: row;
  align-items: center;
  display: flex;
}
```

### 4.2 状态矩阵

| 状态 | 触发 | background | opacity | cursor |
|------|------|------------|---------|--------|
| default | — | transparent | 0.75 | `--cursor-interaction` |
| hover | `:hover:not([aria-disabled=true])` | `--color-token-list-hover-background` | 1 | `--cursor-interaction` |
| selected (keyboard) | `[data-selected=true]` | `--color-token-list-hover-background` | 1 | `--cursor-interaction` |
| selected (ARIA) | `[aria-selected=true]` | `--color-token-list-hover-background` | 1 | `--cursor-interaction` |
| focus | `:focus-visible` | `--color-token-list-hover-background` | 1 | `--cursor-interaction` |
| active | `:active:not([aria-disabled=true])` | `--color-token-list-hover-background` | 1 | `--cursor-interaction` |
| disabled | `[aria-disabled=true]` / `[data-disabled=true]` | transparent | 0.25 | `default` |
| loading | `[data-command-menu-loading=true]` | transparent | 0.6 | `default` |
| empty state | `[data-command-menu-empty-state=true]` | transparent | 1 | `default` |

### 4.3 完整 CSS

```css
[cmdk-item][aria-disabled=true],
[cmdk-item][data-disabled=true] {
  cursor: default;
  opacity: .25;                                          /* 比加载态更暗 */
}

[cmdk-item]:hover:not([aria-disabled=true]),
[cmdk-item][data-selected=true],
[cmdk-item][aria-selected=true],
[cmdk-item]:focus-visible,
[cmdk-item]:active:not([aria-disabled=true]) {
  background-color: var(--color-token-list-hover-background);
  opacity: 1;
}

[cmdk-item][data-command-menu-loading=true],
[cmdk-item][data-command-menu-loading=true]:hover,
[cmdk-item][data-command-menu-loading=true][data-selected=true],
[cmdk-item][data-command-menu-loading=true][aria-selected=true],
[cmdk-item][data-command-menu-loading=true]:focus-visible,
[cmdk-item][data-command-menu-loading=true]:active {
  cursor: default;
  opacity: .6;
  background-color: #0000;                              /* 加载态不高亮 */
}

[cmdk-item][data-command-menu-empty-state=true],
[cmdk-item][data-command-menu-empty-state=true]:hover,
[cmdk-item][data-command-menu-empty-state=true][data-selected=true],
[cmdk-item][data-command-menu-empty-state=true][aria-selected=true],
[cmdk-item][data-command-menu-empty-state=true]:focus-visible,
[cmdk-item][data-command-menu-empty-state=true]:active {
  cursor: default;
  opacity: 1;
  background-color: #0000;                              /* empty 态不高亮 */
}
```

### 4.4 关键状态规则

- **default opacity 是 0.75，不是 1**：让 keyboard-selected 项"亮起来"形成对比
- **disabled 是 0.25**：比 loading 的 0.6 更暗，区分"不可用"与"加载中"
- **loading 与 empty 不高亮**：避免误以为可点击
- **active 与 hover 同色**：不做"按下变深"效果，简化状态空间

---

## 5. cmdk-list 与滚动

### 5.1 默认 List

```css
[cmdk-list] {
  max-height: min(300px, var(--cmdk-list-height, 300px));
  scrollbar-width: none;                                /* Firefox: 隐藏滚动条 */
  overscroll-behavior: contain;                         /* 防止滚动传播 */
  gap: var(--spacing);                                   /* 4px */
  min-height: 0;
  transition: max-height var(--transition-duration-basic) ease;
  flex-direction: column;
  display: flex;
  overflow-y: auto;
}

[cmdk-list]:focus-visible {
  outline: none;                                         /* 焦点环由 item 自身处理 */
}
```

### 5.2 Dialog 内 List

```css
.command-menu-dialog [cmdk-list] {
  max-height: var(--command-menu-list-max-height);       /* 使用 dialog 计算的高度 */
  scroll-padding-block-start: calc(var(--spacing) * 8);  /* 32px 顶部留白（键盘滚动定位） */
}
```

### 5.3 Composer Top Menu 内 List

```css
.composer-home-top-menu [cmdk-list] {
  max-height: none;                                      /* 不限高度 */
}

.composer-home-top-menu {
  max-height: min(320px, var(--composer-top-menu-max-height, 320px));
  overflow: hidden;
}
```

**关键模式**：当 list 处于受限容器（如 composer top menu）时，把高度限制从 list 移到外层容器。

### 5.4 滚动行为

- **`scrollbar-width: none`**：Firefox 隐藏滚动条（Webkit 通过 `::-webkit-scrollbar { display: none }` 隐藏）
- **`overscroll-behavior: contain`**：滚动到边界时不传播到父容器（避免触发父级滚动）
- **`scroll-padding-block-start: 32px`**：键盘选中项滚动到顶部时留 32px 上边距（避免贴边）

---

## 6. cmdk-input 输入框

### 6.1 几何

```css
[cmdk-input] {
  padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2.5);  /* 6px 10px */
}

[cmdk-input]:focus-visible {
  outline: none;                                         /* 无焦点环 — 始终有光标 */
}
```

### 6.2 设计要点

- **无 border、无 background**：input 是 list 的"延伸"，视觉上融为一体
- **无焦点环**：input 始终聚焦（光标闪烁），不需要焦点环提示
- **padding 比 item 大**：6px 10px vs item 的 `--padding-row-y --padding-row-x`，让 input 视觉更"重"
- **字号继承 root**：web 12px / Electron 14px

---

## 7. Empty State

```css
[cmdk-empty],
[data-cmdk-empty] {
  padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2.5);  /* 6px 10px */
  min-height: calc(var(--spacing) * 8);                              /* 32px */
  color: var(--color-token-description-foreground);                  /* 次级文字色 */
  white-space: pre-wrap;                                             /* 保留换行 */
  text-align: center;
  align-items: center;
  line-height: 1.4;
  display: flex;
}
```

**要点**：
- 使用 `--color-token-description-foreground`（次级文字色），不是 foreground
- `white-space: pre-wrap` 支持多行 empty 提示
- `text-align: center` + `align-items: center` 居中
- min-height 32px 保证视觉重量

---

## 8. Hotkey Window Home

### 8.1 容器结构

Hotkey Window Home 是**独立浮动窗口**，包裹 Composer 用于全局快捷唤起：

```
┌─── _homeShell_wq94q_39 (圆角 30px + 边框 + 内嵌高光) ───┐
│  ┌─── _shellUnderlay_wq94q_41 (绝对定位填充) ───┐       │
│  │                                              │       │
│  │  ┌─── _composerSurface_wq94q_43 ───┐        │       │
│  │  │  Composer（边框/圆角/阴影重置为 0）  │        │       │
│  │  └──────────────────────────────────┘        │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### 8.2 完整 CSS

```css
._home_wq94q_1 {
  --composer-top-tray-inline-padding: 12px;
  --composer-top-tray-top-padding: 14px;
  --hotkey-window-home-shell-radius: var(--radius-4xl);   /* 30px — 最大圆角 */
  --composer-top-tray-background:
    color-mix(in oklab, var(--color-token-side-bar-background) 94%, transparent);
  --composer-top-tray-border:
    color-mix(in srgb, var(--color-token-border) 72%, transparent);
  --hotkey-window-home-shell-shadow: inset 0 1px 0 #ffffff1a;  /* 顶部内嵌白光 */
  background: 0 0;
}

._homeShell_wq94q_39,
._shellUnderlay_wq94q_41,
._composerSurface_wq94q_43 {
  background: var(--composer-top-tray-background);
}

._homeShell_wq94q_39,
._shellUnderlay_wq94q_41 {
  border-radius: var(--hotkey-window-home-shell-radius);
}

._homeShell_wq94q_39 {
  border: 1px solid var(--composer-top-tray-border);
  box-shadow: var(--hotkey-window-home-shell-shadow);
}

._composerSurface_wq94q_43 {
  --composer-border-radius: 0px;                          /* 重置 Composer 圆角 */
  z-index: 1;
  -webkit-app-region: no-drag;                            /* Electron 拖拽区禁用 */
  border-radius: var(--composer-border-radius);
  box-shadow: none;
  border: none;
  position: relative;
}

._shellUnderlay_wq94q_41 {
  position: absolute;
  inset: 0;
}

body[data-hotkey-window-home-composer-menu-open] ._homeShell_wq94q_39,
body[data-hotkey-window-home-composer-menu-open] ._shellUnderlay_wq94q_41 {
  border-top-left-radius: 0;                              /* 菜单打开时去顶圆角 */
  border-top-right-radius: 0;
}
```

### 8.3 关键设计

| 维度 | 值 | 说明 |
|------|-----|------|
| 外壳圆角 | `--radius-4xl` (30px) | 比 Composer (25px) 更圆一档 |
| 外壳背景 | `color-mix(in oklab, sidebar-bg 94%, transparent)` | 半透明侧边栏色 |
| 外壳边框 | `color-mix(in srgb, border 72%, transparent)` | 半透明边框 |
| 顶部高光 | `inset 0 1px 0 #ffffff1a` | 模拟 Mac 原生窗口顶部光线 |
| Composer 重置 | `--composer-border-radius: 0px` | Composer 完全融入外壳 |
| 菜单打开态 | 去掉顶部圆角 | 让菜单"接续"外壳顶部 |

### 8.4 三层背景叠加

1. **`_homeShell`**：外壳，提供圆角 + 边框 + 顶部高光
2. **`_shellUnderlay`**：绝对定位填充层，提供背景色
3. **`_composerSurface`**：z-index:1，Composer 本体

这种三层结构让 Composer 的"无圆角无阴影"重置不破坏外壳的视觉完整性。

---

## 9. Quick Chat Window

### 9.1 滚动渐隐遮罩

```css
._headerScrollFade_44v1g_1 {
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    black var(--edge-fade-distance, 1rem),
    black 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    black var(--edge-fade-distance, 1rem),
    black 100%
  );
}
```

### 9.2 双向滚动遮罩（顶部 + 底部）

```css
._windowScrollMask_44v1g_31 {
  --quick-chat-window-footer-fade-height: calc(var(--spacing) * 5.5);  /* 22px */
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,                                                    /* 顶部 fade */
    black var(--edge-fade-distance, 1rem),
    black calc(100% - var(--quick-chat-footer-height, 0px)),           /* 内容区 */
    transparent calc(100% - var(--quick-chat-footer-height, 0px) + var(--quick-chat-window-footer-fade-height)),  /* 底部 fade */
    transparent 100%
  );
  mask-image: linear-gradient(/* 同上 */);
}

._scrollContent_44v1g_89 {
  padding-bottom: var(--quick-chat-footer-height, 0px);               /* 给 footer 留位 */
}
```

### 9.3 浮动表面

```css
._floatingSurface_1d7n0_13 {
  --quick-chat-floating-inset: calc(var(--spacing) * 1.5);            /* 6px */
  --quick-chat-floating-radius:
    calc(var(--radius-token-composer-single-line) + var(--quick-chat-floating-inset));  /* 22+6=28px */
  border-radius: var(--quick-chat-floating-radius);
}

._floatingComposerInset_1d7n0_31 {
  padding-inline: var(--quick-chat-floating-inset);
  padding-bottom: var(--quick-chat-floating-inset);
}
```

### 9.4 关键模式

- **mask-image 渐隐**：替代 box-shadow，性能更好，且支持非线性渐隐
- **CSS 变量驱动 footer 高度**：`--quick-chat-footer-height` 由 JS 注入实际高度
- **浮动圆角叠加**：`composer-single-line-radius (22px) + inset (6px) = 28px`，让浮动窗口比 Composer 更圆

---

## 10. Window Zoom 适配

### 10.1 zoom token

```css
/* 全局 token */
--codex-window-zoom: 1;  /* 默认 1，用户可调整为 0.8 / 1.25 / 1.5 等 */
```

### 10.2 zoom-aware 几何计算

cmdk 的所有尺寸都通过 `--codex-window-zoom` 缩放：

```css
.command-menu-dialog {
  /* 高度：先除以 zoom 还原为 CSS 像素，再被 zoom 整体缩放 */
  --command-menu-list-max-height:
    min(300px, max(120px, calc(90vh / var(--codex-window-zoom,1) - 64px)));

  /* 顶部偏移：除以 zoom */
  top: max(
    calc(var(--spacing) * 4 / var(--codex-window-zoom,1)),
    calc((100vh / var(--codex-window-zoom,1) - var(--command-menu-max-height)) / 2)
  );

  /* 宽度：除以 zoom */
  width: min(520px, calc(92vw / var(--codex-window-zoom,1)));

  /* 应用 zoom */
  zoom: var(--codex-window-zoom,1);
}
```

### 10.3 计算逻辑

1. **CSS 像素还原**：`90vh / zoom` 得到未缩放的 vh 值
2. **几何计算**：用未缩放值算 max-height / top / width
3. **应用 zoom**：`zoom: var(--codex-window-zoom)` 让整个 dialog 缩放

**好处**：zoom 后 dialog 仍然**居中**且**不超出视口**。

### 10.4 Quick Chat 的 zoom 处理

```css
._zoomedViewport_1d7n0_1 {
  height: calc(100vh / var(--codex-window-zoom));   /* 还原 CSS 像素 */
  width: calc(100vw / var(--codex-window-zoom));
  zoom: var(--codex-window-zoom);                   /* 整体缩放 */
}
```

---

## 11. 性能模式

### 11.1 content-visibility: auto

```css
[cmdk-item] {
  content-visibility: auto;   /* 屏幕外的 item 不渲染 */
}
```

**效果**：长列表（如全局命令面板 440px 高度）只渲染可见 item，不可见 item 跳过布局/绘制。配合 `min-height: 24px` 保证跳过渲染时仍占位。

### 11.2 transform: translateZ(0)

```css
[cmdk-root] {
  transform: translateZ(0);   /* 提升为合成层 */
}
```

**效果**：cmdk 容器独立合成层，动画/滚动不触发父级重绘。

### 11.3 overscroll-behavior: contain

```css
[cmdk-list] {
  overscroll-behavior: contain;   /* 滚动不传播 */
}
```

**效果**：list 滚动到边界时不触发 body / modal 的滚动，避免"双重滚动"问题。

### 11.4 scroll-padding-block-start

```css
.command-menu-dialog [cmdk-list] {
  scroll-padding-block-start: calc(var(--spacing) * 8);   /* 32px */
}
```

**效果**：键盘选中项滚动到顶部时，距离 list 顶部留 32px（不贴边），符合视觉舒适度。

---

## 12. 键盘导航

### 12.1 完整键位

| 键 | 行为 |
|----|------|
| `ArrowDown` | 选中下一项；当前是最后一项时回到第一项 |
| `ArrowUp` | 选中上一项；当前是第一项时回到最后一项 |
| `Home` | 跳到第一项 |
| `End` | 跳到最后一项 |
| `Enter` | 触发当前选中项的 `onSelect`；无选中项时不响应 |
| `Escape` | 关闭 cmdk |
| 字母 / 数字 | 进入 input，过滤 list |
| `Tab` | 在 input 与 list 之间切换焦点（不关闭 cmdk） |
| `Shift+Tab` | 反向 Tab |

### 12.2 焦点管理

- **打开时**：input 自动聚焦，光标在末尾
- **键盘选中时**：focus 留在 input，list item 通过 `[data-selected=true]` 标记（不是真 focus）
- **Tab 切换时**：focus 真正移到 list，此时 list item 通过 `:focus-visible` 高亮
- **关闭时**：focus 返回 trigger

### 12.3 与 Dropdown 键盘的区别

| 维度 | Dropdown | cmdk |
|------|----------|------|
| 焦点位置 | 真正移到 item | 留在 input，item 用 `data-selected` |
| 字母键 | 跳转到首字母匹配项 | 进入 input 过滤 |
| Tab | 关闭 dropdown | 切换焦点 |

---

## 13. 无障碍

### 13.1 ARIA 角色

```html
<div cmdk-dialog role="dialog" aria-modal="true" aria-label="Command menu">
  <div cmdk-root role="combobox" aria-expanded="true" aria-haspopup="listbox">
    <input cmdk-input role="textbox" aria-controls="cmdk-list" aria-activedescendant="{selected-id}" />
    <div cmdk-list role="listbox" id="cmdk-list" aria-label="Commands">
      <div cmdk-item role="option" id="{item-id}" aria-selected="true" aria-disabled="false">...</div>
    </div>
    <div cmdk-empty role="status" aria-live="polite">No results found</div>
  </div>
</div>
```

### 13.2 关键属性

| 属性 | 用途 |
|------|------|
| `role="dialog"` + `aria-modal="true"` | 屏蔽背景内容 |
| `role="combobox"` + `aria-expanded` | 表明可展开的输入控件 |
| `aria-activedescendant` | 指向当前键盘选中项（无需真 focus） |
| `role="listbox"` + `role="option"` | 列表语义 |
| `aria-selected` | 标记当前选中项 |
| `aria-disabled="true"` | 区分禁用与加载（加载不是禁用） |
| `role="status"` + `aria-live="polite"` | empty state 应该被读屏 |

### 13.3 reduced-motion

cmdk 本身动画极少（只有 list `max-height` 过渡），但仍需旁路：

```css
@media (prefers-reduced-motion: reduce) {
  [cmdk-list] {
    transition: none;
  }
}
```

---

## 14. Do / Don't

### ✅ Do

- 三种变体共享同一份 CSS，通过容器类名区分
- item 默认 opacity 0.75，selected 时 1.0，形成"亮起来"对比
- 使用 `content-visibility: auto` 优化长列表性能
- input 始终聚焦，键盘选中通过 `data-selected` 标记
- 几何计算除以 `--codex-window-zoom` 保证 zoom 后仍居中
- empty state 用 `--color-token-description-foreground` 次级色
- 滚动容器加 `overscroll-behavior: contain` 防止滚动传播
- Hotkey Window Home 三层结构（shell / underlay / surface）保证 Composer 重置不破坏外壳

### ❌ Don't

- **不要**给 cmdk-item 加 `cursor: pointer`，用 `--cursor-interaction` token（平台感知）
- **不要**让 disabled item 高亮（loading 是 0.6 + 透明，disabled 是 0.25 + 透明）
- **不要**用 `aria-busy="true"` 标记 loading，用 `data-command-menu-loading`（aria-busy 会停止屏幕阅读器）
- **不要**在 cmdk 内部嵌套 dropdown —— cmdk 本身就是 dropdown 的超集
- **不要**给 Quick Chat 的滚动 fade 用 box-shadow，用 `mask-image`（线性渐隐，性能更好）
- **不要**在 Hotkey Window Home 的 Composer 上保留默认圆角 —— 必须 `--composer-border-radius: 0px` 让其融入外壳
- **不要**忘记 `zoom: var(--codex-window-zoom)` —— 否则 zoom 模式下几何会错乱
- **不要**在 `[cmdk-list]:focus-visible` 加 outline —— 焦点环由 item 自身处理

---

## 15. 与 ClawX 的对齐建议

### 15.1 当前问题

- ClawX 没有统一 cmdk 实现，各处 dropdown 用 `cmdk` 库但样式散乱
- 缺少 process-manager 与 global-command-menu 的变体区分
- 没有处理 `--codex-window-zoom`，缩放后几何错乱

### 15.2 迁移建议

1. 引入 `cmdk-uRuhKLE-.css` 作为唯一 cmdk 样式源
2. 在 tokens.css 加 `--codex-window-zoom: 1` 默认值
3. 实现 `command-menu-dialog` / `global-command-menu-dialog` / `process-manager-dialog` 三种类名
4. 所有 item 必须支持 `data-selected` / `aria-selected` / `data-command-menu-loading` / `data-command-menu-empty-state` 四种状态
5. Hotkey Window Home 模式单独类（`.hotkey-window-home-shell`），不要复用 Composer 默认样式
