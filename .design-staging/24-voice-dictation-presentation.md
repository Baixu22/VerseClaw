---
doc: 24-voice-dictation-presentation
name: Voice Dictation, Orb & Presentation Panel
category: Subsystems
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/css/global-dictation-orb-DOhfZ79u.css
  - codex-reference/css/global-dictation-page-Q_eqn6UZ.css
  - codex-reference/css/PopcornElectronPresentationPanel-pMDpowHW.css
  - codex-reference/css/scroll-to-bottom-buton-CQcpasM2.pretty.css (wave keyframes 参考)
---

# 24 — Voice Dictation, Orb & Presentation Panel

> 语音听写浮球（Orb）的 glassmorphism 材质、听写页面暗色主题 token 覆盖、以及 Popcorn 演示面板的容器查询三态响应式布局，是 Codex "跨模态交互子系统"的代表。本文规定浮球材质配方、主题覆盖策略、以及演示面板的完整响应式行为。

---

## 目录

1. [录音浮球（Orb）材质](#1-录音浮球orb材质)
2. [听写页面暗色主题覆盖](#2-听写页面暗色主题覆盖)
3. [浮层材质策略](#3-浮层材质策略)
4. [Popcorn 演示面板](#4-popcorn-演示面板)
5. [无障碍三层防御](#5-无障碍三层防御)
6. [波形动画参考](#6-波形动画参考)
7. [Do / Don't](#do--dont)

---

## 1. 录音浮球（Orb）材质

### 1.1 完整源码

```css
/* global-dictation-orb-DOhfZ79u.css */

._recordingOrb_o79gg_1 {
  -webkit-backdrop-filter: blur(18px) saturate(1.45);
  backdrop-filter: blur(18px) saturate(1.45);
  background-color: #ff453ab8;
  box-shadow:
    inset 0 1px #ffffff47,
    inset 0 -8px 18px #75000042;
}

@media (prefers-reduced-transparency: reduce) {
  ._recordingOrb_o79gg_1 {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    background-color: #ff453a;
  }
}

@media (forced-colors: active) {
  _recordingOrb_o79gg_1 {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    background-color: canvas;
  }
}
```

### 1.2 材质配方表

| 属性 | 值 | 解析 |
|---|---|---|
| 背景色 | `#ff453ab8` | 录制红 `rgb(255,69,58)` @ 72% 不透明 |
| 模糊半径 | `blur(18px)` | 强模糊（对比 mini-surface 4px、popcorn 桌面 40px） |
| 饱和度提升 | `saturate(1.45)` | +45% 饱和，增强玻璃色彩 |
| 内阴影（顶部高光） | `inset 0 1px #ffffff47` | 1px 白色高光 @ 28% 不透明 |
| 内阴影（底部暗调） | `inset 0 -8px 18px #75000042` | 偏移 -8px、模糊 18px 的深栗色 @ 26% 不透明 |

### 1.3 球体感构成

浮球的双层 inset shadow 模拟球体光照：
- **顶亮**：`inset 0 1px #ffffff47` → 顶部 1px 白色高光，模拟光源从上方照射
- **底暗**`inset 0 -8px 18px #75000042` → 底部偏移 8px、模糊 18px 的深栗色，模拟球体下半阴影

**无外阴影**：浮球不投射环境阴影，视觉上"浮于"内容之上而非"悬浮在"内容之上。

### 1.4 录制红色板

| Hex | Alpha | RGB | 用途 |
|---|---|---|---|
| `#ff453a` | 100% | `rgb(255,69,58)` | 录制红基色（Apple systemRed 体系） |
| `#ff453ab8` | 72% | `rgba(255,69,58,0.72)` | 浮球常规背景 |
| `#ffffff47` | 28% | `rgba(255,255,255,0.28)` | 顶部高光 |
| `#75000042` | 26% | `rgba(117,0,0,0.26)` | 底部球体阴影 |

### 1.5 尺寸/形状/动画

> CSS 参考包仅含材质定义。浮球的 `width` / `height` / `border-radius` / `position` / pulse 动画由 JS 运行时注入（CSS-in-JS 或内联 style）。
>
> **设计文档标注**：浮球尺寸、圆角、pulse 周期需通过运行时 DevTools 补全。CSS 仅锁定"材质 + 颜色 + a11y 降级"三件事。

---

## 2. 听写页面暗色主题覆盖

### 2.1 完整源码

```css
/* global-dictation-page-Q_eqn6UZ.css */

._darkTheme_1xdv6_1 {
  --lightningcss-light: ;
  --lightningcss-dark: initial;
  color-scheme: dark;

  --color-token-bg-primary:            black;
  --color-token-dropdown-background:   #181818f0;
  --color-token-foreground:            var(--gray-0);
  --color-token-text-primary:          var(--gray-0);
  --color-token-text-secondary:        #ffffffa6;
  --color-token-border:                #ffffff14;
  --color-token-border-default:        #ffffff14;
  --color-token-list-hover-background: #ffffff14;
  --color-token-error-foreground:      var(--red-300);
  --color-token-focus-border:          #339cffb3;
}
```

### 2.2 Token 覆盖表

| Token | 覆盖值 | 解析 |
|---|---|---|
| `--color-token-bg-primary` | `black` | 纯黑背景 |
| `--color-token-dropdown-background` | `#181818f0` | 深灰 @ 94% 不透明 |
| `--color-token-foreground` | `var(--gray-0)` = `#fff` | 前景纯白 |
| `--color-token-text-primary` | `var(--gray-0)` = `#fff` | 主文本纯白 |
| `--color-token-text-secondary` | `#ffffffa6` | 次文本 @ 65% 不透明 |
| `--color-token-border` | `#ffffff14` | 边框 @ 8% 不透明 |
| `--color-token-border-default` | `#ffffff14` | 默认边框 @ 8% |
| `--color-token-list-hover-background` | `#ffffff14` | 列表 hover @ 8% |
| `--color-token-error-foreground` | `var(--red-300)` = `#ff6764` | 错误色 |
| `--color-token-focus-border` | `#339cffb3` | 焦点蓝 @ 70% 不透明 |

### 2.3 Lightning CSS 暗色变量机制

```css
--lightningcss-light: ;
--lightningcss-dark: initial;
```

这是 **lightningcss** 编译器注入的暗色模式变量：
- `--lightningcss-light: ;`（空值 = 在暗色下不激活）
- `--lightningcss-dark: initial;`（initial = 在暗色下激活）

配合 `color-scheme: dark`，让浏览器原生控件（滚动条、表单元素）也切换到暗色。

### 2.4 就地主题覆盖模式

> 听写页面通过 `._darkTheme_1xdv6_1` 类**就地重定义** 10 个 `--color-token-*`，而非依赖全局 `.electron-dark`。
>
> **设计意图**：听写是一个**全屏覆盖式**交互（用户专注语音输入），需要独立的主题环境。就地覆盖确保即使全局主题为 light，听写页面仍为暗色——这是"沉浸式暗色"策略。

---

## 3. 浮层材质策略

### 3.1 Mini Surface（收起态）

```css
._miniSurface_1xdv6_29 {
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  background-color: #000000b3;    /* 70% 不透明黑 */
}
```

| 属性 | 值 |
|---|---|
| 模糊 | `blur(4px)` |
| 背景色 | `#000000b3`（70% 不透明黑） |
| 触发条件 | 默认（未 hover/未展开） |

### 3.2 Expanded Surface（展开态）

```css
.group:hover ._miniSurface_1xdv6_29,
.group[data-state=delayed-open] ._miniSurface_1xdv6_29,
._expandedSurface_1xdv6_43 {
  background-color: var(--color-token-bg-primary);    /* 暗色下 = black */
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
```

| 属性 | 值 |
|---|---|
| 背景色 | `var(--color-token-bg-primary)`（暗色 = `black`） |
| 模糊 | `none`（取消玻璃，改实色） |
| 触发条件 | `.group:hover` / `data-state=delayed-open` / 直接 `._expandedSurface_` |

### 3.3 材质渐进策略

| 状态 | 模糊 | 背景 | 设计意图 |
|---|---|---|---|
| 收起态 | 4px 弱模糊 | 70% 黑 | 轻量浮层，透出底色 |
| 展开态 | none | 实色 black | 放弃模糊换取内容可读性 |

> **核心模式**："轻提示 → 重内容"的渐进材质。收起时用弱模糊做存在感提示，展开时切换实色确保文字清晰。

---

## 4. Popcorn 演示面板

### 4.1 容器查询上下文

```css
.popcorn-presentation-editor-shell {
  container: presentation-editor / inline-size;
}
```

### 4.2 三态布局

| 形态 | 触发条件 | 行为 |
|---|---|---|
| **桌面侧栏态** | 容器 ≥ 749px | 220px 固定侧栏常驻左侧 |
| **窄屏浮出态** | 容器 ≤ 748px | 20px 触发条，点击展开 136px 浮动面板 |
| **极窄堆叠态** | 容器 ≤ 688px + `--small-stacked` | 主面板隐藏，幻灯片纵向堆叠 |

### 4.3 桌面侧栏态（≥ 749px）

```css
@container presentation-editor (width >= 749px) {
  .popcorn-presentation-thumbnail-rail--overlay-desktop,
  .popcorn-presentation-codex-thumbnail-rail {
    z-index: 20;
    background: color-mix(in srgb, var(--color-token-main-surface-primary, #fff) 80%, transparent);
    -webkit-backdrop-filter: blur(40px);
    backdrop-filter: blur(40px);
    width: 220px;
    position: absolute; top: 0; bottom: 0; left: 0;
  }
  .popcorn-presentation-main-panel--codex-responsive { order: 2; }
  .popcorn-presentation-codex-thumbnail-rail {
    pointer-events: auto; height: auto; display: flex;
  }
  .popcorn-presentation-codex-thumbnail-panel {
    pointer-events: auto; width: 220px; height: 100%;
    min-height: 0; box-shadow: none; opacity: 1;
    -webkit-backdrop-filter: none; backdrop-filter: none;
    background: 0 0; border-radius: 0;
    flex-direction: column; gap: 10px;
    padding: 12px 12px 48px;
    display: flex; position: relative;
    overflow: hidden auto; transform: none;
  }
}
```

| 属性 | 值 |
|---|---|
| 侧栏宽度 | 220px |
| 模糊 | `blur(40px)` |
| 背景 | 80% surface-primary + transparent |
| 主面板 order | 2（在右侧） |
| 面板间距 | `gap: 10px` |
| 面板 padding | `12px 12px 48px` |

### 4.4 窄屏浮出态（≤ 748px）

```css
@container presentation-editor (width <= 748px) {
  .popcorn-presentation-main-panel--codex-responsive { order: 1; }

  .popcorn-presentation-codex-thumbnail-rail {
    pointer-events: none;
    z-index: 30;
    width: 136px;
    position: absolute;
    top: 12px; bottom: 24px; left: 16px;
  }

  .popcorn-presentation-codex-thumbnail-stack {
    pointer-events: auto;
    background: 0 0; border: 0;
    flex-direction: column; align-items: stretch;
    gap: 6px;
    width: 20px;
    max-height: calc(100% - 36px);
    padding: 0;
    transition: opacity .2s ease-out;
    display: flex;
    position: absolute; top: 50%; left: 0;
    overflow: hidden;
    transform: translateY(-50%);
  }

  .popcorn-presentation-codex-thumbnail-stack-bar {
    border-radius: 9999px;
    width: 20px; height: 2px;
    transition: background-color .2s ease-out;
    display: block;
  }

  .popcorn-presentation-codex-thumbnail-panel {
    background: color-mix(in srgb, var(--color-token-main-surface-primary, #fff) 80%, transparent);
    -webkit-backdrop-filter: blur(27.6923px);
    backdrop-filter: blur(27.6923px);
    border-radius: 16px;
    flex-direction: column;
    width: 136px;
    min-height: 0; max-height: 100%;
    padding: 8px;
    transition: opacity .2s ease-out, transform .2s ease-out;
    display: flex;
    position: absolute; top: 50%; left: 0;
    overflow: hidden auto;
    transform: translateY(-50%);
    box-shadow: 0 5px 32px #00000012;
  }
}
```

### 4.5 浮出态开合交互

| `data-open` | stack opacity | panel opacity | panel transform | panel pointer-events |
|---|---|---|---|---|
| `true` | 0 | 1 | `translateY(-50%) translate(0)` | auto |
| `false` | 1 | 0 | `translateY(-50%) translate(-8px)` | none |

> 入场动画：面板从左侧 `-8px` 滑入 + opacity 渐显，`transition: opacity .2s ease-out, transform .2s ease-out`。

### 4.6 极窄堆叠态（≤ 688px）

```css
@container presentation-editor (width <= 688px) {
  .popcorn-presentation-editor-shell--small-stacked { flex-direction: column; }
  .popcorn-presentation-editor-shell--small-stacked .popcorn-presentation-main-panel,
  .popcorn-presentation-editor-shell--small-stacked .popcorn-presentation-codex-thumbnail-rail,
  .popcorn-presentation-editor-shell--small-stacked .popcorn-presentation-thumbnail-rail--overlay-desktop {
    display: none;
  }
  .popcorn-presentation-editor-shell--small-stacked .popcorn-presentation-stacked-pages {
    flex-direction: column; flex: auto;
    gap: 20px; width: 100%;
    min-height: 0; padding: 20px;
    display: flex; overflow-y: auto;
  }
  .popcorn-presentation-stacked-page-placeholder {
    aspect-ratio: 16/9;
    background: var(--color-token-bg-secondary, #fafafae6);
    border: 1px solid var(--color-token-border-default, #0d0d0d1a);
    background: #fff;
    border-radius: 8px;
    width: 100%; display: block;
    overflow: hidden;
    box-shadow: 0 4px 16px #0000000d;
  }
}
```

### 4.7 Active 页高亮

```css
.popcorn-presentation-stacked-page[data-active=true] .popcorn-presentation-stacked-page-image {
  border-color: var(--color-token-interactive-label-accent-default, #0285ff);
  box-shadow:
    0 0 0 1px var(--color-token-interactive-label-accent-default, #0285ff),
    0 2px 8px 0 #0285ff29,
    0 4px 16px 0 #0000000d;
}
```

三段式 box-shadow：1px 描边 + 8px 蓝色辉光（16% 不透明）+ 16px 环境阴影。

### 4.8 玻璃材质三档

| 断点 | 元素 | 模糊半径 |
|---|---|---|
| ≥ 749px | 桌面侧栏 | `blur(40px)` |
| ≤ 748px | 浮动面板 | `blur(27.6923px)` |
| 默认 | mini surface | `blur(4px)` |

> `27.6923px` 是一个非整数模糊值，可能来自设计稿的精确计算（如 36px * 0.769...），保留原始精度。

---

## 5. 无障碍三层防御

### 5.1 三种媒体查询

| 媒体查询 | 触发场景 | 处理方式 |
|---|---|---|
| `prefers-reduced-transparency: reduce` | 用户要求降低透明度 | 关闭 `backdrop-filter`，背景色改 100% 不透明 |
| `forced-colors: active` | Windows 高对比度 | 关闭 `backdrop-filter`，背景色改 `canvas` 系统色 |
| `prefers-reduced-motion: no-preference` | 用户未要求减少动画 | **反向 gating**：仅在 no-preference 时启用循环动画 |

### 5.2 降透明度回退表

| 组件 | 常规背景 | 降透明度背景 |
|---|---|---|
| 浮球 | `#ff453ab8`（72%） | `#ff453a`（100%） |
| mini surface | `#000000b3`（70%） | `#000000d9`（85%） |
| 浮球 | `blur(18px) saturate(1.45)` | `none` |
| mini surface | `blur(4px)` | `none` |

### 5.3 Forced-colors 策略

所有玻璃材质组件在 `forced-colors: active` 下统一降级为 `background-color: canvas`（系统画布色），**放弃品牌色以适配系统高对比度主题**。

> 浮球在 forced-colors 下降级为 `canvas` 而非录制红——这是"无障碍优先于品牌一致性"的明确决策。

---

## 6. 波形动画参考

> CSS 参考包中未包含浮球的 pulse/wave/breathe 动画。以下 `working-dot-wave` 是 Codex 中最接近"声波/波形"的动画，可作为听写声波可视化的设计锚点。

### 6.1 Working Dot Wave

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

| 参数 | 值 |
|---|---|
| 周期 | 1000ms |
| 缓动 | `ease-in-out` |
| 迭代 | `infinite` |
| 错峰 | 第 2 点 +100ms，第 3 点 +200ms |
| 位移 | 基线 0 → 下沉 1.2px → 上扬 -2px → 回归 0 |
| reduced-motion | **opt-in**（仅在 `no-preference` 时启用） |

### 6.2 建议的听写声波设计

基于 `working-dot-wave` 模式，听写声波可视化建议：
- 3-5 个垂直条/点，`ease-in-out` 波浪
- 错峰 delay 100ms 递增
- 仅在 `prefers-reduced-motion: no-preference` 时启用
- 录制中用录制红 `#ff453a`，空闲时用 `--color-token-text-secondary`

---

## 7. Do / Don't

### Do

- 浮球用 `blur(18px) saturate(1.45)` 玻璃材质 + 双层 inset shadow
- 听写页面用就地 token 覆盖（`._darkTheme_`），不依赖全局 `.electron-dark`
- 收起态用弱模糊（4px），展开态切实色
- 演示面板用容器查询三态布局
- 所有玻璃材质提供 `prefers-reduced-transparency` 和 `forced-colors` 降级

### Don't

- 不要用 `rgba()` 代替 `color-mix` + hex-alpha
- 不要在听写页面用全局主题 token（需就地覆盖确保暗色）
- 不要用媒体查询驱动演示面板布局（用容器查询）
- 不要在 `forced-colors` 下保留品牌色（改用 `canvas` 系统色）
- 不要用正向 `prefers-reduced-motion: reduce` gating 循环动画（用反向 `no-preference` gating）

---

## 来源

- `FakeCoding-main/codex-reference/css/global-dictation-orb-DOhfZ79u.css`（浮球材质）
- `FakeCoding-main/codex-reference/css/global-dictation-page-Q_eqn6UZ.css`（听写页主题）
- `FakeCoding-main/codex-reference/css/PopcornElectronPresentationPanel-pMDpowHW.css`（演示面板）
- `FakeCoding-main/codex-reference/css/scroll-to-bottom-buton-CQcpasM2.pretty.css`（wave keyframes 参考）
