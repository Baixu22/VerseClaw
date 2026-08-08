---
doc: 15-conversation-rendering
name: Conversation Rendering System
category: Content
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-conversation-render/css-all/prettified/mermaid-diagram-shell-Bvc_FFGx.pretty.css
  - codex-conversation-render/02-assistant-message/prettified/markdown-DiI4eNZk.pretty.js
  - codex-conversation-render/02-assistant-message/prettified/code-snippet-CE90EJ2C.pretty.js
  - codex-conversation-render/02-assistant-message/prettified/copy-button-CLHBBPl_.pretty.js
  - codex-conversation-render/03-tool-calls/prettified/local-conversation-turn-DxDq8hHK.pretty.js
  - codex-conversation-render/03-tool-calls/prettified/tool-activity-disclosure-BE4gE6t7.pretty.js
  - codex-conversation-render/01-user-message/prettified/thread-scroll-layout-D6qiyxGb.pretty.js
  - codex-conversation-render/css-all/prettified/app-VS6Z-TiK.pretty.css
  - codex-conversation-render/css-all/prettified/thinking-shimmer-C-5BnEUj.pretty.css
  - codex-conversation-render/css-all/prettified/scroll-to-bottom-buton-CQcpasM2.pretty.css
  - codex-conversation-render/04-thinking-shimmer/cadencedShimmer-extracted.js
---

# 15 — Conversation Rendering System

> 对话渲染是 Codex 的核心产品表面。本文规定了 Markdown 渲染、代码块、Diff、流式文本、用户/助手气泡、工具调用、复制按钮和滚动行为的完整规范，所有值直接取自真实 Codex 源码（v26.715.52143）。

---

## 目录

