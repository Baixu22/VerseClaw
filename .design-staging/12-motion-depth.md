# 12 — 动效深度规范

> 本文是 [06-motion.md](./06-motion.md) 的**生产级深挖**,基于 Codex Electron asar 提取的原始 JS/CSS 源码逐行核对。06 解决"动效该用什么时长/缓动",12 解决"复杂场景如何编排、如何退让、如何不卡顿"。
>
> 来源(均为已逐行核对的源文件):
> - `FakeCoding-main/codex-conversation-render/02-assistant-message/prettified/markdown-DiI4eNZk.pretty.js`(stagger 引擎)
> - `FakeCoding-main/codex-conversation-render/02-assistant-message/prettified/code-snippet-CE90EJ2C.pretty.js`(streaming 高亮防抖)
> - `FakeCoding-main/codex-conversation-render/02-assistant-message/prettified/copy-button-CLHBBPl_.pretty.js`(copy 反馈)
> - `FakeCoding-main/codex-conversation-render/02-assistant-message/prettified/chatgpt-conversation-page-CVTdydPj.pretty.js`(自动跟底)
> - `FakeCoding-main/codex-conversation-render/01-user-message/prettified/thread-virtualizer-43g3Bw27.pretty.js`(虚拟列表)
> - `FakeCoding-main/codex-conversation-render/04-thinking-shimmer/cadencedShimmer-extracted.js`(cadenced shimmer)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/app-main-DtaE1-1W.pretty.css`(toast/curtain/content switch)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/model-picker-power-slider-impl-ShOI3rhA.pretty.css`(三轨动画 + 粒子爆裂)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/mermaid-diagram-shell-Bvc_FFGx.pretty.css`(fade-in keyframes)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/app-VS6Z-TiK.pretty.css`(Tailwind 标准 keyframes + active:scale-*)
>
> **核心规则**:进入/退出**不对称**(进入慢、退出快);stagger 用 `--fade-delay` CSS 变量驱动,JS 只计算不直接动 style;周期动画必须显式 `will-change`;**所有 keyframes 必须带 `prefers-reduced-motion` 旁路**,且 shimmer 类周期动画必须**完全关闭**而非"跑一次";`will-change` 在动画结束 1 帧后必须移除。

---

## 目录

