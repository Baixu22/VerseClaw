---
doc: 22-data-visualization-progress
name: Data Visualization, Charts, Progress & SVG Animations
category: Patterns
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/tokens.css
  - codex-reference/css/progression-donut-DkjcVlU6.css
  - codex-reference/css/chart-widget-stores-Bps-0OA4.css
  - codex-reference/css/shimmer-lines-yjvWUHPT.css
  - codex-reference/css/thinking-shimmer-C-5BnEUj.css
  - codex-reference/css/scroll-to-bottom-buton-CQcpasM2.css
  - codex-pure-source/runtime-dom/stylesheets-rules.json
  - codex-design-system.css
---

# 22 — Data Visualization, Charts, Progress & SVG Animations

> 数据可视化（charts）、进度指示器（progress）、SVG 动画构成 Codex 的"**数据视觉层**"。本文规范 Recharts 图表主题、进度环（progression donut）的 SVG 动画、Chart Tooltip / Legend 交互模式、Chart Scroll 容器策略。
>
> 企业级产品中**数据展示必须可读、可访问、可交互**：图表不只是"画出来"，还要支持 hover tooltip、legend 切换、键盘 focus、reduced-motion fallback。

---

## 目录

1. [设计哲学](#1-设计哲学)
2. [Progression Donut — SVG 进度环](#2-progression-donut--svg-进度环)
3. [Chart 系统架构](#3-chart-系统架构)
4. [Chart Token 映射](#4-chart-token-映射)
5. [Chart Legend — 交互式图例](#5-chart-legend--交互式图例)
6. [Chart Tooltip — 数据悬浮卡](#6-chart-tooltip--数据悬浮卡)
7. [Chart Scroll 容器](#7-chart-scroll-容器)
8. [Box 布局原语](#8-box-布局原语)
9. [性能优化](#9-性能优化)
10. [无障碍](#10-无障碍)
11. [Reduced Motion 策略](#11-reduced-motion-策略)
12. [Do / Don't](#12-do--dont)

---

## 1. 设计哲学

### 1.1 三层数据视觉

| 层 | 用途 | 实现 |
|----|------|------|
| **Progress（进度）** | 单值进度 | SVG `<circle>` + stroke-dashoffset |
| **Chart（图表）** | 多维数据 | Recharts + 自定义主题 |
| **Shimmer（占位）** | 加载占位 | CSS gradient + animation |

### 1.2 与品牌色的关系

数据可视化**完全脱离品牌色 `#339cff`**：
- 进度环用 `currentColor`（继承父级）
- 图表用 `--color-text-secondary`、`--color-border`、`--alpha-10` 等中性 token
- 数据系列颜色由调用方决定，不在主题层固定

**理由**：让数据可视化"中立"——不与 UI 品牌色混淆，用户能专注数据本身。

### 1.3 与 [18-states-icons-a11y.md](./18-states-icons-a11y.md) 的分野

- [18](./18-states-icons-a11y.md) 规范"加载状态"（shimmer / spinner / skeleton），是**占位**
- 本文规范"数据展示"（chart / progress），是**结果**

二者共同构成"等待 → 结果"的完整视觉链路。

---

## 2. Progression Donut — SVG 进度环

### 2.1 完整 CSS

```css
._fillOnMount_1crzc_1 {
  animation:
    _progression-donut-fill_1crzc_1
    var(--transition-duration-relaxed)                     /* 0.3s */
    ease-out
    backwards;
}

@keyframes _progression-donut-fill_1crzc_1 {
  0% {
    stroke-dashoffset: 100px;                              /* 起始：完全偏移 */
  }
  /* 终止：stroke-dashoffset 由具体进度决定（如 30% = 70px 偏移） */
}

@media (prefers-reduced-motion: reduce) {
  ._fillOnMount_1crzc_1 {
    animation: none;                                        /* 直接显示最终态 */
  }
}
```

### 2.2 关键设计

#### 2.2.1 `stroke-dashoffset` 动画原理

SVG `<circle>` 通过两个属性控制进度：

```html
<circle
  cx="50" cy="50" r="40"
  stroke-dasharray="100"     <!-- 圆周长度（或简化为 100） -->
  stroke-dashoffset="70"      <!-- 偏移量：0 = 满，100 = 空 -->
/>
```

- `stroke-dasharray="100"`：定义虚线段长度为 100（即整个圆周）
- `stroke-dashoffset="70"`：偏移 70，即显示 30% 进度
- 动画：从 `100`（空）到目标值（如 `70`），形成"填充"动画

#### 2.2.2 `backwards` fill-mode

```css
animation-fill-mode: backwards;
```

**含义**：动画开始**前**应用 `0%` keyframe 的样式。

**作用**：在动画延迟期间（如果有 `animation-delay`），元素已经处于"空"状态，避免"先显示满再回退到空"的闪烁。

#### 2.2.3 `--transition-duration-relaxed` 时长

```css
animation-duration: var(--transition-duration-relaxed);  /* 0.3s */
```

**为什么用 relaxed (0.3s) 而不是 basic (0.15s)**：
- 0.15s 太快，进度环"瞬间"填满，用户感知不到进度
- 0.3s 让用户能看到"填充过程"，符合进度语义

#### 2.2.4 `ease-out` 缓动

```css
animation-timing-function: ease-out;
```

**含义**：开始快、结束慢。

**理由**：进度环填充应该"快速启动 + 缓慢收尾"，让用户感觉"加载在加速完成"。

### 2.3 进度环的 SVG 结构（推荐）

```html
<svg viewBox="0 0 100 100" class="progression-donut">
  <!-- 背景圆（轨道） -->
  <circle
    cx="50" cy="50" r="40"
    fill="none"
    stroke="var(--color-border)"
    stroke-width="8"
    opacity="0.3"
  />

  <!-- 进度圆 -->
  <circle
    cx="50" cy="50" r="40"
    fill="none"
    stroke="var(--color-text)"
    stroke-width="8"
    stroke-linecap="round"
    stroke-dasharray="251.327"                            <!-- 2 * π * 40 ≈ 251.327 -->
    stroke-dashoffset="{251.327 * (1 - progress)}"         <!-- progress 0-1 -->
    transform="rotate(-90 50 50)"                          <!-- 从顶部开始 -->
    class="_fillOnMount_1crzc_1"
  />
</svg>
```

### 2.4 `stroke-linecap` 选择

| 值 | 效果 | 适用场景 |
|----|------|----------|
| `butt` | 直角端点 | 进度条（linear） |
| `round` | 圆角端点 | **进度环（donut）** ✅ |
| `square` | 直角延长 | 不推荐 |

进度环用 `round` 让两端"圆润"，避免视觉断裂。

### 2.5 `transform: rotate(-90 50 50)` 起点偏移

SVG 圆形默认从 3 点钟方向开始绘制，进度环需要从 12 点钟方向开始：

```html
<circle transform="rotate(-90 50 50)" />
```

`rotate(-90 50 50)` 表示绕点 (50, 50) 旋转 -90 度，让起点从右侧移到顶部。

---

## 3. Chart 系统架构

### 3.1 整体结构

```
.Chart_Chart                              ← 根容器
├── .Chart_ScrollViewport                 ← 滚动视口
│   ├── .Chart_Scrollable / .Chart_ScrollLocked
│   └── .Chart_ScrollContent             ← 内容（will-change: transform）
│       └── .Chart_ChartScrollable        ← SVG 容器
│           └── <svg> (Recharts)         ← 实际图表
├── .recharts-cartesian-axis-tick text   ← 轴标签
├── .recharts-cartesian-grid line        ← 网格线
├── .Chart_LegendItem                     ← 图例项
└── .Chart_ChartTooltip                   ← Tooltip
```

### 3.2 类名规范

| 类 | 用途 |
|----|------|
| `.Chart_Chart` | 根容器，定义字号 |
| `.Chart_ScrollViewport` | 滚动视口（width/height 100%） |
| `.Chart_Scrollable` | 水平滚动（overflow: auto hidden） |
| `.Chart_ScrollLocked` | 锁定滚动（overflow: hidden） |
| `.Chart_ScrollContent` | 滚动内容（will-change: transform） |
| `.Chart_ChartScrollable` | SVG 滚动容器（max-width 100%） |
| `.Chart_Axis` | 轴样式 |
| `.Chart_ChartTooltip` | Tooltip |
| `.Chart_LegendItem` | 图例项 |
| `.Chart_LegendItemMarker` | 图例颜色点 |
| `.Chart_LegendItemLabel` | 图例文本 |
| `.Chart_LegendSelectedIcon` | 图例选中图标 |
| `.Chart_InteractiveSeries` | 可交互数据系列 |
| `.Chart_ValueLabel` | 数据值标签 |

---

## 4. Chart Token 映射

### 4.1 完整 Token 表

```css
.Chart_Chart {
  font-size: var(--font-text-sm-size);                    /* 14px */
  line-height: var(--font-text-sm-line-height);
}

.Chart_Chart .recharts-cartesian-axis-tick text {
  fill: var(--color-text-secondary);                      /* 轴标签文字色 */
}

.Chart_Chart .recharts-cartesian-grid line {
  stroke: var(--color-border);                            /* 网格线色 */
}

.Chart_Chart .recharts-curve.recharts-tooltip-cursor {
  stroke: var(--alpha-10);                                /* 10% 透明的 tooltip 指示线 */
}

.Chart_Chart .recharts-polar-grid {
  stroke: var(--color-border);                            /* 极坐标网格 */
}

.Chart_Chart .recharts-cartesian-axis-line,
.Chart_Chart .recharts-cartesian-axis-tick-line {
  stroke: var(--color-border);                            /* 轴线色 */
  stroke-width: 1px;
}

.Chart_Chart .recharts-rectangle.recharts-tooltip-cursor,
.Chart_Chart .recharts-radial-bar-background-sector {
  fill: var(--alpha-05);                                  /* 5% 透明的柱状 tooltip 背景 */
}

.Chart_Chart .recharts-surface {
  outline: none;                                          /* SVG 表面无 outline */
  overflow: visible;                                      /* 允许溢出（tooltip） */
}

.Chart_Chart .recharts-sector,
.Chart_Chart .recharts-layer {
  outline: none;                                          /* 扇区/层无 outline */
}

.Chart_Chart[data-y-axis=hidden] .recharts-cartesian-grid line:last-of-type {
  display: none;                                           /* 隐藏 Y 轴时移除最后一条网格线 */
}
```

### 4.2 Token 来源

| Token | 含义 | 来源 |
|-------|------|------|
| `--font-text-sm-size` | 14px 字号 | typography |
| `--font-text-sm-line-height` | 1.5 行高 | typography |
| `--color-text-secondary` | 次级文字色 | color tokens |
| `--color-border` | 边框色 | color tokens |
| `--alpha-10` | 10% 透明色 | alpha tokens |
| `--alpha-05` | 5% 透明色 | alpha tokens |
| `--color-surface-elevated` | elevated 表面色 | color tokens |
| `--color-surface-tertiary` | 三级表面色 | color tokens |
| `--color-ring` | 焦点环色 | color tokens |
| `--color-text` | 主文字色 | color tokens |
| `--font-text-xs-size` | 12px 字号 | typography |
| `--radius-md` | 10px 圆角 | rounded |
| `--radius-sm` | 7.5px 圆角 | rounded |
| `--radius-full` | 9999px 圆角 | rounded |
| `--shadow` | 标准阴影 | shadows |
| `--shadow-hairline` | hairline 阴影 | shadows |
| `--spacing` | 4px 间距 | spacing |

### 4.3 设计原则

1. **轴标签用次级色**：`--color-text-secondary` 让轴"退后"，让数据"突出"
2. **网格线用 border 色**：与 UI 边框一致，保持视觉统一
3. **tooltip 指示线用 `alpha-10`**：10% 透明，可见但不抢眼
4. **柱状 tooltip 背景用 `alpha-05`**：5% 透明，几乎不可见但有反馈
5. **`overflow: visible`**：让 tooltip 能溢出 SVG 边界

---

## 5. Chart Legend — 交互式图例

### 5.1 完整 CSS

```css
.Chart_LegendItem {
  align-items: center;
  gap: calc(var(--spacing) * 1.5);                        /* 6px */
  min-width: 0;
  max-width: 100%;
  padding: calc(var(--spacing) * 1) calc(var(--spacing) * 2);  /* 4px 8px */
  border-radius: var(--radius-sm);                        /* 7.5px */
  color: inherit;
  transition: background-color .15s, opacity .15s;
  display: flex;
}

.Chart_LegendItem:hover,
.Chart_LegendToggle:focus-visible,
.Chart_LegendItem[data-w-selected] {
  background: var(--color-surface-tertiary);             /* 三级表面色 */
}

.Chart_LegendItem[data-w-hidden] {
  opacity: .4;                                            /* 隐藏的数据系列 40% 透明 */
}

.Chart_LegendToggle:focus-visible {
  outline: 2px solid var(--color-ring);                  /* 焦点环 */
  outline-offset: 2px;                                   /* 偏移 2px */
}

.Chart_LegendToggle {
  cursor: pointer;
  background: 0 0;
  border: 0;
}

.Chart_LegendItemMarker {
  border-radius: var(--radius-full);                     /* 圆形 */
  flex: none;
  width: 10px;
  height: 10px;
}

.Chart_LegendItemLabel {
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
}

.Chart_LegendSelectedIcon {
  width: 12px;
  height: 12px;
  color: var(--color-text-secondary);
  flex: none;
}
```

### 5.2 三态对比

| 状态 | 触发 | background | opacity |
|------|------|------------|---------|
| default | — | transparent | 1 |
| hover | `:hover` | `--color-surface-tertiary` | 1 |
| focus | `:focus-visible` | `--color-surface-tertiary` + 2px ring | 1 |
| selected | `[data-w-selected]` | `--color-surface-tertiary` | 1 |
| hidden | `[data-w-hidden]` | transparent | 0.4 |

### 5.3 关键设计

#### 5.3.1 `flex: none` for Marker

```css
.Chart_LegendItemMarker {
  flex: none;          /* 不收缩 */
  width: 10px;
  height: 10px;
}
```

**含义**：marker 不参与 flex 收缩，保持固定 10×10px。当 legend 文本很长时，文本截断而不是 marker 缩小。

#### 5.3.2 `text-overflow: ellipsis` for Label

```css
.Chart_LegendItemLabel {
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;        /* 允许收缩到 0 */
  overflow: hidden;
}
```

**含义**：标签过长时显示省略号。`min-width: 0` 是 flexbox 必需的，否则文本不会截断。

#### 5.3.3 `outline-offset: 2px`

```css
.Chart_LegendToggle:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 2px;
}
```

**含义**：焦点环偏移 2px，不遮挡 legend 内容。

#### 5.3.4 `transition: background-color .15s, opacity .15s`

```css
.Chart_LegendItem {
  transition: background-color .15s, opacity .15s;
}
```

**含义**：背景色和透明度都用 0.15s 过渡（默认时长），但**形状不变**（避免 layout shift）。

---

## 6. Chart Tooltip — 数据悬浮卡

### 6.1 完整 CSS

```css
.Chart_ChartTooltip {
  align-items: start;
  gap: calc(var(--spacing) * 1.5);                        /* 6px */
  padding: calc(var(--spacing) * 2) calc(var(--spacing) * 3);  /* 8px 12px */
  border-radius: var(--radius-md);                        /* 10px */
  background: var(--color-surface-elevated);             /* elevated 表面色 */
  box-shadow: var(--shadow), var(--shadow-hairline);     /* 双阴影 */
  font-size: var(--font-text-xs-size);                   /* 12px */
  line-height: var(--font-text-xs-line-height);
  display: grid;
}
```

### 6.2 关键设计

#### 6.2.1 双阴影叠加

```css
box-shadow: var(--shadow), var(--shadow-hairline);
```

**含义**：标准阴影 + hairline 边框（模拟 0.5px 边框）。

**与 dropdown 的对比**：
- dropdown：`--shadow-xl-spread`（hairline + xl 复合）
- chart tooltip：`--shadow` + `--shadow-hairline`（分离，更轻）

chart tooltip 阴影更轻，因为它是"跟随鼠标"的瞬时元素，不需要太强的"浮起"感。

#### 6.2.2 `display: grid` + `align-items: start`

```css
display: grid;
align-items: start;
```

**含义**：tooltip 内容用 grid 布局，每行左对齐。适合多行数据（系列名 + 值）。

#### 6.2.3 字号 12px（xs）

```css
font-size: var(--font-text-xs-size);  /* 12px */
```

**为什么用 xs 而不是 sm (14px)**：tooltip 是"瞬时信息"，应该比主内容更小、更轻，避免遮挡图表。

---

## 7. Chart Scroll 容器

### 7.1 完整 CSS

```css
.Chart_ScrollViewport {
  width: 100%;
  height: 100%;
}

.Chart_Scrollable {
  overflow: auto hidden;                                  /* 水平滚动，垂直隐藏 */
}

.Chart_ScrollLocked {
  overflow: hidden;                                       /* 锁定滚动 */
}

.Chart_ScrollContent {
  will-change: transform;
  min-width: 100%;
  height: 100%;
}

.Chart_ChartScrollable {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  display: block;
  overflow: hidden;
}

.Chart_ChartScrollable svg {
  transform: translateZ(0);                               /* GPU 加速 */
}
```

### 7.2 三种滚动模式

| 类 | 用途 | overflow |
|----|------|---------|
| `.Chart_Scrollable` | 允许水平滚动 | `auto hidden` |
| `.Chart_ScrollLocked` | 锁定滚动 | `hidden` |
| `.Chart_ChartScrollable` | SVG 容器 | `hidden` |

### 7.3 `will-change: transform` + `translateZ(0)`

```css
.Chart_ScrollContent {
  will-change: transform;
}

.Chart_ChartScrollable svg {
  transform: translateZ(0);
}
```

**性能优化**：
- `will-change: transform`：声明即将变化的属性
- `translateZ(0)`：提升 SVG 到合成层，滚动时独立绘制

**为什么需要**：图表 SVG 包含大量 path / circle / text 元素，滚动时如果不提升合成层会卡顿。

---

## 8. Box 布局原语

### 8.1 设计哲学

`Box_Box` 是 chart 系统的**通用布局原语**，用 data-attribute 驱动 flex 属性：

```css
.Box_Box {
  display: flex;
}

.Box_Box[data-w-align=start] { align-items: flex-start; }
.Box_Box[data-w-align=center] { align-items: center; }
.Box_Box[data-w-align=end] { align-items: flex-end; }
.Box_Box[data-w-align=baseline] { align-items: baseline; }
.Box_Box[data-w-align=stretch] { align-items: stretch; }

.Box_Box[data-w-justify=start] { justify-content: flex-start; }
.Box_Box[data-w-justify=center] { justify-content: center; }
.Box_Box[data-w-justify=end] { justify-content: flex-end; }
.Box_Box[data-w-justify=between] { justify-content: space-between; }
.Box_Box[data-w-justify=around] { justify-content: space-around; }
.Box_Box[data-w-justify=evenly] { justify-content: space-evenly; }
.Box_Box[data-w-justify=stretch] { justify-content: stretch; }

.Box_Box[data-w-wrap=nowrap] { flex-wrap: nowrap; }
.Box_Box[data-w-wrap=wrap] { flex-wrap: wrap; }
.Box_Box[data-w-wrap=wrap-reverse] { flex-wrap: wrap-reverse; }
```

### 8.2 优势

- **声明式**：通过 data-attribute 表达意图，不用写专用类
- **可组合**：`data-w-align="center" data-w-justify="between"` 自然组合
- **可读性**：HTML 直接表达布局语义

### 8.3 辅助属性

```css
.Box_Box[data-w-clip] { overflow: hidden; }
.Box_Box[data-w-scrollable] { overflow: auto; }

.Box_Box[data-w-direction=col] { flex-direction: column; }
.Box_Box[data-w-direction=col] > [data-w-component=image]:not([data-w-has-width][data-w-has-height]) {
  aspect-ratio: 16/9;                                     /* 列布局：图片 16:9 */
}

.Box_Box[data-w-direction=row] > [data-w-component=image]:not([data-w-has-width][data-w-has-height]) {
  aspect-ratio: 1;                                        /* 行布局：图片 1:1 */
}

.Box_Box[data-w-direction=row] > [data-w-component=image]:not([data-w-has-width], [data-w-has-height]) {
  width: 40px;                                            /* 默认图片 40px */
}

.Box_Box[data-w-direction=row] > .Box_Box:not([data-w-has-width]) {
  min-width: 0;                                           /* 允许子 Box 收缩 */
}
```

### 8.4 hover 状态

```css
.Box_Box[data-w-hover-background] {
  transition: background-color .15s;
}

@media (hover: hover) and (pointer: fine) {
  .Box_Box[data-w-hover-background]:hover {
    background-color: var(--box-hover-background-color);
  }
}
```

**注意**：hover 样式必须在 `@media (hover: hover) and (pointer: fine)` 内，避免触屏设备 hover 卡住。

---

## 9. 性能优化

### 9.1 SVG 合成层

```css
.Chart_ChartScrollable svg {
  transform: translateZ(0);
}
```

**效果**：SVG 独立合成层，滚动/动画不触发父级重绘。

### 9.2 `will-change: transform`

```css
.Chart_ScrollContent {
  will-change: transform;
}
```

**效果**：浏览器提前为 transform 变化做准备，避免首次滚动卡顿。

### 9.3 `overflow: visible` for SVG surface

```css
.Chart_Chart .recharts-surface {
  overflow: visible;
}
```

**效果**：SVG 内容可以溢出边界（如 tooltip），不受 clip 限制。

**注意**：需要配合外层 `.Chart_ChartScrollable` 的 `overflow: hidden` 防止整体溢出。

### 9.4 content-visibility（如果支持）

对于密集图表（如 100+ 数据点），可以在数据 series 上加：

```css
.Chart_InteractiveSeries {
  content-visibility: auto;
  contain: layout paint style;
}
```

**注意**：这会让屏幕外的 series 不渲染，但可能影响 tooltip 定位，需要测试。

---

## 10. 无障碍

### 10.1 Chart 的 ARIA

```html
<div
  class="Chart_Chart"
  role="img"
  aria-label="{chart-title}: {chart-summary}"
  aria-describedby="chart-desc"
>
  <div id="chart-desc" class="sr-only">
    This chart shows {data-description}. {data-summary}.
  </div>
  <!-- SVG 内容 -->
</div>
```

**规则**：
- 整体 `role="img"` + `aria-label` 包含标题和数据摘要
- 用 `aria-describedby` 提供详细描述
- 数据摘要应包含关键数值（如"最高 X，最低 Y"）

### 10.2 Legend 的 ARIA

```html
<button
  class="Chart_LegendToggle"
  aria-pressed="true"
  aria-label="Toggle {series-name} series visibility"
>
  <span class="Chart_LegendItemMarker" style="background: {series-color}" aria-hidden="true"></span>
  <span class="Chart_LegendItemLabel">{series-name}</span>
  <svg class="Chart_LegendSelectedIcon" aria-hidden="true">...</svg>
</button>
```

**规则**：
- legend 项用 `<button>` + `aria-pressed` 表达"显示/隐藏"状态
- `aria-label` 明确说明作用
- 颜色点和图标 `aria-hidden="true"`

### 10.3 Tooltip 的 ARIA

```html
<div
  class="Chart_ChartTooltip"
  role="tooltip"
  aria-live="polite"
>
  <!-- tooltip 内容 -->
</div>
```

**规则**：
- `role="tooltip"` + `aria-live="polite"` 让屏幕阅读器在 tooltip 出现时朗读
- tooltip 内容应该是有序的文本（系列名 + 值）

### 10.4 进度环的 ARIA

```html
<svg viewBox="0 0 100 100" role="progressbar" aria-valuenow="30" aria-valuemin="0" aria-valuemax="100" aria-label="Loading progress">
  <circle ... />
  <circle ... class="_fillOnMount_1crzc_1" />
</svg>
```

**规则**：
- `role="progressbar"` + `aria-valuenow/min/max`
- `aria-label` 描述进度含义
- SVG `<title>` 元素作为 fallback

---

## 11. Reduced Motion 策略

### 11.1 Progression Donut

```css
@media (prefers-reduced-motion: reduce) {
  ._fillOnMount_1crzc_1 {
    animation: none;           /* 直接显示最终态 */
  }
}
```

### 11.2 Chart Hover Transition

```css
/* hover transition 保留，因为不是"动画"而是"过渡" */
.Chart_LegendItem {
  transition: background-color .15s, opacity .15s;
}

/* 但可以在 reduced-motion 下加快 */
@media (prefers-reduced-motion: reduce) {
  .Chart_LegendItem {
    transition-duration: 0.01s;   /* 几乎瞬时 */
  }
}
```

### 11.3 Chart Scroll

不需要旁路——滚动是用户主动行为，不属于"动画"。

---

## 12. Do / Don't

### ✅ Do

- 进度环用 `stroke-dashoffset` + `stroke-linecap: round`
- 进度环动画用 `ease-out` + `0.3s` (relaxed)
- chart 轴标签用 `--color-text-secondary`（次级色）
- chart 网格线用 `--color-border`
- tooltip 用 `--shadow` + `--shadow-hairline` 双阴影
- legend 用 `<button>` + `aria-pressed` 表达切换状态
- 颜色点用 `flex: none` 保持 10×10px
- SVG 容器加 `transform: translateZ(0)` 提升合成层
- hover 样式用 `@media (hover: hover) and (pointer: fine)` 包裹

### ❌ Don't

- **不要**用品牌色 `#339cff` 作为 chart 数据色（让数据"中立"）
- **不要**让进度环用 `linear` 缓动（应该 `ease-out`）
- **不要**在 chart SVG 上加 `overflow: hidden`（会截断 tooltip）
- **不要**用 `<div>` 替代 `<button>` 作为 legend toggle
- **不要**让 legend marker 参与 flex 收缩（用 `flex: none`）
- **不要**在 tooltip 用 14px 字号（用 12px xs，避免遮挡）
- **不要**用 `box-shadow` 给 chart 加 hover（用 background 切换）
- **不要**让进度环在 reduced-motion 下仍播放动画
- **不要**用 `<img>` 替代 SVG 进度环（SVG 可控性更强）

---

## 13. 与 ClawX 的对齐建议

### 13.1 当前问题

- ClawX 没有统一 chart 主题（各处用不同 Recharts 配置）
- 进度指示用 spinner 而非 progression donut
- 没有 chart legend 的交互切换
- tooltip 直接用 Recharts 默认样式

### 13.2 迁移建议

1. 引入 `progression-donut` SVG 模式，替代所有 spinner
2. 建立 `chart-widget-stores.css` 作为唯一 chart 主题源
3. 所有 chart 必须用 `--color-text-secondary` / `--color-border` / `--alpha-10` 等 token
4. legend 用 `<button>` + `aria-pressed` 实现，支持键盘切换
5. tooltip 用 `--color-surface-elevated` + `--shadow` + `--shadow-hairline`
6. SVG 容器加 `transform: translateZ(0)` 提升合成层
7. 所有 chart 动画加 `@media (prefers-reduced-motion: reduce)` 旁路
