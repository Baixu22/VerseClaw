---
doc: 20-onboarding-first-run-experience
name: Onboarding, First-Run, Content Transitions & Code Highlighting
category: Patterns
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/tokens.css
  - codex-reference/css/onboarding-page-DMMT1hQC.css
  - codex-reference/css/app-main-DtaE1-1W.css
  - codex-reference/css/app-shell-DJDX7Pvr.css
  - codex-reference/css/markdown-BjJBLRLf.css
  - codex-reference/css/at-mention-list-BAjTVsT9.css
  - codex-pure-source/runtime-dom/stylesheets-rules.json
  - codex-design-system.css
---

# 20 — Onboarding, First-Run, Content Transitions & Code Highlighting

> 首次启动 / 引导 / 内容过渡 / 代码高亮是 Codex "第一印象" 的四大支柱。本文规范引导箭头动画、Codex↔ChatGPT 内容过渡、首次启动几何、`hljs` 代码高亮 token、侧边栏滚动渐隐遮罩、Toast 与 Curtain 的入场/出场编排。
>
> 这些场景共同构成 **从冷启动到首次价值产出** 的视觉叙事，是 enterprise 产品最容易被忽视但最影响留存的部分。

---

## 目录

1. [设计哲学](#1-设计哲学)
2. [引导箭头动画](#2-引导箭头动画)
3. [内容过渡 — Codex↔ChatGPT 切换](#3-内容过渡--codexchatgpt-切换)
4. [首次启动几何](#4-首次启动几何)
5. [代码高亮系统](#5-代码高亮系统)
6. [侧边栏滚动渐隐遮罩](#6-侧边栏滚动渐隐遮罩)
7. [Toast 入场 / 出场](#7-toast-入场--出场)
8. [Curtain 升降动画](#8-curtain-升降动画)
9. [入场动画编排](#9-入场动画编排)
10. [Reduced Motion 策略](#10-reduced-motion-策略)
11. [Do / Don't](#11-do--dont)

---

## 1. 设计哲学

### 1.1 三阶段引导叙事

Codex 的"第一印象"分为三阶段：

| 阶段 | 时间窗 | 主要元素 | 视觉策略 |
|------|--------|----------|----------|
| **冷启动** | 0-300ms | Canvas + 应用外壳 | 灰阶 canvas + 立即可见的 header tint |
| **首次引导** | 300ms-2s | 引导箭头 + 引导卡 | 1s 弹跳动画吸引注意，不强阻断 |
| **价值产出** | 2s+ | Composer + 对话内容 | 0.26s 内容渐入，无障碍焦点立即可用 |

### 1.2 与 Airtable 风格引导的对比

- **Airtable**：大图 + 多步引导遮罩 + "Skip" 按钮（强阻断）
- **Codex**：箭头弹跳 + 渐入过渡 + 立即可用（弱阻断）

Codex 选择"不打扰"策略：**让用户立即能开始打字**，引导只是"提示存在"，不强制走完流程。

---

## 2. 引导箭头动画

### 2.1 完整 CSS

```css
._uacArrow_1tl1k_1 {
  filter: drop-shadow(0 2px 2px #0000003d);                /* 投影增强可见性 */
  animation: 1s ease-in-out infinite alternate _uac-arrow-bounce_1tl1k_1;
}

@keyframes _uac-arrow-bounce_1tl1k_1 {
  to {
    transform: translateY(-4px);                            /* 上移 4px */
  }
}

@media (prefers-reduced-motion: reduce) {
  ._uacArrow_1tl1k_1 {
    animation: none;                                        /* 关闭动画 */
  }
}
```

### 2.2 设计要点

| 维度 | 值 | 说明 |
|------|-----|------|
| 持续时间 | `1s` | 比 default 0.15s 慢得多，吸引注意 |
| 缓动 | `ease-in-out` | 对称缓动，进出对称 |
| 模式 | `infinite alternate` | 往返循环（前进后退） |
| 位移 | `-4px` | 上移 4px（轻微，不刺眼） |
| 投影 | `drop-shadow(0 2px 2px #0003d)` | 半透明黑色投影 |
| reduced-motion | `animation: none` | 完全关闭，保留静态状态 |

### 2.3 为什么用 `alternate` 而不是 `alternate-reverse`

- `alternate`：第一帧从 0%（默认位置）开始，第二帧到 100%（上移）
- `alternate-reverse`：第一帧从 100%（上移）开始

`alternate` 让动画从"静止位置"开始，符合"箭头本来在那里，然后弹一下"的直觉。

### 2.4 为什么用 `drop-shadow` 而不是 `box-shadow`

`drop-shadow` 跟随 SVG 路径形状（如箭头三角形），`box-shadow` 只跟随盒模型矩形。对于不规则形状的图标必须用 `drop-shadow`。

---

## 3. 内容过渡 — Codex↔ChatGPT 切换

### 3.1 完整 CSS

```css
._contentEnter_1twe3_17 {
  animation: .26s cubic-bezier(.16, 1, .3, 1) both _codex-to-chatgpt-content-in_1twe3_1;
}

._contentExit_1twe3_27 {
  animation: .18s cubic-bezier(.4, 0, 1, 1) both _codex-to-chatgpt-content-out_1twe3_1;
}

@keyframes _codex-to-chatgpt-content-in_1twe3_1 {
  0% {
    opacity: 0;
    translate: -50% calc(8px - 50%);    /* 下移 8px（基于 transform: translate(-50%, -50%) 居中） */
    scale: .98;                          /* 缩小 2% */
  }
  to {
    opacity: 1;
    translate: -50% -50%;                /* 回到居中位置 */
    scale: 1;                            /* 原始大小 */
  }
}

@keyframes _codex-to-chatgpt-content-out_1twe3_1 {
  0% {
    opacity: 1;
    translate: -50% -50%;
    scale: 1;
  }
  to {
    opacity: 0;
    translate: -50% calc(4px - 50%);    /* 下移 4px（比 enter 位移减半） */
    scale: .99;                          /* 缩小 1%（比 enter 缩放减半） */
  }
}
```

### 3.2 关键时序差异

| 维度 | Enter | Exit |
|------|-------|------|
| 持续时间 | `0.26s` | `0.18s` |
| 缓动 | `cubic-bezier(.16, 1, .3, 1)` (强减速) | `cubic-bezier(.4, 0, 1, 1)` (加速) |
| 位移 | `8px` | `4px` |
| 缩放 | `.98` | `.99` |
| `both` fill-mode | 是 | 是 |

### 3.3 不对称设计原理

- **Enter 慢（0.26s） + 减速**：内容"沉下来"的感觉，吸引用户注意
- **Exit 快（0.18s） + 加速**：内容"消失"的感觉，不阻碍下一步
- **位移减半**：exit 不需要大幅移动，避免视觉抖动
- **缩放减半**：exit 不需要明显缩放，避免"塌陷"感

### 3.4 `translate` 属性 vs `transform: translate()`

Codex 用 `translate: -50% -50%` 而不是 `transform: translate(-50%, -50%)`，因为：

- `translate` 是独立属性，不与 `transform` 冲突
- 可以同时用 `transform: scale()` 而不覆盖 `translate`
- 现代浏览器支持，性能更好（独立合成）

---

## 4. 首次启动几何

### 4.1 应用根容器

```css
._root_13iv5_1 {
  background-color: var(--gray-75);                       /* 浅灰底（启动时） */
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.electron-dark ._root_13iv5_1 {
  background-color: var(--color-token-dropdown-background);  /* 暗色：dropdown 色 */
}
```

### 4.2 Canvas 与 Fallback

```css
._canvas_13iv5_23 {
  width: 100%;
  height: 100%;
  display: block;
}

._fallback_13iv5_35 {
  width: 83px;
  height: 83px;
  color: var(--color-token-foreground);
  opacity: .7;                                            /* 70% 透明度，不抢眼 */
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);                       /* 居中 */
}

._interactionTarget_13iv5_57 {
  width: 83px;
  height: 83px;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);                       /* 与 fallback 同位 */
}
```

### 4.3 启动序列

1. **t=0**：`._root_13iv5_1` 显示，背景为 `--gray-75`（亮）/ `--color-token-dropdown-background`（暗）
2. **t=0-300ms**：canvas 加载，fallback logo 显示在屏幕中央（83×83px，opacity 0.7）
3. **t=300ms**：canvas 就绪，fallback 淡出
4. **t=300ms+**：app-shell 显示，header tint 出现

### 4.4 关键设计

- **fallback 不全不透明**：opacity 0.7 让用户知道"在加载"但不抢占注意力
- **fallback 与 interaction target 同位**：83×83px 是可点击区域，用户能立即交互
- **背景色与 dropdown 同色**：让 fallback 看起来像"从 dropdown 浮出"

---

## 5. 代码高亮系统

### 5.1 基础设置

```css
code, pre {
  font-family: var(--font-mono) !important;                /* 强制 mono 字体 */
}

code[class=language-plaintext] {
  white-space: pre-line;                                   /* 纯文本：保留换行 */
}

code[class*=language-], pre[class*=language-], code.hljs {
  text-align: left;
  white-space: pre;                                        /* 代码：保留所有空白 */
  word-spacing: normal;
  word-break: normal;
  word-wrap: normal;
  tab-size: 4;                                             /* Tab = 4 空格 */
  -webkit-hyphens: none;
  hyphens: none;
  background: 0 0;                                         /* 透明背景 */
  line-height: 1.5;                                        /* 1.5 倍行高 */
}

pre[class*=language-] {
  border-radius: .3em;                                     /* 圆角 0.3em ≈ 4.2px */
  overflow: auto;
}

:not(pre) > code[class*=language-], :not(pre) > code.hljs {
  white-space: normal;
  border-radius: .3em;
  padding: .1em;                                           /* 行内代码轻 padding */
}
```

### 5.2 暗色主题 Token

```css
:is(.light .dark, .dark) code[class*=language-],
:is(.light .dark, .dark) pre[class*=language-],
:is(.light .dark, .dark) code.hljs {
  color: #fff;                                              /* 默认文字色 */
}

/* ── Token 颜色 ── */
:is(.light .dark, .dark) .hljs-comment { color: #ffffff80; }                 /* 注释：50% 白 */
:is(.light .dark, .dark) .hljs-meta { color: #fff9; }                        /* 元信息：60% 白 */

:is(.light .dark, .dark) .hljs-built_in,
:is(.light .dark, .dark) .hljs-class .hljs-title { color: #e9950c; }         /* 内建/类名：橙 */

:is(.light .dark, .dark) .hljs-doctag,
:is(.light .dark, .dark) .hljs-keyword,
:is(.light .dark, .dark) .hljs-formula,
:is(.light .dark, .dark) .hljs-literal { color: #2e95d3; }                   /* 关键字：蓝 */

:is(.light .dark, .dark) .hljs-string,
:is(.light .dark, .dark) .hljs-regexp,
:is(.light .dark, .dark) .hljs-addition,
:is(.light .dark, .dark) .hljs-attribute,
:is(.light .dark, .dark) .hljs-meta-string { color: #00a67d; }              /* 字符串：绿 */

:is(.light .dark, .dark) .hljs-attr,
:is(.light .dark, .dark) .hljs-variable,
:is(.light .dark, .dark) .hljs-template-variable,
:is(.light .dark, .dark) .hljs-type,
:is(.light .dark, .dark) .hljs-selector-class,
:is(.light .dark, .dark) .hljs-selector-attr,
:is(.light .dark, .dark) .hljs-selector-pseudo,
:is(.light .dark, .dark) .hljs-number { color: #df3079; }                   /* 变量/属性：粉 */

:is(.light .dark, .dark) .hljs-symbol,
:is(.light .dark, .dark) .hljs-bullet,
:is(.light .dark, .dark) .hljs-link,
:is(.light .dark, .dark) .hljs-selector-id,
:is(.light .dark, .dark) .hljs-title { color: #f22c3d; }                    /* 符号/链接：红 */
```

### 5.3 亮色主题 Token

```css
.light code[class*=language-], .light pre[class*=language-], .light code.hljs {
  color: #383a42;                                          /* 默认文字色：深灰蓝 */
}

.light .hljs-comment, .light .hljs-quote { color: #a0a1a7; font-style: italic; }
.light .hljs-doctag, .light .hljs-keyword, .light .hljs-formula { color: #a626a4; }   /* 紫 */
.light .hljs-section, .light .hljs-name, .light .hljs-selector-tag,
.light .hljs-deletion, .light .hljs-subst { color: #e45649; }                          /* 红 */
.light .hljs-literal { color: #0184bb; }                                                /* 青 */
.light .hljs-string, .light .hljs-regexp, .light .hljs-addition,
.light .hljs-attribute, .light .hljs-meta-string { color: #50a14f; }                   /* 绿 */
.light .hljs-built_in, .light .hljs-class .hljs-title { color: #c18401; }               /* 橙 */
.light .hljs-attr, .light .hljs-variable, .light .hljs-template-variable,
.light .hljs-type, .light .hljs-selector-class, .light .hljs-selector-attr,
.light .hljs-selector-pseudo, .light .hljs-number { color: #986801; }                  /* 棕黄 */
.light .hljs-symbol, .light .hljs-bullet, .light .hljs-link,
.light .hljs-meta, .light .hljs-selector-id, .light .hljs-title { color: #4078f2; }    /* 蓝 */

.light .hljs-emphasis { font-style: italic; }
.light .hljs-strong { font-weight: 700; }
.light .hljs-link { text-decoration: underline; }
```

### 5.4 Token 语义映射表

| Token 类别 | 暗色 | 亮色 | 用途 |
|-----------|------|------|------|
| comment | `#ffffff80` | `#a0a1a7` | 注释 |
| keyword | `#2e95d3` (蓝) | `#a626a4` (紫) | `if`/`for`/`return` 等 |
| string | `#00a67d` (绿) | `#50a14f` (绿) | 字符串 |
| number | `#df3079` (粉) | `#986801` (棕) | 数字 |
| built_in | `#e9950c` (橙) | `#c18401` (橙) | 内建函数 |
| variable | `#df3079` (粉) | `#986801` (棕) | 变量 |
| type | `#df3079` (粉) | `#986801` (棕) | 类型 |
| function title | `#f22c3d` (红) | `#4078f2` (蓝) | 函数名 |
| symbol | `#f22c3d` (红) | `#4078f2` (蓝) | 符号 |
| meta | `#fff9` (60% 白) | `#4078f2` (蓝) | 元信息 |
| link | `#f22c3d` (红) | `#4078f2` (蓝) + 下划线 | 链接 |

### 5.5 与品牌色的关系

代码高亮色**完全独立于品牌色 `#339cff`**，不混用。这是为了让代码"像代码"而不是"像 UI"——用户的视觉系统能立即区分"这是 UI 元素"vs"这是代码内容"。

---

## 6. 侧边栏滚动渐隐遮罩

### 6.1 完整 CSS

```css
._headerFadeMask_13q70_1 {
  --edge-fade-distance: calc(var(--spacing) * 10);        /* 40px 顶部渐隐 */
  --sidebar-scroll-footer-edge: calc(100% - var(--sidebar-footer-height));
  --sidebar-scroll-footer-fade-distance: calc(var(--spacing) * 10);  /* 40px 底部渐隐 */
  --sidebar-scroll-footer-fade-start:
    calc(var(--sidebar-scroll-footer-edge) - var(--sidebar-scroll-footer-fade-distance));
  --sidebar-scroll-header-mask-distance:
    var(--sidebar-scroll-header-fade-distance,
        var(--sidebar-scroll-header-spacing, calc(var(--spacing) * 2)));   /* 8px */
  --sidebar-scroll-header-mask-start: var(--sidebar-scroll-header-fade-start, 0px);

  --sidebar-scroll-mask-image:
    linear-gradient(
      to bottom,
      transparent 0,
      transparent var(--sidebar-scroll-header-mask-start),
      black calc(var(--sidebar-scroll-header-mask-start) + var(--sidebar-scroll-header-mask-distance)),
      black var(--sidebar-scroll-footer-fade-start),
      #000000e0 calc(var(--sidebar-scroll-footer-edge) - var(--spacing) * 6),     /* 88% 黑 */
      #00000085 calc(var(--sidebar-scroll-footer-edge) - var(--spacing) * 3),     /* 52% 黑 */
      #0000002e calc(var(--sidebar-scroll-footer-edge) - var(--spacing)),          /* 18% 黑 */
      transparent var(--sidebar-scroll-footer-edge),
      transparent 100%
    );

  -webkit-mask-image: var(--sidebar-scroll-mask-image);
  mask-image: var(--sidebar-scroll-mask-image);
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

@supports (animation-timeline: --scroll-fade) {
  ._headerFadeMask_13q70_1 {
    --sidebar-scroll-footer-fade-distance: var(--bottom-fade);  /* 滚动驱动动态调整 */
  }
}
```

### 6.2 渐隐阶段

```
┌─────────────────┐  ← 0% (透明)
│  顶部渐隐区      │  ← 0 to 8px (透明 → 黑)
├─────────────────┤  ← 8px (纯黑开始)
│                 │
│  内容区（黑）   │  ← 100% 可见
│                 │
├─────────────────┤  ← footer-fade-start
│  底部渐隐区     │  ← 4 段阶梯渐隐：
│   - 88% 黑      │  ← edge - 24px
│   - 52% 黑      │  ← edge - 12px
│   - 18% 黑      │  ← edge - 4px
│   - 透明        │  ← edge
├─────────────────┤  ← 100% (透明)
│  Footer 区      │  ← 完全透明（不遮 footer）
└─────────────────┘
```

### 6.3 Scroll-Timeline 驱动（高级）

```css
@supports (animation-timeline: --scroll-fade) {
  ._headerFadeMask_13q70_1 {
    --sidebar-scroll-footer-fade-distance: var(--bottom-fade);
  }
}
```

**含义**：当浏览器支持 `animation-timeline` 时，底部渐隐距离由 `--bottom-fade` 变量驱动，**这个变量可以通过 scroll-timeline 动画驱动**——滚动到底部时渐隐距离变小（footer 越来越可见），滚动到顶部时变大。

### 6.4 与 Quick Chat Window 的对比

| 维度 | Sidebar Mask | Quick Chat Mask |
|------|--------------|-----------------|
| 顶部 fade | 8px | `--edge-fade-distance` (默认 16px) |
| 底部 fade | 4 段阶梯 | 1 段线性 |
| Footer 处理 | 透明让 footer 可见 | 透明让 footer 可见 |
| 驱动方式 | 静态 + scroll-timeline 可选 | 纯静态 |

---

## 7. Toast 入场 / 出场

### 7.1 完整 CSS

```css
@keyframes _toast-open_ykdga_1 {
  0% {
    opacity: 0;
    transform: translateY(-4px);                          /* 从上方 4px 滑入 */
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes _toast-close_ykdga_1 {
  0% { opacity: 1; }
  to { opacity: 0; }                                       /* 仅淡出，无位移 */
}

._root_ykdga_45 {
  flex-direction: column;
  align-items: center;
  transition:
    opacity .24s cubic-bezier(0, 0, .2, 1),
    transform .24s cubic-bezier(0, 0, .2, 1);
  animation: .25s cubic-bezier(.175, .885, .32, 1) both _toast-open_ykdga_1;
  display: flex;
}

._root_ykdga_45[data-state=entering],
._root_ykdga_45[data-state=entered] {
  animation: .25s cubic-bezier(.175, .885, .32, 1) both _toast-open_ykdga_1;
}

._root_ykdga_45[data-state=exiting] {
  animation: .25s cubic-bezier(.4, 0, 1, 1) both _toast-close_ykdga_1;
}

._alert_ykdga_85 {
  pointer-events: all;
  min-width: 0;
  max-width: 100%;
  font-size: var(--text-base);                            /* 14px */
  line-height: 1.5;
  box-shadow: 0 4px 12px #0000001a;                      /* 轻投影 */
}
```

### 7.2 时序对比

| 状态 | 持续时间 | 缓动 | 动作 |
|------|---------|------|------|
| entering / entered | `0.25s` | `cubic-bezier(.175, .885, .32, 1)` (back-out) | 上移 4px + 淡入 |
| exiting | `0.25s` | `cubic-bezier(.4, 0, 1, 1)` (加速) | 仅淡出 |

### 7.3 关键设计

- **入场有位移，出场无位移**：toast 出现时"滑下"，消失时"淡去"——消失不引人注意
- **使用 `data-state` 驱动**：由 Radix UI 状态机控制，不依赖 class 切换
- **transition 与 animation 共存**：transition 用于跨状态过渡，animation 用于初始入场
- **back-out 缓动**：`cubic-bezier(.175, .885, .32, 1)` 让 toast 有轻微"弹"的感觉

---

## 8. Curtain 升降动画

### 8.1 完整 CSS

```css
._curtain_174ud_1 {
  z-index: var(--max-app-overlay-z-index);                /* 最高层级 */
  pointer-events: auto;
  opacity: 0;
  -webkit-backdrop-filter: blur(12px);                    /* 12px 模糊 */
  backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--color-token-bg-primary) 74%, transparent);  /* 74% 主色 + 透明 */
  animation-duration: .11s;
  animation-timing-function: cubic-bezier(.2, .8, .2, 1);
  animation-fill-mode: forwards;
  position: fixed;
  inset: 0;
  transform: scale(1.01);                                /* 默认略放大 */
}

._curtain_174ud_1[data-phase=raise] {
  animation-name: _curtainRaise_174ud_1;
}

._curtain_174ud_1[data-phase=lower] {
  animation-name: _curtainLower_174ud_1;
}

@keyframes _curtainRaise_174ud_1 {
  0% {
    opacity: 0;
    transform: scale(1.01);                               /* 起始略放大 */
  }
  to {
    opacity: 1;
    transform: scale(1);                                  /* 终止原大小 */
  }
}

@keyframes _curtainLower_174ud_1 {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(1.01);                               /* 结束略放大 */
  }
}
```

### 8.2 设计要点

| 维度 | 值 | 说明 |
|------|-----|------|
| 持续时间 | `0.11s` | 极短（比 default 0.15s 还快） |
| 缓动 | `cubic-bezier(.2, .8, .2, 1)` | 接近 ease-out 但更急促 |
| 模糊 | `blur(12px)` | 中等模糊，让背景可读但不清晰 |
| 背景 | `color-mix(in srgb, bg-primary 74%, transparent)` | 74% 主色（不是 oklab） |
| 缩放 | `1.01 → 1`（raise）/ `1 → 1.01`（lower） | 微缩放制造"镜头推进"感 |

### 8.3 为什么用 `in srgb` 而不是 `in oklab`

Curtain 背景用 `color-mix(in srgb, ...)` 而不是 `in oklab`。原因：

- srgb 混合在低 alpha 下更"暗"（更接近黑色），适合遮罩
- oklab 混合在低 alpha 下更"亮"（更接近白色），适合 hover
- Curtain 是遮罩，应该偏暗 → 用 srgb

### 8.4 与 cmdk backdrop 的区别

| 维度 | cmdk backdrop | curtain |
|------|---------------|---------|
| 模糊 | `blur(8px)` | `blur(12px)` |
| 透明度 | 95% | 74% |
| 用途 | dropdown 浮层 | modal 全屏遮罩 |
| 动画 | 无 | 0.11s 升降 |

---

## 9. 入场动画编排

### 9.1 通用入场

```css
@keyframes _enter_ogrc3_25 {
  0% {
    opacity: 0;
    transform: translateY(-4px) scale(.98);               /* 上移 + 缩小 */
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

._enter_ogrc3_25 {
  animation: _enter_ogrc3_25
    var(--transition-duration-basic)                       /* 0.15s */
    var(--cubic-enter)                                     /* cubic-bezier(0.19, 1, 0.22, 1) */
    both;
}

@media (prefers-reduced-motion: reduce) {
  _enter_ogrc3_25 {
    animation: none;
  }
}
```

### 9.2 编排策略

| 场景 | 动画 | 时长 | 缓动 |
|------|------|------|------|
| 通用元素入场 | `translateY(-4px) scale(.98)` | 0.15s | `cubic-enter` |
| Toast 入场 | `translateY(-4px)` | 0.25s | `back-out` |
| 内容过渡 Enter | `translate(-50%, 8px) scale(.98)` | 0.26s | `cubic-enter` |
| 引导箭头 | `translateY(-4px)` 循环 | 1s | `ease-in-out` |
| Curtain 升起 | `scale(1.01) → 1` | 0.11s | `cubic-bezier(.2, .8, .2, 1)` |

### 9.3 位移基准

- **4px**：微位移，不引人注意但能感知"动了"
- **8px**：明显位移，用于内容过渡
- **scale .98**：微缩放，配合位移增强"出现"感

---

## 10. Reduced Motion 策略

### 10.1 统一旁路

所有动画必须有 `@media (prefers-reduced-motion: reduce)` 旁路：

```css
@media (prefers-reduced-motion: reduce) {
  ._uacArrow_1tl1k_1,           /* 引导箭头 */
  ._enter_ogrc3_25,              /* 通用入场 */
  ._contentEnter_1twe3_17,       /* 内容过渡 */
  ._contentExit_1twe3_27,
  ._root_ykdga_45 {              /* toast */
    animation: none;
  }
}
```

### 10.2 例外（无动画即可）

- **curtain**：动画 0.11s 已经很短，但仍可旁路
- **code highlighting**：无动画
- **sidebar scroll mask**：无动画

### 10.3 替代策略

reduced-motion 模式下：
- **动画 → 即时切换**：opacity 直接 0/1，无过渡
- **位移 → 静态**：transform 归零
- **缩放 → 静态**：scale = 1
- **背景模糊 → 保留**：backdrop-filter 不属于 motion

---

## 11. Do / Don't

### ✅ Do

- 引导箭头用 `infinite alternate` 而不是 `infinite` 单向
- 内容过渡用不对称时序（enter 0.26s / exit 0.18s）
- curtain 用 `in srgb` 而不是 `in oklab`（遮罩要偏暗）
- 通用入场用 4px 位移 + .98 缩放（微动效）
- 代码高亮色与品牌色独立（不让 UI 色污染代码）
- sidebar 滚动遮罩用 4 段阶梯渐隐（不是单一线性）
- 所有动画带 reduced-motion 旁路

### ❌ Don't

- **不要**用 `box-shadow` 给 SVG 箭头投影，用 `drop-shadow`
- **不要**让 enter 与 exit 同时长同缓动（exit 应更快）
- **不要**在 curtain 用 `in oklab`（会让遮罩太亮）
- **不要**让代码高亮的 keyword 色等于品牌色 `#339cff`
- **不要**用 `alternate-reverse` 让动画从位移态开始（违反直觉）
- **不要**在 reduced-motion 模式下保留 backdrop-filter 之外的动画
- **不要**用 `transition` 替代 `animation` 实现复杂入场（无法精确控制 keyframes）
- **不要**在 curtain 用 `infinite` 动画（遮罩升起后应静止）

---

## 12. 与 ClawX 的对齐建议

### 12.1 当前问题

- ClawX 没有引导箭头动画（用户不知道下一步该点哪里）
- 内容切换没有过渡动画（硬切，体验割裂）
- 代码高亮色与品牌色混用（蓝色 keyword 让代码"像 UI"）
- 没有 curtain 升降（modal 直接出现/消失）
- 没有 sidebar 滚动渐隐（列表项贴边显示）

### 12.2 迁移建议

1. 引入 `_uacArrow` 弹跳动画类，用于首次引导箭头
2. 引入 `_contentEnter` / `_contentExit` 不对称过渡，用于页面切换
3. 引入 `hljs` 暗色/亮色 token 集合，独立于品牌色
4. 引入 `curtain` 升降动画，0.11s + scale 1.01
5. 引入 sidebar 4 段阶梯渐隐 mask-image
6. 所有动画必须加 `@media (prefers-reduced-motion: reduce)` 旁路
