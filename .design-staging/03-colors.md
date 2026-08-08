# 03 — 颜色系统

> 颜色是 Codex 设计体系里 **最严守的边界**。本文档定义 palette、语义角色、dark/light 切换策略，以及 `color-mix(in oklab)` 的使用规则。
>
> 来源：`FakeCoding-main/codex-reference/tokens.css`（Light/Dark 两段）+ `codex-design-system.css`。
>
> **核心规则**：hex 只在 palette 出现一次；语义色走 token 切换；透明叠加必须 `color-mix(in oklab)`；禁用 `rgba` 与 `dark:` 双声明。

---

## 目录

1. [设计哲学](#设计哲学)
2. [Palette（原始色板）](#palette原始色板)
3. [语义角色总览](#语义角色总览)
4. [Surface 表面](#surface-表面)
5. [Button 按钮](#button-按钮)
6. [Status 状态](#status-状态)
7. [Text 文本](#text-文本)
8. [Icon 图标](#icon-图标)
9. [Border 边界](#border-边界)
10. [Decoration diff 装饰](#decoration-diff-装饰)
11. [Terminal ANSI](#terminal-ansi)
12. [`color-mix(in oklab)` 使用规则](#color-mixin-oklab-使用规则)
13. [Do / Don't](#do--dont)

---

## 设计哲学

Codex 的颜色体系可以用一句话概括：**一片近黑灰度 + 一抹蓝**。

- **背景永远不是纯黑**：canvas 是 `#181818`，editor 是 `#212121`，under-canvas 才是 `#000`。这三层灰阶让 elevated surface（`#212121f5`，半透明）浮在 canvas 上时差是"感知均匀的一档"，而不是两档 —— 这是 Mac 原生窗口质感的来源。
- **品牌电压来自单一蓝色 `#339cff`**：它在整套体系里稀有出现，只在"这里需要你做决定"的位置 —— 发送按钮 hover、选中 tab 底线、可点击链接、focus ring。从不当背景墙纸。
- **透明叠加用 `color-mix(in oklab)`**：8% 白在暗底上看起来像"灯光"而不是"灰雾"，因为 OKLab 是感知均匀颜色空间。`rgba` 在低 alpha 会出现脏灰感，**禁用**。
- **状态色只在状态语义上用**：success 绿 / warning 橙 / error 红，不当 CTA。次要操作走 secondary/tertiary 灰按钮，不走"第二个彩色"。

---

## Palette（原始色板）

> 这是 **唯一允许出现 hex 的地方**。所有 palette token 在 `:root` 声明，全主题共享。组件 CSS 不直接引 palette，必须经 Layer 2 语义 token 中转。

### Gray scale（体系骨架）

```css
:root {
  --gray-0: #fff;
  --gray-50: #f9f9f9;
  --gray-75: #f3f3f3;
  --gray-100: #ededed;
  --gray-300: #afafaf;
  --gray-500: #5d5d5d;
  --gray-550: #4f4f4f;
  --gray-600: #414141;
  --gray-700: #303030;
  --gray-750: #282828;
  --gray-800: #212121;
  --gray-900: #181818;   /* ← dark canvas */
  --gray-1000: #0d0d0d;  /* ← 最深，button-primary 填充 */
}
```

| Token | Hex | 在体系中的角色 |
|---|---|---|
| `--gray-0` | `#ffffff` | dark 主题文本主色 / light canvas |
| `--gray-50` | `#f9f9f9` | light under-canvas |
| `--gray-75` | `#f3f3f3` | light 次级表面 |
| `--gray-100` | `#ededed` | light 边界 / 分隔 |
| `--gray-300` | `#afafaf` | light 次要文本 / decoration-unchanged / secondary 按钮文字 |
| `--gray-500` | `#5d5d5d` | tertiary 文本 / tertiary 按钮文字 |
| `--gray-550` | `#4f4f4f` | 过渡灰（稀有） |
| `--gray-600` | `#414141` | dark 次级表面过渡 |
| `--gray-700` | `#303030` | dark 边界过渡 |
| `--gray-750` | `#282828` | **dark elevated opaque**（不透明浮层 fallback） |
| `--gray-800` | `#212121` | **dark editor / elevated-glass base** |
| `--gray-900` | `#181818` | **★ dark canvas（主表面）** |
| `--gray-1000` | `#0d0d0d` | **dark button-primary 填充（最深）** |

**三层灰阶**（必须背下来）：
```
under-canvas  #000        ← 窗口背景 / 视频
canvas        #181818     ← 主 UI 表面（gray-900）
editor        #212121     ← 代码 / diff 区（gray-800）
elevated      #282828      ← 不透明浮层 fallback（gray-750）
elevated-glass #212121f5  ← 半透明浮层（color-mix gray-800 96%）
```

### Green（success）

```css
:root {
  --green-50: #d9f4e4;
  --green-300: #40c977;
  --green-400: #04b84c;
  --green-500: #00a240;
  --green-700: #00692a;
  --green-800: #004f1f;
}
```

| Token | Hex | 角色 |
|---|---|---|
| `--green-50` | `#d9f4e4` | light success 背景淡 |
| `--green-300` | `#40c977` | dark success 文本/icon |
| `--green-400` | `#04b84c` | dark success 填充（背景 color-mix 16%） |
| `--green-500` | `#00a240` | **success 主色（跨主题）** |
| `--green-700` | `#00692a` | dark decoration-added 文本 |
| `--green-800` | `#004f1f` | — |

### Red（error / danger）

```css
:root {
  --red-50: #ffd9d9;
  --red-300: #ff6764;
  --red-400: #fa423e;
  --red-500: #e02e2a;
  --red-600: #ba2623;
  --red-900: #4d100e;
}
```

| Token | Hex | 角色 |
|---|---|---|
| `--red-50` | `#ffd9d9` | light error 背景 |
| `--red-300` | `#ff6764` | dark error 文本/icon |
| `--red-400` | `#fa423e` | dark danger-active 填充（color-mix 36%） |
| `--red-500` | `#e02e2a` | **error 主色** |
| `--red-600` | `#ba2623` | decoration-deleted |
| `--red-900` | `#4d100e` | dark error 背景 |

### Orange（warning）

```css
:root {
  --orange-50: #ffe7d9;
  --orange-300: #ff8549;
  --orange-400: #fb6a22;
  --orange-500: #e25507;
  --orange-700: #923b0f;
  --orange-900: #4a2206;
}
```

| Token | Hex | 角色 |
|---|---|---|
| `--orange-50` | `#ffe7d9` | light warning 背景 |
| `--orange-300` | `#ff8549` | dark warning 文本/icon |
| `--orange-500` | `#e25507` | **warning 主色** |
| `--orange-700` | `#923b0f` | decoration-modified |
| `--orange-900` | `#4a2206` | dark warning 背景 |

### Yellow

```css
:root {
  --yellow-300: #ffd240;
  --yellow-400: #ffc300;
}
```

仅用于 accent-yellow（稀有），无 status 语义。

### Blue（★ brand）

```css
:root {
  --blue-50: #e5f3ff;
  --blue-100: #99ceff;
  --blue-300: #339cff;   /* ← 单一品牌主色 */
  --blue-400: #0285ff;
  --blue-900: #00284d;
}
```

| Token | Hex | 角色 |
|---|---|---|
| `--blue-50` | `#e5f3ff` | **light accent 背景**（chip / 选中态填充） |
| `--blue-100` | `#99ceff` | dark accent 文本（链接，比 blue-300 柔和） |
| `--blue-300` | `#339cff` | **★ brand 主色（单一品牌色）** —— light accent 文本/icon |
| `--blue-400` | `#0285ff` | dark accent 强填充（更亮，补偿暗底） |
| `--blue-900` | `#00284d` | dark accent 深背景 |

**三档蓝之外没有第四种蓝**。accent 在不同主题用不同档：
- dark 主题：文本用 `blue-100`，填充用 `blue-400`，背景用 `blue-900`
- light 主题：文本用 `blue-300`，填充用 `blue-300`，背景用 `blue-50`

### Purple / Pink（稀有 accent）

```css
:root {
  --purple-300: #ad7bf9;
  --purple-400: #924ff7;
  --pink-400: #ff66ad;
}
```

仅用于 accent-purple / accent-pink，**不是 status**。出现频率极低（基本只在宠物 / 装饰动画）。

### Black / White

```css
:root {
  --white: #fff;
  --black: #000;
}
```

`--white` 是 `--gray-0` 的别名。`--black` 只用在 under-canvas / 视频，**不上 UI 表面**。

---

## 语义角色总览

> 组件 CSS 引用这一层。主题切换在 `.electron-dark` / `.electron-light` 选择器下覆盖这些 token。

| 类别 | 数量 | 主题切换 | 例 |
|---|---|---|---|
| Surface 表面 | 6 | 是 | `--color-background-elevated-primary` |
| Button 按钮 | 9 | 是 | `--color-background-button-primary` |
| Status background | 5 | 是 | `--color-background-status-success` |
| Text 文本 | 11 | 是 | `--color-text-foreground` |
| Icon 图标 | 7 | 是 | `--color-icon-accent` |
| Border 边界 | 6 | 是 | `--color-border` |
| Decoration diff | 6 | 否（跨主题同值） | `--color-decoration-added` |
| Terminal ANSI | 8 | 否 | `--terminal-ansi-red` |

---

## Surface 表面

### Dark theme（`.electron-dark`）

```css
--color-background-surface: var(--gray-900);                          /* #181818 */
--color-background-surface-under: black;                              /* #000 */
--color-background-editor-opaque: var(--gray-800);                     /* #212121 */
--color-background-elevated-primary: color-mix(in oklab, var(--gray-800) 96%, transparent);   /* ≈ #212121f5 */
--color-background-elevated-primary-opaque: var(--gray-750);           /* #282828 */
--color-background-elevated-secondary: color-mix(in oklab, var(--gray-0) 3%, transparent);
--color-background-elevated-secondary-opaque: var(--gray-800);         /* #212121 */
```

### Light theme（`.electron-light`）

```css
--color-background-surface: var(--gray-0);                             /* #fff */
--color-background-surface-under: var(--gray-50);                      /* #f9f9f9 */
--color-background-elevated-primary: color-mix(in oklab, var(--gray-0) 70%, transparent);
--color-background-elevated-primary-opaque: var(--gray-0);             /* #fff */
--color-background-elevated-secondary: color-mix(in oklab, var(--color-text-foreground) 2%, transparent);
```

### 用途对照

| Token | 用途 | 出现位置 |
|---|---|---|
| `--color-background-surface` | 主 canvas | app 背景 / 主滚动区 |
| `--color-background-surface-under` | under-canvas | 窗口背景 / video fallback |
| `--color-background-editor-opaque` | editor / code 区 | 代码编辑器背景（仅 dark） |
| `--color-background-elevated-primary` | **半透明浮层** | dropdown / popover / composer / dialog |
| `--color-background-elevated-primary-opaque` | 不透明浮层 fallback | 当 backdrop-blur 不支持时 |
| `--color-background-elevated-secondary` | 次级浮层 | card-surface-flat / 内嵌卡片 |

### 关键规则

- **elevated-primary 必须半透明**：`color-mix(in oklab, gray-800 96%, transparent)` + `backdrop-filter: blur(8px)`。两个一起才形成 Mac 原生面板质感。少一个都不到位。
- **elevated-primary-opaque 是 fallback**：当浏览器/环境不支持 backdrop-filter 时用不透明版本。
- **elevated-secondary 比 primary 浅一档**：用于嵌套浮层（dropdown 里的子卡片）。

---

## Button 按钮

> 三种变体 + 一种 icon。详见 [07-components.md](./07-components.md) 的 button recipe。

### Dark theme

```css
--color-background-button-primary: var(--gray-1000);                                          /* #0d0d0d */
--color-background-button-primary-hover: color-mix(in oklab, var(--gray-1000) 6%, transparent);
--color-background-button-primary-active: color-mix(in oklab, var(--gray-1000) 10%, transparent);
--color-background-button-secondary: color-mix(in oklab, var(--gray-0) 5%, transparent);
--color-background-button-secondary-hover: color-mix(in oklab, var(--gray-0) 8%, transparent);
--color-background-button-secondary-active: color-mix(in oklab, var(--gray-0) 12%, transparent);
--color-background-button-tertiary: color-mix(in oklab, var(--gray-0) 3%, transparent);
--color-background-button-tertiary-hover: color-mix(in oklab, var(--gray-0) 7%, transparent);
--color-background-button-tertiary-active: color-mix(in oklab, var(--gray-0) 10%, transparent);
```

### Light theme

```css
--color-background-button-primary: var(--color-text-foreground);                              /* #1a1c1f */
--color-background-button-primary-hover: color-mix(in oklab, var(--color-text-foreground) 8%, transparent);
--color-background-button-primary-active: color-mix(in oklab, var(--color-text-foreground) 16%, transparent);
--color-background-button-secondary: color-mix(in oklab, var(--color-text-foreground) 5%, transparent);
--color-background-button-secondary-hover: color-mix(in oklab, var(--color-text-foreground) 5%, transparent);
--color-background-button-secondary-active: color-mix(in oklab, var(--color-text-foreground) 4%, transparent);
--color-background-button-tertiary: color-mix(in oklab, var(--color-text-foreground) 0%, transparent);   /* transparent */
--color-background-button-tertiary-hover: color-mix(in oklab, var(--color-text-foreground) 10%, transparent);
--color-background-button-tertiary-active: color-mix(in oklab, var(--color-text-foreground) 20%, transparent);
```

### 变体语义

| 变体 | Dark 填充 | 含义 | 何时用 |
|---|---|---|---|
| primary | `#0d0d0d` 实色 | 主操作 | 发送 / 确认 / 创建 |
| secondary | `gray-0 5%` 半透明 | 次要操作 | 取消 / 关闭 |
| tertiary | `gray-0 3%` 极淡（默认近透明） | 工具栏图标 | toolbar / icon-only |
| icon | transparent（同 tertiary 默认） | 32×32 方形 | 独立图标按钮 |

**hover 加深规则**：primary hover 加 6%，active 加 10%；secondary/tertiary hover 加 2-3%，active 加 2-3% 递增。**hover 和 active 的差永远是 ~4%**，不要把 active 做成"完全反色"。

---

## Status 状态

### Background

| Token | Dark | Light |
|---|---|---|
| `--color-background-accent` | `var(--blue-900)` `#00284d` | `var(--blue-50)` `#e5f3ff` |
| `--color-background-status-success` | `color-mix(in oklab, green-400 16%, transparent)` | `color-mix(in oklab, green-500 7%, transparent)` |
| `--color-background-status-warning` | `var(--orange-900)` | `var(--orange-50)` |
| `--color-background-status-error` | `var(--red-900)` | `var(--red-50)` |
| `--color-background-danger-active` | `color-mix(in oklab, red-400 36%, transparent)` | `color-mix(in oklab, red-500 90%, transparent)` |

### 使用边界

- **accent background** 只用于 **可点击选中态**（被选中的 tab / chip / dropdown item active）。不是"强调背景"。
- **status-success/warning/error** 只用于 **状态语义**（成功提示 / 警告条 / 错误条）。不当按钮颜色，不当 CTA。
- **danger-active** 用于"删除"按钮按下态（destructive 按钮），平时用 secondary 变体，按下才红。

### 状态色 vs 品牌色 vs 灰

| 场景 | 用什么 | 为什么 |
|---|---|---|
| 主 CTA 按钮 | primary 变体（`#0d0d0d` 实色） | 不是彩色，是"墨色"。Airtable 同哲学。 |
| 次要按钮 | secondary 变体（灰 5%） | 不抢主 CTA |
| 工具栏图标 | tertiary 变体（透明 hover 灰） | 不喧宾夺主 |
| 链接文本 | `--color-text-accent`（blue） | 唯一蓝出现位 |
| 选中 tab 底线 | `--color-border-focus`（blue） | 唯一蓝出现位 |
| focus ring | `--color-border-focus`（blue） | 唯一蓝出现位 |
| 成功提示 | `--color-text-success`（green） + `--color-background-status-success` | 状态 |
| 删除按钮 | secondary + danger-active 按下 | 平时灰，按下红 |

---

## Text 文本

### Dark theme

```css
--color-text-foreground: var(--gray-0);                                              /* #fff */
--color-text-foreground-secondary: color-mix(in oklab, var(--gray-0) 70%, transparent);
--color-text-foreground-tertiary: color-mix(in oklab, var(--gray-0) 50%, transparent);
--color-text-button-primary: var(--gray-1000);                                       /* #0d0d0d 反相 */
--color-text-button-secondary: var(--gray-300);                                     /* #afafaf */
--color-text-button-tertiary: var(--gray-500);                                      /* #5d5d5d */
--color-text-accent: var(--blue-100);                                               /* #99ceff */
--color-text-on-accent: var(--gray-1000);
--color-text-success: var(--green-300);
--color-text-warning: var(--orange-300);
--color-text-error: var(--red-300);
```

### Light theme

```css
--color-text-foreground: #1a1c1f;
--color-text-foreground-secondary: color-mix(in oklab, #1a1c1f 70%, transparent);
--color-text-foreground-tertiary: color-mix(in oklab, #1a1c1f 50%, transparent);
--color-text-button-primary: var(--gray-0);                                         /* #fff 反相 */
--color-text-button-secondary: var(--color-text-foreground);
--color-text-button-tertiary: var(--gray-500);
--color-text-accent: var(--blue-300);                                               /* #339cff */
--color-text-on-accent: var(--gray-1000);
--color-text-success: var(--green-500);
--color-text-warning: var(--orange-500);
--color-text-error: var(--red-500);
```

### 文本层级

| Token | Dark | Light | 用途 |
|---|---|---|---|
| `--color-text-foreground` | `#fff` | `#1a1c1f` | 主文本（正文 / 标题） |
| `--color-text-foreground-secondary` | white 70% | ink 70% | 次要文本（描述 / caption） |
| `--color-text-foreground-tertiary` | white 50% | ink 50% | 三级文本（元信息 / placeholder） |

**注意**：light 主题 foreground 是 `#1a1c1f`，**不是纯黑 `#000`**。这是故意的小调整，让文本在白底上不那么"硬"。

### button 文本反相规则

primary 按钮文字 **永远反相**：
- dark primary（`#0d0d0d` 填充）→ 文字 `--color-text-button-primary`（`#0d0d0d`... 等等，这看起来不对）

实际上 dark 主题 primary 填充是 `#0d0d0d`，文字也是 `#0d0d0f`？不对 —— 让我重读 source。

实际 Codex tokens.css：
```css
--color-text-button-primary: var(--gray-1000);   /* dark: #0d0d0d */
```
而 primary 填充：
```css
--color-background-button-primary: var(--gray-1000);   /* dark: #0d0d0d */
```

这两个**同值**？是的，dark 主题 primary 按钮是 **同色填充 + 文字** —— 但这是错的。让我重新核对 ALIGNMENT.md：

ALIGNMENT.md 说"send gray-300"—— 发送按钮文字是 gray-300。所以 primary 按钮在 dark 下填充 `#0d0d0d`，文字 `gray-300`（`#afafaf`）。

这里 tokens.css 里的 `--color-text-button-primary: var(--gray-1000)` 应该是 **light 主题**的值（light primary 填充是 `#1a1c1f`，文字应是 `#fff` = `gray-0`，但 token 写 `gray-1000` `#0d0d0d`... 也不对）。

**结论**：这里 Codex tokens.css 自身可能有命名混乱。**实操规则**（ALIGNMENT.md 实测为准）：
- dark primary：填充 `#0d0d0d`，文字 `gray-300`（`#afafaf`，浅灰）
- light primary：填充 `#1a1c1f`，文字 `#fff`

**不要纠结 token 名字**，按实测反相规则用：**填充深 → 文字浅；填充浅 → 文字深**。

---

## Icon 图标

### Dark theme

```css
--color-icon-primary: color-mix(in oklab, var(--white) 90%, transparent);
--color-icon-secondary: color-mix(in oklab, var(--white) 70%, transparent);
--color-icon-tertiary: color-mix(in oklab, var(--white) 50%, transparent);
--color-icon-accent: var(--blue-300);
--color-icon-success: var(--green-500);
--color-icon-warning: var(--orange-500);
--color-icon-error: var(--red-500);
```

### Light theme

```css
--color-icon-primary: var(--color-text-foreground);
--color-icon-secondary: color-mix(in oklab, var(--color-text-foreground) 70%, transparent);
--color-icon-tertiary: color-mix(in oklab, var(--color-text-foreground) 50%, transparent);
--color-icon-accent: var(--blue-300);
--color-icon-success: var(--green-500);
--color-icon-warning: var(--orange-500);
--color-icon-error: var(--red-500);
```

**规则**：
- 图标默认用 `currentColor`，跟着父元素 `color-*` 走。
- 独立图标（不跟文字走）才用 `--color-icon-*`。
- accent 图标用 `blue-300`（light）/ 实际 dark 用 `blue-300` 不是 `blue-100`（与 text-accent 不同，图标需要更饱和）。

---

## Border 边界

### Dark theme

```css
--color-border: color-mix(in oklab, var(--gray-0) 8%, transparent);
--color-border-heavy: color-mix(in oklab, var(--gray-0) 12%, transparent);
--color-border-light: color-mix(in oklab, var(--gray-0) 5%, transparent);
--color-border-warning: color-mix(in oklab, var(--orange-500) 15%, transparent);
--color-border-error: color-mix(in oklab, var(--red-500) 15%, transparent);
--color-border-focus: var(--blue-300);
```

### Light theme

```css
--color-border: color-mix(in oklab, #1a1c1f 8%, transparent);
--color-border-heavy: color-mix(in oklab, #1a1c1f 12%, transparent);
--color-border-light: color-mix(in oklab, #1a1c1f 5%, transparent);
--color-border-warning: color-mix(in oklab, var(--orange-500) 15%, transparent);
--color-border-error: color-mix(in oklab, var(--red-500) 15%, transparent);
--color-border-focus: var(--blue-300);
```

### 三档边界

| Token | alpha | 用途 |
|---|---|---|
| `--color-border-light` | 5% | 极浅（卡片内分隔） |
| `--color-border` | 8% | **标准 hairline**（输入框 / dropdown 边 / 卡片边） |
| `--color-border-heavy` | 12% | 重边界（disabled 边 / 强分隔） |

### hairline 实现

Codex 的 hairline 不是 `1px solid border`，而是 **`0.5px` box-shadow**：

```css
box-shadow: 0 0 0 0.5px var(--color-border), var(--shadow-xl);
```

这就是 `--shadow-xl-spread` 复合。**dropdown 永远用这个**，不要用 `border: 1px solid`。

---

## Decoration diff 装饰

**跨主题同值**（不随主题切换）：

```css
--color-decoration-added: var(--green-500);      /* #00a240 */
--color-decoration-modified: var(--orange-700);   /* #923b0f */
--color-decoration-deleted: var(--red-600);        /* #ba2623 */
--color-decoration-unchanged: var(--gray-300);     /* #afafaf */
--color-editor-added: color-mix(in oklab, var(--green-500) 15%, transparent);
--color-editor-deleted: color-mix(in oklab, var(--red-600) 15%, transparent);
```

**规则**：diff 装饰色跨主题一致，因为 diff 的语义是"代码变更状态"，不是"UI 状态"。绿色永远是"新增"，不因主题变浅。

---

## Terminal ANSI

```css
--terminal-ansi-black: #000;
--terminal-ansi-red: #d53538;
--terminal-ansi-green: #008809;
--terminal-ansi-yellow: #bd5800;
--terminal-ansi-blue: #001bcb;
--terminal-ansi-magenta: #751ed9;
--terminal-ansi-cyan: #0071ea;
--terminal-ansi-white: #666;
```

**跨主题同值**（ANSI 色板是终端协议，不随 UI 主题变）。这些值是 Codex 调过的"暗底友好"ANSI 色（比标准 ANSI 稍暗）。

---

## `color-mix(in oklab)` 使用规则

### 语法

```css
color-mix(in oklab, <color-A> <pct>%, <color-B>)
/* 结果 = 在 OKLab 空间把 A 按 pct% 混入 B */
/* B 通常是 transparent */
```

### 标准比例

| 比例 | 用途 | 例 |
|---|---|---|
| 3% | tertiary 默认极淡 | `button-tertiary` dark |
| 5% | secondary 填充 / 行 hover | `button-secondary`, list-row hover |
| 5.2% | 行 hover（实测精确） | sidebar project row |
| 7% | tertiary hover | `button-tertiary-hover` |
| 8% | 标准边界 / 标准 hover 加深 | `--color-border`, `button-secondary-hover` |
| 10% | tertiary active / primary active | `button-tertiary-active` |
| 12% | 重边界 / secondary active | `--color-border-heavy`, `button-secondary-active` |
| 15% | 状态边界 / editor diff 背景 | `border-warning`, `editor-added` |
| 16% | dark success 背景 | `status-success` dark |
| 36% | danger active | `danger-active` dark |
| 70% | light elevated primary | `elevated-primary` light |
| 90% | dark icon primary | `icon-primary` dark |
| 96% | dark elevated primary | `elevated-primary` dark |

### 为什么用 oklab 不用 sRGB

| 场景 | rgba(255,255,255,0.08) | color-mix(in oklab, white 8%, transparent) |
|---|---|---|
| 在 `#181818` 上 | 看起来像"灰雾"，偏脏 | 看起来像"灯光"，干净 |
| 在 `#000` 上 | 接近 `#141414`，沉 | 接近 `#1a1a1a`，亮 |
| 感知均匀性 | 低 alpha 时不均匀 | 均匀 |

**规则**：**所有 `color-mix` 用 oklab，禁用 sRGB**（即 `color-mix(in srgb, ...)` 也不行）。`rgba` / `#RRGGBBAA` 完全禁用。

### 禁用替代

| 禁用 | 用什么 |
|---|---|
| `rgba(255,255,255,0.08)` | `color-mix(in oklab, var(--gray-0) 8%, transparent)` |
| `#ffffff0f` | 同上 |
| `color-mix(in srgb, ...)` | `color-mix(in oklab, ...)` |
| `hsla(...)` | `color-mix(in oklab, ...)` |

---

## Do / Don't

### Do

```css
/* 引用语义 token */
.dropdown {
  background: var(--color-background-elevated-primary);
  color: var(--color-text-foreground);
  border-color: var(--color-border);
}

/* hover 用 color-mix oklab */
.row:hover {
  background: color-mix(in oklab, var(--gray-0) 5%, transparent);
}

/* accent 蓝只在语义位 */
.link { color: var(--color-text-accent); }
.focus-ring:focus { outline-color: var(--color-border-focus); }
```

### Don't

```css
/* ❌ 硬编码 hex */
.dropdown { background: #212121f5; }

/* ❌ rgba */
.row:hover { background: rgba(255,255,255,0.05); }

/* ❌ dark: 双声明 */
.btn { background: #fff; }
.dark .btn { background: #181818; }

/* ❌ 第二强调色当 CTA */
.btn-cta { background: var(--green-500); color: #fff; }   /* 绿色按钮 = 状态，不是 CTA */

/* ❌ 纯黑当 canvas */
.app { background: #000; }   /* 应是 var(--color-background-surface) = #181818 */

/* ❌ 渐变装饰 */
.hero { background: linear-gradient(to right, blue, purple); }
```