1. [Markdown 渲染](#1-markdown-渲染)
2. [代码块](#2-代码块)
3. [Diff 渲染](#3-diff-渲染)
4. [流式文本渲染](#4-流式文本渲染)
5. [用户 vs 助手消息](#5-用户-vs-助手消息)
6. [工具调用渲染](#6-工具调用渲染)
7. [复制按钮](#7-复制按钮)
8. [滚动行为](#8-滚动行为)
9. [动画时序总表](#9-动画时序总表)

---

## 1. Markdown 渲染

### 1.1 容器

Markdown 根容器 `_markdownContent_l45ev_131` 建立本地排版上下文：

```css
._markdownContent_l45ev_131 {
  --markdown-font-size: var(--codex-chat-font-size);
  --markdown-line-height: calc(var(--markdown-font-size) + 8px);
  --text-primary: var(--color-token-text-primary);
  --border-medium: var(--color-token-border-heavy);
  --border-light: var(--color-token-border-light);
  --main-surface-secondary: var(--color-token-bg-secondary);
  --thread-content-max-width: 40rem;       /* 640px */
  color: var(--text-primary);
  font-size: var(--markdown-font-size);
  line-height: var(--markdown-line-height);
  overflow-wrap: anywhere;
}
._markdownContent_l45ev_131 > :first-child { margin-top: 0; }
._markdownContent_l45ev_131 > :last-child  { margin-bottom: 0; }
```

**关键 token**：
- `--markdown-font-size` 跟随 `--codex-chat-font-size`（可被用户缩放）
- `--markdown-line-height` = 字号 + 8px（14px 字号 → 22px 行高）
- `--thread-content-max-width: 40rem`（640px）是内容最大宽度

### 1.2 段落与块级元素

```css
._paragraph_l45ev_175, ._markdownBlock_l45ev_177 {
  margin: 0 0 .6875rem;    /* 11px 底边距 */
}
._markdownBlock_l45ev_177 { display: flow-root; }  /* 清除浮动 */
._markdownText_l45ev_193 {
  font-size: var(--markdown-font-size);
  line-height: var(--markdown-line-height);
}
._markdownTextSmall_l45ev_203 {
  font-size: 12px;
  line-height: 20px;
}
```

### 1.3 标题

```css
._heading_l45ev_235 {
  margin: 20px 0 10px;
  font-weight: 600;        /* semibold，标题唯一允许的加粗位 */
  line-height: 1.25;
}
._heading1_l45ev_247 { font-size: 24px; }
._heading2_l45ev_255 { font-size: 20px; }
._heading3_l45ev_263, ._heading4_l45ev_265 { font-size: 17px; line-height: 22px; }
._heading5_l45ev_275, ._heading6_l45ev_277 { font-size: 15px; line-height: 20px; }
```

| 层级 | 字号 | 行高 | 字重 |
|------|------|------|------|
| H1 | 24px | 1.25 | 600 |
| H2 | 20px | 1.25 | 600 |
| H3/H4 | 17px | 22px | 600 |
| H5/H6 | 15px | 20px | 600 |

### 1.4 列表

```css
._list_l45ev_287 {
  margin: 0;
  padding-inline-start: 1.3125rem;    /* 21px 缩进 */
  list-style-position: outside;
}
._unorderedList_l45ev_315 { list-style-type: disc; }
._list_l45ev_287 ._unorderedList_l45ev_315                { list-style-type: circle; }
._list_l45ev_287 ._list_l45ev_287 ._unorderedList_l45ev_315 { list-style-type: square; }
._orderedList_l45ev_339 { list-style-type: decimal; }
._taskList_l45ev_347    { padding-inline-start: 0; list-style-type: none; }

._listItem_l45ev_357    { padding-inline-start: .125rem; display: list-item; }
._listItem_l45ev_357 + ._listItem_l45ev_357 { margin-top: .5rem; }  /* 8px 项间距 */
```

**列表 marker 颜色**：继承 `--text-primary`（与正文同色）。

**列表与段落间距规则**：
```css
._markdownContent_l45ev_131 > p:has(+ ._list_l45ev_287) { margin-bottom: .625rem; }  /* 10px */
._markdownContent_l45ev_131 > ._list_l45ev_287 + p      { margin-top: 1rem; }        /* 16px */
```

### 1.5 引用块

```css
._blockquote_l45ev_465 {
  color: var(--text-primary);
  background-color: transparent;
  border: 0;
  margin: 0 0 8px;
  padding-block: 8px;
  padding-inline-start: 24px;
  font-style: normal;          /* 引用不加斜体 */
  line-height: 24px;
  position: relative;
}
/* 左侧强调条 */
._blockquote_l45ev_465:after {
  content: "";
  inset-inline-start: 0;
  background-color: var(--border-medium);   /* --color-token-border-heavy */
  border-radius: 2px;
  width: 4px;
  position: absolute;
  top: 8px;
  bottom: 8px;
}
```

### 1.6 分隔线

```css
._horizontalRule_l45ev_547 {
  clear: both;
  border: 0;
  border-top: 1px solid var(--border-medium);   /* 1px hairline */
  height: 0;
  margin: 28px 0;
}
```

### 1.7 表格

表格采用可横向滚动设计，支持列宽分级：

```css
._tableContainer_l45ev_571 {
  width: calc(100% + (var(--thread-content-margin, 24px) * 2));
  margin-inline: calc(var(--thread-content-margin, 24px) * -1);
  scrollbar-width: thin;
  overflow-x: auto;
}
._table_l45ev_571 {
  width: fit-content;
  min-width: min(calc(100cqw - 48px), var(--thread-content-max-width, 40rem));
  border-collapse: separate;
  border-spacing: 0;
  table-layout: auto;
  font-size: 14px;
}
._tableHeaderCell_l45ev_673 {
  border-bottom: 1px solid var(--border-medium);
  color: var(--text-primary);
  padding: 8px 0;
  font-weight: 600;
  line-height: 16px;
}
._tableCell_l45ev_665 {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);   /* 行间分隔线 */
}
```

**列宽分级**（24 列网格）：

| 尺寸标记 | min-width | max-width |
|----------|----------|-----------|
| `sm` | `40rem * 4/24` | `40rem * 6/24` |
| `md` | `40rem * 6/24` | `40rem * 8/24` |
| `lg` | `40rem * 8/24` | `40rem * 12/24` |
| `xl` | `40rem * 14/24` | `40rem * 18/24` |

### 1.8 链接

```css
/* 默认态 */
color: var(--color-token-text-secondary);
text-decoration: underline dotted;
text-decoration-thickness: 0.5px;
text-underline-offset: 4px;
text-decoration-color: var(--color-token-text-tertiary);

/* 悬停态 */
color: var(--color-token-text-primary);
text-decoration-color: var(--color-token-text-primary);

/* 聚焦态 */
outline: 1px solid var(--color-token-focus-border);
outline-offset: 2px;
```

### 1.9 行内代码

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
  font-size: .92em;          /* 比正文小 8% */
  display: inline;
}
```

**Do**：行内代码背景用 `color-mix` 叠加，不用固定 hex。
**Don't**：不要给行内代码加边框——只有背景。

---

## 2. 代码块

### 2.1 容器结构

```tsx
<div className="relative w-full min-w-0 overflow-clip rounded-lg
     bg-token-text-code-block-background contain-inline-size dark"
     data-markdown-copy="code-block"
     data-theme="dark|light">
  {/* Header */}
  <div className="flex items-center py-1 pe-2 ps-2 font-sans text-sm
       text-token-description-foreground select-none rounded-t-lg"
       data-markdown-copy="exclude">
    <div className="min-w-0 flex-1 truncate">{title || language}</div>
    <div className="ml-auto flex shrink-0 items-center gap-px">
      {/* Wrap toggle + Copy button */}
    </div>
  </div>
  {/* Content */}
  <div className="text-size-chat overflow-auto p-2" dir="ltr">
    <code className="whitespace-pre!">{highlightedHtml}</code>
  </div>
</div>
```

### 2.2 关键 token

| Token | Dark 值 | Light 值 |
|-------|---------|----------|
| `--color-token-text-code-block-background` | `var(--gray-800)` = `#212121` | `var(--gray-50)` = `#f9f9f9` |
| `--color-token-description-foreground` | `var(--gray-300)` = `#afafaf` | — |

### 2.3 圆角与尺寸

- 容器圆角：`rounded-lg` = **12.5px**（`--radius-lg`）
- `overflow-clip`：超出部分裁剪，不滚动
- `contain-inline-size`：CSS Containment，优化性能

### 2.4 代码占位（高亮加载前）

```css
._codeBlockPlaceholder_l45ev_775 {
  border-radius: var(--radius-lg);
  background: var(--color-token-text-code-block-background);
  font-size: var(--codex-chat-code-font-size);
  padding: 8px;
  line-height: 20px;
  overflow-x: auto;
}
._codeBlock_l45ev_749 { margin-block: 14px; }
```

### 2.5 语法高亮

- **引擎**：Shiki（动态 import `highlight-code-IUEcEehV.js`）
- **主题**：`codex-dark-DgyInWLc.js` / `codex-light-CVyGr2nP.js`
- **防抖**：`120ms`（`ue = 120`）
- **懒加载**：`IntersectionObserver` + `rootMargin: "600px 0px"`（视口外 600px 开始加载）
- **分行渲染**：高亮 HTML 按 `\n` 拆分，每行一个 `<span dangerouslySetInnerHTML>`

### 2.6 行号

**代码块不渲染显式行号**。高亮 HTML 按行拆分后直接渲染，行号依赖编辑器上下文（非对话内）。

### 2.7 换行切换

- 默认：`whitespace-pre!`（不换行，横向滚动）
- 开启换行：`whitespace-pre-wrap!`
- 按钮颜色 `ghost`，`size: "icon"`
- Tooltip：`codeSnippet.wrap.enable` / `codeSnippet.wrap.disable`

---

## 3. Diff 渲染

### 3.1 Diff 颜色 Token

**Dark 主题**：

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-decoration-added` | `var(--green-300)` = `#40c977` | 添加行前景/gutter |
| `--color-decoration-deleted` | `var(--red-400)` = `#fa423e` | 删除行前景/gutter |
| `--color-decoration-modified` | `var(--orange-300)` = `#ff8549` | 修改行前景 |
| `--color-decoration-unchanged` | `var(--gray-600)` = `#414141` | 未变行前景 |
| `--color-editor-added` | `#40c9773b`（green-300 @ 23%） | 添加行背景 |
| `--color-editor-deleted` | `#fa423e3b`（red-400 @ 23%） | 删除行背景 |

**Light 主题**：

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-decoration-added` | `var(--green-500)` = `#00a240` | 添加行前景 |
| `--color-decoration-deleted` | `var(--red-600)` = `#ba2623` | 删除行前景 |
| `--color-editor-added` | `#00a24026`（green-500 @ 15%） | 添加行背景 |
| `--color-editor-deleted` | `#ba262326`（red-600 @ 15%） | 删除行背景 |

### 3.2 VS Code Diff Editor Token 桥接

```css
--vscode-diffEditor-insertedTextBackground:  var(--color-editor-added);
--vscode-diffEditor-removedTextBackground:   var(--color-editor-deleted);
--vscode-diffEditor-insertedLineBackground:  var(--color-editor-added);
--vscode-diffEditor-removedLineBackground:   var(--color-editor-deleted);
```

### 3.3 Turn-Diff 行（对话级 diff 入口）

```tsx
<div className="text-size-chat flex h-9 w-full cursor-interaction items-center gap-2
     border-b border-token-border bg-token-dropdown-background
     py-[var(--turn-diff-row-padding-y)] text-left
     hover:bg-token-list-hover-background/30
     focus-visible:ring-1 focus-visible:ring-token-focus-border
     focus-visible:outline-none focus-visible:ring-inset">
```

- 行高：`h-9` = 36px
- `--turn-diff-row-padding-y: 0.25rem`（4px）
- `--codex-diffs-header-padding-y: var(--turn-diff-row-padding-y)`

### 3.4 Diff 统计

使用 `diff-stats-BT6xrs4T.js` 组件，props `linesAdded` + `linesRemoved`，className `shrink-0`。

---

## 4. 流式文本渲染

### 4.1 淡入交错引擎（Stagger Engine）

流式文本段逐段淡入，每段设置 CSS 变量 `--fade-delay`：

**时间线状态**：
```js
{
  delayMsByKey: new Map(),      // 每段的延迟记录
  nextSegmentStartAtMs: 0,       // 下一段开始时间
  settledKeys: new Set()          // 已完成的段
}
```

**延迟计算**：
```js
// 基础延迟 = 段索引 × 每段延迟
r = segmentIndex * fadeSegmentDelayMs;

// 超过最大延迟后的压缩逻辑
if (r > fadeSegmentMaxDelayMs) {
  r = fadeSegmentMaxDelayMs +
      (segmentIndex - Math.floor(fadeSegmentMaxDelayMs / fadeSegmentDelayMs)) * ET(...);
}
```

**段时长（ET）**：
- 未超上限：`fadeSegmentDelayMs`
- 超上限后：`Math.max(1ms, fadeSegmentDelayMs * 0.25)` — 后续段以 25% 速度运行

### 4.2 淡入 CSS

```css
@keyframes _fade-in_l45ev_1 { to { opacity: 1; } }

._markdownRoot_l45ev_871 ._fadeIn_l45ev_871,
._markdownRoot_l45ev_871 hr,
._markdownRoot_l45ev_871 li,
._markdownRoot_l45ev_871 tr,
._markdownRoot_l45ev_871 blockquote {
  opacity: 0;
  animation: _fade-in_l45ev_1
    var(--duration, var(--transition-duration-basic))
    var(--fade-easing, cubic-bezier(.37, .55, .86, .88)) forwards;
  animation-delay: var(--fade-delay, 0s);
}
```

| 参数 | 值 |
|------|-----|
| duration | `var(--transition-duration-basic)` = 0.15s |
| easing | `cubic-bezier(.37, .55, .86, .88)` |
| delay | `var(--fade-delay)` — 由 JS 引擎逐段设置 |
| fill-mode | `forwards` |

**列表 marker 淡入**：
```css
._markdownRoot_l45ev_871 ._fadeListDecoration_l45ev_893::marker {
  animation: _fade-in-marker_l45ev_1
    var(--duration) var(--fade-easing) forwards;
  animation-delay: var(--fade-delay, 0s);
}
@keyframes _fade-in-marker_l45ev_1 { 0% { color: transparent; } }
```

**图片入场**：
```css
._markdownRoot_l45ev_871 ._imageEnter_l45ev_905 {
  transform-origin: 50%;
  animation: .18s ease-out both _image-enter_l45ev_1;
}
@keyframes _image-enter_l45ev_1 {
  0% { opacity: 0; transform: scale(.98); }
  to { opacity: 1; transform: scale(1); }
}
```

### 4.3 节奏式 Shimmer（Thinking 指示器）

节奏式 shimmer 是"思考中"的文本动画，不是连续 shimmer，而是每 4 秒扫一次：

**DOM 结构**：
```html
<span class="loading-shimmer-pure-text _cadencedShimmer_9d9bl_1">
  {children}
  <span aria-hidden class="_cadencedShimmerSweep_9d9bl_45">
    <span class="_cadencedShimmerHighlight_9d9bl_33">{children}</span>
  </span>
</span>
```

**CSS**：
```css
._cadencedShimmer_9d9bl_1 {
  color: var(--shimmer-text-secondary);
  position: relative;
}
._cadencedShimmerSweep_9d9bl_45 {
  pointer-events: none;
  position: absolute;
  inset: 0;
  transform: translate(-50%);
  mask-image: linear-gradient(90deg, #0000 0%, #000 20% 30%, #0000 50% 100%);
}
._cadencedShimmerHighlight_9d9bl_33 {
  color: var(--shimmer-contrast);
  transform: translate(50%);
}
._cadencedShimmerActive_9d9bl_111 ._cadencedShimmerSweep_9d9bl_45,
._cadencedShimmerActive_9d9bl_111 ._cadencedShimmerHighlight_9d9bl_33 {
  animation-duration: 1s;
  animation-timing-function: steps(48, end);
  animation-iteration-count: 1;
}
@keyframes _cadencedLoadingShimmerSweep_9d9bl_1     { 0% { transform: translate(-50%); } to { transform: translate(125%); } }
@keyframes _cadencedLoadingShimmerHighlight_9d9bl_1 { 0% { transform: translate(50%); }  to { transform: translate(-125%); } }
```

**JS 时间常量**：
```js
Noc = 1000;  // ms — 单次扫光持续时间
Poc = 4000;  // ms — setInterval 周期（每 4 秒扫一次）
Foc = 600;   // ms — 首次扫光前的延迟
```

**时间线**：
```
t=0ms     挂载
t=600ms   首次扫光开始（添加 active class）
t=1600ms  首次扫光结束（移除 active）
t=4600ms  第二次扫光
t=5600ms  第二次扫光结束
...       每 4000ms 重复
```

### 4.4 写作块 Shimmer（CoT 流式文本）

```css
--shimmer-contrast: var(--oai-wb-text-tertiary);
--shimmer-text-secondary: var(--oai-wb-text-secondary);
--cot-shimmer-duration: 2s;

background-size: 50% 200%;
background-position: -100% 0;
animation: _writingBlockLoadingShimmer_11vxc_1 var(--cot-shimmer-duration, 2s) infinite;

@keyframes _writingBlockLoadingShimmer_11vxc_1 {
  0% { background-position: -100% 0; }
  to { background-position: 250% 0; }
}
```

### 4.5 加载结果 Shimmer

```css
._loadingResultsShimmer_h3w7l_1 {
  --loading-results-shimmer-base:
    color-mix(in srgb, var(--color-token-description-foreground) 10%, transparent);
  --loading-results-shimmer-highlight:
    color-mix(in srgb, var(--color-token-description-foreground) 16%, transparent);
  background-color: var(--loading-results-shimmer-base);
  overflow: hidden;
}
._loadingResultsShimmer_h3w7l_1:before {
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
}
@keyframes _loadingResultsShimmer_h3w7l_1 {
  0% { transform: translate(-100%); }
  to { transform: translate(100%); }
}
```

---

## 5. 用户 vs 助手消息

### 5.1 用户消息气泡

```tsx
{/* 外层容器 — 居中对齐 */}
<div className="flex w-full max-w-(--thread-content-max-width) min-w-0 justify-center">
  {/* 动效容器 */}
  <div className="relative z-10 max-w-full min-w-0 overflow-hidden rounded-3xl">
    {/* 气泡本体 */}
    <div className="flex w-max max-w-full min-w-0 items-center gap-2
         rounded-3xl border border-token-border/80
         bg-token-input-background/70
         px-3 py-1.5
         text-token-foreground
         backdrop-blur-sm"
         data-user-message-bubble>
      {content}
    </div>
  </div>
</div>
```

| 属性 | 值 | 说明 |
|------|-----|------|
| 圆角 | `rounded-3xl` = 25px | 胶囊形 |
| 边框 | `border-token-border/80` | 80% 透明度 |
| 背景 | `bg-token-input-background/70` | 70% 透明度 |
| padding | `px-3 py-1.5` = 12px / 6px | 紧凑 |
| 模糊 | `backdrop-blur-sm` = 4px | 玻璃质感 |
| 宽度动效 | Framer Motion `animate(width)` 0.2s `easeOut` | 内容变化时平滑过渡 |

### 5.2 助手消息（无气泡）

助手消息 **不使用气泡**，直接渲染 Markdown：

```tsx
<div className="flex flex-col gap-0
     [contain-intrinsic-size:auto_240px]
     [content-visibility:auto]
     [&:has([data-mcp-app-expanded='true'])]:[content-visibility:visible]"
     data-local-conversation-final-assistant>
  <MarkdownContent />
</div>
```

**关键特性**：
- `content-visibility: auto` + `contain-intrinsic-size: auto 240px` — 虚拟化渲染，视口外不渲染
- 无背景、无边框、无圆角 — 全宽内联文本

### 5.3 对话线程根容器

```tsx
<div className="relative flex flex-col gap-3
     electron:[--color-token-description-foreground:color-mix(in_srgb,var(--color-token-foreground)_70%,transparent)]"
     data-thread-find-target="conversation">
```

- 子项间距：`gap-3` = 12px
- Electron 下描述色降为前景色 70%

---

## 6. 工具调用渲染

### 6.1 工具活动容器

```tsx
<div className="min-w-0 text-size-chat py-0">
  {/* 头部（可折叠） */}
  <button className="group/activity-header inline-flex min-w-0 max-w-full
       self-start items-center gap-1 p-0 text-left cursor-interaction"
       aria-expanded={expanded}>
    <Chevron className="icon-2xs shrink-0 text-token-conversation-body
         opacity-0 group-focus-visible/activity-header:opacity-100
         transition-transform duration-relaxed
         [@media(hover:hover)]:group-[:hover]:opacity-100" />
    <span className="text-size-chat shrink truncate text-token-conversation-body">
      {summary}
    </span>
  </button>
  {/* 折叠体 */}
  <div className="flex min-w-0 flex-col">
    {details}
  </div>
</div>
```

### 6.2 折叠箭头动效

- 默认 `opacity-0`（隐藏）
- 悬停 / 聚焦时 `opacity-100`
- 展开时 `rotate-90`
- 过渡：`transition-transform duration-relaxed`（0.3s）

### 6.3 MCP 工具调用

```tsx
// 过滤 mcp-tool-call 类型
items.filter(item => item.type === "mcp-tool-call")

// 渲染组件 props
{
  conversationId,
  hostId,
  item,              // 包含 invocation.server, invocation.tool
  matchingApp,
  mcpAppId
}

// 结果类型检查
item.result?.type === "success"
```

### 6.4 工具结果悬停色

```css
/* 头部悬停时，非文件链接的子元素全部变前景色 */
[@media(hover:hover)]:group-[:hover:not(:has([data-agent-activity-file-link]:hover))]/activity-header:!text-token-foreground
[@media(hover:hover)]:group-[:hover:not(:has([data-agent-activity-file-link]:hover))]/activity-header:[&_*:not(button)]:!text-token-foreground
```

---

## 7. 复制按钮

### 7.1 组件规范

```tsx
<CopyButton
  iconClassName="icon-xs"       // 代码块用 icon-xs
  iconOnly={true}                // 代码块：仅图标
  onCopy={handleCopy}
  ariaLabel={copied ? "Copied" : "Copy"}
/>
```

### 7.2 行为时序

```js
// 点击
e.stopPropagation();
onCopy(e);
setCopied(true);
setTimeout(() => {
  if (stillMounted) setCopied(false);
}, 2000);    // 2 秒后重置
```

### 7.3 图标切换

| 状态 | 图标 | 来源 |
|------|------|------|
| 未复制 | copy 图标 | `copy-ZZgOnVKL.js` |
| 已复制 | check 图标 | `check-md-BDgYl1ny.js` |

### 7.4 复制时颜色

```js
const copiedClassName = copied && "text-token-foreground";  // 复制后变前景色
```

### 7.5 Tooltip 与 ARIA

| 状态 | Tooltip | aria-label |
|------|---------|------------|
| 未复制 | `copyButton.copy` ("Copy") | `copyButton.copyAriaLabel` |
| 已复制 | `copyButton.copied` ("Copied") | `copyButton.copiedAriaLabel` |

**iconOnly 模式下 Tooltip 禁用**（`j = !iconOnly`）。

### 7.6 代码块复制逻辑

```js
function handleCopy(e) {
  if (e.defaultPrevented) return;
  e.preventDefault();
  e.stopPropagation();
  const text = window.getSelection()?.toString();
  if (text) copyToClipboard(text, e);
}
```

---

## 8. 滚动行为

### 8.1 滚动容器 API

```ts
interface ScrollContext {
  scrollToBottom: () => void;                              // 平滑滚到底
  addScrollListener: (cb) => void;                         // 注册偏移监听
  addUserScrollListener: (cb) => void;                    // 注册用户滚动监听
  compensateScrollToDistanceFromBottomPx: (px) => void;   // 即时滚动到指定偏移
  getLastScrollDistanceFromBottomPx: () => number;         // 当前距底距离
  getScrollElement: () => HTMLElement;                    // 获取滚动 DOM
  isScrolledFromBottom: () => boolean;                    // 是否滚离底部
  preserveScrollPositionForNextLayout: () => void;        // 内容变化时保持位置
  scrollToDistanceFromBottomPx: (px, behavior) => void;  // 滚到指定距离
  setFooterResizeViewportPreserveDisabled: (bool) => void;
}
```

### 8.2 "在底部"阈值

```js
const AT_BOTTOM_THRESHOLD = 24;   // px — 距底 ≤24px 视为"在底部"
```

### 8.3 滚到底部动画

```js
const DURATION = 260;   // ms
const easing = (a) => 1 - (1 - a) ** 3;   // cubic ease-out

function scrollToBottom() {
  if (distanceFromBottom <= 24) {
    scrollEl.scrollTo({ behavior: "instant", top: 0 });
    stopAutoScroll();
    return;
  }
  startAutoScroll();
  const startTime = performance.now();
  function frame(now) {
    const progress = Math.min(1, (now - startTime) / DURATION);
    const eased = easing(progress);
    setScrollTop(currentTop * (1 - eased));
    if (progress < 1) requestAnimationFrame(frame);
    else { setScrollTop(0); stopAutoScroll(); }
  }
  requestAnimationFrame(frame);
}
```

| 参数 | 值 |
|------|-----|
| 动画时长 | 260ms |
| 缓动函数 | `1 - (1-a)³`（cubic ease-out） |
| 帧机制 | `requestAnimationFrame` |
| 阈值 | 24px |

### 8.4 滚动位置保持

内容高度变化时（如流式追加），保持用户滚动位置：

```js
function preserveScrollPosition() {
  const { distanceFromBottomPx, scrollHeightPx } = capture();
  requestAnimationFrame(() => {
    scrollTo({
      behavior: "instant",
      top: distanceFromBottomPx + wheelDistanceFromBottomPx
    });
  });
}
```

### 8.5 滚到底部按钮

```tsx
<button className="cursor-interaction absolute z-30
     flex h-8 w-8 translate-x-1/2
     items-center justify-center
     rounded-full
     border border-token-border-default
     bg-token-main-surface-primary bg-clip-padding
     text-token-text-secondary
     transition-opacity duration-basic ease-in-out
     end-1/2 print:hidden
     bottom-[calc(100%+6*var(--spacing))]"   /* 距 composer 24px */
     aria-hidden={!visible}
     tabIndex={visible ? undefined : -1}>
  {showWorkingDots ? <WorkingDots /> : <ArrowUp className="icon rotate-180" />}
</button>
```

| 属性 | 值 |
|------|-----|
| 尺寸 | 32×32px |
| z-index | 30 |
| 圆角 | `rounded-full` |
| 位置 | composer 上方 24px |
| 过渡 | opacity + duration-basic |
| 隐藏态 | `pointer-events-none opacity-0` |
| 打印 | `print:hidden` |

### 8.6 工作点动画（Working Dots）

三个点的波浪动画：

```css
._waveDot_99dwr_43 {
  width: 1px;
  height: 1px;
  border-radius: 50%;
  background: var(--color-token-text-primary);
  opacity: 0.7;
}

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

**注意**：工作点动画只在 `prefers-reduced-motion: no-preference` 下启用 — 这是 **opt-in** 策略而非 opt-out。

---

## 9. 动画时序总表

| 动画 | 时长 | 缓动 | 迭代 | 延迟 |
|------|------|------|------|------|
| Markdown 段淡入 | 0.15s | `cubic-bezier(.37,.55,.86,.88)` | 1 (forwards) | `var(--fade-delay)` |
| 图片入场 | 0.18s | ease-out | 1 (both) | — |
| 节奏 shimmer 扫光 | 1s | `steps(48, end)` | 1 | 600ms 初次，4000ms 周期 |
| 写作块 shimmer | 2s | linear | infinite | — |
| 加载结果 shimmer | 3s | linear | infinite | `var(--loading-results-shimmer-delay)` |
| 工作点波浪 | 1s | ease-in-out | infinite | 0s / 0.1s / 0.2s |
| 滚到底部 | 260ms | `1-(1-a)³` | 1 (rAF) | — |
| 用户气泡宽度 | 0.2s | easeOut | 1 | — |
| 复制按钮重置 | 2000ms (setTimeout) | — | 1 | — |
| Stagger 后压缩段 | `max(1ms, delay×0.25)` | — | — | 逐段 |

**所有动画在 `prefers-reduced-motion: reduce` 下**：
- duration → 0s
- opacity → 1
- transform → scale(1) / none
- animation-delay → 0s !important

---

## Do / Don't

### Do
- 用 `color-mix(in oklab)` 做行内代码背景，不用固定 hex
- 代码块用 Shiki + `IntersectionObserver(rootMargin: 600px)` 懒加载
- 流式文本用 stagger 引擎逐段淡入，设 `--fade-delay` CSS 变量
- 节奏 shimmer 每 4 秒扫一次，不是连续 shimmer
- 用户气泡用 `rounded-3xl` + `backdrop-blur-sm` + 70% 透明度
- 助手消息不用气泡，直接全宽 Markdown
- 滚动到底部用 260ms cubic ease-out + rAF
- 复制按钮 2 秒后自动重置图标

### Don't
- 不要给代码块加行号（对话内代码块不需要）
- 不要让流式文本全部同时淡入 — 必须交错
- 不要在 `prefers-reduced-motion: reduce` 下保留 shimmer — 必须同时禁用 `animation` 和 `background-image`
- 不要用连续 shimmer 替代节奏 shimmer — 后者是"思考中"的特有节奏
- 不要给助手消息加气泡或背景 — 它是纯内容
- 不要在滚动动画里用 `setTimeout` — 必须用 `requestAnimationFrame`
