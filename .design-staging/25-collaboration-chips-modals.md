---
doc: 25-collaboration-chips-modals
name: Collaboration, Chips, Rate-Limit & Invite Modals
category: Subsystems
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/css/annotation-comment-editor-card-BFXPl2BV.css
  - codex-reference/css/subagent-activity-chip-group-OY7Ia_qf.css
  - codex-reference/css/rate-limit-reset-redemption-pDJMFnJa.css
  - codex-reference/css/referral-invite-modal-CoMV3aAJ.css
---

# 25 — Collaboration, Chips, Rate-Limit & Invite Modals

> 注释表单控件、子代理活动芯片组、限流恢复光效、邀请模态框 token 架构——这四个子系统展示了 Codex 在"协作与状态反馈"层面的设计语言。本文规定芯片入场动画、点阵呼吸场、Discord Blurple 扫光、以及三段式主题 token 架构。

---

## 目录

1. [注释表单输入控件](#1-注释表单输入控件)
2. [子代理活动芯片组](#2-子代理活动芯片组)
3. [限流恢复光效](#3-限流恢复光效)
4. [邀请模态框 Token 架构](#4-邀请模态框-token-架构)
5. [跨组件复用要点](#5-跨组件复用要点)
6. [Do / Don't](#do--dont)

---

## 1. 注释表单输入控件

### 1.1 数字输入框

```css
/* annotation-comment-editor-card-BFXPl2BV.css */

._numericInput_491xx_1 {
  appearance: textfield;
}
._numericInput_491xx_1:focus,
._numericInput_491xx_1:focus-visible,
._numericInput_491xx_1:active {
  box-shadow: none;
  outline: none;
}
._numericInput_491xx_1::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
._numericInput_491xx_1::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
```

| 属性 | 值 | 说明 |
|---|---|---|
| `appearance` | `textfield` | 强制文本框外观 |
| `:focus` / `:focus-visible` / `:active` | `box-shadow: none; outline: none` | 移除原生聚焦环 |
| `::-webkit-outer-spin-button` | `appearance: none; margin: 0` | 隐藏 WebKit 外侧箭头 |
| `::-webkit-inner-spin-button` | `appearance: none; margin: 0` | 隐藏 WebKit 内侧箭头 |

> **焦点上移策略**：input 本身移除所有原生焦点指示，焦点样式必须由父级 wrapper 提供。否则会出现"无可见焦点"的可访问性回归。

### 1.2 颜色选择器

```css
._colorInput_491xx_37 {
  appearance: none;
}
._colorInput_491xx_37::-webkit-color-swatch-wrapper {
  padding: 0;
}
._colorInput_491xx_37::-webkit-color-swatch {
  border-radius: inherit;
  border: 0;
}
._colorInput_491xx_37::-moz-color-swatch {
  border-radius: inherit;
  border: 0;
}
```

| 属性 | 值 | 说明 |
|---|---|---|
| `appearance` | `none` | 关闭原生外观 |
| `::-webkit-color-swatch-wrapper` padding | `0` | 取消内边距，色块填满 |
| `::-webkit-color-swatch` border-radius | `inherit` | 跟随容器圆角 |
| `::-webkit-color-swatch` border | `0` | 去除默认边框 |

> `border-radius: inherit` 是关键——色块圆角跟随控件容器，保证胶囊/圆角一致。

---

## 2. 子代理活动芯片组

### 2.1 点阵呼吸场

```css
/* subagent-activity-chip-group-OY7Ia_qf.css */

._dots_1888p_1 {
  opacity: 0.38;
  animation: 1.75s ease-in-out infinite _dot-field-opacity_1888p_1;
  -webkit-mask-image: linear-gradient(to left top,
    rgba(0,0,0,0) 0%,
    rgb(0,0,0) 30%,
    rgb(0,0,0) 70%,
    rgba(0,0,0,0) 100%);
  mask-image: linear-gradient(to left top,
    rgba(0,0,0,0) 0%,
    rgb(0,0,0) 30%,
    rgb(0,0,0) 70%,
    rgba(0,0,0,0) 100%);
}

@keyframes _dot-field-opacity_1888p_1 {
  50% { opacity: 0.56; }
}
```

| 属性 | 值 |
|---|---|
| 静态 opacity | 0.38 |
| 动画峰值 opacity | 0.56（50% 关键帧） |
| 振幅 | ±18%（38% ↔ 56%） |
| duration | 1.75s |
| easing | `ease-in-out` |
| iteration | `infinite` |
| mask | 对角线柔光带（30%-70% 可见） |

> **mask 含义**：从右下到左上方向，仅在 30%-70% 区间可见（中心带可见，两端淡出），形成"对角线柔光带"裁切效果。

### 2.2 芯片入场动画

```css
._chip_lj1sl_1[data-animate-entrance] {
  transform-origin: 0;
  animation: .28s cubic-bezier(.23, 1, .32, 1) both _chip-enter_lj1sl_1;
}

@keyframes _chip-enter_lj1sl_1 {
  0%  { opacity: 0; transform: translate(-8px, 4px) scale(.92); }
  70% { opacity: 1; transform: translate(1px, -1px) scale(1.02); }
  to  { opacity: 1; transform: translate(0, 0) scale(1); }
}
```

### 2.3 入场轨迹解析

| 阶段 | opacity | translateX | translateY | scale |
|---|---|---|---|---|
| 0%（入场前） | 0 | -8px | +4px | 0.92 |
| 70%（overshoot 顶点） | 1 | +1px | -1px | 1.02 |
| 100%（落定） | 1 | 0 | 0 | 1.0 |

> **设计语义**：芯片从左下方向右上方"弹入"，先冲过 2% 再回落。`transform-origin: 0` 让缩放锚定在左侧，配合 `-8px` 横向位移形成"从左缘推出"的视觉。

### 2.4 动画参数表

| 参数 | 值 |
|---|---|
| duration | 280ms |
| easing | `cubic-bezier(0.23, 1, 0.32, 1)` |
| fill-mode | `both` |
| iteration | 1（单次） |
| 触发条件 | `data-animate-entrance` 属性存在 |

### 2.5 Reduced-motion 双重兜底

```css
/* 1. 类名兜底（JS 主动注入） */
._reducedMotion_1888p_35 { animation: none; }

/* 2. 媒体查询自动降级 */
@media (prefers-reduced-motion: reduce) {
  ._dots_1888p_1 { animation: none; }
}
@media (prefers-reduced-motion: reduce) {
  ._chip_lj1sl_1[data-animate-entrance] { animation: none; }
}
```

> 降级后：点阵场停在静态 `opacity: 0.38`，芯片直接显示终态（opacity: 1, 无 transform）。

---

## 3. 限流恢复光效

### 3.1 横向扫光（Shimmer）

```css
/* rate-limit-reset-redemption-pDJMFnJa.css */

._shimmer_ogtge_1 {
  background-image: linear-gradient(90deg,
    #5865f200 0%,
    #5865f21f 20%,
    #8895ff75 38%,
    #e8e7ffe0 50%,
    #8895ff75 62%,
    #5865f21f 80%,
    #5865f200 100%);
}
```

### 3.2 扫光色标表

| 色标位置 | 颜色 | Alpha | 不透明度 | 角色 |
|---|---|---|---|---|
| 0% | `#5865F2` | `0x00` | 0% | 边缘完全透明 |
| 20% | `#5865F2` | `0x1F` | 12.2% | 边缘淡入 |
| 38% | `#8895FF` | `0x75` | 45.9% | 中间过渡浅蓝紫 |
| 50% | `#E8E7FF` | `0xE0` | 87.8% | 中心高光（近白淡紫） |
| 62% | `#8895FF` | `0x75` | 45.9% | 对称过渡 |
| 80% | `#5865F2` | `0x1F` | 12.2% | 边缘淡出 |
| 100% | `#5865F2` | `0x00` | 0% | 边缘完全透明 |

> 扫光带在 38%-62% 之间形成 24% 宽的高光核心，两侧对称衰减。结合 `background-position` 动画即可形成"光带横扫"效果。

### 3.3 径向绽放（Bloom）

```css
._bloom_ogtge_27 {
  background-image: radial-gradient(80% 220% at 100%,
    #8491ff57 0%,
    #5865f22e 40%,
    #5865f200 82%);
}
```

| 色标位置 | 颜色 | Alpha | 不透明度 | 角色 |
|---|---|---|---|---|
| 0% | `#8491FF` | `0x57` | 34.1% | 右缘最亮 |
| 40% | `#5865F2` | `0x2E` | 18.0% | 中段衰减 |
| 82% | `#5865F2` | `0x00` | 0% | 外缘完全透明 |

> 椭圆比例 `80% 220%`：横向窄、纵向极高，形成"竖向光柱从右侧射入"的视觉。

### 3.4 Discord Blurple 色板

| 角色 | 颜色 | 用途 |
|---|---|---|
| 基色 | `#5865F2` | Discord Blurple，扫光/绽放主色 |
| 过渡浅紫 | `#8895FF` | 扫光中段 |
| 高光近白 | `#E8E7FF` | 扫光中心 |
| 浅蓝紫 | `#8491FF` | 绽放右缘最亮 |

> **注意**：限流恢复 UI 使用 Discord Blurple 而非 Codex 品牌蓝 `#339cff`。这是刻意区分——品牌蓝用于"可交互强调"，Blurple 用于"恢复/奖励"的正反馈色。

---

## 4. 邀请模态框 Token 架构

### 4.1 三段式主题架构

```css
/* referral-invite-modal-CoMV3aAJ.css */

/* L1: 默认引用上层语义 token */
._modal_fswjq_1 {
  --referral-rate-limit-border:                 var(--color-token-border);
  --referral-rate-limit-check-background:       var(--color-token-charts-green);
  --referral-rate-limit-input-background:       var(--color-token-input-background);
  --referral-rate-limit-muted-surface:          var(--color-token-list-hover-background);
  --referral-rate-limit-secondary:              var(--color-token-text-secondary);
  --referral-rate-limit-success-background:     color-mix(in srgb, var(--color-token-charts-green) 16%, transparent);
  --referral-rate-limit-success-foreground:     var(--color-token-charts-green);
  --referral-rate-limit-surface:                var(--color-token-dropdown-background);
  --referral-rate-limit-tracking-background:    var(--color-token-dropdown-background);
  --referral-rate-limit-tracking-hover-background: var(--color-token-list-hover-background);
}

/* L2: Light 主题硬编码回退 */
.electron-light ._modal_fswjq_1 {
  --referral-rate-limit-border:                 #dedede;
  --referral-rate-limit-check-background:       #77d05c;
  --referral-rate-limit-input-background:       #f3f3f3;
  --referral-rate-limit-muted-surface:          #f4f4f4;
  --referral-rate-limit-secondary:              #5f5f5f;
  --referral-rate-limit-success-background:     #def3e5;
  --referral-rate-limit-success-foreground:     #1f6f2c;
  --referral-rate-limit-surface:                #fff;
  --referral-rate-limit-tracking-background:    #fff;
  --referral-rate-limit-tracking-hover-background: #f7f7f7;
}

/* L3: Dark 主题硬编码回退 */
.electron-dark ._modal_fswjq_1 {
  --referral-rate-limit-border:                 #3b3b3b;
  --referral-rate-limit-check-background:       #77d05c;
  --referral-rate-limit-input-background:       #424242;
  --referral-rate-limit-muted-surface:          #424242;
  --referral-rate-limit-secondary:              #b8b8b8;
  --referral-rate-limit-success-background:     #007a31;
  --referral-rate-limit-success-foreground:     #d9f4e4;
  --referral-rate-limit-surface:                #212121;
  --referral-rate-limit-tracking-background:    #424242;
  --referral-rate-limit-tracking-hover-background: #4a4a4a;
}
```

### 4.2 Token 映射表

| 本地 token | 上游语义 token | Light 回退 | Dark 回退 |
|---|---|---|---|
| `--referral-rate-limit-border` | `--color-token-border` | `#dedede` | `#3b3b3b` |
| `--referral-rate-limit-check-background` | `--color-token-charts-green` | `#77d05c` | `#77d05c` |
| `--referral-rate-limit-input-background` | `--color-token-input-background` | `#f3f3f3` | `#424242` |
| `--referral-rate-limit-muted-surface` | `--color-token-list-hover-background` | `#f4f4f4` | `#424242` |
| `--referral-rate-limit-secondary` | `--color-token-text-secondary` | `#5f5f5f` | `#b8b8b8` |
| `--referral-rate-limit-success-background` | `color-mix(charts-green 16%, transparent)` | `#def3e5` | `#007a31` |
| `--referral-rate-limit-success-foreground` | `--color-token-charts-green` | `#1f6f2c` | `#d9f4e4` |
| `--referral-rate-limit-surface` | `--color-token-dropdown-background` | `#fff` | `#212121` |
| `--referral-rate-limit-tracking-background` | `--color-token-dropdown-background` | `#fff` | `#424242` |
| `--referral-rate-limit-tracking-hover-background` | `--color-token-list-hover-background` | `#f7f7f7` | `#4a4a4a` |

### 4.3 主题反相策略

| token 类型 | Light → Dark 策略 |
|---|---|
| border | 浅灰 → 深灰（亮度反转） |
| check-background | **不变**（`#77d05c` 跨主题恒定） |
| input-background | 浅灰 → 深灰 |
| secondary text | 深灰 → 浅灰（反相） |
| success-background | 浅薄荷 → 深绿 |
| success-foreground | 深森林绿 → 浅薄荷绿（反相） |
| surface | 纯白 → 近黑 |
| tracking-hover | 微灰 → 仅亮 8 单位（极克制 hover） |

> **跨主题恒定色**：`check-background`（`#77d05c`）在两套回退中保持一致——绿色作为"成功/勾选"的语义色，不需要主题反相。

### 4.4 color-mix 透明度合成

```css
--referral-rate-limit-success-background: color-mix(in srgb, var(--color-token-charts-green) 16%, transparent);
```

> **关键技巧**：用 `color-mix(in srgb, <token> 16%, transparent)` 在运行时合成 16% 不透明度的成功绿底色，避免硬编码 rgba，主题切换时自动跟随 `charts-green`。

### 4.5 精灵图

```css
._artwork_fswjq_43 {
  background-position: -883px -33px;
  background-size: 1402px 1051px;
}
```

| 属性 | 值 |
|---|---|
| 整图尺寸 | 1402 × 1051 px |
| 邀请模态偏移 | `-883px -33px` |
| 宽高比 | ≈ 1.335:1 |

---

## 5. 跨组件复用要点

### 5.1 动画 token 建议

| 用途 | duration | easing | fill-mode | 备注 |
|---|---|---|---|---|
| 芯片入场 | 280ms | `cubic-bezier(0.23, 1, 0.32, 1)` | `both` | overshoot 至 102% 再回落 |
| 呼吸/脉冲 | 1750ms | `ease-in-out` | — | infinite，opacity 振幅 ±18% |

### 5.2 Reduced-motion 三层兜底模式

1. **类名层**：`._reducedMotion_<hash>` → `animation: none`（JS 主动注入）
2. **媒体查询层**：`@media (prefers-reduced-motion: reduce)` → `animation: none`（系统级自动降级）
3. **静态值保留**：关闭动画后元素停留在 keyframe 终态或静态值

### 5.3 三段式主题 token 架构

```
[L1 上层语义 token]          [L2 组件本地 token]              [L3 硬编码回退]
--color-token-charts-green → --referral-...-check-bg        → #77d05c (light/dark)
--color-token-dropdown-bg  → --referral-...-surface         → #fff (light) / #212121 (dark)
```

- 默认引用 `--color-token-*`，跟随全局主题
- `.electron-light` / `.electron-dark` 提供硬编码回退，确保 token 缺失时仍有可读配色
- 跨主题恒定的语义色（如勾选绿 `#77d05c`）在两套回退中保持一致
- 需要透明度叠色时用 `color-mix(in srgb, <token> N%, transparent)` 而非 rgba 硬编码

---

## 6. Do / Don't

### Do

- 数字/颜色输入框移除原生装饰，焦点样式由父级 wrapper 提供
- 芯片入场用 `cubic-bezier(.23, 1, .32, 1)` 280ms + overshoot 102%
- 点阵呼吸场用对角线 mask 裁切（30%-70% 可见带）
- 限流/恢复用 Discord Blurple `#5865F2`（区别于品牌蓝 `#339cff`）
- 模态框用三段式 token 架构（语义 → 本地 → 硬编码回退）
- 透明度叠色用 `color-mix(in srgb, ...)` 而非 rgba

### Don't

- 不要在 input 上保留原生 `outline`（移除后必须在容器层补偿）
- 不要用 `prefers-reduced-motion: reduce` 正向 gating 循环动画
- 不要在限流 UI 中使用品牌蓝（Blurple 是"恢复/奖励"色，品牌蓝是"交互"色）
- 不要在模态框中硬编码 rgba 透明色（用 `color-mix` 跟随主题）
- 不要让跨主题恒定色（如勾选绿）在 dark/light 中反相

---

## 来源

- `FakeCoding-main/codex-reference/css/annotation-comment-editor-card-BFXPl2BV.css`（表单控件）
- `FakeCoding-main/codex-reference/css/subagent-activity-chip-group-OY7Ia_qf.css`（芯片组）
- `FakeCoding-main/codex-reference/css/rate-limit-reset-redemption-pDJMFnJa.css`（限流光效）
- `FakeCoding-main/codex-reference/css/referral-invite-modal-CoMV3aAJ.css`（邀请模态）
