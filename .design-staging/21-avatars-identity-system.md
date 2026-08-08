---
doc: 21-avatars-identity-system
name: Avatars, Identity, Profile & Activity Stacks
category: Components
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/tokens.css
  - codex-reference/css/avatar-overlay-pill-material-Cb1G0F_E.css
  - codex-reference/css/avatar-overlay-native-frame-CqLVkFV5.css
  - codex-reference/css/profile-CQjDNzte.css
  - codex-reference/css/at-mention-list-BAjTVsT9.css
  - codex-reference/css/codex-avatar-CBhzyYwb.css
  - codex-pure-source/runtime-dom/stylesheets-rules.json
  - codex-design-system.css
---

# 21 — Avatars, Identity, Profile & Activity Stacks

> 头像（avatar）、身份徽章、个人资料（profile）与活动堆叠（activity stack）构成 Codex 的"**人物视觉系统**"。本文规范玻璃拟态头像药丸、原生帧头像、profile 加载动画、活动堆叠的滚动渐隐遮罩。
>
> 这是企业级产品中**最容易被忽视但最影响协作体验**的部分：当多人协作出现在同一画面时，头像必须既能"识别个体"又能"表达状态"，且不能干扰主内容。

---

## 目录

1. [设计哲学](#1-设计哲学)
2. [玻璃拟态头像药丸 — Pill Material](#2-玻璃拟态头像药丸--pill-material)
3. [活动堆叠渐隐遮罩 — Activity Stack Fade](#3-活动堆叠渐隐遮罩--activity-stack-fade)
4. [Profile 加载动画](#4-profile-加载动画)
5. [Profile 照片编辑徽章](#5-profile-照片编辑徽章)
6. [Reply Stop Control — 特殊按钮态](#6-reply-stop-control--特殊按钮态)
7. [主题对比矩阵](#7-主题对比矩阵)
8. [无障碍](#8-无障碍)
9. [Do / Don't](#9-do--dont)

---

## 1. 设计哲学

### 1.1 三层身份视觉

Codex 的人物视觉分为三层：

| 层 | 用途 | 视觉策略 |
|----|------|----------|
| **Avatar（基础）** | 单个用户头像 | 圆形/方形图片 + 边框 |
| **Pill Material（药丸）** | 嵌入对话流的头像控件 | 玻璃拟态 + 内嵌高光 + backdrop-blur |
| **Native Frame（原生帧）** | 头像 + 活动堆叠 | 系统原生样式 + 滚动渐隐遮罩 |

### 1.2 与 macOS 原生头像的关系

Codex 的头像药丸借鉴 macOS 原生控件：
- **顶部内嵌白光**（`inset 0 1px 1px #fff9`）模拟"光从上方照下来"
- **底部内嵌暗影**（`inset 0 -1px 2px #fff3`）模拟"光被遮挡"
- **backdrop-blur** 让头像药丸"浮"在内容上
- **暗色专用值**（`#202020e6`）保证暗色下仍有玻璃感

### 1.3 协作场景的"低干扰原则"

头像药丸在对话流中出现时，必须：
- **不抢眼**：opacity 低于主内容，用 backdrop-filter 而非纯色
- **可识别**：边框 + 内嵌高光让头像药丸有清晰边界
- **状态可表达**：通过 hover/active 改变 mix-blend-mode 表达交互态

---

## 2. 玻璃拟态头像药丸 — Pill Material

### 2.1 完整 CSS

```css
._cssMaterial_1rpta_1 {
  --avatar-overlay-css-material-elevation: 0 0 transparent;   /* 默认无投影 */

  border: 1px solid color-mix(in srgb, var(--color-token-border) 60%, transparent);

  box-shadow:
    inset 0 1px 1px #fff9,                  /* 顶部白光（高亮） */
    inset 0 -1px 2px #fff3,                 /* 底部白光（暗影） */
    var(--avatar-overlay-css-material-elevation);

  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  will-change: transform, backdrop-filter;  /* 性能：声明合成属性 */
  background: #ffffffe6;                    /* 90% 白 */
}

._activityPillMaterial_1rpta_29 {
  -webkit-backdrop-filter: none;            /* 活动药丸：关闭 blur */
  backdrop-filter: none;
  will-change: transform;
}

._cssMaterialElevated_1rpta_43 {
  --avatar-overlay-css-material-elevation: 0 3px 16px #0003;  /* 投影：3px y + 16px blur + 20% 黑 */
  border-color: #ffffff26;                  /* 15% 白边框 */
}

.electron-dark ._cssMaterial_1rpta_1 {
  box-shadow:
    inset 0 1px 1px #fff3,                  /* 暗色顶部白光减弱 */
    inset 0 -1px 2px #ffffff14,             /* 暗色底部白光更弱 */
    var(--avatar-overlay-css-material-elevation);
  background: #202020e6;                    /* 暗色背景 90% 黑 */
}

.electron-dark ._cssMaterialElevated_1rpta_43 {
  --avatar-overlay-css-material-elevation: 0 3px 16px #00000059;  /* 暗色投影 35% 黑 */
  border-color: #ffffff1f;                  /* 12% 白边框 */
}
```

### 2.2 三种变体

| 类 | 用途 | blur | 阴影 | 背景 |
|----|------|------|------|------|
| `._cssMaterial_1rpta_1` | 默认头像药丸 | `blur(4px)` | inset 高光 + 暗影 | `#ffffffe6` (亮) / `#202020e6` (暗) |
| `._activityPillMaterial_1rpta_29` | 活动药丸（密集列表） | `none` | 同上 | 同上 |
| `._cssMaterialElevated_1rpta_43` | 悬浮头像药丸 | `blur(4px)` | inset + 投影 `0 3px 16px #0003` | 同上 |

### 2.3 关键设计

#### 2.3.1 双 inset 高光

```css
box-shadow:
  inset 0 1px 1px #fff9,    /* 顶部 1px 白光 97% */
  inset 0 -1px 2px #fff3;   /* 底部 1px 白光 95% */
```

**效果**：模拟 Mac 原生控件的"光从上方照下来"效果——顶部边缘亮、底部边缘暗，制造**球面感**而非平面感。

#### 2.3.2 backdrop-filter: blur(4px)

```css
-webkit-backdrop-filter: blur(4px);
backdrop-filter: blur(4px);
```

**与 dropdown 的对比**：
- dropdown：`blur(8px)`（重模糊，强调浮层）
- avatar pill：`blur(4px)`（轻模糊，强调融入）

头像药丸**不需要**像 dropdown 那样"明显浮起来"，而是要"融入但有边界"。

#### 2.3.3 will-change 声明

```css
will-change: transform, backdrop-filter;
```

**性能优化**：声明即将变化的属性，让浏览器提前为合成层做准备。`backdrop-filter` 是昂贵的属性，提前声明避免动画时卡顿。

#### 2.3.4 暗色背景值 `#202020e6`

```css
.electron-dark ._cssMaterial_1rpta_1 {
  background: #202020e6;   /* 90% #202020 + 10% 透明 */
}
```

**为什么不直接用 `--gray-800` (#212121)**：
- `#202020` 比 `#212121` 略深一档，与头像药丸下方的对话内容形成对比
- 90% 不透明 + 10% 透明让 backdrop-blur 生效（如果完全透明则 blur 无意义）

### 2.4 elevated 变体的投影

```css
._cssMaterialElevated_1rpta_43 {
  --avatar-overlay-css-material-elevation: 0 3px 16px #0003;
}
```

**几何**：
- `0 3px`：y 偏移 3px（轻微下沉，模拟重力）
- `16px`：blur 16px（柔和扩散）
- `#0003`：20% 黑（轻投影，不抢眼）

**与 dropdown shadow-xl 的对比**：
- dropdown `xl`：`0 8px 16px -4px` (8px y, 16px blur, -4px spread)
- avatar elevated：`0 3px 16px` (3px y, 16px blur, 0 spread)

avatar 投影更"贴身"——y 偏移小、blur 大，制造"轻微浮起"而非"明显悬浮"。

---

## 3. 活动堆叠渐隐遮罩 — Activity Stack Fade

### 3.1 三种 fade 模式

```css
/* 顶部渐隐（活动列表上方淡出） */
._activityStackFadeTop_1dp8w_1 {
  -webkit-mask-image: linear-gradient(#0000, #000 24px 100%);
  mask-image: linear-gradient(#0000, #000 24px 100%);
}

/* 底部渐隐（活动列表下方淡出） */
._activityStackFadeBottom_1dp8w_21 {
  -webkit-mask-image: linear-gradient(0deg, #0000, #000 24px 100%);
  mask-image: linear-gradient(0deg, #0000, #000 24px 100%);
}

/* 双向渐隐（顶部 + 底部都淡出） */
._activityStackFadeBoth_1dp8w_41 {
  -webkit-mask-image: linear-gradient(#0000, #000 24px, #000 calc(100% - 24px), #0000);
  mask-image: linear-gradient(#0000, #000 24px, #000 calc(100% - 24px), #0000);
}
```

### 3.2 渐隐几何

```
┌─── Fade Top ───┐  ┌─── Fade Bottom ───┐  ┌─── Fade Both ───┐
│ 透明 (0%)      │  │ 不透明 (100%)     │  │ 透明 (0%)       │
│   ↓ 24px       │  │                   │  │   ↓ 24px        │
│ 不透明 (100%)  │  │ 不透明 (100%)     │  │ 不透明 (100%)   │
│   ↓ 100%       │  │   ↓ 100%-24px     │  │   ↓ 100%-24px   │
│ 不透明 (100%)  │  │   ↓ 24px          │  │   ↓ 24px        │
│                │  │ 透明 (0%)         │  │ 透明 (0%)       │
└────────────────┘  └───────────────────┘  └─────────────────┘
```

### 3.3 关键设计

#### 3.3.1 渐隐距离 24px

- 比 sidebar 渐隐（40px）短
- 比 cmdk 输入框 padding（10px）长
- **理由**：活动堆叠通常较小（4-8 个头像），不需要太长渐隐

#### 3.3.2 用 mask-image 而不是 gradient overlay

```css
/* ❌ 错误做法：用 overlay 渐变 */
.activity-stack::before {
  background: linear-gradient(to bottom, var(--bg), transparent);
  position: absolute;
  top: 0;
  height: 24px;
}

/* ✅ 正确做法：用 mask-image */
.activity-stack {
  mask-image: linear-gradient(to bottom, transparent, black 24px);
}
```

**优势**：
- mask-image 不需要额外 DOM 元素
- mask 跟随容器形状（无论圆角/不规则）
- 不引入额外背景色（保持 backdrop-filter 效果）
- 性能更好（不触发 layout）

#### 3.3.3 `0deg` vs `to bottom`

`linear-gradient(0deg, ...)` 等价于 `linear-gradient(to top, ...)`：
- `to bottom`：从上到下
- `0deg`：从下到上（CSS 角度 0 = 上）

`._activityStackFadeBottom` 用 `0deg` 让渐隐方向"从下到上"，即底部透明、顶部不透明。

---

## 4. Profile 加载动画

### 4.1 完整 CSS

```css
._profileLoadingBlock_17kdy_1 {
  --profile-loading-shimmer-highlight: #ffffffbf;          /* 默认高亮：75% 白 */

  background-color:
    color-mix(in srgb,
      var(--color-token-description-foreground) 7%,       /* 7% 描述前景色 */
      var(--color-token-main-surface-primary));           /* + 主表面色 */

  background-image:
    linear-gradient(90deg,
      transparent 34%,                                    /* 前 34% 透明 */
      var(--profile-loading-shimmer-highlight) 50%,       /* 50% 处高亮 */
      transparent 66%);                                   /* 后 34% 透明 */

  background-position: -100vw 0;                          /* 起始：屏幕外左侧 */
  background-repeat: no-repeat;
  background-size: 100vw 100vh;                           /* 高光宽度 = 视口宽 */
  background-attachment: fixed;                            /* 固定，不随滚动 */
  animation: 2.6s steps(48, end) infinite _profile-loading-page-sweep_17kdy_1;
}

@keyframes _profile-loading-page-sweep_17kdy_1 {
  to {
    background-position: 100vw 0;                         /* 终止：屏幕外右侧 */
  }
}

.dark ._profileLoadingBlock_17kdy_1,
.electron-dark ._profileLoadingBlock_17kdy_1 {
  --profile-loading-shimmer-highlight:
    color-mix(in srgb,
      var(--color-token-description-foreground) 13%,      /* 暗色：13% 描述色 */
      var(--color-token-main-surface-primary));
}

@media (prefers-reduced-motion: reduce) {
  _profileLoadingBlock_17kdy_1 {
    background-image: none;                               /* 完全移除高光 */
    animation: none;
  }
}
```

### 4.2 关键设计

#### 4.2.1 `steps(48, end)` 步进动画

```css
animation: 2.6s steps(48, end) infinite;
```

**为什么用步进而不是线性**：
- 线性动画看起来"丝滑"，但 profile 加载是"离散的"（数据一段段到达）
- 48 步让动画看起来像"扫描线"，符合"加载数据"的语义
- 每步 `2.6s / 48 = 54ms`，比 60fps 帧间隔（16ms）慢，制造"扫描"感

#### 4.2.2 `background-attachment: fixed`

```css
background-attachment: fixed;
```

**含义**：背景图相对于**视口**固定，不随容器滚动。

**效果**：即使 profile 容器在滚动，shimmer 高光也"扫过整个视口"，制造"页面级加载"的视觉，而不是"局部加载"。

#### 4.2.3 暗色高亮色计算

```css
/* 亮色：75% 白 */
--profile-loading-shimmer-highlight: #ffffffbf;

/* 暗色：13% 描述前景色 + 主表面色 */
--profile-loading-shimmer-highlight:
  color-mix(in srgb,
    var(--color-token-description-foreground) 13%,
    var(--color-token-main-surface-primary));
```

**为什么暗色不用白**：暗色背景下 75% 白会"刺眼"，改用 13% 描述色让高光"融入"暗背景。

#### 4.2.4 底色策略

```css
background-color:
  color-mix(in srgb,
    var(--color-token-description-foreground) 7%,
    var(--color-token-main-surface-primary));
```

**含义**：底色 = 主表面色 + 7% 描述色，让 loading block 比"正常 surface"略暗，形成"未加载"的视觉差异。

---

## 5. Profile 照片编辑徽章

### 5.1 完整 CSS

```css
._profilePhotoEditBadge_17kdy_43 {
  -webkit-backdrop-filter: blur(20px);                    /* 重模糊 */
  backdrop-filter: blur(20px);
  background-color: #0000001a;                            /* 10% 黑 */
}

._profilePhotoInput_17kdy_55:hover ._profilePhotoEditBadge_17kdy_43,
._profilePhotoInput_17kdy_55:focus-within ._profilePhotoEditBadge_17kdy_43 {
  background-color: #00000029;                            /* 16% 黑 */
}
```

### 5.2 关键设计

#### 5.2.1 `blur(20px)` 极重模糊

**与头像药丸对比**：
- avatar pill：`blur(4px)`（轻模糊）
- profile edit badge：`blur(20px)`（重模糊）

**原因**：edit badge 覆盖在头像图片上，需要"完全模糊化"背景头像，让用户专注于"编辑"操作而非头像本身。

#### 5.2.2 hover/focus 加深背景

```css
:hover / :focus-within → background-color: #00000029;
```

**10% → 16% 黑**：hover 时加深 60%，提供明确反馈。

#### 5.2.3 用 `:focus-within` 而不是 `:focus`

```css
._profilePhotoInput_17kdy_55:focus-within ._profilePhotoEditBadge_17kdy_43
```

**原因**：`._profilePhotoInput_17kdy_55` 内部包含 `<input type="file">`，`<input>` 获得焦点时父级 `:focus` 不会触发，但 `:focus-within` 会。

---

## 6. Reply Stop Control — 特殊按钮态

### 6.1 完整 CSS

```css
._replyStopControl_1rpta_79:before {
  opacity: .2;
  mix-blend-mode: multiply;                              /* 正片叠底 */
  background: #727272;                                    /* 中灰 */
}

._replyStopControl_1rpta_79 svg {
  color: #727272;                                         /* 中灰图标 */
  mix-blend-mode: normal;                                 /* 不混色 */
}

@media (hover: hover) and (pointer: fine) {
  /* 普通控件 hover */
  ._cssControl_1rpta_103:enabled:hover {
    color: #f7f7f7;
    background: #202020d1;                                /* 82% 黑 */
  }

  ._cssControl_1rpta_103:enabled:hover:before {
    opacity: 0;                                           /* hover 时隐藏伪元素 */
  }

  ._cssControl_1rpta_103:enabled:hover svg {
    color: #f7f7f7;
    mix-blend-mode: normal;
  }

  /* reply-stop hover */
  ._replyStopControl_1rpta_79:enabled:is(:hover, [data-native-hovered=true]),
  ._replyStopControl_1rpta_79[aria-pressed=true] {
    background: 0 0;                                       /* hover 透明背景 */
  }

  ._replyStopControl_1rpta_79:enabled:is(:hover, [data-native-hovered=true]):before,
  ._replyStopControl_1rpta_79[aria-pressed=true]:before {
    opacity: .47;                                         /* 提高伪元素不透明度 */
    mix-blend-mode: multiply;
    background: #4c4c4c;                                  /* 深灰 */
  }

  ._replyStopControl_1rpta_79:enabled:is(:hover, [data-native-hovered=true]) svg,
  ._replyStopControl_1rpta_79[aria-pressed=true] svg {
    color: #fff;
    mix-blend-mode: plus-lighter;                         /* 加亮混色 */
  }

  /* dark 普通 hover */
  .electron-dark ._cssControl_1rpta_103:not(._replyStopControl_1rpta_79):enabled:hover {
    background: #ffffff2e;                                 /* 18% 白 */
  }
}

/* active 态 */
._replyStopControl_1rpta_79:enabled:active:before {
  opacity: .55;
}
```

### 6.2 三态对比

| 状态 | `:before` opacity | `:before` color | svg color | svg blend |
|------|-------------------|------------------|-----------|-----------|
| default | 0.2 | `#727272` (中灰) | `#727272` | normal |
| hover | 0.47 | `#4c4c4c` (深灰) | `#fff` | `plus-lighter` |
| active | 0.55 | (继承) | (继承) | (继承) |
| pressed (`aria-pressed=true`) | 0.47 | `#4c4c4c` | `#fff` | `plus-lighter` |

### 6.3 mix-blend-mode 用法

#### 6.3.1 `mix-blend-mode: multiply`（正片叠底）

```css
._replyStopControl_1rpta_79:before {
  mix-blend-mode: multiply;
}
```

**效果**：伪元素颜色与背景相乘，结果总是更暗。用于让按钮背景"融入"头像药丸。

#### 6.3.2 `mix-blend-mode: plus-lighter`（加亮）

```css
._replyStopControl_1rpta_79:enabled:hover svg {
  mix-blend-mode: plus-lighter;
}
```

**效果**：颜色相加（不是平均），让 svg 图标在 hover 时"发光"。

**注意**：`plus-lighter` 是较新的 blend mode（CSS Compositing Level 2），在老浏览器中可能不支持。Codex 用它来表达"hover 时图标发光"的视觉效果。

### 6.4 hover 媒体查询

```css
@media (hover: hover) and (pointer: fine) {
  /* hover 样式 */
}
```

**含义**：只在支持 hover 且使用精确指针（鼠标）的设备上应用 hover 样式。触屏设备（如平板）不会触发 hover，避免"点击后 hover 卡住"的问题。

---

## 7. 主题对比矩阵

### 7.1 完整对比

| 属性 | 亮色 | 暗色 |
|------|------|------|
| 默认背景 | `#ffffffe6` (90% 白) | `#202020e6` (90% #202020) |
| elevated 投影 | `0 3px 16px #0003` (20% 黑) | `0 3px 16px #00000059` (35% 黑) |
| elevated 边框 | `#ffffff26` (15% 白) | `#ffffff1f` (12% 白) |
| 顶部 inset | `inset 0 1px 1px #fff9` (97% 白) | `inset 0 1px 1px #fff3` (95% 白) |
| 底部 inset | `inset 0 -1px 2px #fff3` (95% 白) | `inset 0 -1px 2px #ffffff14` (8% 白) |
| 普通 hover bg | `#202020d1` (82% 黑) | `#ffffff2e` (18% 白) |

### 7.2 设计哲学

- **亮色用"白底深 hover"**：默认白底，hover 时变深（黑覆盖）
- **暗色用"暗底浅 hover"**：默认暗底，hover 时变浅（白覆盖）
- **inset 高光强度**：亮色强（97%/95%），暗色弱（95%/8%）—— 暗色下高光"几乎消失"
- **投影强度**：暗色比亮色强（35% vs 20%）—— 暗色需要更强投影才能感知

---

## 8. 无障碍

### 8.1 头像图片的 alt 文本

```html
<img
  src="avatar.png"
  alt="{user.display_name}'s avatar"
  role="img"
/>
```

**规则**：
- 单用户头像：alt = "{用户名}'s avatar"
- 多用户堆叠：alt = "{user1}, {user2}, {user3}"（最多 3 个，其余用 "+N"）
- 系统头像：alt = ""（装饰性，让屏幕阅读器跳过）

### 8.2 状态徽章的 ARIA

```html
<div class="avatar-pill" role="img" aria-label="{user.name}, {status}">
  <img src="avatar.png" alt="" />
  <span class="status-dot" aria-hidden="true"></span>
</div>
```

**规则**：
- 头像药丸整体 `role="img"` + `aria-label` 包含状态
- 内部 `<img>` alt 留空（避免重复）
- 状态点 `aria-hidden="true"`（视觉装饰）

### 8.3 reply-stop 按钮的 ARIA

```html
<button class="_replyStopControl_1rpta_79" aria-pressed="false" aria-label="Stop generating reply">
  <svg aria-hidden="true">...</svg>
</button>
```

**规则**：
- 用 `aria-pressed` 表达"停止中"状态
- `aria-label` 明确说明按钮作用
- svg `aria-hidden="true"`（图标装饰）

### 8.4 Profile 加载态

```html
<div class="_profileLoadingBlock_17kdy_1" role="status" aria-live="polite" aria-label="Loading profile">
  <span class="sr-only">Profile is loading...</span>
</div>
```

**规则**：
- `role="status"` + `aria-live="polite"` 让屏幕阅读器在加载完成时通知
- 加视觉隐藏的文本 fallback（`sr-only`）

### 8.5 reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  /* profile loading：移除 shimmer 高光，保留底色 */
  ._profileLoadingBlock_17kdy_1 {
    background-image: none;
    animation: none;
  }

  /* avatar hover：保留颜色变化，移除过渡 */
  ._cssControl_1rpta_103 {
    transition: none;
  }
}
```

---

## 9. Do / Don't

### ✅ Do

- 头像药丸用双 inset 高光（顶部 + 底部）模拟球面感
- backdrop-filter 用 4px（融入感），不要 12px（隔离感）
- 暗色背景用 `#202020e6` 而不是 `#212121`（略深一档形成对比）
- profile loading 用 `steps(48, end)` 步进动画（扫描感）
- profile edit badge 用 20px 重模糊（遮盖头像内容）
- activity stack fade 用 mask-image（不引入额外 DOM）
- reply-stop 用 `mix-blend-mode: plus-lighter` 让 hover 图标发光
- hover 样式用 `@media (hover: hover) and (pointer: fine)` 包裹

### ❌ Don't

- **不要**用 `box-shadow` 给头像药丸加 hover（用 inset 高光 + backdrop-filter）
- **不要**在头像药丸上用 `blur(12px)`（太重，让头像"消失"）
- **不要**用 `rgba()` 表达半透明背景（用 `#hex` 后缀 alpha 或 `color-mix`）
- **不要**让 reply-stop 的 `:before` opacity 在 default 时高于 0.2（会遮盖头像）
- **不要**在触屏设备上保留 hover 状态（用 `@media (hover: hover)` 旁路）
- **不要**用 `linear-gradient` overlay 替代 `mask-image`（前者需要额外 DOM 且破坏 backdrop-filter）
- **不要**在 profile loading 用 `linear` 缓动（应该用 `steps` 表达扫描感）
- **不要**让 `aria-pressed` 同时用于"按钮选中"和"按钮激活"——只用一种语义

---

## 10. 与 ClawX 的对齐建议

### 10.1 当前问题

- ClawX 没有玻璃拟态头像药丸（用纯色圆形头像）
- 没有 profile loading shimmer（用 spinner）
- 没有 activity stack 渐隐遮罩（列表项贴边显示）
- 没有 reply-stop 的 mix-blend-mode 视觉

### 10.2 迁移建议

1. 引入 `avatar-overlay-pill-material` 三变体（default / activity / elevated）
2. profile loading 用 `steps(48, end)` + `background-attachment: fixed` 实现扫描感
3. activity stack fade 用 `mask-image` 三模式（top / bottom / both）
4. reply-stop 类按钮引入 `mix-blend-mode: plus-lighter` hover 效果
5. 所有 hover 样式用 `@media (hover: hover) and (pointer: fine)` 包裹
6. 暗色专用值 `#202020e6` 加入 tokens.css 作为 `--color-token-avatar-pill-background-dark`
