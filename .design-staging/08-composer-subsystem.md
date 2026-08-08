# 08 — Composer 子系统

> Composer 是 Codex 界面里 **最复杂的单组件**。本文档深入定义其结构、尺寸、状态、内部按钮、菜单系统。
>
> 来源：`FakeCoding-main/codex-reference/css/composer-*.css`（5 个 CSS）+ `codex-conversation-render/08-inlined-from-app-initial/use-chatgpt-composer-controller-BIZ0AzS_.js`（1.9MB 控制器）+ `codex-reference/DROPDOWN.md` + `codex-reference/ALIGNMENT.md`。
>
> **核心规则**：容器 25px 圆角（3xl）；内部按钮 28px 直径 + 10px 圆角；按钮间 4px gap；Composer 内菜单用统一 dropdown recipe。

---

## 目录

1. [设计哲学](#设计哲学)
2. [结构总览](#结构总览)
3. [容器尺寸](#容器尺寸)
4. [内部按钮系统](#内部按钮系统)
5. [Composer 内菜单](#composer-内菜单)
6. [Power Slider 推理强度](#power-slider-推理强度)
7. [Approval / 审批卡](#approval--审批卡)
8. [状态变体](#状态变体)
9. [Do / Don't](#do--dont)

---

## 设计哲学

Composer 是用户和 AI 交互的 **唯一入口**，所以它要同时满足三个看似矛盾的要求：

1. **够大，能输入长 prompt**：多行输入、附件、@mention、code block 都要塞下。
2. **够小，不抢会话区**：默认状态不能占太多屏幕，要让会话历史是主角。
3. **结构清晰，按钮不混乱**：工具栏按钮多（发送 / 模型 / 推理强度 / 附件 / 模式 / run location），不能挤成一团。

Codex 的解法是 **单一容器 + 三层结构**：
- 外层是 25px 圆角的圆角矩形容器（`--radius-3xl`），把所有 Composer 元素包成一个视觉单元。
- 中层是 prompt editor（ProseMirror）+ 工具栏（utility bar）+ action bar。
- 内层是按钮组，按钮统一 28px 直径，4px gap，圆角 10px。

**这套数字是硬编码常量**，不要在组件里自由发挥。

---

## 结构总览

```
┌──────────────────────────────────────────────────────┐
│  Composer Container (25px radius, 3xl)               │
│  ┌────────────────────────────────────────────────┐  │
│  │  Prompt Editor (ProseMirror)                  │  │  ← 输入区
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │  @mention list (dropdown recipe)         │  │  │  ← 提及列表
│  │  └──────────────────────────────────────────┘  │  │
│  ├────────────────────────────────────────────────┤  │
│  │  Utility Bar (附件 / 代码块 / 工具)            │  │  ← 工具栏
│  ├────────────────────────────────────────────────┤  │
│  │  Action Bar                                     │  │
│  │  [模型] [推理强度] [run location]    [发送]   │  │  ← 操作栏
│  │   28px   28px        28px            28px      │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 层级

| 层 | 元素 | 圆角 | 阴影 |
|---|---|---|---|
| 容器 | Composer shell | 25px（3xl） | md-stronger |
| 内嵌菜单 | @mention / dropdown | 20px（2xl） | xl-spread |
| 按钮 | 工具栏按钮 | 10px（md） | 无 |

---

## 容器尺寸

### Token 引用

```css
.composer {
  background: var(--color-background-elevated-primary);          /* color-mix gray-800 96% */
  border-radius: var(--radius-3xl);                             /* 25px */
  box-shadow: var(--shadow-md-stronger);                        /* 0 2px 4px -1px 0.13 */
  backdrop-filter: blur(8px);
  padding: 8px;
}
```

### 多行 vs 单行

| 变体 | 圆角 | 用途 |
|---|---|---|
| 多行（标准） | `--radius-3xl`（25px） | 会话页 Composer |
| 单行 | `--radius-token-composer-single-line`（22px） | 快速输入栏 / 紧凑模式 |

**单行 22px 是特例**：介于 2xl(20) 和 3xl(25) 之间。这是故意的设计 —— 单行 Composer 比 dropdown 大一档（22 vs 20），但比多行 Composer 小一档（22 vs 25）。

### 关键规则

- **25px 圆角**。多行 Composer 容器 `--radius-3xl`（25px），不是 20px 或 16px。
- **md-stronger shadow**。Composer 用 `--shadow-md-stronger`（比 dropdown 浅，因为 Composer 是嵌入式的，不是浮层）。
- **8px blur**。必须 `backdrop-filter: blur(8px)` + `color-mix 96%`。
- **8px padding**。容器内边距 8px，让内部按钮和 editor 有呼吸空间。

---

## 内部按钮系统

### Token 引用

```css
.composer__btn {
  width: var(--spacing-token-button-composer);                 /* 28px */
  height: var(--spacing-token-button-composer);
  border-radius: var(--radius-md);                            /* 10px */
  background: transparent;
  color: var(--color-icon-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s, color 0.15s;
}
.composer__btn:hover {
  background: var(--color-background-button-tertiary-hover);  /* gray-0 7% */
  color: var(--color-icon-primary);
}
.composer__btn:active {
  background: var(--color-background-button-tertiary-active); /* gray-0 10% */
}
.composer__btn--sm {
  width: var(--spacing-token-button-composer-sm);            /* 20px */
  height: var(--spacing-token-button-composer-sm);
}
.composer__btn-group {
  display: inline-flex;
  gap: var(--spacing-token-button-composer-gap);            /* 4px */
}
```

### 按钮尺寸

| 变体 | size | 用途 |
|---|---|---|
| 标准 | 28px | 模型选择 / 推理强度 / run location / 发送 |
| 小 | 20px | 紧凑工具栏按钮（代码块 / 附件） |

### 按钮组 gap

```css
.composer__btn-group {
  display: inline-flex;
  gap: 4px;                                                     /* 永远 4px */
}
```

**规则**：Composer 内按钮间 gap 永远 4px（`--spacing-token-button-composer-gap`）。不要 8px（太散）或 2px（太挤）。

### 状态

| 状态 | 背景 | 图标色 |
|---|---|---|
| default | transparent | `--color-icon-secondary`（70% alpha） |
| hover | `gray-0 7%` | `--color-icon-primary`（90% alpha） |
| active | `gray-0 10%` | `--color-icon-primary` |
| disabled | transparent | `--color-icon-tertiary`（50% alpha） |

### 发送按钮特化

发送按钮是主操作，有 hover 态变蓝的特化：

```css
.composer__btn--send:hover {
  background: var(--color-background-button-primary-hover);
  color: var(--color-icon-accent);                             /* blue-300 */
}
.composer__btn--send--active-state {
  /* 有内容时可点 */
  background: var(--color-background-button-primary);
  color: var(--color-text-button-primary);
}
.composer__btn--send--disabled {
  /* 无内容时禁用 */
  opacity: 0.5;
  cursor: not-allowed;
}
```

**规则**：发送按钮 hover 时图标变蓝（`--color-icon-accent`），这是蓝色出现位之一。

### 关键规则

- **28px 直径**。Composer 内按钮统一 28px，不要 24px 或 32px。
- **10px 圆角**。按钮 `--radius-md`（10px），不是 8px 或 12px。
- **4px gap**。按钮间 gap 永远 4px。
- **transparent 默认**。按钮默认透明，只有 hover 出灰。
- **发送 hover 变蓝**。发送按钮 hover 时图标变 accent 色。

---

## Composer 内菜单

### 模型选择 / 推理强度 / run location 下拉

这些是 Composer 内的 dropdown，**必须用统一 dropdown recipe**（见 [07-components.md](./07-components.md)），不要单写。

```tsx
{/* 模型选择 dropdown */}
<Dropdown width={280}>
  <DropdownItem>GPT-4o</DropdownItem>
  <DropdownItem>o1-preview</DropdownItem>
</Dropdown>

{/* run location dropdown */}
<Dropdown width={200}>
  <DropdownItem>Local</DropdownItem>
  <DropdownItem>Cloud</DropdownItem>
</Dropdown>
```

### 宽度对照

| 菜单 | 宽度 | 来源 |
|---|---|---|
| 模型选择 | 280px（同 project picker） | DROPDOWN.md |
| 推理强度 power slider | 见 [Power Slider](#power-slider-推理强度) | — |
| run location | 200px（同 project action） | DROPDOWN.md |
| @mention list | 280px | 实测 |
| mode switch | `min(260px, sidebar-w-16)` | DROPDOWN.md |

### 关键规则

- **统一 recipe**。Composer 内 dropdown 用 `codex-dropdown.css`，不单写。
- **20px 圆角**。dropdown 容器 `--radius-2xl`（20px），比 Composer 容器（25px）小一档，但不会"陷进"。
- **从按钮弹出**。dropdown 从对应按钮下方弹出，对齐按钮左边。

---

## Power Slider 推理强度

> 推理强度是 Composer 里 **唯一的特殊控件**（不是标准 dropdown，是 draggable slider）。来源：`codex-reference/css/model-picker-power-slider-impl-ShOI3rhA.css`。

### 结构

```
[推理强度按钮] ← 点击/拖拽
    └── [Power Slider 浮层]
         ├── 标题 "Reasoning effort"
         ├── [slider track]
         │   ├─ low
         │   ├─ medium  ← 可拖拽 thumb
         │   └─ high
         └── 说明文字
```

### 浮层样式

Power slider 浮层 **不是标准 dropdown**，是特殊的下拉卡片：

```css
.effort-card--dropdown {
  background: var(--color-background-elevated-primary);
  border-radius: var(--radius-2xl);                          /* 20px */
  box-shadow: 0 0 0 0.5px var(--color-border), var(--shadow-xl);
  backdrop-filter: blur(8px);
  padding: 12px;
  width: 260px;
}
```

**与 dropdown recipe 的差异**：
- padding 12px（dropdown 是 4px）—— 因为 slider 需要更多空间
- width 260px（固定，不按用途区分）

### slider track

```css
.power-slider__track {
  height: 4px;
  background: var(--color-background-elevated-secondary);
  border-radius: var(--radius-full);                        /* 圆形端 */
  position: relative;
}
.power-slider__thumb {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--color-text-foreground);
  box-shadow: var(--shadow-sm);
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
}
.power-slider__thumb:hover {
  background: var(--color-icon-accent);                   /* hover 变蓝 */
}
```

### 关键规则

- **浮层用 dropdown recipe**。effort-card 的背景 / 圆角 / 阴影 / blur 与 dropdown 完全一致，只是 padding 和 width 不同。
- **thumb 16px 圆形**。slider thumb 是 16px 直径圆形，用 `--radius-full`。
- **hover 变蓝**。thumb hover 时变 accent 色（`--color-icon-accent`）。
- **track 4px 高**。slider track 4px 高，圆角端。

---

## Approval / 审批卡

> 工具调用审批请求卡，出现在会话区（不是 Composer 内）。来源：`codex-reference/css/composer-approval-request-card-IKpIrw8U.css`。

### 结构

```
┌─────────────────────────────────────────┐
│ [icon] Tool Call Request                │
│                                         │
│ Run command: npm install                │
│                                         │
│ [Allow once] [Always allow] [Deny]     │
└─────────────────────────────────────────┘
```

### Token 引用

```css
.approval-card {
  background: var(--color-background-elevated-primary);
  border-radius: var(--radius-2xl);                          /* 20px */
  box-shadow: var(--shadow-md);
  padding: 16px;
}
.approval-card__title {
  font-size: var(--text-sm);                                /* 12px */
  font-weight: var(--font-weight-medium);                   /* 500 */
  color: var(--color-text-foreground-secondary);
}
.approval-card__command {
  font-family: var(--font-mono-default);
  font-size: var(--text-sm);
  color: var(--color-text-foreground);
  background: var(--color-background-elevated-secondary);
  border-radius: var(--radius-sm);                         /* 7.5px */
  padding: 8px 12px;
  margin: 8px 0;
}
.approval-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
```

### 按钮组合

审批卡有三种按钮：
- **Allow once**：secondary 变体（灰）
- **Always allow**：secondary 变体（灰）
- **Deny**：secondary 变体，但按下走 `--color-background-danger-active`（红）

**规则**：审批按钮平时都是 secondary（灰），不预设"Deny 是红色"—— 只有按下时才红。这避免用户被红色按钮误导。

---

## 状态变体

### 默认（有内容）

```css
.composer {
  background: var(--color-background-elevated-primary);
  box-shadow: var(--shadow-md-stronger);
}
```

### 空状态（无内容）

```css
.composer--empty {
  /* 容器不变，但发送按钮禁用 */
}
.composer--empty .composer__btn--send {
  opacity: 0.5;
  cursor: not-allowed;
}
```

### focus 状态

Composer 整体 focus 时（用户在输入），容器加一个 focus ring：

```css
.composer:focus-within {
  box-shadow: var(--shadow-md-stronger),
              0 0 0 0.5px var(--color-border-focus);          /* 蓝色 hairline */
}
```

**规则**：focus ring 用 `0 0 0 0.5px blue-300`（hairline，不是 3px ring）。蓝色出现位之一。

### 错误状态

```css
.composer--error {
  box-shadow: var(--shadow-md-stronger),
              0 0 0 0.5px var(--color-border-error);          /* 红色 hairline */
}
```

### 加载状态（发送中）

```css
.composer--loading .composer__btn--send {
  /* 发送按钮变成 spinner */
  background: var(--color-background-button-primary);
  color: var(--color-text-button-primary);
  pointer-events: none;
}
.composer--loading .composer__btn--send .icon {
  animation: spin 0.6s linear infinite;
}
```

---

## 关键规则汇总

1. **容器 25px 圆角**（`--radius-3xl`）。多行 Composer。
2. **单行 22px 圆角**（`--radius-token-composer-single-line`）。单行 Composer 例外。
3. **内部按钮 28px 直径**（`--spacing-token-button-composer`）。
4. **小按钮 20px 直径**（`--spacing-token-button-composer-sm`）。
5. **按钮圆角 10px**（`--radius-md`）。
6. **按钮间 gap 4px**（`--spacing-token-button-composer-gap`）。
7. **Composer 内菜单用统一 dropdown recipe**（20px 圆角，xl-spread shadow，8px blur）。
8. **发送按钮 hover 变蓝**（`--color-icon-accent`）。
9. **focus 用蓝色 hairline**（`0 0 0 0.5px blue-300`）。
10. **md-stronger shadow**（比 dropdown 浅，因为 Composer 是嵌入式）。

---

## Do / Don't

### Do

```tsx
{/* Composer 容器 */}
<div className="composer rounded-3xl bg-token-elevated-primary shadow-md-stronger backdrop-blur-sm">
  {/* prompt editor */}
  <ProseMirror className="px-3 py-2" />
  {/* action bar */}
  <div className="flex gap-1 p-2">
    <button className="composer__btn"><ModelIcon /></button>
    <button className="composer__btn"><EffortIcon /></button>
    <div className="ml-auto" />
    <button className="composer__btn composer__btn--send"><SendIcon /></button>
  </div>
</div>
```

### Don't

```tsx
{/* ❌ 容器圆角错误 */}
<div className="composer rounded-xl">  {/* 应是 rounded-3xl (25px) */}

{/* ❌ 按钮尺寸自由发挥 */}
<button className="w-8 h-8">  {/* 应是 28px (w-7) */}

{/* ❌ Composer 内菜单单写 */}
<Dropdown className="my-custom-menu rounded-lg bg-gray-700">  {/* 应统一 recipe */}

{/* ❌ 发送按钮蓝色填充 */}
<button className="bg-blue-500 text-white">发送</button>  {/* 应是 primary 墨色填充，hover 才蓝 */}

{/* ❌ focus ring 3px */}
<input className="focus:ring-2 focus:ring-blue-500" />  {/* 应是 0.5px hairline */}
```
