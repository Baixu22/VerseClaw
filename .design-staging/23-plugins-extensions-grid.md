---
doc: 23-plugins-extensions-grid
name: Plugins, Extensions Grid & PDF Preview
category: Subsystems
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/css/plugins-page-e7LodWnf.css
  - codex-reference/css/pdf-preview-panel-BHPFKiOr.css
  - codex-reference/css/chart-widget-stores-Bps-0OA4.css (Box 布局原语)
---

# 23 — Plugins, Extensions Grid & PDF Preview

> 插件市场网格、PDF 预览面板、Box 布局原语是 Codex "可扩展子系统"的三块基石。本文规定容器查询驱动的响应式网格、PDF.js 文本/注释层规范、以及 `Box_Box` 布局原语的完整 API。

---

## 目录

1. [插件页响应式网格](#1-插件页响应式网格)
2. [PDF 预览面板](#2-pdf-预览面板)
3. [Box 布局原语](#3-box-布局原语)
4. [容器查询策略总结](#4-容器查询策略总结)
5. [Do / Don't](#do--dont)

---

## 1. 插件页响应式网格

### 1.1 完整源码

```css
/* plugins-page-e7LodWnf.css */

._container_3x1p4_1 {
  container-type: inline-size;
}

._grid_3x1p4_9 {
  grid-template-columns: repeat(1, minmax(0, 1fr));
}

@container (width >= 581px) {
  ._grid_3x1p4_9 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

### 1.2 规范解析

| 属性 | 值 | 说明 |
|---|---|---|
| `container-type` | `inline-size` | 容器查询基于 inline 方向（宽度） |
| 默认列数 | `repeat(1, minmax(0, 1fr))` | 单列布局 |
| 断点 | `581px` | 容器宽度 ≥ 581px 时切换为双列 |
| 断点后列数 | `repeat(2, minmax(0, 1fr))` | 双列等宽 |
| 列宽约束 | `minmax(0, 1fr)` | 最小 0（可收缩），最大 1fr（等分） |

### 1.3 设计意图

- **容器查询而非媒体查询**：网格列数由容器宽度决定，而非视口宽度。这让插件网格可以嵌入侧边栏、弹窗、全屏页面等任意容器，自动适配。
- **581px 断点**：双列切换点。单列时每个卡片最小宽度 = 容器宽度；双列时每个卡片宽度 ≈ (容器宽度 - gap) / 2。
- **`minmax(0, 1fr)`**：`min: 0` 允许卡片收缩到内容最小宽度，避免溢出；`max: 1fr` 保证等分。

### 1.4 响应式行为表

| 容器宽度 | 列数 | 卡片宽度（假设 gap=16px） |
|---|---|---|
| < 581px | 1 | 100% |
| ≥ 581px | 2 | (100% - 16px) / 2 |
| ≥ 1162px | 2（不扩展到 3） | (100% - 16px) / 2 |

> **注意**：Codex 插件网格**最多双列**，不会在超宽容器中扩展为三列。这是刻意约束——保持卡片尺寸在可读范围内，避免卡片过窄。

---

## 2. PDF 预览面板

### 2.1 文件范围

`pdf-preview-panel-BHPFKiOr.css` 定义了 PDF.js 渲染引擎的文本层与注释层样式，确保 PDF 内容在 Codex 暗色主题中正确显示。

### 2.2 页面容器

```css
.pdfPreviewPage {
  --scale-factor: 1;
  --user-unit: 1;
  --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
}
```

| 变量 | 默认值 | 用途 |
|---|---|---|
| `--scale-factor` | `1` | 缩放因子（由 JS 控制） |
| `--user-unit` | `1` | PDF 用户单位（通常为 1） |
| `--total-scale-factor` | 两者乘积 | 最终缩放倍率 |

### 2.3 文本层（textLayer）

```css
.pdfPreviewPage .textLayer {
  z-index: 1;
  text-align: initial;
  -webkit-text-size-adjust: none;
  -moz-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  line-height: 1;
  position: absolute;
  inset: 0;
  overflow: clip;
}
```

| 属性 | 值 | 说明 |
|---|---|---|
| `z-index` | `1` | 文本层在页面之上 |
| `text-size-adjust` | `none` | 禁用浏览器自动文字大小调整 |
| `forced-color-adjust` | `none` | 不跟随系统高对比度 |
| `transform-origin` | `0 0` | 左上角为缩放原点 |
| `line-height` | `1` | 紧密行高（PDF 精确定位） |
| `overflow` | `clip` | 裁剪溢出（不用 `hidden`，不创建滚动容器） |

### 2.4 文本 span 定位

```css
.pdfPreviewPage .textLayer :is(span, br) {
  color: #0000;              /* 透明文字（仅用于选择） */
  white-space: pre;           /* 保留空格 */
  cursor: text;
  transform-origin: 0 0;
  position: absolute;
}
```

> **关键设计**：文本层文字颜色为**透明**（`#0000`），因为 PDF 渲染的视觉效果由 canvas 层提供，文本层仅用于**选择/复制**。这是 PDF.js 的标准模式。

### 2.5 注释层（annotationLayer）

```css
.pdfPreviewPage .annotationLayer {
  z-index: 2;
  pointer-events: none;
  transform-origin: 0 0;
  position: absolute;
  inset: 0;
}

.pdfPreviewPage .annotationLayer section {
  box-sizing: border-box;
  text-align: initial;
  pointer-events: auto;
  transform-origin: 0 0;
  position: absolute;
}
```

| 属性 | 文本层 | 注释层 |
|---|---|---|
| `z-index` | 1 | 2 |
| `pointer-events` | 继承 | `none`（层穿透）→ `auto`（section 捕获） |
| `position` | absolute | absolute |

### 2.6 链接注释

```css
.pdfPreviewPage .annotationLayer :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton) > a {
  width: 100%;
  height: 100%;
  cursor: var(--cursor-interaction);
  position: absolute;
  inset: 0;
}

.pdfPreviewPage .annotationLayer .linkAnnotation:not(.hasBorder) > a:hover {
  background-color: #ff03;    /* 黄色 20% 透明度 */
}
```

| 状态 | 背景 | 说明 |
|---|---|---|
| 默认 | 透明 | 不可见 |
| hover（无边框链接） | `#ff03`（黄色 20%） | 微弱黄色高亮 |

### 2.7 选区样式

```css
.pdfPreviewPage .textLayer ::selection {
  background: color-mix(in srgb, AccentColor, transparent 75%);
}

.pdfPreviewPage .textLayer br::selection {
  background: 0 0;    /* br 不可选 */
}
```

> 使用 CSS `AccentColor` 关键字（跟随系统强调色），混合 75% 透明度，使选区在暗/亮主题中都自然。

### 2.8 endOfContent 滚动捕获

```css
.pdfPreviewPage .textLayer .endOfContent {
  z-index: 0;
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
  display: block;
  position: absolute;
  inset: 100% 0 0;
}

.pdfPreviewPage .textLayer.selecting .endOfContent {
  top: 0;
}
```

> `endOfContent` 是 PDF.js 的"滚动延伸区"——默认在页面下方（`inset: 100% 0 0`），选区拖拽时扩展到全页（`top: 0`），确保跨页选择不中断。

---

## 3. Box 布局原语

### 3.1 来源

`chart-widget-stores-Bps-0OA4.css` 中定义了 `Box_Box` 通用布局原语，它是 Codex 组件库的 Flexbox 快捷方式。

### 3.2 对齐属性

```css
.Box_Box[data-w-align=start]    { align-items: flex-start; }
.Box_Box[data-w-align=center]   { align-items: center; }
.Box_Box[data-w-align=end]      { align-items: flex-end; }
.Box_Box[data-w-align=baseline] { align-items: baseline; }
.Box_Box[data-w-align=stretch]  { align-items: stretch; }
```

### 3.3 分布属性

```css
.Box_Box[data-w-justify=start]    { justify-content: flex-start; }
.Box_Box[data-w-justify=center]   { justify-content: center; }
.Box_Box[data-w-justify=end]      { justify-content: flex-end; }
.Box_Box[data-w-justify=between]   { justify-content: space-between; }
.Box_Box[data-w-justify=around]   { justify-content: space-around; }
.Box_Box[data-w-justify=evenly]   { justify-content: space-evenly; }
.Box_Box[data-w-justify=stretch]  { justify-content: stretch; }
```

### 3.4 换行与方向

```css
.Box_Box[data-w-wrap=nowrap]        { flex-wrap: nowrap; }
.Box_Box[data-w-wrap=wrap]          { flex-wrap: wrap; }
.Box_Box[data-w-wrap=wrap-reverse]  { flex-wrap: wrap-reverse; }

.Box_Box[data-w-direction=col]  { flex-direction: column; }
.Box_Box[data-w-direction=row]  { flex-direction: row; }
```

### 3.5 溢出与过渡

```css
.Box_Box[data-w-clip]              { overflow: hidden; }
.Box_Box[data-w-scrollable]        { overflow: auto; }
.Box_Box[data-w-hover-background]  { transition: background-color .15s; }

@media (hover: hover) and (pointer: fine) {
  .Box_Box[data-w-hover-background]:hover {
    background-color: var(--box-hover-background-color);
  }
}
```

> **hover 媒体查询**：仅在支持 hover 的设备（非触屏）上启用 hover 效果。

### 3.6 图片子元素规则

```css
/* col 方向 + 无显式尺寸的图片 → 16:9 */
.Box_Box[data-w-direction=col] > [data-w-component=image]:not([data-w-has-width][data-w-has-height]) {
  aspect-ratio: 16/9;
}

/* row 方向 + 无显式尺寸的图片 → 1:1 */
.Box_Box[data-w-direction=row] > [data-w-component=image]:not([data-w-has-width],[data-w-has-height]) {
  aspect-ratio: 1;
}

/* row 方向无宽度的图片 → 40px */
.Box_Box[data-w-direction=row] > [data-w-component=image]:not([data-w-has-width]) {
  width: 40px;
}

/* row 方向的子 Box 最小宽度 0（可收缩） */
.Box_Box[data-w-direction=row] > .Box_Box:not([data-w-has-width]) {
  min-width: 0;
}
```

### 3.7 Box 完整 API 表

| 属性 | data-w-* 值 | CSS 映射 |
|---|---|---|
| align | `start`/`center`/`end`/`baseline`/`stretch` | `align-items` |
| justify | `start`/`center`/`end`/`between`/`around`/`evenly`/`stretch` | `justify-content` |
| wrap | `nowrap`/`wrap`/`wrap-reverse` | `flex-wrap` |
| direction | `col`/`row` | `flex-direction` |
| clip | (boolean) | `overflow: hidden` |
| scrollable | (boolean) | `overflow: auto` |
| hover-background | (boolean) | `transition: background-color .15s` + hover |

---

## 4. 容器查询策略总结

### 4.1 Codex 容器查询使用模式

| 组件 | 容器名 | 断点 | 策略 |
|---|---|---|---|
| 插件网格 | （匿名） | 581px | 1→2 列 |
| 演示面板 | `presentation-editor` | 748px / 688px / 749px | 三态切换 |
| Mermaid 宽块 | （匿名 cqi） | 无断点 | 流体宽度 |

### 4.2 容器查询 vs 媒体查询选择规则

| 场景 | 选择 | 原因 |
|---|---|---|
| 组件内响应式（网格列数、面板形态） | 容器查询 | 组件可嵌入任意容器 |
| 浮层尺寸约束（tooltip 高度） | 视口查询 | 浮层需要全局视口约束 |
| 字体加载（远程编辑） | 无 | 字体不依赖容器/视口 |

---

## 5. Do / Don't

### Do

- 用 `container-type: inline-size` 建立容器查询上下文
- 用 `minmax(0, 1fr)` 保证网格列可收缩
- PDF 文本层用透明文字 + canvas 渲染
- 用 `Box_Box` data 属性代替重复的 flex utility class
- hover 效果用 `@media (hover: hover) and (pointer: fine)` 包裹

### Don't

- 不要用视口媒体查询驱动组件内部网格列数
- 不要让 PDF 文本层文字可见（会与 canvas 重叠）
- 不要在 `Box_Box` 中硬编码 `flex-direction`，用 `data-w-direction`
- 不要在超宽容器中自动扩展到 3+ 列（Codex 最多双列）
- 不要用 `overflow: hidden` 代替 `overflow: clip`（clip 不创建滚动容器）

---

## 来源

- `FakeCoding-main/codex-reference/css/plugins-page-e7LodWnf.css`（插件网格）
- `FakeCoding-main/codex-reference/css/pdf-preview-panel-BHPFKiOr.css`（PDF 预览）
- `FakeCoding-main/codex-reference/css/chart-widget-stores-Bps-0OA4.css`（Box 原语）
