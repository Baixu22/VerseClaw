# 06 — 动画与过渡

> 动效是 Codex 体系里 **最克制** 的部分。本文档定义 transition / animation 的时长、缓动、应用场景，以及 reduced-motion 无障碍旁路。
>
> 来源：`FakeCoding-main/codex-reference/tokens.css`（motion 段）+ `codex-design-system.css` + shimmer 提取（`cadencedShimmer-extracted.js`）。
>
> **核心规则**：默认 `0.15s` / `cubic-bezier(0.4, 0, 0.2, 1)`；进入用 `ease-enter`（强减速）；所有动画必须带 `prefers-reduced-motion` 旁路；禁用长动画（除 shimmer 周期性）。

---

## 目录

1. [设计哲学](#设计哲学)
2. [Duration 时长](#duration-时长)
3. [Easing 缓动](#easing-缓动)
4. [Transition 应用场景](#transition-应用场景)
5. [Animation 关键帧](#animation-关键帧)
6. [Shimmer 子系统](#shimmer-子系统)
7. [Reduced-motion 旁路](#reduced-motion-旁路)
8. [Do / Don't](#do--dont)

---

## 设计哲学

Codex 的动效有三条铁律：

1. **快**：默认 `0.15s`。hover 反馈、颜色过渡、展开折叠都是 150ms。这是"开发者工具节奏"——用户在快速操作，动效不能拖后腿。
2. **有方向**：进入用 `ease-enter`（强减速，`cubic-bezier(0.19, 1, 0.22, 1)`），让元素"滑入到位"而非"匀速出现"；退出用 `ease-in`（加速），让元素"快速离开"。**禁用 `ease` / `linear`**（无方向感）。
3. **可关闭**：所有动画必须带 `@media (prefers-reduced-motion: reduce)` 旁路，把时长压到 `0.01ms`。这是无障碍红线，不是可选。

**Codex 的动效从不"表演"** —— 它们只反馈状态变化。没有视差滚动、没有滚动触发动画、没有渐入渐出 hero、没有数字 count-up。界面是工具，不是 demo。

---

## Duration 时长

### Token

```css
:root {
  --default-transition-duration: 0.15s;
  --transition-duration-basic: 0.15s;
  --transition-duration-relaxed: 0.3s;
}
```

### 时长阶

| Token | 时长 | 用途 |
|---|---|---|
| `--default-transition-duration` | 0.15s | **默认**（hover / color / 颜色过渡） |
| `--transition-duration-basic` | 0.15s | 别名（同上） |
| `--transition-duration-relaxed` | 0.3s | 宽松（modal 进入 / 大幅位移） |

### 使用对照

| 场景 | 时长 | 备注 |
|---|---|---|
| hover 颜色变化 | 0.15s | 默认 |
| 按钮 hover / active | 0.15s | 默认 |
| dropdown 展开 | 0.15s | 默认 |
| 行 hover | 0.15s | 默认 |
| tab 切换 | 0.15s | 默认 |
| sidebar 折叠/展开 | 0.3s | 宽松（大幅位移） |
| modal 进入 | 0.3s | 宽松（淡入 + 轻微缩放） |
| shimmer 周期 | 4s | 例外（周期性动画） |

### 关键规则

- **默认 150ms**。不要为"让 hover 更丝滑"加到 300ms —— 那是错的，会拖后腿。
- **大幅位移才用 300ms**。sidebar / modal 这种"元素整体位置变化"才用宽松时长。
- **禁用 >0.5s 的 transition**。除 shimmer（周期性，4s）外，没有动画超过 0.5s。
- **禁用 0s（无过渡）**。即时的颜色跳变很突兀，至少 0.15s。

---

## Easing 缓动

### Token

```css
:root {
  --default-transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-basic: ease;
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-enter: cubic-bezier(0.19, 1, 0.22, 1);
  --ease-enter-snappy: cubic-bezier(0.23, 1, 0.32, 1);
  --cubic-enter: cubic-bezier(0.19, 1, 0.22, 1);
}
```

### 缓动阶对照

| Token | 曲线特征 | 用途 |
|---|---|---|
| `--default-transition-timing-function` | 标准 ease-in-out | **默认** |
| `--ease-in-out` | 同上（别名） | 默认 |
| `--ease-enter` | **强减速**（快速开始，缓慢结束） | **进入动画**（dropdown 展开 / modal 淡入） |
| `--ease-enter-snappy` | 更快的强减速 | 紧凑进入（小 dropdown） |
| `--ease-out` | 减速（快速开始，缓慢结束） | 通用减速 |
| `--ease-in` | **加速**（缓慢开始，快速结束） | **退出动画**（dropdown 收起） |
| `--ease-basic` | CSS `ease` | 稀有，禁用 |

### 曲线分析

**`ease-enter` (`cubic-bezier(0.19, 1, 0.22, 1)`)**：
- 控制点 `(0.19, 1)` 和 `(0.22, 1)`
- 动画开始时快速前进（前 22% 时间内完成大部分位移），然后缓慢收敛到位
- 视觉效果：元素"嗖地一下飞到位，稳稳停住"
- 这是 **进入动画的标准**（dropdown / popover / modal 进入）

**`ease-in` (`cubic-bezier(0.4, 0, 1, 1)`)**：
- 控制点 `(0.4, 0)` 和 `(1, 1)`
- 动画开始时缓慢，结尾快速冲出去
- 视觉效果：元素"加速离开"
- 这是 **退出动画的标准**

**`default / ease-in-out` (`cubic-bezier(0.4, 0, 0.2, 1)`)**：
- 控制点 `(0.4, 0)` 和 `(0.2, 1)`
- 两端缓，中间快
- 视觉效果：双向过渡（hover 颜色变化等双向状态）
- 这是 **默认 transition**（hover / color / 通用状态切换）

### 关键规则

- **进入用 ease-enter**。dropdown 展开 / modal 淡入用 `--ease-enter`。
- **退出用 ease-in**。dropdown 收起用 `--ease-in`。
- **双向用 default**。hover / 颜色 / 选中态切换用 `--default-transition-timing-function`。
- **禁用 `ease` / `linear`**。无方向感，像 demo。

---

## Transition 应用场景

### 通用 transition（hover / color）

```css
.element {
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
              color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
              border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
```

**规则**：
- **列具体 property**。不要 `transition: all 0.15s` —— 那会让所有属性都过渡，包括 width / height / layout，造成卡顿。
- **颜色三件套**：`background-color` / `color` / `border-color` 一起列，因为 hover 通常三者都变。
- **0.15s + default easing**。

### Hover lift（行 / 卡片悬浮）

```css
.card--interactive {
  transition: box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.card--interactive:hover {
  box-shadow: var(--shadow-lg);
}
```

### Dropdown 展开（进入）

```css
.dropdown {
  transition: opacity 0.15s var(--ease-enter),
              transform 0.15s var(--ease-enter);
}
.dropdown--entering {
  opacity: 0;
  transform: scale(0.95);
}
.dropdown--entered {
  opacity: 1;
  transform: scale(1);
}
```

### Sidebar 折叠（大幅位移）

```css
.sidebar {
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Modal 进入

```css
.modal {
  transition: opacity 0.3s var(--ease-enter),
              transform 0.3s var(--ease-enter);
}
.modal--entering {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}
.modal--entered {
  opacity: 1;
  transform: scale(1) translateY(0);
}
```

---

## Animation 关键帧

### Spinner（加载）

```css
@keyframes spin {
  to { transform: rotate(360deg); }
}
.spinner {
  animation: spin 0.6s linear infinite;
}
```

**例外**：spinner 用 `linear`（不是 default easing），因为是 **周期性无限循环**，缓动会让它"一快一慢"看着抽搐。

### Pulse（脉冲 / 在线状态）

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
```

### Fade-in（淡入）

```css
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.fade-in {
  animation: fade-in 0.15s var(--ease-enter);
}
```

### Slide-in（侧滑进入）

```css
@keyframes slide-in-right {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.slide-in {
  animation: slide-in-right 0.3s var(--ease-enter);
}
```

---

## Shimmer 子系统

> Shimmer 是 Codex 唯一的 **复杂动画子系统**，用于"助手思考中"状态。来源：`FakeCoding-main/codex-conversation-render/04-thinking-shimmer/cadencedShimmer-extracted.js`（已提取成独立可读文件）。

### 节拍常量

```js
// cadencedShimmer 节拍常量（从提取文件确认）
const SHIMMER_DELAY = 600;     // 思考开始后 600ms 才显示 shimmer
const SHIMMER_SWEEP = 1000;    // 一次扫光 1s
const SHIMMER_PERIOD = 4000;   // 周期 4s
```

### 三层结构

```
W1 (条件包装) ─── 判断是否在思考中
  └── koc (核心节拍) ─── 控制 600ms 延迟 → 1s 扫光 → 4s 周期
        └── Aoc (ThinkingShimmer) ─── 实际渲染双图层扫光
```

### 双图层扫光

```css
.thinking-shimmer {
  position: relative;
  overflow: hidden;
}
.thinking-shimmer__layer-1 {
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in oklab, var(--gray-0) 8%, transparent) 50%,
    transparent 100%
  );
  animation: shimmer-sweep 4s var(--ease-enter) infinite;
}
.thinking-shimmer__layer-2 {
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in oklab, var(--gray-0) 4%, transparent) 50%,
    transparent 100%
  );
  animation: shimmer-sweep 4s var(--ease-enter) infinite;
  animation-delay: 2s;   /* 第二层错峰 2s */
}
@keyframes shimmer-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

### 关键规则

- **600ms 延迟**：思考开始后不立即显示 shimmer，等 600ms（避免短思考时闪烁）。
- **双层错峰**：两层扫光错开 2s（周期 4s 的一半），形成连续节拍。
- **8% + 4% 透明度**：主层 8% 白，副层 4% 白，OKLab mix。
- **4s 周期**：这是 Codex 唯一允许 >0.5s 的动画（因为是周期性，不是位移）。

### CSS 文件

- `codex-reference/css/thinking-shimmer-C-5BnEUj.css` — 主 shimmer CSS
- `codex-reference/css/shimmer-lines-yjvWUHPT.css` — shimmer lines（流式行）

---

## Reduced-motion 旁路

### 强制规则

**每一个 `transition` 和 `animation` 必须带 reduced-motion 旁路**。这是无障碍红线。

### 标准 pattern

```css
.element {
  transition: background-color 0.15s var(--default-transition-timing-function);
}

@media (prefers-reduced-motion: reduce) {
  .element {
    transition-duration: 0.01ms;
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }
}
```

### 全局 reset（推荐）

在全局 CSS 顶部加一段全局 reduced-motion reset，覆盖所有遗漏的动画：

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### shimmer 的 reduced-motion

shimmer 周期性动画在 reduced-motion 下应该 **完全关闭**（不显示扫光，只显示静态占位）：

```css
@media (prefers-reduced-motion: reduce) {
  .thinking-shimmer__layer-1,
  .thinking-shimmer__layer-2 {
    animation: none;
    opacity: 0;   /* 完全隐藏扫光 */
  }
  /* 显示静态占位（如 "Thinking..." 文本） */
  .thinking-shimmer__static {
    display: block;
  }
}
```

### 关键规则

- **不是可选**。每个动画都要带。
- **`0.01ms` 不是 `0ms`**。`0ms` 会让某些浏览器跳过 transition 完全，`0.01ms` 保留事件触发。
- **`animation-iteration-count: 1`**。无限循环动画在 reduced-motion 下只跑一次（spinner / pulse）。
- **shimmer 完全关闭**。周期性扫光在 reduced-motion 下应完全隐藏，不是"跑一次"。

---

## Do / Don't

### Do

```css
/* 通用 transition：列具体 property + default easing */
.btn {
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
              color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 进入动画用 ease-enter */
.dropdown--enter {
  animation: dropdown-enter 0.15s var(--ease-enter);
}

/* reduced-motion 旁路 */
@media (prefers-reduced-motion: reduce) {
  .btn { transition-duration: 0.01ms; }
}
```

### Don't

```css
/* ❌ transition: all（卡顿 + 不可控） */
.btn { transition: all 0.3s; }

/* ❌ ease / linear（无方向感） */
.dropdown { transition: opacity 0.3s ease; }

/* ❌ 长动画（除 shimmer） */
.modal { animation: modal-in 0.8s; }   /* 应是 0.3s */

/* ❌ 无 reduced-motion 旁路 */
.spinner { animation: spin 0.6s linear infinite; }
/* 缺 @media (prefers-reduced-motion: reduce) */

/* ❌ 0ms（让浏览器跳过） */
@media (prefers-reduced-motion: reduce) {
  .btn { transition-duration: 0ms; }   /* 应是 0.01ms */
}

/* ❌ 视差滚动 / 滚动触发动画（Codex 不用） */
.window { transform: translateY(calc(var(--scroll-y) * 0.5px)); }
```