1. [设计哲学升级](#设计哲学升级)
2. [Stagger 编排引擎](#stagger-编排引擎)
3. [三轨并行编排](#三轨并行编排)
4. [进入/退出不对称规则](#进入退出不对称规则)
5. [微交互与触感反馈](#微交互与触感反馈)
6. [滚动行为与自动跟底](#滚动行为与自动跟底)
7. [状态指示动效谱系](#状态指示动效谱系)
8. [Reduced-motion 退让策略](#reduced-motion-退让策略)
9. [性能预算与 will-change 管理](#性能预算与-will-change-管理)
10. [Token 阶梯总表](#token-阶梯总表)
11. [Do / Don't](#do--dont)

---

## 设计哲学升级

06 给出的三条铁律(快、有方向、可关闭)在本文升维为**六条**:

1. **快** —— 默认 150ms,大幅位移 300ms,只有周期性动画允许 >0.5s
2. **有方向** —— 进入用 `ease-enter`(强减速),退出用 `ease-in`(加速),双向状态用 `default`
3. **不对称** —— 进入与退出**时长不同、缓动不同、位移方向相反**(详见第 4 节)
4. **可编排** —— stagger 用 `--fade-delay` CSS 变量驱动,JS 只算延迟、不动 style;多条轨道并行时各自独立时长(详见第 2、3 节)
5. **可退让** —— `prefers-reduced-motion: reduce` 下,不仅时长压到 `0.01ms`,**周期性动画必须完全关闭**;`will-change` 必须在动画后清理
6. **可预测** —— `will-change` 必须显式声明且必须移除;动画必须在主线程之外(GPU 合成)—— 只动 `transform` / `opacity`,**不动 layout 属性**(`width`/`height`/`top`/`left`)

**Codex 的动效从不"表演"** —— 它们只反馈状态变化。这一条在 06 已立,12 再次强调:视差、滚动触发、hero 渐入、count-up、3D 翻转、弹性回弹超过 1.05,这些都**不在 Codex 词汇表里**。

---

## Stagger 编排引擎

> 这是 Codex 流式渲染的**核心动效子系统**。当对话流式输出时,新段落(`hr` / `li` / `tr` / `blockquote` / `fadeIn` 段)**不是同时淡入**,而是按到达顺序排成一条时间线,前段先入、后段跟进,形成"逐段铺开"的视觉节奏。

### 引擎结构(三层)

```
┌─────────────────────────────────────────────┐
│ Timeline (per conversation)                 │
│   delayMsByKey: Map<segmentKey, delayMs>    │  ← 每段最终延迟
│   nextSegmentStartAtMs: number              │  ← 全局时间线指针
│   settledKeys: Set<segmentKey>              │  ← 已播完动画的段
├─────────────────────────────────────────────┤
│ wT(element, segmentKey, timeline)           │  ← 时间线分配器
│   计算 delay → 注入 --fade-delay CSS 变量     │
│   推进 nextSegmentStartAtMs                  │
├─────────────────────────────────────────────┤
│ AT(className, segmentKey, segmentIndex)     │  ← React 属性工厂
│   返回 { className, onAnimationEnd, ref,    │
│          style: { --fade-delay: ... } }      │
└─────────────────────────────────────────────┘
```

### 核心算法(三函数)

**`TT(segmentIndex)`** —— 基于段索引的初始延迟计算:

```js
function TT({ fadeSegmentDelayMs, fadeSegmentMaxDelayMs, segmentIndex }) {
  let r = segmentIndex * fadeSegmentDelayMs;       // 线性阶梯:N * 16ms
  return fadeSegmentMaxDelayMs == null || r <= fadeSegmentMaxDelayMs
    ? r                                            // 未超 maxDelay,线性增长
    : fadeSegmentMaxDelayMs + (segmentIndex - Math.floor(fadeSegmentMaxDelayMs / fadeSegmentDelayMs)) * ET({
        fadeSegmentDelayMs, fadeSegmentMaxDelayMs, segmentDelayMs: fadeSegmentMaxDelayMs
      });
}
```

**`ET(segmentDelayMs)`** —— 超过 maxDelay 后的衰减因子:

```js
const DT = 0.25;  // 衰减系数:超过 maxDelay 后,后续段延迟变为 25%
const OT = 1;     // 最小延迟:1ms(不是 0,避免浏览器跳过)

function ET({ fadeSegmentDelayMs, fadeSegmentMaxDelayMs, segmentDelayMs }) {
  return fadeSegmentMaxDelayMs == null || segmentDelayMs < fadeSegmentMaxDelayMs
    ? fadeSegmentDelayMs
    : Math.max(OT, fadeSegmentDelayMs * DT);       // 衰减到 25%,最低 1ms
}
```

**`wT(element, segmentKey, timeline)`** —— 全局时间线串联(关键):

```js
function wT({ element, fadeSegmentDelayMs, fadeSegmentMaxDelayMs, segmentKey, timeline }) {
  let a = timeline.delayMsByKey.get(segmentKey);
  if (a != null) {                                  // 已分配过,直接复用
    element.style.setProperty('--fade-delay', `${a}ms`);
    return;
  }
  let now = performance.now();
  let startAt = Math.max(timeline.nextSegmentStartAtMs, now);  // 不能早于上一段
  let delay = Math.max(Math.round(startAt - now), 0);          // 本段相对延迟
  timeline.delayMsByKey.set(segmentKey, delay);
  timeline.nextSegmentStartAtMs = startAt + ET({                // 推进全局时间线
    fadeSegmentDelayMs, fadeSegmentMaxDelayMs, segmentDelayMs: delay
  });
  element.style.setProperty('--fade-delay', `${delay}ms`);     // 只动 CSS 变量
}
```

### 实际参数(从 `use-chatgpt-composer-controller` 提取)

```js
// codex-conversation-render/03-tool-calls/prettified/use-chatgpt-composer-controller-DxNZRylk.pretty.js:43829
Xw = 16;   // fadeSegmentDelayMs = 16ms
Zw = 96;   // fadeSegmentMaxDelayMs = 96ms
```

**衰减节奏可视化**:

| 段索引 | 计算式 | 延迟(ms) | 说明 |
|---|---|---|---|
| 0 | `0 * 16` | 0 | 首段立即 |
| 1 | `1 * 16` | 16 | 线性 |
| 2 | `2 * 16` | 32 | 线性 |
| 3 | `3 * 16` | 48 | 线性 |
| 4 | `4 * 16` | 64 | 线性 |
| 5 | `5 * 16` | 80 | 线性 |
| 6 | `6 * 16` | 96 | 到达 maxDelay |
| 7 | `96 + 1 * 4` | 100 | 衰减为 25%(16 × 0.25 = 4) |
| 8 | `96 + 2 * 4` | 104 | |
| 9 | `96 + 3 * 4` | 108 | |
| ... | `96 + N * 4` | 96 + 4N | 最低保留 1ms |

**效果**:前 6 段(0-96ms)线性递增,第 7 段起衰减为 4ms 间隔,确保长输出时后续段不会"堆积等待",而是快速跟进。

### CSS 应用规则

```css
/* mermaid-diagram-shell-Bvc_FFGx.pretty.css:255-275 */
._markdownRoot_l45ev_871 ._fadeIn_l45ev_871,
._markdownRoot_l45ev_871 hr,
._markdownRoot_l45ev_871 li,
._markdownRoot_l45ev_871 tr,
._markdownRoot_l45ev_871 blockquote {
  opacity: 0;
  animation: _fade-in_l45ev_1
    var(--duration, var(--transition-duration-basic))   /* 0.15s */
    var(--fade-easing, cubic-bezier(.37, .55, .86, .88)) forwards;
  animation-delay: var(--fade-delay, 0s);               /* 由 JS 注入 */
}

._markdownRoot_l45ev_871 ._fadeListDecoration_l45ev_893::marker {
  animation: _fade-in-marker_l45ev_1
    var(--duration, var(--transition-duration-basic))
    var(--fade-easing, cubic-bezier(.37, .55, .86, .88)) forwards;
  animation-delay: var(--fade-delay, 0s);
}

._markdownRoot_l45ev_871 ._imageEnter_l45ev_905 {
  transform-origin: 50%;
  animation: 0.18s ease-out both _image-enter_l45ev_1;
}

@keyframes _fade-in_l45ev_1 { to { opacity: 1 } }
@keyframes _fade-in-marker_l45ev_1 { 0% { color: #0000 } }
@keyframes _image-enter_l45ev_1 {
  0% { opacity: 0; transform: scale(0.98) }
  to { opacity: 1; transform: scale(1) }
}
```

### 专属缓动

fade-in 不用 `--ease-enter`,而用一个**专属缓动** `cubic-bezier(0.37, 0.55, 0.86, 0.88)`。这条曲线比 `ease-enter`(`0.19, 1, 0.22, 1`)更"稳":开头不那么冲,结尾更慢,适合"段落轻轻落位"的视觉语义。**禁止用 `ease-enter` 替代**。

### React 属性工厂

```js
// markdown-DiI4eNZk.pretty.js:7827-7840
function AT({ className, fadeSegmentDelayMs, fadeSegmentMaxDelayMs, segmentIndex, segmentKey, timeline }) {
  return {
    // 已 settled 的段不再加 fadeIn 类(避免重复动画)
    className: segmentKey != null && timeline?.settledKeys.has(segmentKey) === true ? undefined : className,
    onAnimationEnd: segmentKey == null || timeline == null ? undefined : (e) => {
      if (e.target === e.currentTarget) timeline.settledKeys.add(segmentKey);
    },
    ref: timeline == null || segmentKey == null || fadeSegmentDelayMs <= 0 ? undefined : (el) => {
      if (el != null) wT({ element: el, fadeSegmentDelayMs, fadeSegmentMaxDelayMs, segmentKey, timeline });
    },
    style: fadeSegmentDelayMs <= 0 ? undefined : {
      '--fade-delay': `${(segmentKey == null ? undefined : timeline?.delayMsByKey.get(segmentKey)) ??
        TT({ fadeSegmentDelayMs, fadeSegmentMaxDelayMs, segmentIndex })}ms`
    }
  };
}
```

### 关键规则

- **CSS 变量驱动**:JS 只算延迟、注入 `--fade-delay`,**不直接动 `style.animationDelay`**。这让 CSS 可以独立覆盖 `--duration` 和 `--fade-easing`。
- **全局时间线**:`nextSegmentStartAtMs` 确保**后到达的段不会插队**——即使 React 渲染顺序乱了,视觉上仍按到达顺序排列。
- **settled 标记**:`onAnimationEnd` 触发后,段被加入 `settledKeys`,**后续重渲染不再重复动画**。这是流式增量输出时不闪烁的关键。
- **段类型区分**:`task` 用 `fadeIn` 类(整体淡入),普通列表项的 marker 用 `fadeListDecoration` 类(仅 `::marker` 淡入)。

### ClawX 迁移要点

ClawX 当前的对话渲染**完全没有 stagger**——新段落直接出现。迁移时:
1. 在 `TurnList` 上层维护 `Timeline` ref(每会话一份)
2. 在每个 `TurnItem` / `MessageSegment` 上调用 `AT()` 工厂
3. CSS 引入 `_fadeIn_l45ev_871` 类与 `--fade-delay` 变量
4. **参数保持 16/96**,不要"优化"成 8/64 或 32/128——这是实测调过的节奏

---

## 三轨并行编排

> 当一个状态切换涉及**多个视觉属性同时变化**(如 scale + translate + fade),Codex 用**多条独立 keyframe 并行**而非单一复合 keyframe。这让每条轨道可以独立控制时长、缓动、延迟。

### 例子:FastMode Tick 进入/退出

**进入态(三轨并行)**:

```css
/* model-picker-power-slider-impl-ShOI3rhA.pretty.css:251-261 */
._Root_m3zgh_37[data-fast-mode-dot-transition=entering]:not([data-max=true]) ._Tick_m3zgh_79[data-selected=true] {
  animation:
    0.8s  cubic-bezier(0.23, 1, 0.32, 1) both           _FastModeTickScale_m3zgh_1,        /* 轨1:scale */
    1.15s ease-in-out                      50ms both    _FastModeTickTranslate_m3zgh_1,    /* 轨2:translate,延迟 50ms */
    0.5s  ease-in-out                       0.7s both   _FastModeTickFade_m3zgh_1;         /* 轨3:fade,延迟 700ms */
}

@keyframes _FastModeTickScale_m3zgh_1 {
  0%   { transform: translate(-50%, -50%) scale(0.75) }
  to   { transform: translate(-50%, -50%) scale(1) }
}
@keyframes _FastModeTickTranslate_m3zgh_1 {
  0%   { translate: 10px }
  to   { translate: 0 }
}
@keyframes _FastModeTickFade_m3zgh_1 {
  0%   { opacity: 0 }
  to   { opacity: 1 }
}
```

**退出态(三轨并行,更快)**:

```css
._Root_m3zgh_37[data-fast-mode-dot-transition=exiting]:not([data-max=true]) ._Tick_m3zgh_79[data-selected=true] {
  animation:
    0.35s ease-in-out both _FastModeTickReturnScale_m3zgh_1,        /* scale 0.35s */
    0.35s ease-out    both _FastModeTickReturnTranslate_m3zgh_1,    /* translate 0.35s */
    0.2s  ease-in-out both _FastModeTickReturnFade_m3zgh_1;         /* fade 0.2s */
}
```

### 轨道编排原则

| 原则 | 说明 |
|---|---|
| **进入时长 > 退出时长** | 进入 scale 0.8s,退出 scale 0.35s(约 2.3:1) |
| **延迟递进** | 进入时 scale 0ms → translate 50ms → fade 700ms,让 scale 先动、translate 跟进、fade 最后揭示 |
| **退出无延迟** | 退出时三轨同时启动,但 fade 仅 0.2s(最快),让元素"先消失再收缩" |
| **缓动选型** | scale 用 `cubic-bezier(.23, 1, .32, 1)`(强减速);translate/fade 用 `ease-in-out`(双向) |

### 何时用三轨

只有**状态切换涉及 ≥3 个独立视觉属性**时才用三轨。普通 hover / 颜色变化用单条 transition 即可。Codex 中三轨用于:
- FastMode tick(状态切换)
- 粒子爆裂(16 个粒子各自 nth-child,详见第 5 节)
- Composer 容器在 single-line ↔ multi-line 切换时(scale + radius + height)

---

## 进入/退出不对称规则

> 06 提到"进入用 ease-enter,退出用 ease-in",12 给出**完整不对称矩阵**。

### 不对称三要素

1. **时长不对称**:进入 > 退出(约 1.5:1 到 2:1)
2. **缓动不对称**:进入用强减速(`ease-enter` / `cubic-bezier(.175, .885, .32, 1)`),退出用加速(`ease-in` / `cubic-bezier(.4, 0, 1, 1)`)
3. **位移方向不对称**:进入"从远到近"(向下 8px),退出"从近到远"(向上 4px,距离减半)

### Codex 实测数据

| 场景 | 进入时长 | 进入缓动 | 退出时长 | 退出缓动 | 进入位移 | 退出位移 |
|---|---|---|---|---|---|---|
| **Toast** | 0.25s | `cubic-bezier(.175, .885, .32, 1)` (easeOut) | 0.25s | `cubic-bezier(.4, 0, 1, 1)` (easeIn) | translateY(-4px → 0) | 无位移(仅淡出) |
| **Curtain** | 0.11s | `cubic-bezier(.2, .8, .2, 1)` | 0.11s | 同进入 | scale(1.01 → 1) | scale(1 → 1.01) |
| **Content switch** | 0.26s | `cubic-bezier(.16, 1, .3, 1)` | 0.18s | `cubic-bezier(.4, 0, 1, 1)` | translateY(8px → 0) + scale(0.98 → 1) | translateY(0 → -4px) + scale(1 → 0.99) |
| **ModelPicker dropdown** | 0.32s | `cubic-bezier(.23, 1, .32, 1)` | (Radix unmount) | — | scale(0.98 → 1) + opacity | — |
| **Subagent chip** | 0.28s | `cubic-bezier(.23, 1, .32, 1)` | — | — | translate(-8px, 4px) → (0,0) + scale(0.92 → 1) | — |
| **FastMode tick** | 0.8s | `cubic-bezier(.23, 1, .32, 1)` | 0.35s | ease-in-out | scale(0.75 → 1) | scale(0.75 → 1) |

### 关键规则

- **退出时长 = 进入时长的 50%-70%**:Toast 1:1(例外,因仅淡出);Content 0.26:0.18 ≈ 1.44:1;FastMode 0.8:0.35 ≈ 2.3:1
- **退出位移 = 进入位移的 50%**:Content 进入 8px,退出 4px(50%)
- **退出方向相反**:进入向下,退出向上;进入放大,退出缩小
- **退出仅淡出优先**:若退出场景不强调"离开方向",仅用 opacity 淡出(toast 退出无位移)

### 反例(禁用)

- 进入 0.3s ease-out,退出 0.3s ease-out(对称)—— 没有"离开感"
- 进入 translateY(8px),退出 translateY(8px)(同向)—— 没有"回弹感"
- 进入 0.5s,退出 0.1s(差距过大)—— 退出太快,用户来不及感知

---

## 微交互与触感反馈

### 1. 按钮 active scale 阶梯

```css
/* app-VS6Z-TiK.pretty.css:10657-10669 */
.active\:scale-95:active              { scale: 0.95 }      /* 主按钮:5% 缩小 */
.active\:scale-\[0\.97\]:active       { scale: 0.97 }      /* 强反馈 */
.active\:scale-\[0\.98\]:active       { scale: 0.98 }      /* 标准按钮(最常用) */
.active\:scale-\[0\.99\]:active       { scale: 0.99 }      /* 轻反馈 */
.active\:scale-\[0\.995\]:active      { scale: 0.995 }     /* 极轻反馈(图标按钮) */

.motion-reduce\:active\:scale-100:active { scale: 1 }      /* reduced-motion:不缩放 */
```

**分级规则**:
- 主按钮(primary):`active:scale-95`(5%,最明显)
- 次要按钮(secondary):`active:scale-[0.98]`(2%)
- 图标按钮(icon):`active:scale-[0.995]`(0.5%,极轻)
- 禁用按钮:不缩放

### 2. Copy 按钮反馈(2 秒窗口 + icon 切换)

```js
// copy-button-CLHBBPl_.pretty.js:15-52
const [copied, setCopied] = useState(false);

const handleClick = (e) => {
  e.stopPropagation();
  onCopy(e);
  setCopied(true);                       // 立即切到 copied 状态
  setTimeout(() => {
    if (mounted()) setCopied(false);    // 2 秒后回退
  }, 2000);
};

// icon 条件渲染
return copied
  ? <CheckIcon className={copied ? 'text-token-foreground' : ''} />   // 蓝色 check
  : <CopyIcon />;
```

**机制**:
- 点击立即 `setState(true)` → icon 从 `copy` 切到 `check-md`
- 文字色升级为 `text-token-foreground`(主色)
- 2 秒后 `setState(false)` 回退
- **无 CSS 过渡**,纯 React 条件渲染(icon 切换本身够快,无需过渡)

### 3. 粒子爆裂(staggered nth-child)

```css
/* model-picker-power-slider-impl-ShOI3rhA.pretty.css:63-145 */
._Burst_1ibg9_151 > span {
  --particle-color: var(--color-token-charts-purple);
  --particle-x: 0px;
  --particle-y: -36px;
  background: var(--particle-color);
  border-radius: 999px;
  width: 5px;
  height: 5px;
  animation: 0.62s cubic-bezier(0.25, 1, 0.5, 1) both _ParticleBurst_1ibg9_1;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.2);
}

/* 16 个粒子,每个 nth-child 单独配置位置和延迟 */
._Burst_1ibg9_151 > span:nth-child(2)  { --particle-x: 15px;  --particle-y: -29px; animation-delay: 8ms }
._Burst_1ibg9_151 > span:nth-child(4)  { --particle-x: 34px;  --particle-y: 2px;   animation-delay: 12ms }
._Burst_1ibg9_151 > span:nth-child(6)  { --particle-x: 12px;  --particle-y: 31px;  animation-delay: 10ms }
._Burst_1ibg9_151 > span:nth-child(8)  { --particle-x: -22px; --particle-y: 26px;  animation-delay: 14ms }
/* ... 16 个粒子完整覆盖 360° */

@keyframes _ParticleBurst_1ibg9_1 {
  0%  { opacity: 0; transform: translate(-50%, -50%) scale(0.25) }
  22% { opacity: 1; transform: translate(-50%, -50%) scale(1.28) }    /* overshoot 1.28 倍 */
  to  { opacity: 0;
        transform: translate(calc(-50% + var(--particle-x)), calc(-50% + var(--particle-y))) scale(0.55) }
}
```

**机制**:
- 16 个粒子,6-14ms 错峰延迟
- 22% 处 overshoot 到 1.28 倍(弹性反馈)
- 然后飞散到各自 `--particle-x/y` 位置,缩小到 0.55
- 总时长 0.62s + 最大延迟 14ms ≈ 0.634s

### 4. Subagent chip 入场(overshoot)

```css
/* subagent-activity-chip-group-OY7Ia_qf.pretty.css:23-40 */
._chip_lj1sl_1[data-animate-entrance] {
  transform-origin: 0;
  animation: 0.28s cubic-bezier(0.23, 1, 0.32, 1) both _chip-enter_lj1sl_1;
}
@keyframes _chip-enter_lj1sl_1 {
  0%  { opacity: 0; transform: translate(-8px, 4px) scale(0.92) }
  70% { opacity: 1; transform: translate(1px, -1px) scale(1.02) }    /* 70% 处轻微 overshoot 1.02 */
  to  { opacity: 1; transform: translate(0, 0) scale(1) }
}
```

**Overshoot 阈值**:
- chip 入场:1.02(2%,极轻)
- 粒子爆裂:1.28(28%,强烈)
- **最大允许 1.05**(除粒子爆裂这种特殊场景)—— Codex 不允许"弹性回弹"

### 5. Tick hover 放大

```css
._Tick_m3zgh_79:hover {
  filter: brightness(0.85);                              /* 先变暗 15% */
  transform: translate(-50%, -50%) scale(2);            /* 再放大 2 倍 */
}
```

**注意**:hover 放大 2 倍是**例外**(tick 是小型标记,需要明确反馈),普通按钮 hover 不允许放大。

---

## 滚动行为与自动跟底

> Codex 的滚动系统是**自研虚拟列表 + IntersectionObserver 101 档 + rAF 节流 + spring 动画**的组合,不依赖 react-virtual 或 framer-motion 的滚动方案。

### 1. 虚拟列表(自研,无第三方)

```js
// thread-virtualizer-43g3Bw27.pretty.js:12-21
function computeVisibleRange({ distanceFromBottomPx, layout, overscanCount, viewportHeightPx }) {
  if (layout.turnKeys.length === 0) return { startIndex: 0, endIndex: 0 };
  let topPx = Math.min(Math.max(0, distanceFromBottomPx), layout.totalHeightPx);
  let bottomPx = Math.min(topPx + Math.max(0, viewportHeightPx), layout.totalHeightPx);
  let endIndex = binarySearchEndIndex(layout.bottomOffsetsPx, bottomPx);     // 二分查找
  let startIndex = binarySearchStartIndex(layout.heightsPx, topPx);            // 二分查找
  return {
    startIndex: Math.max(0, endIndex - overscanCount),                       // 向下 overscan
    endIndex: Math.min(layout.turnKeys.length, Math.max(startIndex, endIndex + 1) + overscanCount)
  };
}

const DEFAULT_TURN_HEIGHT = 280;    // 每条 turn 默认估算 280px
```

**特点**:
- 二分查找 + overscan(默认上下各 overscanCount 条)
- 默认估算高度 280px(未测量前)
- 测量后更新 `layout.heightsPx` 与 `layout.bottomOffsetsPx`

### 2. 自动跟底(IntersectionObserver 101 档 + rAF)

```js
// chatgpt-conversation-page-CVTdydPj.pretty.js:505-590
const VISIBILITY_RATIO_THRESHOLD = 2 / 3;                          // 视口 2/3 可见才算"在底部"
const NEAR_BOTTOM_PX = 1;                                          // 距底 1px 即视为贴底
const IO_THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100);  // 0.00~1.00 全档
const SPRING_CONFIG = { type: 'spring', bounce: 0, duration: 0.5 };

// IntersectionObserver 监听底部 spacer
const observer = new IntersectionObserver((entries) => {
  const last = entries.at(-1);
  if (last == null) return;
  const visibleHeight = Math.max(0, last.intersectionRect.height);
  isAtBottomRef.current = spacerHeight.get() > 0 && visibleHeight <= NEAR_BOTTOM_PX;
  maybeUpdate();                                                   // 触发 spacer 高度调整
}, { root: scrollContainer, threshold: IO_THRESHOLDS });           // 101 档

// 用户滚动监听(rAF 节流)
const unsubscribe = scrollContainer.addUserScrollListener((delta, distanceFromBottom) => {
  if (distanceFromBottom == null) return;
  const increment = delta - distanceFromBottom;
  if (increment <= 0) return;
  accumulatedScrollRef.current += increment;
  rafIdRef.current ??= window.requestAnimationFrame(processScroll);  // rAF 批处理
});
```

**关键规则**:
- **IntersectionObserver 101 档**:生成 `Array.from({length: 101}, (_, i) => i / 100)` 即 `[0, 0.01, 0.02, ..., 1.0]`,确保任意可见比例变化都触发
- **rAF 节流**:用户滚动事件累积增量后用 `requestAnimationFrame` 批处理,避免每像素都触发补偿
- **spring 配置**:`{ type: 'spring', bounce: 0, duration: 0.5 }`——零弹跳,0.5s 收敛(用于 spacer 高度过渡,不是滚动本身)
- **即时补偿**:滚动补偿用 `instant`(无动画),spring 仅用于 spacer 高度过渡
- **24px 阈值**:距底 ≤24px 时直接归零,避免微小抖动

### 3. 强制贴底

```js
const forceScrollToBottom = () => {
  const el = scrollContainer.getScrollElement();
  if (el == null) return;
  const targetPx = Math.max(0, el.clientHeight - getOverscanHeight(el)) * VISIBILITY_RATIO_THRESHOLD;
  cancelPending();
  spacerHeight.stop();
  isAtBottomRef.current = false;
  if (spacerHeight.get() <= 24) spacerHeight.jump(0);                // ≤24px 直接归零
  scrollContainer.scrollToDistanceFromBottomPx(1, 'instant');        // 即时贴底
  animateSpring(spacerHeight, targetPx, SPRING_CONFIG);             // spring 动画到目标
};
```

### 4. Scroll-to-bottom 按钮(wave-dot 动画)

```css
/* scroll-to-bottom-buton-CQcpasM2.pretty.css */
@keyframes _working-dot-wave_99dwr_1 {
  0%, 10%, to { transform: translateY(0) }
  25%         { transform: translateY(1.2px) }    /* 微下沉 */
  55%         { transform: translateY(-2px) }    /* 上跳 2px */
  70%         { transform: translateY(0) }
}

@media (prefers-reduced-motion: no-preference) {
  ._waveDot_99dwr_43 {
    animation: _working-dot-wave_99dwr_1 1s ease-in-out infinite;
  }
  ._waveDot_99dwr_43:nth-child(2) { animation-delay: 0.1s }     /* 100ms 错峰 */
  ._waveDot_99dwr_43:nth-child(3) { animation-delay: 0.2s }     /* 200ms 错峰 */
}
```

**特点**:
- 三点波浪,100ms 错峰(stagger)
- 1s 周期,`ease-in-out`
- **仅 `prefers-reduced-motion: no-preference` 时启用**——这是反向写法,确保 reduced-motion 默认关闭

### ClawX 迁移要点

ClawX 当前用 `scrollIntoView({ behavior: 'smooth' })` 自动滚动,**没有 spacer 机制**。迁移时:
1. 在消息列表底部放一个 `<div ref={bottomSentinelRef} />` 作为 IO 观察目标
2. 用 `useThreadScroll` hook(已存在于 ClawX)`isNearBottom` 控制 scroll-to-bottom 按钮显隐
3. 用户向上滚动时**暂停自动跟底**,向下滚回底部时**恢复**
4. 用 `requestAnimationFrame` 替代 `scrollIntoView`,实现 400ms cubic ease-out(详见 `useThreadScroll.ts`)

---

## 状态指示动效谱系

### 1. Cadenced Shimmer(思考中节拍扫光)

> 唯一的复杂周期性动画。详见 [06-motion.md](./06-motion.md) 的 shimmer 子系统,这里补充深度参数。

```js
// cadencedShimmer-extracted.js:41-44
const SHIMMER_ACTIVE_DURATION = 1000;   // active 类名持续 1s
const SHIMMER_PERIOD = 4000;            // 每 4s 触发一次
const SHIMMER_INITIAL_DELAY = 600;     // 首次延迟 600ms
```

```css
/* thinking-shimmer-C-5BnEUj.pretty.css:30-53 */
._cadencedShimmerActive_9d9bl_111 ._cadencedShimmerSweep_9d9bl_45,
._cadencedShimmerActive_9d9bl_111 ._cadencedShimmerHighlight_9d9bl_33 {
  animation-duration: 1s;
  animation-timing-function: steps(48, end);          /* 48 步阶梯,模拟"逐字"扫光 */
  animation-iteration-count: 1;                       /* 仅一次 */
}

@keyframes _cadencedLoadingShimmerSweep_9d9bl_1 {
  0% { transform: translate(-50%) }
  to { transform: translate(125%) }
}
@keyframes _cadencedLoadingShimmerHighlight_9d9bl_1 {
  0% { transform: translate(50%) }
  to { transform: translate(-125%) }
}
```

**深度规则**:
- **`steps(48, end)`**:1s 内分 48 步推进,每步约 20.8ms。这是"分步思考"颗粒感的来源,**不是连续滑动**。
- **`iteration-count: 1`**:每次 active 类触发只跑一次,由 JS 的 `setInterval(4000)` 周期性重新添加 active 类
- **mask-image 限定可见区**:`linear-gradient(90deg, #0000 0%, #000 20% 30%, #0000 50% 100%)`,让光带呈现 20%-30% 区间可见、两端透明
- **双图层反向**:sweep 从 -50% → 125%(向右),highlight 从 50% → -125%(向左),形成"对冲"视觉

### 2. Loading Results Shimmer(搜索加载)

```css
/* shimmer-lines-yjvWUHPT.pretty.css */
._loadingResultsShimmer_h3w7l_1 {
  --loading-results-shimmer-base: color-mix(in srgb, var(--color-token-description-foreground) 10%, transparent);
  --loading-results-shimmer-highlight: color-mix(in srgb, var(--color-token-description-foreground) 16%, transparent);
  background-color: var(--loading-results-shimmer-base);
  position: relative;
  overflow: hidden;
}
._loadingResultsShimmer_h3w7l_1:before {
  content: "";
  pointer-events: none;
  background: linear-gradient(90deg, transparent 0%, var(--loading-results-shimmer-highlight) 50%, transparent 100%);
  will-change: transform;                                              /* 显式 will-change */
  animation: 3s linear infinite _loadingResultsShimmer_h3w7l_1;
  animation-delay: var(--loading-results-shimmer-delay, 0s);           /* 支持错峰 */
  position: absolute;
  inset: 0;
  transform: translate(-100%);
}
@keyframes _loadingResultsShimmer_h3w7l_1 {
  0% { transform: translate(-100%) }
  to { transform: translate(100%) }
}
```

**vs Cadenced Shimmer**:

| 维度 | Cadenced Shimmer | Loading Results Shimmer |
|---|---|---|
| 用途 | "AI 思考中"文本扫光 | 搜索结果列表项占位 |
| 时长 | 1s | 3s |
| 缓动 | `steps(48, end)` | `linear` |
| 迭代 | 1 次(JS 周期触发) | `infinite` |
| 可见区 | mask-image 20%-30% | linear-gradient 全宽 |
| 错峰 | 双图层 2s 错峰 | `--loading-results-shimmer-delay` |

### 3. Writing Block Loading Shimmer(魔法编辑提交中)

```css
/* markdown-BjJBLRLf.pretty.css:174-205 */
._editor_11vxc_8.magic-edit-submitting .ProseMirror {
  --shimmer-contrast: var(--oai-wb-text-tertiary);
  --shimmer-text-secondary: var(--oai-wb-text-secondary);
  background: var(--shimmer-text-secondary) linear-gradient(to var(--end),
    var(--shimmer-text-secondary) 0%,
    var(--shimmer-contrast) 40%,
    var(--shimmer-contrast) 60%,
    var(--shimmer-text-secondary) 100%);
  text-fill-color: transparent;
  -webkit-text-fill-color: transparent;
  animation-duration: var(--cot-shimmer-duration, 2s);      /* 默认 2s,可配置 */
  background-size: 50% 200%;
  -webkit-background-clip: text;
  background-clip: text;
  animation-name: _writingBlockLoadingShimmer_11vxc_1;
  animation-iteration-count: infinite;
}
@keyframes _writingBlockLoadingShimmer_11vxc_1 {
  0% { background-position: -100% 0 }
  to { background-position: 250% 0 }
}
```

**特点**:`background-clip: text` 让扫光直接作用于文字本身,而非独立图层。

### 4. Status Pill Progress(进度条收缩)

```css
/* worktree-init-row-DRsY3oC1.pretty.css */
._statusPillProgress_5zp72_1 {
  opacity: 0;
  transform-origin: 0;                                   /* 左侧锚定 */
  animation-name: _statusPillProgress_5zp72_1;
  animation-timing-function: linear;
  animation-fill-mode: both;
}
@keyframes _statusPillProgress_5zp72_1 {
  0%    { opacity: 0; transform: scaleX(1) }              /* 全宽不可见 */
  0.001%{ opacity: 1; transform: scaleX(1) }              /* 立即变可见 */
  to    { opacity: 1; transform: scaleX(0) }              /* 从右往左收缩到 0 */
}
```

**机制**:`transform-origin: 0`(左侧锚定),`scaleX` 从 1 → 0,模拟进度条从右往左消减。`animation-duration` 由 JS 注入控制进度速度。

### 5. Progression Donut(SVG 进度环)

```css
/* progression-donut-DkjcVlU6.pretty.css */
._fillOnMount_1crzc_1 {
  animation: _progression-donut-fill_1crzc_1
    var(--transition-duration-relaxed) ease-out backwards;     /* 0.3s */
}
@keyframes _progression-donut-fill_1crzc_1 {
  0% { stroke-dashoffset: 100px }                              /* 从满偏移开始 */
}
@media (prefers-reduced-motion: reduce) {
  ._fillOnMount_1crzc_1 { animation: none }
}
```

### 6. MCP App Loading Pulse(整面板呼吸)

```css
/* app-VS6Z-TiK.pretty.css:885-912, 14705-14710 */
.mcp-app-loading-pulse {
  --mcp-app-loading-base: var(--color-token-main-surface-primary);
  --mcp-app-loading-peak: color-mix(in srgb, var(--color-token-description-foreground) 7%, var(--color-token-main-surface-primary));
  background-color: var(--mcp-app-loading-base);
  position: relative;
}
.mcp-app-loading-pulse:before {
  content: "";
  background-color: var(--mcp-app-loading-peak);
  opacity: 0;
  animation: 3s ease-in-out infinite mcp-app-loading-pulse;
  position: absolute;
  inset: 0;
}
.dark .mcp-app-loading-pulse {
  --mcp-app-loading-peak: color-mix(in srgb, var(--color-token-description-foreground) 14%, var(--color-token-main-surface-primary));
}
@keyframes mcp-app-loading-pulse {
  0%, to { opacity: 0 }
  50%   { opacity: 1 }
}
```

**Dark 模式峰值更高**:14% vs 7%,补偿暗底对比度。

### 7. Dot Field Opacity(subagent 后台活动)

```css
/* subagent-activity-chip-group-OY7Ia_qf.pretty.css:1-22 */
._dots_1888p_1 {
  opacity: 0.38;
  animation: 1.75s ease-in-out infinite _dot-field-opacity_1888p_1;
  position: absolute;
  inset: 0;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to top left, #0000 0%, #000 30% 70%, #0000 100%);
  mask-image: linear-gradient(to top left, #0000 0%, #000 30% 70%, #0000 100%);
}
@keyframes _dot-field-opacity_1888p_1 {
  50% { opacity: 0.56 }                       /* 0.38 ↔ 0.56 呼吸 */
}
```

### 8. UAC Arrow Bounce(onboarding 引导)

```css
/* onboarding-page-DMMT1hQC.pretty.css:1-11 */
._uacArrow_1tl1k_1 {
  filter: drop-shadow(0 2px 2px #0000003d);
  animation: 1s ease-in-out infinite alternate _uac-arrow-bounce_1tl1k_1;
}
@keyframes _uac-arrow-bounce_1tl1k_1 {
  to { transform: translateY(-4px) }            /* alternate 模式:上下往复 */
}
```

**`alternate` 模式**:不是 `infinite` 单向,而是 `alternate` 让 0%→100%→0%→100% 往复,适合"引导箭头"场景。

### 状态指示动效选用表

| 场景 | 选用 | 时长 | 缓动 | 迭代 |
|---|---|---|---|---|
| AI 思考中(文本) | Cadenced Shimmer | 1s(每 4s) | `steps(48, end)` | 1(周期触发) |
| 搜索结果占位 | Loading Results Shimmer | 3s | `linear` | `infinite` |
| 魔法编辑提交中 | Writing Block Shimmer | 2s(可配) | `linear` | `infinite` |
| 整面板加载 | MCP App Loading Pulse | 3s | `ease-in-out` | `infinite` |
| 进度条 | Status Pill Progress | JS 注入 | `linear` | 1 |
| 进度环 | Progression Donut | 0.3s | `ease-out` | 1 |
| 后台活动 | Dot Field Opacity | 1.75s | `ease-in-out` | `infinite` |
| 引导箭头 | UAC Arrow Bounce | 1s | `ease-in-out` | `alternate` |
| 工作中三点 | Wave Dot | 1s | `ease-in-out` | `infinite`(错峰 100ms) |

---

## Reduced-motion 退让策略

> 06 给出标准 pattern,12 给出**分级退让策略**。

### 三级退让

| 级别 | 触发 | 行为 | 适用 |
|---|---|---|---|
| **L1 软退让** | `prefers-reduced-motion: reduce` | 时长压到 `0.01ms`,`iteration-count: 1` | 通用 transition / 一次性 animation |
| **L2 静默退让** | `prefers-reduced-motion: reduce` | `animation: none`,元素保持终态 | 进入动画(终态可见即可) |
| **L3 完全关闭** | `prefers-reduced-motion: reduce` | `animation: none` + `opacity: 0`(隐藏扫光)+ 显示静态占位 | 周期性扫光(shimmer / pulse) |

### L1 软退让(标准)

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

### L2 静默退让(进入动画)

```css
.dropdown--enter {
  animation: dropdown-enter 0.15s var(--ease-enter);
}
@media (prefers-reduced-motion: reduce) {
  .dropdown--enter { animation: none; }    /* 直接显示终态 */
}
```

### L3 完全关闭(周期扫光)

```css
.thinking-shimmer__layer-1,
.thinking-shimmer__layer-2 {
  animation: shimmer-sweep 4s var(--ease-enter) infinite;
}

@media (prefers-reduced-motion: reduce) {
  .thinking-shimmer__layer-1,
  .thinking-shimmer__layer-2 {
    animation: none;
    opacity: 0;                          /* 完全隐藏扫光 */
  }
  .thinking-shimmer__static {
    display: block;                     /* 显示静态占位 */
  }
}
```

### 反向写法(推荐用于新代码)

Codex 在 `scroll-to-bottom-buton-CQcpasM2.pretty.css` 用了**反向写法**:

```css
@media (prefers-reduced-motion: no-preference) {    /* 仅在不偏好减少动效时启用 */
  ._waveDot_99dwr_43 {
    animation: _working-dot-wave_99dwr_1 1s ease-in-out infinite;
  }
}
```

**优势**:默认状态下不应用动画,只有用户**明确不偏好减少动效**时才启用。这是 W3C 推荐的新写法,**新代码应优先采用**。

### 全局 reset(兜底)

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

**注意**:全局 reset 是**兜底**,不能替代每个动画的显式旁路。理由:
- `!important` 会破坏用户自定义
- 某些动画在 reduced-motion 下应显示静态占位(L3),而非"跑一次"
- 全局 reset 无法处理"显示静态占位"的逻辑

### 关键规则

- **不是可选**:每个动画都要带旁路,这是无障碍红线
- **`0.01ms` 不是 `0ms`**:`0ms` 会让某些浏览器跳过 transition 完全,`0.01ms` 保留事件触发
- **`iteration-count: 1`**:无限循环动画在 reduced-motion 下只跑一次(spinner / pulse)
- **shimmer 完全关闭**:周期性扫光在 reduced-motion 下应**完全隐藏**,不是"跑一次"
- **新代码用反向写法**:`@media (prefers-reduced-motion: no-preference) { ... }`

---

## 性能预算与 will-change 管理

### 性能预算

| 指标 | 预算 | 测量方式 |
|---|---|---|
| 单次 transition | ≤150ms | DevTools Performance tab |
| 单次 animation(非周期) | ≤500ms | DevTools Performance tab |
| 周期性动画 FPS | ≥60fps | DevTools FPS meter |
| 流式渲染 FPS(每 token) | ≥60fps | DevTools Performance |
| 首次绘制(FCP) | ≤1.5s | Lighthouse |
| stagger 单段延迟 | ≤96ms(线性) / ≤4ms(衰减) | JS 计算 |
| 滚动事件响应 | ≤1帧(16ms) | rAF 节流 |
| 代码高亮防抖 | 120ms | `lastStartedAtMs` 机制 |

### will-change 管理三原则

1. **显式声明**:动画前必须 `will-change: <property>`,告诉浏览器提前合成
2. **及时移除**:动画结束后 1 帧内必须移除 `will-change`,释放 GPU 内存
3. **不滥用**:`will-change` 不是性能优化银弹,只在确有动画时声明

### 示例(Loading Results Shimmer)

```css
._loadingResultsShimmer_h3w7l_1:before {
  will-change: transform;                          /* 显式声明 */
  animation: 3s linear infinite _loadingResultsShimmer_h3w7l_1;
}
```

### 示例(ModelPicker Dropdown)

```css
._ModelPickerDropdownContent_1w4ob_203 {
  transform-origin: var(--radix-dropdown-menu-content-transform-origin);
  will-change: opacity, transform;                 /* 双属性 */
  overflow: clip;
}
```

### 反例(禁用)

```css
/* ❌ 永远 will-change(浪费 GPU 内存) */
* { will-change: transform; }

/* ❌ 动画后不移除(内存泄漏) */
.element {
  will-change: transform;
  transition: transform 0.15s;
}
/* 缺:动画结束后 will-change: auto */

/* ❌ 动 layout 属性(触发重排,卡顿) */
.element { transition: width 0.15s, height 0.15s; }
/* 应该:用 transform: scale() 替代 */
```

### GPU 合成原则

**只动以下属性**(GPU 合成,不触发 layout / paint):
- `transform`(translate / scale / rotate)
- `opacity`
- `filter`(blur / brightness)

**禁动以下属性**(触发 layout / paint):
- `width` / `height` / `top` / `left` / `right` / `bottom`
- `margin` / `padding`(影响 layout)
- `background-color`(触发 paint,但比 layout 轻量,可接受)
- `box-shadow`(触发 paint)

### Streaming 高亮防抖(性能关键路径)

```js
// code-snippet-CE90EJ2C.pretty.js:118-137
const HIGHLIGHT_DEBOUNCE_MS = 120;                  // 防抖窗口

const scheduleHighlight = () => {
  let state = ref.current;
  state.latestContent = content;
  state.latestLanguage = language;
  if (!isVisible || state.timeoutHandle != null) return;

  let now = performance.now();
  let elapsedSinceLastStart = state.lastStartedAtMs == null
    ? HIGHLIGHT_DEBOUNCE_MS
    : now - state.lastStartedAtMs;
  let waitMs = Math.max(0, HIGHLIGHT_DEBOUNCE_MS - elapsedSinceLastStart);

  const run = () => {
    state.timeoutHandle = null;
    if (state.disposed) return;
    let content = state.latestContent;
    let language = state.latestLanguage;
    state.lastStartedAtMs = performance.now();       // 记录"开始时刻",非"结束时刻"
    getHighlighter().then((hl) => {
      if (state.disposed || hl == null) return;
      try {
        setHighlightedHtml(hl.highlightCode(content, language));
      } catch (e) { /* ... */ }
    });
  };

  if (waitMs === 0) { run(); return; }
  state.timeoutHandle = setTimeout(run, waitMs);
};
```

**关键设计**:
- **记录"开始时刻"而非"结束时刻"**:确保高频 token 流入时,高亮不会饿死(每 120ms 至少触发一次)
- **IntersectionObserver 600px 预加载**:`rootMargin: '600px 0px'` 让代码块在进入视口前 600px 就开始高亮
- **`React.memo` 化的 dangerouslySetInnerHTML**:每行代码独立 memo,避免流式增量时全量重渲染

```js
// 行级 memo(行 243-250)
const MemoizedLine = React.memo(function Line({ html }) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
});
```

---

## Token 阶梯总表

### 时长阶

| Token | 时长 | 用途 |
|---|---|---|
| `--default-transition-duration` | 0.15s | 默认(hover / color) |
| `--transition-duration-basic` | 0.15s | 别名 |
| `--transition-duration-relaxed` | 0.3s | 大幅位移(sidebar / modal) |
| (硬编码) | 0.11s | Curtain 升降(极短) |
| (硬编码) | 0.18s | Content 退出 |
| (硬编码) | 0.24s / 0.25s | Toast 进/出 |
| (硬编码) | 0.26s | Content 进入 |
| (硬编码) | 0.28s | Subagent chip 入场 |
| (硬编码) | 0.32s | ModelPicker dropdown 进入 |
| (硬编码) | 0.5s | FastMode tick fade 进入 |
| (硬编码) | 0.62s | 粒子爆裂 |
| (硬编码) | 0.8s | FastMode tick scale 进入 |
| (硬编码) | 0.35s | FastMode tick scale 退出 |
| (硬编码) | 1s | Cadenced shimmer active / Wave dot |
| (硬编码) | 1.75s | Dot field opacity |
| (硬编码) | 2s | Writing block shimmer |
| (硬编码) | 3s | Loading results shimmer / MCP pulse |
| (硬编码) | 4s | Cadenced shimmer 周期 |

### 缓动阶

| Token / 硬编码 | 曲线 | 用途 |
|---|---|---|
| `--default-transition-timing-function` | `cubic-bezier(0.4, 0, 0.2, 1)` | 默认(双向) |
| `--ease-enter` | `cubic-bezier(0.19, 1, 0.22, 1)` | 进入(强减速) |
| `--ease-enter-snappy` | `cubic-bezier(0.23, 1, 0.32, 1)` | 紧凑进入 |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | 通用减速 |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | 退出(加速) |
| (硬编码) | `cubic-bezier(0.175, 0.885, 0.32, 1)` | Toast 进入(easeOut) |
| (硬编码) | `cubic-bezier(0.16, 1, 0.3, 1)` | Content 进入 |
| (硬编码) | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Curtain 升降 |
| (硬编码) | `cubic-bezier(0.25, 1, 0.5, 1)` | 粒子爆裂 |
| (硬编码) | `cubic-bezier(0.37, 0.55, 0.86, 0.88)` | **Fade-in 专属**(段落淡入) |
| (硬编码) | `steps(48, end)` | Cadenced shimmer(逐字扫光) |
| (硬编码) | `linear` | Spinner / Loading results shimmer(周期性) |

### active scale 阶

| 工具类 | 缩放 | 用途 |
|---|---|---|
| `active:scale-95` | 0.95 | 主按钮 |
| `active:scale-[0.97]` | 0.97 | 强反馈 |
| `active:scale-[0.98]` | 0.98 | 标准按钮(最常用) |
| `active:scale-[0.99]` | 0.99 | 轻反馈 |
| `active:scale-[0.995]` | 0.995 | 极轻反馈(图标按钮) |
| `motion-reduce:active:scale-100` | 1 | reduced-motion 备用 |

---

## Do / Don't

### Do

```css
/* 进入/退出不对称 */
.dropdown--enter {
  animation: dropdown-in 0.26s cubic-bezier(0.16, 1, 0.3, 1) both;  /* 进入 0.26s */
}
.dropdown--exit {
  animation: dropdown-out 0.18s cubic-bezier(0.4, 0, 1, 1) both;  /* 退出 0.18s,加速 */
}

/* stagger 用 CSS 变量驱动 */
.segment {
  opacity: 0;
  animation: fade-in 0.15s cubic-bezier(0.37, 0.55, 0.86, 0.88) forwards;
  animation-delay: var(--fade-delay, 0s);
}

/* 周期动画显式 will-change */
.shimmer::before {
  will-change: transform;
  animation: 3s linear infinite shimmer-sweep;
}

/* reduced-motion 反向写法(新代码) */
@media (prefers-reduced-motion: no-preference) {
  .wave-dot { animation: wave 1s ease-in-out infinite; }
}

/* 动 GPU 合成属性 */
.card { transition: transform 0.15s, opacity 0.15s; }
.card--active { transform: scale(0.98); opacity: 1; }
```

### Don't

```css
/* ❌ 对称进入/退出(无方向感) */
.dropdown { animation: dropdown-toggle 0.2s ease both; }

/* ❌ stagger 直接动 style.animationDelay(JS) */
element.style.animationDelay = `${delay}ms`;   /* 应该:setProperty('--fade-delay', ...) */

/* ❌ 周期动画无 will-change(可能掉帧) */
.shimmer::before { animation: 3s linear infinite sweep; }

/* ❌ reduced-motion 仅压时长(周期动画应完全关闭) */
@media (prefers-reduced-motion: reduce) {
  .shimmer { animation-duration: 0.01ms; }   /* 应该:animation: none */
}

/* ❌ 动 layout 属性(触发重排) */
.card { transition: width 0.15s, height 0.15s; }

/* ❌ transition: all(不可控) */
.btn { transition: all 0.15s; }

/* ❌ 弹性回弹 >1.05(除粒子爆裂) */
.card--active { transform: scale(1.2); }   /* 应该:≤1.05 */

/* ❌ 永远 will-change(浪费 GPU) */
* { will-change: transform; }

/* ❌ 视差滚动 / 滚动触发动画(Codex 不用) */
.window { transform: translateY(calc(var(--scroll-y) * 0.5px)); }
```

---

## 与 06 的关系

| 06 解决 | 12 解决 |
|---|---|
| 时长 / 缓动 / 基础 transition | stagger 编排 / 三轨并行 / 不对称矩阵 |
| 通用 reduced-motion 旁路 | 三级退让策略 / 反向写法 |
| Shimmer 基础结构 | 状态指示动效谱系(8 种) |
| 标准 keyframes | Streaming 高亮防抖 / will-change 管理 |
| 单条 transition recipe | 滚动行为 / 虚拟列表 / 自动跟底 |

**阅读顺序**:先读 06 建立基础认知,再读 12 解决复杂场景。两份文档互补,不替代。
