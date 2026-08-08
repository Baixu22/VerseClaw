# 05 — 间距 / 圆角 / 阴影 / 模糊

> 本文定义空间语言：间距基线、圆角节奏、阴影阶、模糊阶。这四者共同决定 Codex 界面的"密度感"和"层次感"。
>
> 来源：`FakeCoding-main/codex-reference/tokens.css` + `codex-design-system.css` + `codex-reference/ALIGNMENT.md`（实测值）+ `codex-reference/DROPDOWN.md`。
>
> **核心规则**：4px 间距基线；1.25× 圆角缩放；6 阶阴影 + 1 hairline；8px blur 是玻璃标配。

---

## 目录

1. [设计哲学](#设计哲学)
2. [Spacing 间距](#spacing-间距)
3. [Border radius 圆角](#border-radius-圆角)
4. [Shadow 阴影](#shadow-阴影)
5. [Blur 模糊](#blur-模糊)
6. [组合 recipe](#组合-recipe)
7. [Do / Don't](#do--dont)

---

## 设计哲学

Codex 的空间语言有四条铁律：

1. **4px 基线**：所有间距是 4 的倍数（4/8/12/16/24/32/48/64）。非 4 倍数值仅允许 row-y 的 `6px`（视觉补偿半档，让行垂直居中看着对齐）。
2. **1.25× 圆角缩放**：基础 Tailwind 圆角值 × 1.25 = Codex 实际值。形成 **三级圆角节奏**：3xl(25px) 大表面 → 2xl(20px) 浮层 → lg(12.5px) 行/按钮。
3. **6 阶阴影 + 1 hairline**：阴影是封闭集合，dropdown 永远 `xl-spread`（hairline + xl 复合），card 用 `md`，hover lift 用 `lg`，modal 用 `2xl`。**禁止自定义 shadow**。
4. **8px blur 是玻璃标配**：所有半透明浮层必须 `backdrop-filter: blur(8px)`，配合 `color-mix 96%` 形成马原生面板质感。

---

## Spacing 间距

### Base

```css
:root {
  --spacing: 0.25rem;   /* 4px 基线 */
}
```

### 间距阶

| Token | px | 用途 | Tailwind |
|---|---|---|---|
| — | 4 | 极小（图标 gap / composer 按钮 gap） | `gap-1` / `p-1` |
| — | 8 | row-x（dropdown / list row 水平 padding） | `gap-2` / `p-2` |
| — | 12 | card-surface-flat padding / 紧凑区 | `gap-3` / `p-3` |
| — | 16 | card padding / 标准内边距 | `gap-4` / `p-4` |
| — | 20 | dialog 紧凑内边距 | `p-5` |
| — | 24 | dialog 标准内边距 / section gap | `gap-6` / `p-6` |
| — | 32 | 大 section gap | `gap-8` / `p-8` |
| — | 48 | 页面大留白 | `gap-12` / `p-12` |
| — | 64 | 极大留白 | `gap-16` |

### Layout heights（固定尺寸）

```css
:root {
  --height-toolbar: 46px;
  --height-toolbar-sm: 36px;
  --height-toolbar-pane: 40px;
  --height-token-settings-row: 4rem;            /* 64px */
  --height-token-empty-state-page: 26.25rem;    /* 420px */
}
```

| Token | px | 用途 |
|---|---|---|
| `--height-toolbar` | 46 | 标准 toolbar（顶部 header / composer toolbar） |
| `--height-toolbar-sm` | 36 | 紧凑 toolbar（dropdown header / 子面板） |
| `--height-toolbar-pane` | 40 | 面板 toolbar（右侧栏 / 底部面板） |
| `--height-token-settings-row` | 64 | settings 行高（较松，因为是表单） |
| `--height-token-empty-state-page` | 420 | 空状态页最小高度 |

### Composer 专用

```css
:root {
  --spacing-token-button-composer: calc(var(--spacing) * 7);      /* 28px */
  --spacing-token-button-composer-sm: calc(var(--spacing) * 5);   /* 20px */
  --spacing-token-button-composer-gap: var(--spacing);            /* 4px */
  --radius-token-composer-single-line: calc(var(--spacing) * 5.5); /* 22px */
}
```

| Token | px | 用途 |
|---|---|---|
| `--spacing-token-button-composer` | 28 | composer 按钮 size（圆形直径） |
| `--spacing-token-button-composer-sm` | 20 | composer 小按钮 size |
| `--spacing-token-button-composer-gap` | 4 | composer 按钮间 gap |
| `--radius-token-composer-single-line` | 22 | 单行 composer 圆角（介于 2xl 20 和 3xl 25 之间） |

### Sidebar 宽度

```css
:root {
  --spacing-token-sidebar: clamp(240px, 275px, min(520px, calc(100vw - 320px)));
}
```

`clamp(min, preferred, max)`：
- 最小 240px（窗口很窄时）
- 偏好 275px（默认）
- 最大 `min(520px, 100vw - 320px)`（窗口很宽时不超过 520px，且至少给主区留 320px）

### Container（max-width 阶）

```css
:root {
  --container-3xs: 16rem;   /* 256px */
  --container-xs: 20rem;    /* 320px */
  --container-sm: 24rem;    /* 384px */
  --container-md: 28rem;    /* 448px */
  --container-lg: 32rem;    /* 512px */
  --container-xl: 36rem;    /* 576px */
  --container-2xl: 42rem;   /* 672px */
  --container-3xl: 48rem;   /* 768px */
  --container-4xl: 56rem;   /* 896px */
  --container-5xl: 64rem;    /* 1024px */
}
```

用于 **内容区 max-width**（如 markdown 主体 `--markdown-wide-block-max-width: 64rem`）。

### Markdown 区

```css
:root {
  --markdown-wide-block-max-width: 64rem;    /* 1024px */
  --markdown-wide-block-max-height: 80vh;
}
```

代码块 / 宽表格 max-width 1024px，max-height 80vh（超出滚动）。

### 关键规则

- **4 倍数**：所有间距是 4 的倍数。`7px` / `11px` / `13px` 禁用。
- **row-y 6px 例外**：行垂直 padding 用 6px（1.5×4 半档），是视觉补偿，让行高 32px 时文字垂直居中看着对齐。
- **gap 4px**：按钮间 / 图标间 gap 永远 4px，不要 8px（太散）。
- **card padding 16px**：标准卡片 padding 16px，不要 24px（太松）。
- **dialog padding 24px**：dialog 主区 24px（比 card 松一档）。

---

## Border radius 圆角

### Scale（全局乘数）

```css
:root {
  --corner-radius-scale: 1.25;   /* 全局 1.25× 缩放 */
}
```

### Base values（未应用 scale）

```css
:root {
  --radius-2xs-base: 0.125rem;   /* 2px */
  --radius-xs-base: 0.25rem;     /* 4px */
  --radius-sm-base: 0.375rem;    /* 6px */
  --radius-md-base: 0.5rem;      /* 8px */
  --radius-lg-base: 0.625rem;    /* 10px */
  --radius-xl-base: 0.75rem;     /* 12px */
  --radius-2xl-base: 1rem;       /* 16px */
  --radius-3xl-base: 1.25rem;    /* 20px */
  --radius-4xl-base: 1.5rem;     /* 24px */
}
```

### Applied values（base × 1.25）

```css
:root {
  --radius-2xs: calc(var(--radius-2xs-base) * var(--corner-radius-scale));   /* 2.5px */
  --radius-xs: calc(var(--radius-xs-base) * var(--corner-radius-scale));      /* 5px */
  --radius-sm: calc(var(--radius-sm-base) * var(--corner-radius-scale));     /* 7.5px */
  --radius-md: calc(var(--radius-md-base) * var(--corner-radius-scale));      /* 10px */
  --radius-lg: calc(var(--radius-lg-base) * var(--corner-radius-scale));      /* 12.5px */
  --radius-xl: calc(var(--radius-xl-base) * var(--corner-radius-scale));      /* 15px */
  --radius-2xl: calc(var(--radius-2xl-base) * var(--corner-radius-scale));    /* 20px */
  --radius-3xl: calc(var(--radius-3xl-base) * var(--corner-radius-scale));    /* 25px */
  --radius-4xl: calc(var(--radius-4xl-base) * var(--corner-radius-scale));    /* 30px */
  --radius-full: 9999px;
}
```

### 圆角阶对照

| Token | base | × 1.25 | 实际 px | 用途 |
|---|---|---|---|---|
| `--radius-2xs` | 2px | 2.5 | 2.5 | chip / badge / 极小元素 |
| `--radius-xs` | 4px | 5 | 5 | 小按钮 / 输入框 |
| `--radius-sm` | 6px | 7.5 | 7.5 | 表单输入 |
| `--radius-md` | 8px | 10 | **10** | **按钮 / 卡片** |
| `--radius-lg` | 10px | 12.5 | **12.5** | **列表行 / dropdown item** |
| `--radius-xl` | 12px | 15 | 15 | 小 dropdown（稀有） |
| `--radius-2xl` | 16px | 20 | **20** | **标准 dropdown / popover / dialog / card** |
| `--radius-3xl` | 20px | 25 | **25** | **Composer 容器** |
| `--radius-4xl` | 24px | 30 | 30 | 大 dialog |
| `--radius-full` | — | — | 9999 | 圆形（avatar / pill 按钮） |

### 三级圆角节奏

这是 **必须背下来的** 圆角节奏：

```
3xl (25px) ─── 最大表面 ─── Composer 输入区容器
2xl (20px) ─── 标准浮层 ─── dropdown / popover / dialog / surface card
lg  (12.5px) ─ 最小表面 ─── list row / dropdown item / button
```

**含义**：
- 大表面（Composer）最圆
- 浮层（dropdown）中等圆
- 小元素（行 / 按钮）最紧

这形成 **由大到小的视觉节奏**：Composer 25px 浮在 canvas 上，dropdown 20px 从 Composer 弹出（比 Composer 小一档，但不会"陷进"），dropdown item 12.5px 在 dropdown 内。

### 单行 Composer 例外

```css
--radius-token-composer-single-line: calc(var(--spacing) * 5.5);   /* 22px */
```

单行 Composer 圆角 22px，**介于 2xl(20) 和 3xl(25) 之间**。这是故意的设计：单行 Composer 比 dropdown 大一档（22 vs 20），但比多行 Composer 小一档（22 vs 25）。

### 关键规则

- **禁用标准 Tailwind 值**：`8px` / `12px` / `16px` 在 Codex 体系里是错的（应是 10 / 15 / 20）。
- **禁止 Composer 25 + dropdown 15**：浮层会"陷进"容器。dropdown 必须 20px。
- **圆形只用 full**：avatar / pill 按钮用 `--radius-full`（9999px），不要用 `9999px` 字面量。
- **hairline 配 0.5px**：边界 hairline 用 `box-shadow: 0 0 0 0.5px border`，不要 `border: 1px solid`（1px 太粗）。

---

## Shadow 阴影

### Token

```css
:root {
  --shadow-hairline: 0px 0px 0px 0.5px rgba(0, 0, 0, 0.1);
  --shadow-sm: 0px 1px 2px -1px rgba(0, 0, 0, 0.08);
  --shadow-md: 0px 2px 4px -1px rgba(0, 0, 0, 0.08);
  --shadow-md-stronger: 0px 2px 4px -1px rgba(0, 0, 0, 0.13);
  --shadow-lg: 0px 4px 8px -2px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0px 8px 16px -4px rgba(0, 0, 0, 0.12);
  --shadow-2xl: 0px 16px 32px -8px rgba(0, 0, 0, 0.19);
}
```

### 阴影阶对照

| Token | y-offset | blur-radius | alpha | 用途 |
|---|---|---|---|---|
| `--shadow-hairline` | 0 | 0（spread 0.5px） | 0.1 | **hairline 描边**（输入框/dropdown 边） |
| `--shadow-sm` | 1 | 2 | 0.08 | 极浅 |
| `--shadow-md` | 2 | 4 | 0.08 | **surface card** |
| `--shadow-md-stronger` | 2 | 4 | 0.13 | **composer 容器** |
| `--shadow-lg` | 4 | 8 | 0.1 | **hover lift** |
| `--shadow-xl` | 8 | 16 | 0.12 | **dropdown** |
| `--shadow-2xl` | 16 | 32 | 0.19 | **modal / 大 dialog** |

### 复合 shadow（dropdown 标配）

```css
box-shadow: 0 0 0 0.5px var(--color-border), var(--shadow-xl);
/* = hairline + xl
   Codex 称 xl-spread */
```

**所有 dropdown 必须用这个复合**。hairline 给浮层一个 0.5px 的边界感（避免浮层和 canvas 颜色太近时"融化"），xl 给浮层深度。

### 使用对照

| 场景 | shadow |
|---|---|
| 输入框 focus | `--shadow-hairline` + `--color-border-focus` |
| surface card | `--shadow-md` |
| composer 容器 | `--shadow-md-stronger` |
| hover lift（行 / 卡片悬浮） | `--shadow-lg` |
| dropdown / popover | `0 0 0 0.5px var(--color-border), var(--shadow-xl)`（xl-spread） |
| modal / dialog | `--shadow-2xl` |

### 关键规则

- **6 阶封闭集合**：禁止自定义 `box-shadow: 0 4px 12px rgba(0,0,0,0.15)` 这种手写值。
- **dropdown 必带 hairline**：dropdown 不能只有 `--shadow-xl`，必须加 hairline（`0 0 0 0.5px var(--color-border)`）。
- **modal 用 2xl**：modal 阴影最大，用 `--shadow-2xl`。
- **hairline 不是 border**：`--shadow-hairline` 是 `box-shadow`，不是 `border`。1px border 在低 DPI 上太粗。

---

## Blur 模糊

### Token

```css
:root {
  --blur-xs: 4px;
  --blur-sm: 8px;
  --blur-md: 12px;
  --blur-lg: 16px;
  --blur-xl: 24px;
  --blur-2xl: 40px;
  --blur-3xl: 64px;
}
```

### 模糊阶对照

| Token | px | Tailwind | 用途 |
|---|---|---|---|
| `--blur-xs` | 4 | `backdrop-blur-xs` | 极浅 hover |
| `--blur-sm` | **8** | `backdrop-blur-sm` | **dropdown / popover / glass 标配** |
| `--blur-md` | 12 | `backdrop-blur-md` | — |
| `--blur-lg` | 16 | `backdrop-blur-lg` | — |
| `--blur-xl` | 24 | `backdrop-blur-xl` | — |
| `--blur-2xl` | 40 | `backdrop-blur-2xl` | — |
| `--blur-3xl` | 64 | `backdrop-blur-3xl` | — |

### 使用规则

**8px 是玻璃标配**：所有半透明浮层（dropdown / popover / composer / glass card）必须 `backdrop-filter: blur(8px)` + `color-mix 96%`。

```css
.dropdown {
  background: var(--color-background-elevated-primary);   /* color-mix gray-800 96% transparent */
  backdrop-filter: blur(8px);
}
```

**少一个都不行**：
- 只有 `color-mix 96%` 没 blur → 看起来像"半透明灰块"，透出底色但没"磨砂"感。
- 只有 blur 没 `color-mix 96%` → 看起来像"完全透明玻璃"，没层次。

### 禁用

- **禁用 `blur(2px)` 以下**：太浅看不出玻璃感，反而像 bug。
- **禁用 `blur(16px)` 以上当 dropdown**：太糊，文字会模糊（除非 dropdown 和底色距离很远）。
- **不要用 `-webkit-backdrop-filter` 单独**：要同时写 `backdrop-filter` 和 `-webkit-backdrop-filter`（Electron 兼容）。

### fallback

当浏览器/环境不支持 `backdrop-filter`（极罕见，Electron 都支持），用 `--color-background-elevated-primary-opaque`（不透明 fallback）：

```css
.dropdown {
  background: var(--color-background-elevated-primary);   /* 半透明，有 blur 时用 */
  backdrop-filter: blur(8px);
}
@supports not (backdrop-filter: blur(8px)) {
  .dropdown {
    background: var(--color-background-elevated-primary-opaque);  /* 不透明 fallback */
  }
}
```

---

## 组合 recipe

### Dropdown 完整 recipe

```css
.dropdown {
  background: var(--color-background-elevated-primary);
  color: var(--color-text-foreground);
  border-radius: var(--radius-2xl);                          /* 20px */
  box-shadow: 0 0 0 0.5px var(--color-border), var(--shadow-xl);
  backdrop-filter: blur(8px);
  padding: 4px;
}
.dropdown__item {
  border-radius: var(--radius-lg);                          /* 12.5px */
  padding: 6px 8px;                                         /* row-y row-x */
  min-height: 32px;
  font-size: var(--text-sm);                               /* 12px */
}
```

### Surface card recipe

```css
.card {
  background: var(--color-background-elevated-primary);
  border-radius: var(--radius-2xl);                        /* 20px */
  box-shadow: var(--shadow-md);
  padding: 16px;
}
```

### Hover lift recipe

```css
.card--interactive {
  transition: box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.card--interactive:hover {
  box-shadow: var(--shadow-lg);
}
```

### Composer 容器 recipe

```css
.composer {
  background: var(--color-background-elevated-primary);
  border-radius: var(--radius-3xl);                       /* 25px */
  box-shadow: var(--shadow-md-stronger);
  backdrop-filter: blur(8px);
}
```

### Button recipe

```css
.btn {
  border-radius: var(--radius-md);                        /* 10px */
  padding: 8px 12px;
  font-size: var(--text-sm);                              /* 12px */
  font-weight: var(--font-weight-medium);                /* 500 */
  min-height: 32px;
}
.btn--primary { background: var(--color-background-button-primary); }
.btn--secondary { background: var(--color-background-button-secondary); }
.btn--tertiary { background: transparent; }
```

### Modal recipe

```css
.modal {
  background: var(--color-background-elevated-primary);
  border-radius: var(--radius-2xl);                      /* 20px */
  box-shadow: var(--shadow-2xl);
  padding: 24px;
  backdrop-filter: blur(8px);
}
```

### List row recipe

```css
.list-row {
  min-height: 32px;
  padding: 6px 8px;
  border-radius: var(--radius-lg);                       /* 12.5px */
  transition: background-color 0.15s;
}
.list-row:hover {
  background: color-mix(in oklab, var(--gray-0) 5.2%, transparent);  /* 实测 5.2% */
}
```

---

## Do / Don't

### Do

```css
/* dropdown 三件套：color-mix 96% + blur 8 + xl-spread */
.dropdown {
  background: var(--color-background-elevated-primary);
  backdrop-filter: blur(8px);
  border-radius: var(--radius-2xl);
  box-shadow: 0 0 0 0.5px var(--color-border), var(--shadow-xl);
}

/* 圆角三级节奏 */
.composer { border-radius: var(--radius-3xl); }   /* 25 */
.dropdown { border-radius: var(--radius-2xl); }   /* 20 */
.row { border-radius: var(--radius-lg); }          /* 12.5 */

/* 间距 4 倍数 */
.card { padding: 16px; gap: 4px; }
```

### Don't

```css
/* ❌ 标准 Tailwind 圆角值（未应用 1.25 scale） */
.dropdown { border-radius: 16px; }   /* 应是 20px */
.row { border-radius: 8px; }         /* 应是 12.5px */

/* ❌ Composer 25 + dropdown 15（浮层陷进） */
.composer { border-radius: 25px; }
.dropdown { border-radius: 15px; }   /* 应是 20px */

/* ❌ 自定义 shadow */
.card { box-shadow: 0 4px 12px rgba(0,0,0,0.15); }   /* 用 var(--shadow-md) */

/* ❌ blur 缺失 */
.dropdown {
  background: var(--color-background-elevated-primary);
  /* 缺 backdrop-filter: blur(8px) */
}

/* ❌ 间距非 4 倍数 */
.row { padding: 7px 11px; }   /* 应是 6px 8px */

/* ❌ border 1px solid 当 hairline */
.input { border: 1px solid var(--color-border); }   /* 用 box-shadow 0 0 0 0.5px */
```
