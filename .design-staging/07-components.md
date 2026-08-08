# 07 — 组件规范

> 本文定义 Codex 核心组件的 recipe。每个组件给出：结构 / token 引用 / 尺寸 / 状态变体 / Do-Don't。
>
> 来源：`FakeCoding-main/codex-reference/css/*.css`（45 个组件 CSS）+ `codex-reference/DROPDOWN.md`（dropdown 实测）+ `codex-reference/ALIGNMENT.md`（实测值）。
>
> **核心规则**：dropdown 只有一种 recipe；按钮只有三种变体 + 一种 icon；card 用 `2xl` 圆角；list row 用 `lg` 圆角。

---

## 目录

1. [Dropdown 下拉菜单](#dropdown-下拉菜单)
2. [Button 按钮](#button-按钮)
3. [Card 卡片](#card-卡片)
4. [List row 列表行](#list-row-列表行)
5. [Input 输入框](#input-输入框)
6. [Modal / Dialog 对话框](#modal--dialog-对话框)
7. [Tooltip 提示](#tooltip-提示)
8. [Badge / Chip 徽章](#badge--chip-徽章)
9. [Tab 标签页](#tab-标签页)
10. [Toolbar 工具栏](#toolbar-工具栏)
11. [Icon 图标](#icon-图标)

---

## Dropdown 下拉菜单

> **最重要**。Codex 所有菜单共用一份 CSS（`web/src/codex-dropdown.css`），按宽度区分用途。ClawX 当前的 5 套 dropdown 各自为政必须收敛到这一份。

### Token 引用

```css
.dropdown {
  background: var(--color-background-elevated-primary);          /* color-mix gray-800 96% */
  color: var(--color-text-foreground);
  border-radius: var(--radius-2xl);                             /* 20px */
  box-shadow: 0 0 0 0.5px var(--color-border), var(--shadow-xl); /* hairline + xl */
  backdrop-filter: blur(8px);
  padding: 4px;
}
.dropdown__item {
  border-radius: var(--radius-lg);                              /* 12.5px */
  padding: 6px 8px;                                             /* row-y row-x */
  min-height: 32px;
  font-size: var(--text-sm);                                   /* 12px */
  color: var(--color-text-foreground);
  transition: background-color 0.15s;
}
.dropdown__item:hover {
  background: var(--color-background-button-secondary-hover);
}
.dropdown__item--active {
  background: var(--color-background-accent);                   /* blue-900 dark / blue-50 light */
  color: var(--color-text-accent);
}
.dropdown__sep {
  height: 1px;
  margin: 4px 0;
  background: var(--color-border);
}
```

### 尺寸

| 上下文 | 宽度 | 来源 |
|---|---|---|
| sidebar overflow（整理 / ⋯） | **188px** | DROPDOWN.md 实测 |
| project action | **200px** | 实测 |
| project picker | **280px** | 实测 |
| mode switch | `min(260px, var(--sidebar-w-16, 260px))` | 实测 |

| 部位 | 值 |
|---|---|
| 容器 padding | 4px |
| item min-height | 32px |
| item padding-x（row-x） | 8px |
| item padding-y（row-y） | 6px |
| item radius | 12.5px（`--radius-lg`） |
| item font-size | 12px（`--text-sm`） |
| separator height | 1px |
| separator margin | 4px 0 |

### 结构

```tsx
<div className="dropdown" role="menu">
  <div className="dropdown__item" role="menuitem">
    <Icon className="h-4 w-4" />           {/* 16px 图标 */}
    <span>菜单项文字</span>
    <kbd className="ml-auto text-xs">⌘K</kbd>  {/* 快捷键，可选 */}
  </div>
  <div className="dropdown__sep" />
  <div className="dropdown__item dropdown__item--active">
    {/* 选中态 */}
  </div>
</div>
```

### 状态

| 状态 | 背景 | 文字 |
|---|---|---|
| default | transparent | `--color-text-foreground` |
| hover | `--color-background-button-secondary-hover` | 同上 |
| active（选中） | `--color-background-accent`（blue-900/blue-50） | `--color-text-accent` |
| disabled | transparent | `--color-text-foreground-tertiary`（50% alpha） |

### 关键规则

- **唯一 recipe**。所有 dropdown 共用 `codex-dropdown.css`，按宽度区分用途。禁止为某个 dropdown 单写 CSS。
- **20px 圆角**。dropdown 容器 `--radius-2xl`（20px），不是 15px 或 16px。
- **12.5px item 圆角**。item `--radius-lg`（12.5px），不是 8px。
- **8px blur**。必须 `backdrop-filter: blur(8px)` + `color-mix 96%`。
- **xl-spread shadow**。`0 0 0 0.5px border + xl`，不能只有 `xl`。
- **图标 h-4 w-4**（16px）。menu item 内图标统一 16px，`stroke-width: 2`。

### Do / Don't

**Do**：
```tsx
<div className="dropdown">
  <div className="dropdown__item">...</div>
</div>
```

**Don't**：
```tsx
{/* ❌ 单写 dropdown CSS */}
<div className="my-custom-dropdown rounded-xl bg-gray-800 shadow-lg">
  <div className="px-3 py-2 rounded-md">...</div>
</div>

{/* ❌ 15px 圆角 */}
<div style={{ borderRadius: 15 }} />
```

---

## Button 按钮

> 三种变体 + 一种 icon。**没有第四种**。详见 [01-design-philosophy.md](./01-design-philosophy.md) 原则 11。

### Token 引用

```css
.btn {
  border-radius: var(--radius-md);                              /* 10px */
  padding: 8px 12px;
  min-height: 32px;
  font-size: var(--text-sm);                                   /* 12px */
  font-weight: var(--font-weight-medium);                      /* 500 */
  line-height: var(--leading-snug);                           /* 1.375 */
  transition: background-color 0.15s, color 0.15s;
}
.btn--primary {
  background: var(--color-background-button-primary);
  color: var(--color-text-button-primary);
}
.btn--primary:hover { background: var(--color-background-button-primary-hover); }
.btn--primary:active { background: var(--color-background-button-primary-active); }

.btn--secondary {
  background: var(--color-background-button-secondary);
  color: var(--color-text-button-secondary);
}
.btn--secondary:hover { background: var(--color-background-button-secondary-hover); }

.btn--tertiary {
  background: transparent;
  color: var(--color-text-button-tertiary);
}
.btn--tertiary:hover { background: var(--color-background-button-tertiary-hover); }

.btn--icon {
  width: 32px; height: 32px;
  padding: 0;
  background: transparent;
}
.btn--icon:hover { background: var(--color-background-button-tertiary-hover); }
```

### 变体对照

| 变体 | Dark 填充 | 用途 | 何时用 |
|---|---|---|---|
| primary | `#0d0d0d` 实色 | 主操作 | 发送 / 确认 / 创建 / 保存 |
| secondary | `gray-0 5%` 半透明 | 次要操作 | 取消 / 关闭 / 次要 CTA |
| tertiary | transparent | 工具栏图标按钮 | toolbar / 不带文字的图标按钮 |
| icon | transparent | 32×32 方形 | 独立图标按钮（关闭 / 更多） |

### 尺寸

| 属性 | 值 |
|---|---|
| min-height | 32px |
| padding | 8px 12px |
| radius | 10px（`--radius-md`） |
| font-size | 12px（`--text-sm`） |
| font-weight | 500 |
| icon size | 16px（`h-4 w-4`） |
| icon-button size | 32×32 |

### hover / active 加深规则

| 变体 | default | hover | active |
|---|---|---|---|
| primary | `gray-1000` 实色 | +6% transparent | +10% transparent |
| secondary | `gray-0 5%` | `gray-0 8%`（+3%） | `gray-0 12%`（+4%） |
| tertiary | transparent | `gray-0 7%` | `gray-0 10%`（+3%） |

**规则**：hover 和 active 的差永远是 ~4%。不要把 active 做成"完全反色"。

### Composer 内部按钮（特化尺寸）

Composer 内部按钮是 `icon` 变体的特化尺寸，不是新变体：

```css
.composer__btn {
  width: var(--spacing-token-button-composer);      /* 28px */
  height: var(--spacing-token-button-composer);
  border-radius: var(--radius-md);                  /* 10px */
  gap: var(--spacing-token-button-composer-gap);   /* 4px */
}
.composer__btn--sm {
  width: var(--spacing-token-button-composer-sm);   /* 20px */
  height: var(--spacing-token-button-composer-sm);
}
```

### 关键规则

- **只有三种 + icon**。所有按钮必须落到这四种之一。没有"彩色 CTA"（如 `bg-green-500 text-white`）。
- **primary 是墨色不是蓝色**。primary 按钮填充 `#0d0d0d`（dark）/ `#1a1c1f`（light），不是 `blue-300`。蓝色只在 accent 文本 / 选中态 / focus 上用。
- **tertiary 默认透明**。tertiary 不带默认背景，只有 hover 出灰。
- **禁用 disabled 当变体**。disabled 用 `opacity: 0.5` + `cursor: not-allowed`，不是新变体。

### Do / Don't

**Do**：
```tsx
<button className="btn btn--primary">发送</button>
<button className="btn btn--secondary">取消</button>
<button className="btn btn--icon"><Icon /></button>
```

**Don't**：
```tsx
{/* ❌ 彩色 CTA */}
<button className="bg-green-500 text-white">确认</button>

{/* ❌ 第四种变体 */}
<button className="btn btn--ghost-outline-dashed">...</button>

{/* ❌ primary 蓝色 */}
<button className="bg-blue-500 text-white">发送</button>
```

---

## Card 卡片

### 两种 card

| 类型 | 背景 | 圆角 | 阴影 | padding | 用途 |
|---|---|---|---|---|---|
| surface card | `--color-background-elevated-primary` | `--radius-2xl`（20px） | `--shadow-md` | 16px | 独立卡片（工具调用结果 / 审批卡） |
| flat card | `--color-background-elevated-secondary` | `--radius-xl`（15px） | 无 | 12px | 嵌套卡片（card 内子卡片 / 表单组） |

### Token 引用

```css
.card {
  background: var(--color-background-elevated-primary);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
  padding: 16px;
}
.card--flat {
  background: var(--color-background-elevated-secondary);
  border-radius: var(--radius-xl);
  padding: 12px;
}
.card--interactive {
  transition: box-shadow 0.15s;
}
.card--interactive:hover {
  box-shadow: var(--shadow-lg);
}
```

### 关键规则

- **surface card 用 20px 圆角**。`--radius-2xl`，不是 16px 或 12px。
- **flat card 用 15px 圆角**。`--radius-xl`，比 surface 小一档。
- **surface card 用 md shadow**。`--shadow-md`，不要 `lg`（太浮）或 `xl`（太深，那是 dropdown 用的）。
- **hover lift 用 lg shadow**。交互式卡片 hover 时升一档到 `--shadow-lg`。

---

## List row 列表行

### Token 引用

```css
.list-row {
  min-height: 32px;
  padding: 6px 8px;
  border-radius: var(--radius-lg);                              /* 12.5px */
  transition: background-color 0.15s;
}
.list-row:hover {
  background: color-mix(in oklab, var(--gray-0) 5.2%, transparent);  /* 实测 5.2% */
}
.list-row--selected {
  background: var(--color-background-button-secondary);
}
.list-row--selected:hover {
  background: var(--color-background-button-secondary-hover);
}
```

### 尺寸

| 属性 | 值 |
|---|---|
| min-height | 32px |
| padding-x | 8px |
| padding-y | 6px |
| radius | 12.5px（`--radius-lg`） |
| hover overlay | `color-mix(in oklab, gray-0 5.2%, transparent)`（实测精确） |

### 状态

| 状态 | 背景 |
|---|---|
| default | transparent |
| hover | `gray-0 5.2%` |
| selected | `--color-background-button-secondary`（`gray-0 5%`） |
| selected hover | `--color-background-button-secondary-hover`（`gray-0 8%`） |

### 关键规则

- **12.5px 圆角**。`--radius-lg`，不是 8px 或 10px。
- **5.2% hover**。这是 ALIGNMENT.md 实测的精确值，不是随便选的 5%。
- **selected 是 secondary 色**。选中态用 `--color-background-button-secondary`（灰 5%），不是蓝色。蓝色只在 active（当前打开）态用。

---

## Input 输入框

### Token 引用

```css
.input {
  background: var(--color-background-surface);                /* 或 elevated */
  border: none;
  border-radius: var(--radius-sm);                            /* 7.5px */
  padding: 8px 12px;
  font-size: var(--text-base);
  color: var(--color-text-foreground);
  box-shadow: 0 0 0 0.5px var(--color-border);                /* hairline，不是 border */
  transition: box-shadow 0.15s;
}
.input:focus {
  outline: none;
  box-shadow: 0 0 0 0.5px var(--color-border-focus),          /* 蓝色 hairline */
              0 0 0 3px color-mix(in oklab, var(--blue-300) 20%, transparent);  /* focus ring */
}
.input::placeholder {
  color: var(--color-text-foreground-tertiary);
}
```

### 尺寸

| 属性 | 值 |
|---|---|
| min-height | 32px |
| padding | 8px 12px |
| radius | 7.5px（`--radius-sm`） |
| font-size | 14px（`--text-base`） |
| hairline | `0 0 0 0.5px var(--color-border)` |
| focus ring | `0 0 0 3px color-mix(blue-300 20%, transparent)` |

### 关键规则

- **hairline 不是 border**。输入框边界用 `box-shadow: 0 0 0 0.5px`，不要 `border: 1px solid`（1px 太粗）。
- **focus 用蓝色 hairline + ring**。`0 0 0 0.5px blue-300` + `0 0 0 3px blue-300 20%`。
- **placeholder 用 tertiary**。`--color-text-foreground-tertiary`（50% alpha）。

---

## Modal / Dialog 对话框

### Token 引用

```css
.modal {
  background: var(--color-background-elevated-primary);
  border-radius: var(--radius-2xl);                           /* 20px */
  box-shadow: var(--shadow-2xl);
  backdrop-filter: blur(8px);
  padding: 24px;
  max-width: var(--container-md);                            /* 448px */
}
.modal__overlay {
  background: color-mix(in oklab, var(--gray-1000) 50%, transparent);
  backdrop-filter: blur(4px);
}
.modal__title {
  font-size: var(--text-heading-lg);                         /* 24px */
  font-weight: var(--font-weight-medium);                    /* 500 */
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}
.modal__body {
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
  color: var(--color-text-foreground-secondary);
}
.modal__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 24px;
}
```

### 尺寸

| 属性 | 值 |
|---|---|
| radius | 20px（`--radius-2xl`） |
| shadow | `--shadow-2xl`（最大） |
| padding | 24px |
| max-width | 448px（`--container-md`）默认，可调 |
| overlay | `gray-1000 50%` + `blur(4px)` |

### 关键规则

- **20px 圆角**。modal 用 `--radius-2xl`（同 dropdown，因为都是 elevated surface）。
- **2xl shadow**。modal 用最大阴影。
- **overlay 50% + 4px blur**。遮罩半透明 + 轻模糊，让背景内容"虚化"但不完全隐藏。
- **title 24px medium tight**。modal 标题用最大 heading 字号。

---

## Tooltip 提示

### Token 引用

```css
.tooltip {
  background: var(--color-background-elevated-primary);
  color: var(--color-text-foreground);
  border-radius: var(--radius-md);                           /* 10px */
  padding: 6px 8px;
  font-size: var(--text-xs);                                /* 11px */
  box-shadow: 0 0 0 0.5px var(--color-border), var(--shadow-md);
  backdrop-filter: blur(8px);
  max-width: 240px;
}
```

### 尺寸

| 属性 | 值 |
|---|---|
| radius | 10px（`--radius-md`） |
| padding | 6px 8px |
| font-size | 11px（`--text-xs`） |
| max-width | 240px |
| shadow | hairline + md |

### 关键规则

- **11px 字号**。tooltip 用最小字号，因为它是辅助信息。
- **10px 圆角**。比 dropdown 小一档（tooltip 更小，圆角相应小）。
- **240px max-width**。tooltip 不应太长，超出换行。

---

## Badge / Chip 徽章

### Token 引用

```css
.badge {
  background: var(--color-background-elevated-secondary);
  color: var(--color-text-foreground-secondary);
  border-radius: var(--radius-2xs);                         /* 2.5px */
  padding: 2px 6px;
  font-size: var(--text-xs);                                /* 11px */
  font-weight: var(--font-weight-medium);                   /* 500 */
  letter-spacing: var(--tracking-wide);                     /* 0.025em，全大写必加 */
  text-transform: uppercase;
}
.badge--accent {
  background: var(--color-background-accent);
  color: var(--color-text-accent);
}
.badge--success {
  background: var(--color-background-status-success);
  color: var(--color-text-success);
}
```

### 尺寸

| 属性 | 值 |
|---|---|
| radius | 2.5px（`--radius-2xs`，最小） |
| padding | 2px 6px |
| font-size | 11px |
| font-weight | 500 |
| letter-spacing | wide（0.025em） |

### 关键规则

- **2.5px 圆角**。badge 是最小元素，用最小圆角。
- **11px 字号 + 500 weight + wide tracking**。全大写文本必须加字距。
- **uppercase**。badge 文字全大写（`NEW` / `BETA` / `DEPRECATED`）。

---

## Tab 标签页

### Token 引用

```css
.tab {
  padding: 8px 12px;
  font-size: var(--text-sm);                                /* 12px */
  font-weight: var(--font-weight-medium);                   /* 500 */
  color: var(--color-text-foreground-secondary);
  border: none;
  background: transparent;
  border-radius: var(--radius-md);                         /* 10px */
  transition: color 0.15s, background-color 0.15s;
}
.tab:hover {
  color: var(--color-text-foreground);
  background: var(--color-background-button-tertiary-hover);
}
.tab--active {
  color: var(--color-text-foreground);
}
.tab--active::after {
  /* 选中态底线 */
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0; right: 0;
  height: 2px;
  background: var(--color-border-focus);                    /* blue-300 */
}
```

### 关键规则

- **选中底线用蓝色**。`--color-border-focus`（`blue-300`），这是蓝色出现位之一。
- **12px 字号 + 500 weight**。tab label 用 button 同款字号字重。
- **hover 出灰背景**。tab hover 用 tertiary-hover 背景。

---

## Toolbar 工具栏

### Token 引用

```css
.toolbar {
  height: var(--height-toolbar);                            /* 46px */
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  background: var(--color-background-surface);
  border-bottom: 1px solid var(--color-border);
}
.toolbar--sm { height: var(--height-toolbar-sm); }         /* 36px */
.toolbar--pane { height: var(--height-toolbar-pane); }      /* 40px */
```

### 尺寸

| 变体 | 高度 | 用途 |
|---|---|---|
| standard | 46px | 顶部 header / composer toolbar |
| sm | 36px | 紧凑 toolbar（dropdown header） |
| pane | 40px | 面板 toolbar（右侧栏 / 底部面板） |

### 关键规则

- **46px 标准高度**。顶部 header 用 46px。
- **gap 4px**。工具栏按钮间 gap 永远 4px。
- **底部 1px border**。toolbar 用 `border-bottom: 1px solid var(--color-border)` 分隔（这里是 border 不是 hairline，因为 toolbar 是结构性分隔）。

---

## Icon 图标

### 系统

- **图标集**：Lucide（`codex-icons/*.svg`，189 个）
- **viewBox**：`0 0 24 24`
- **stroke**：`currentColor`（继承父色）
- **stroke-width**：2
- **fill**：none

### 尺寸

| Tailwind 类 | px | 用途 |
|---|---|---|
| `h-4 w-4` | 16 | menu item / toolbar / chip 内图标 |
| `h-5 w-5` | 20 | nav rail / 大按钮 |
| `h-6 w-6` | 24 | 稀有（仅空状态大图标） |

### 关键规则

- **唯一图标集**。禁用 Heroicons / Feather / Material Icons / 自绘 SVG。
- **currentColor**。图标用 `stroke="currentColor"`，跟着父元素 `color-*` 走。不要硬编码 `stroke="#fff"`。
- **stroke-width 2**。不要 1.5（太细）或 3（太粗）。
- **h-4 w-4 默认**。menu item / toolbar 用 16px，nav rail 用 20px。

### Do / Don't

**Do**：
```tsx
<svg className="h-4 w-4" stroke="currentColor" strokeWidth={2} fill="none">
  {/* Lucide path */}
</svg>
```

**Don't**：
```tsx
{/* ❌ 非 Lucide 图标 */}
<svg>...</svg>  {/* 自绘 */}

{/* ❌ 硬编码 stroke */}
<svg stroke="#ffffff">...</svg>

{/* ❌ stroke-width 1 */}
<svg strokeWidth={1}>...</svg>
```
