# 02 — Token 全量参考

> 这是 Codex 设计体系的 **token 字典**。所有 token 按分组列出，每条标注：名称 / 定义值 / 用途 / 出现位置。
>
> 来源：`FakeCoding-main/codex-reference/tokens.css`（1137 个官方 custom property，PostCSS 原始输出）+ `codex-design-system.css`（综合可读版，带注释）。
>
> **使用规则**：实施时查表找对应 token，**不要硬编码**。新增 token 必须登记到本文档 + 同步到 `tokens.css`。

---

## 目录

1. [Token 分层架构](#token-分层架构)
2. [Palette（原始色板）](#palette原始色板)
3. [Semantic color（语义色）](#semantic-color语义色)
4. [Typography（字体）](#typography字体)
5. [Spacing & Sizing（间距与尺寸）](#spacing--sizing间距与尺寸)
6. [Border radius（圆角）](#border-radius圆角)
7. [Shadow（阴影）](#shadow阴影)
8. [Blur（模糊）](#blur模糊)
9. [Motion（动效）](#motion动效)
10. [Layout（布局常量）](#layout布局常量)
11. [Component-specific（组件专用）](#component-specific组件专用)
12. [Z-index（层级阶）](#z-index层级阶)
13. [Token 命名规范](#token-命名规范)

---

## Token 分层架构

Codex 的 token 是 **三层架构**，不要混淆层级：

```
┌─────────────────────────────────────────────────┐
│ Layer 1: Palette (raw)                          │
│   --gray-900: #181818                           │  ← 原始 hex，只在此层出现
│   --blue-300: #339cff                           │
├─────────────────────────────────────────────────┤
│ Layer 2: Semantic (theme-bound)                 │
│   --color-background-surface: var(--gray-900)   │  ← 按角色命名，主题切换在这层
│   --color-text-foreground: var(--gray-0)        │
├─────────────────────────────────────────────────┤
│ Layer 3: Component alias (optional)             │
│   --ccm-surface: var(--color-background-        │  ← 组件专用别名，alias 到 Layer 2
│       elevated-primary)                         │
└─────────────────────────────────────────────────┘
```

**规则**：
- 组件 CSS 引用 **Layer 2**（`var(--color-text-foreground)`），不直接引 Layer 1（`var(--gray-0)`）—— 主题切换在 Layer 2，绕过它会导致主题"半残"。
- Layer 3 别名是可选的，且必须 **alias 到 Layer 2**，不能 alias 到 Layer 1 raw hex。ClawX 当前的 `--sp-menu-bg` 直接 alias 到 `color-mix(gray-800...)` 而不是 `var(--color-background-elevated-primary)`，这是病根。
- Layer 1 的 hex 只在 `tokens.css` 出现一次。

---

## Palette（原始色板）

> **这是唯一允许出现 hex 的地方**。所有 palette token 在 `:root` 声明，全主题共享。

### Gray scale

| Token | Hex | 用途 |
|---|---|---|
| `--gray-0` | `#ffffff` | 全白（dark 主题文本主色） |
| `--gray-50` | `#f9f9f9` | light under-canvas |
| `--gray-75` | `#f3f3f3` | light 次级表面 |
| `--gray-100` | `#ededed` | light 边界 / 分隔 |
| `--gray-300` | `#afafaf` | light 次要文本 / decoration-unchanged |
| `--gray-500` | `#5d5d5d` | tertiary 文本 / icon tertiary（light） |
| `--gray-550` | `#4f4f4f` | 过渡灰 |
| `--gray-600` | `#414141` | dark 次级表面过渡 |
| `--gray-700` | `#303030` | dark 边界过渡 |
| `--gray-750` | `#282828` | dark elevated opaque（不透明浮层 fallback） |
| `--gray-800` | `#212121` | dark editor / elevated-glass base |
| `--gray-900` | `#181818` | **dark canvas（主表面）** |
| `--gray-1000` | `#0d0d0d` | dark button-primary 填充（最深） |

### Green（success）

| Token | Hex | 用途 |
|---|---|---|
| `--green-50` | `#d9f4e4` | light success 背景 |
| `--green-300` | `#40c977` | dark success 文本/icon |
| `--green-400` | `#04b84c` | dark success 填充 |
| `--green-500` | `#00a240` | **success 主色（跨主题）** |
| `--green-700` | `#00692a` | dark decoration-added 文本 |
| `--green-800` | `#004f1f` | — |

### Red（error / danger）

| Token | Hex | 用途 |
|---|---|---|
| `--red-50` | `#ffd9d9` | light error 背景 |
| `--red-300` | `#ff6764` | dark error 文本/icon |
| `--red-400` | `#fa423e` | dark danger-active 填充 |
| `--red-500` | `#e02e2a` | **error 主色（跨主题）** |
| `--red-600` | `#ba2623` | decoration-deleted |
| `--red-900` | `#4d100e` | dark error 背景 |

### Orange（warning）

| Token | Hex | 用途 |
|---|---|---|
| `--orange-50` | `#ffe7d9` | light warning 背景 |
| `--orange-300` | `#ff8549` | dark warning 文本/icon |
| `--orange-400` | `#fb6a22` | — |
| `--orange-500` | `#e25507` | **warning 主色** |
| `--orange-700` | `#923b0f` | decoration-modified |
| `--orange-900` | `#4a2206` | dark warning 背景 |

### Yellow

| Token | Hex | 用途 |
|---|---|---|
| `--yellow-300` | `#ffd240` | — |
| `--yellow-400` | `#ffc300` | accent-yellow（稀有） |

### Blue（brand）

| Token | Hex | 用途 |
|---|---|---|
| `--blue-50` | `#e5f3ff` | **light accent 背景**（chip / 选中态填充） |
| `--blue-100` | `#99ceff` | dark accent 文本（链接） |
| `--blue-300` | `#339cff` | **★ brand 主色（单一品牌色）** |
| `--blue-400` | `#0285ff` | dark accent 强填充 |
| `--blue-900` | `#00284d` | dark accent 深背景 |

### Purple / Pink

| Token | Hex | 用途 |
|---|---|---|
| `--purple-300` | `#ad7bf9` | — |
| `--purple-400` | `#924ff7` | accent-purple（稀有） |
| `--pink-400` | `#ff66ad` | accent-pink（稀有） |

### Black / White

| Token | Hex | 用途 |
|---|---|---|
| `--white` | `#fff` | 别名（同 gray-0） |
| `--black` | `#000` | under-canvas / video |

---

## Semantic color（语义色）

> **组件 CSS 引用这一层**。主题切换在 `.electron-dark` / `.electron-light` 选择器下覆盖这些 token。

### Surface（表面）

| Token | Dark 值 | Light 值 | 用途 |
|---|---|---|---|
| `--color-background-surface` | `var(--gray-900)` `#181818` | `var(--gray-0)` `#fff` | 主 canvas |
| `--color-background-surface-under` | `#000` | `var(--gray-50)` `#f9f9f9` | under-canvas |
| `--color-background-editor-opaque` | `var(--gray-800)` `#212121` | — | editor / code 区 |
| `--color-background-elevated-primary` | `color-mix(in oklab, gray-800 96%, transparent)` ≈ `#212121f5` | `color-mix(in oklab, gray-0 70%, transparent)` | **半透明浮层（dropdown / popover / composer）** |
| `--color-background-elevated-primary-opaque` | `var(--gray-750)` `#282828` | `var(--gray-0)` | 不透明浮层 fallback |
| `--color-background-elevated-secondary` | `color-mix(in oklab, gray-0 3%, transparent)` | `color-mix(in oklab, text-foreground 2%, transparent)` | 次级浮层（card-surface-flat） |

### Button（按钮三变体）

| Token | Dark 值 | Light 值 | 用途 |
|---|---|---|---|
| `--color-background-button-primary` | `var(--gray-1000)` `#0d0d0d` | `var(--color-text-foreground)` `#1a1c1f` | primary 按钮填充 |
| `--color-background-button-primary-hover` | `color-mix(in oklab, gray-1000 6%, transparent)` | `color-mix(in oklab, text-foreground 8%, transparent)` | primary hover |
| `--color-background-button-primary-active` | `color-mix(in oklab, gray-1000 10%, transparent)` | `color-mix(in oklab, text-foreground 16%, transparent)` | primary 按下 |
| `--color-background-button-secondary` | `color-mix(in oklab, gray-0 5%, transparent)` | `color-mix(in oklab, text-foreground 5%, transparent)` | secondary 填充 |
| `--color-background-button-secondary-hover` | `color-mix(in oklab, gray-0 8%, transparent)` | 同上 | secondary hover |
| `--color-background-button-secondary-active` | `color-mix(in oklab, gray-0 12%, transparent)` | `color-mix(in oklab, text-foreground 4%, transparent)` | secondary 按下 |
| `--color-background-button-tertiary` | `color-mix(in oklab, gray-0 3%, transparent)` | `transparent` | tertiary 默认 |
| `--color-background-button-tertiary-hover` | `color-mix(in oklab, gray-0 7%, transparent)` | `color-mix(in oklab, text-foreground 10%, transparent)` | tertiary hover |
| `--color-background-button-tertiary-active` | `color-mix(in oklab, gray-0 10%, transparent)` | `color-mix(in oklab, text-foreground 20%, transparent)` | tertiary 按下 |

### Status background

| Token | Dark 值 | Light 值 | 用途 |
|---|---|---|---|
| `--color-background-accent` | `var(--blue-900)` `#00284d` | `var(--blue-50)` `#e5f3ff` | accent 背景（chip / 选中态） |
| `--color-background-status-success` | `color-mix(in oklab, green-400 16%, transparent)` | `color-mix(in oklab, green-500 7%, transparent)` | success 背景 |
| `--color-background-status-warning` | `var(--orange-900)` | `var(--orange-50)` | warning 背景 |
| `--color-background-status-error` | `var(--red-900)` | `var(--red-50)` | error 背景 |
| `--color-background-danger-active` | `color-mix(in oklab, red-400 36%, transparent)` | `color-mix(in oklab, red-500 90%, transparent)` | danger 按下 |

### Text

| Token | Dark 值 | Light 值 | 用途 |
|---|---|---|---|
| `--color-text-foreground` | `var(--gray-0)` `#fff` | `#1a1c1f` | **主文本** |
| `--color-text-foreground-secondary` | `color-mix(in oklab, gray-0 70%, transparent)` | `color-mix(in oklab, #1a1c1f 70%, transparent)` | 次要文本 |
| `--color-text-foreground-tertiary` | `color-mix(in oklab, gray-0 50%, transparent)` | `color-mix(in oklab, #1a1c1f 50%, transparent)` | 三级文本（caption） |
| `--color-text-button-primary` | `var(--gray-1000)` `#0d0d0d` | `var(--gray-0)` `#fff` | primary 按钮文字（反相） |
| `--color-text-button-secondary` | `var(--gray-300)` `#afafaf` | `var(--color-text-foreground)` | secondary 按钮文字 |
| `--color-text-button-tertiary` | `var(--gray-500)` `#5d5d5d` | `var(--gray-500)` | tertiary 按钮文字 |
| `--color-text-accent` | `var(--blue-100)` `#99ceff` | `var(--blue-300)` `#339cff` | accent 文本（链接） |
| `--color-text-on-accent` | `var(--gray-1000)` | `var(--gray-1000)` | accent 上的文字 |
| `--color-text-success` | `var(--green-300)` | `var(--green-500)` | success 文本 |
| `--color-text-warning` | `var(--orange-300)` | `var(--orange-500)` | warning 文本 |
| `--color-text-error` | `var(--red-300)` | `var(--red-500)` | error 文本 |

### Icon

| Token | Dark 值 | Light 值 | 用途 |
|---|---|---|---|
| `--color-icon-primary` | `color-mix(in oklab, white 90%, transparent)` | `var(--color-text-foreground)` | 主图标 |
| `--color-icon-secondary` | `color-mix(in oklab, white 70%, transparent)` | `color-mix(in oklab, text-foreground 70%, transparent)` | 次要图标 |
| `--color-icon-tertiary` | `color-mix(in oklab, white 50%, transparent)` | `color-mix(in oklab, text-foreground 50%, transparent)` | 三级图标 |
| `--color-icon-accent` | `var(--blue-300)` | `var(--blue-300)` | accent 图标 |
| `--color-icon-success` | `var(--green-500)` | `var(--green-500)` | success 图标 |
| `--color-icon-warning` | `var(--orange-500)` | `var(--orange-500)` | warning 图标 |
| `--color-icon-error` | `var(--red-500)` | `var(--red-500)` | error 图标 |

### Border

| Token | Dark 值 | Light 值 | 用途 |
|---|---|---|---|
| `--color-border` | `color-mix(in oklab, gray-0 8%, transparent)` | `color-mix(in oklab, #1a1c1f 8%, transparent)` | **标准 hairline** |
| `--color-border-heavy` | `color-mix(in oklab, gray-0 12%, transparent)` | `color-mix(in oklab, #1a1c1f 12%, transparent)` | 重边界 |
| `--color-border-light` | `color-mix(in oklab, gray-0 5%, transparent)` | `color-mix(in oklab, #1a1c1f 5%, transparent)` | 极浅边界 |
| `--color-border-warning` | `color-mix(in oklab, orange-500 15%, transparent)` | 同上 | warning 边界 |
| `--color-border-error` | `color-mix(in oklab, red-500 15%, transparent)` | 同上 | error 边界 |
| `--color-border-focus` | `var(--blue-300)` | `var(--blue-300)` | focus ring |

### Decoration（diff）

| Token | Dark 值 | Light 值 | 用途 |
|---|---|---|---|
| `--color-decoration-added` | `var(--green-500)` | `var(--green-500)` | diff 新增 |
| `--color-decoration-modified` | `var(--orange-700)` | `var(--orange-700)` | diff 修改 |
| `--color-decoration-deleted` | `var(--red-600)` | `var(--red-600)` | diff 删除 |
| `--color-decoration-unchanged` | `var(--gray-300)` | `var(--gray-300)` | diff 未变 |
| `--color-editor-added` | `color-mix(in oklab, green-500 15%, transparent)` | 同上 | editor 新增行背景 |
| `--color-editor-deleted` | `color-mix(in oklab, red-600 15%, transparent)` | 同上 | editor 删除行背景 |

### Terminal ANSI

| Token | Hex | 用途 |
|---|---|---|
| `--terminal-ansi-black` | `#000` | — |
| `--terminal-ansi-red` | `#d53538` | — |
| `--terminal-ansi-green` | `#008809` | — |
| `--terminal-ansi-yellow` | `#bd5800` | — |
| `--terminal-ansi-blue` | `#001bcb` | — |
| `--terminal-ansi-magenta` | `#751ed9` | — |
| `--terminal-ansi-cyan` | `#0071ea` | — |
| `--terminal-ansi-white` | `#666` | — |

### Misc

| Token | 值 | 用途 |
|---|---|---|
| `--color-simple-scrim` | `rgba(0,0,0,0.1)`（light 专用） | light scrim 遮罩 |

---

## Typography（字体）

### Font family

| Token | 值 | 用途 |
|---|---|---|
| `--font-sans-default` | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | 默认 sans（平台原生栈） |
| `--font-openai-sans` | `"OpenAI Sans", var(--font-sans-default)` | OpenAI Sans（若可用） |
| `--font-mono-default` | `ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` | mono（code / terminal） |

### Font size

| Token | px | 用途 |
|---|---|---|
| `--text-xs` | 11 | chip / badge / 元信息 |
| `--text-sm` | 12 | dropdown item / toolbar / caption |
| `--text-base` | **14** | **正文 base** |
| `--text-lg` | 16 | 小标题 |
| `--text-xl` | 28 | display |
| `--text-2xl` | 36 | 大 display |
| `--text-3xl` | 48 | 最大 display |
| `--text-heading-sm` | 18 | 二级标题 |
| `--text-heading-md` | 20 | 一级标题（页面 H1） |
| `--text-heading-lg` | 24 | 大标题 |

### Font weight

| Token | 值 | 用途 |
|---|---|---|
| `--font-weight-light` | 300 | 稀有 |
| `--font-weight-normal` | 400 | **正文默认** |
| `--font-weight-medium` | 500 | **标题 / 按钮 / tab label 上限** |
| `--font-weight-semibold` | 600 | 禁用（Codex 不用） |
| `--font-weight-bold` | 700 | 禁用（Codex 不用） |

### Line height

| Token | 值 | 用途 |
|---|---|---|
| `--leading-tight` | 1.25 | 标题 |
| `--leading-snug` | 1.375 | 紧凑 |
| `--leading-normal` | 1.5 | 正文 |
| `--leading-relaxed` | 1.625 | 宽松 |

### Letter spacing

| Token | 值 | 用途 |
|---|---|---|
| `--tracking-tight` | -0.025em | 大标题（heading-lg+） |
| `--tracking-normal` | 0em | 默认 |
| `--tracking-wide` | 0.025em | caption / label |

---

## Spacing & Sizing（间距与尺寸）

### Base

| Token | 值 | 用途 |
|---|---|---|
| `--spacing` | `0.25rem`（4px） | **基线单位** |

### Layout heights

| Token | 值 | 用途 |
|---|---|---|
| `--height-toolbar` | 46px | 标准 toolbar |
| `--height-toolbar-sm` | 36px | 紧凑 toolbar |
| `--height-toolbar-pane` | 40px | 面板 toolbar |
| `--height-token-settings-row` | 4rem（64px） | settings 行高 |
| `--height-token-empty-state-page` | 26.25rem（420px） | 空状态页高度 |

### Composer（输入区专用）

| Token | 值 | 用途 |
|---|---|---|
| `--spacing-token-button-composer` | `calc(var(--spacing) * 7)` = 28px | composer 按钮 size |
| `--spacing-token-button-composer-sm` | `calc(var(--spacing) * 5)` = 20px | composer 小按钮 size |
| `--spacing-token-button-composer-gap` | `var(--spacing)` = 4px | composer 按钮间 gap |
| `--radius-token-composer-single-line` | `calc(var(--spacing) * 5.5)` = 22px | 单行 composer 圆角 |

### Sidebar

| Token | 值 | 用途 |
|---|---|---|
| `--spacing-token-sidebar` | `clamp(240px, 275px, min(520px, calc(100vw - 320px)))` | sidebar 宽度 clamp |

### Container（max-width 阶）

| Token | rem | px | 用途 |
|---|---|---|---|
| `--container-3xs` | 16rem | 256 | — |
| `--container-xs` | 20rem | 320 | — |
| `--container-sm` | 24rem | 384 | — |
| `--container-md` | 28rem | 448 | — |
| `--container-lg` | 32rem | 512 | — |
| `--container-xl` | 36rem | 576 | — |
| `--container-2xl` | 42rem | 672 | — |
| `--container-3xl` | 48rem | 768 | — |
| `--container-4xl` | 56rem | 896 | — |
| `--container-5xl` | 64rem | 1024 | — |

### Markdown

| Token | 值 | 用途 |
|---|---|---|
| `--markdown-wide-block-max-width` | 64rem（1024px） | 宽代码块 max-width |
| `--markdown-wide-block-max-height` | 80vh | 宽代码块 max-height |

---

## Border radius（圆角）

### Base（未应用 scale）

| Token | base |
|---|---|
| `--radius-2xs-base` | 0.125rem（2px） |
| `--radius-xs-base` | 0.25rem（4px） |
| `--radius-sm-base` | 0.375rem（6px） |
| `--radius-md-base` | 0.5rem（8px） |
| `--radius-lg-base` | 0.625rem（10px） |
| `--radius-xl-base` | 0.75rem（12px） |
| `--radius-2xl-base` | 1rem（16px） |
| `--radius-3xl-base` | 1.25rem（20px） |
| `--radius-4xl-base` | 1.5rem（24px） |

### Scale

| Token | 值 |
|---|---|
| `--corner-radius-scale` | 1.25（**全局乘数**） |

### Applied（base × scale，实际使用值）

| Token | 计算 | 实际 px | 用途 |
|---|---|---|---|
| `--radius-2xs` | 2 × 1.25 | 2.5 | chip / badge |
| `--radius-xs` | 4 × 1.25 | 5 | 小按钮 / 输入框 |
| `--radius-sm` | 6 × 1.25 | 7.5 | 表单输入 |
| `--radius-md` | 8 × 1.25 | **10** | 按钮 / 卡片 |
| `--radius-lg` | 10 × 1.25 | **12.5** | **列表行 / dropdown item** |
| `--radius-xl` | 12 × 1.25 | 15 | 小 dropdown（稀有） |
| `--radius-2xl` | 16 × 1.25 | **20** | **标准 dropdown / popover / dialog / card** |
| `--radius-3xl` | 20 × 1.25 | **25** | **Composer 容器** |
| `--radius-4xl` | 24 × 1.25 | 30 | 大 dialog |
| `--radius-full` | — | 9999 | 圆形（avatar / pill） |

---

## Shadow（阴影）

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-hairline` | `0px 0px 0px 0.5px rgba(0,0,0,0.1)` | hairline 描边（0.5px 边） |
| `--shadow-sm` | `0px 1px 2px -1px rgba(0,0,0,0.08)` | 极浅 |
| `--shadow-md` | `0px 2px 4px -1px rgba(0,0,0,0.08)` | surface card |
| `--shadow-md-stronger` | `0px 2px 4px -1px rgba(0,0,0,0.13)` | composer 容器 |
| `--shadow-lg` | `0px 4px 8px -2px rgba(0,0,0,0.1)` | hover lift |
| `--shadow-xl` | `0px 8px 16px -4px rgba(0,0,0,0.12)` | dropdown |
| `--shadow-2xl` | `0px 16px 32px -8px rgba(0,0,0,0.19)` | modal / 大 dialog |

**复合**（dropdown 标配）：
```css
box-shadow: 0 0 0 0.5px var(--color-border), var(--shadow-xl);
/* 等价于 hairline + xl，Codex 称 xl-spread */
```

---

## Blur（模糊）

| Token | px | 用途 |
|---|---|---|
| `--blur-xs` | 4 | 极浅 hover |
| `--blur-sm` | **8** | **dropdown / popover / glass 标配** |
| `--blur-md` | 12 | — |
| `--blur-lg` | 16 | — |
| `--blur-xl` | 24 | — |
| `--blur-2xl` | 40 | — |
| `--blur-3xl` | 64 | — |

> Tailwind 别名：`backdrop-blur-sm` = 8px。Codex dropdown recipe 用 `backdrop-blur-sm`。

---

## Motion（动效）

### Duration

| Token | 值 | 用途 |
|---|---|---|
| `--default-transition-duration` | 0.15s | **默认 transition** |
| `--transition-duration-basic` | 0.15s | 别名 |
| `--transition-duration-relaxed` | 0.3s | 宽松（modal 进入） |

### Easing

| Token | 值 | 用途 |
|---|---|---|
| `--default-transition-timing-function` | `cubic-bezier(0.4, 0, 0.2, 1)` | 默认 |
| `--ease-basic` | `ease` | 稀有 |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | 加速退出 |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | 减速进入 |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | 默认（同 default） |
| `--ease-enter` | `cubic-bezier(0.19, 1, 0.22, 1)` | **强减速进入（dropdown / popover）** |
| `--ease-enter-snappy` | `cubic-bezier(0.23, 1, 0.32, 1)` | 更快的强减速 |
| `--cubic-enter` | `cubic-bezier(0.19, 1, 0.22, 1)` | ease-enter 别名 |

> 详细 motion 规范见 [06-motion.md](./06-motion.md)。

---

## Layout（布局常量）

### Dropdown 宽度

| 上下文 | 宽度 | 来源 |
|---|---|---|
| sidebar overflow（整理 / ⋯） | 188px | DROPDOWN.md 实测 |
| project action | 200px | 实测 |
| project picker | 280px | 实测 |
| mode switch | `min(260px, var(--sidebar-w-16, 260px))` | 实测 |

### List row

| 属性 | 值 |
|---|---|
| min-height | 32px |
| padding-x（row-x） | 8px（`spacing * 2`） |
| padding-y（row-y） | 6px（视觉补偿半档） |
| radius | `--radius-lg`（12.5px） |
| hover overlay | `color-mix(in oklab, gray-0 5.2%, transparent)`（实测） |

---

## Component-specific（组件专用）

> 这些是 **Layer 3 别名**，必须 alias 到 Layer 2。ClawX 迁移时把它们收敛。

### Dropdown（`codex-dropdown.css` 唯一来源）

| 别名 | alias 到 |
|---|---|
| `--token-dropdown-background` | `var(--color-background-elevated-primary)` |
| `--token-foreground` | `var(--color-text-foreground)` |

### Composer menu（`codex-composer-menu.css`，ClawX ported）

| 别名 | 当前 ClawX 值 | 应 alias 到 |
|---|---|---|
| `--ccm-surface` | `color-mix(in oklab, #2d2d2d 90%, transparent)` + `backdrop-blur(8px)` | `var(--color-background-elevated-primary)` |
| `--ccm-surface-light` | `rgba(255, 255, 255, 0.92)` + `backdrop-blur(8px)` | 同上（light 覆盖） |

> ClawX 的 `--ccm-surface` 用 `#2d2d2d` 而非 `gray-800`（`#212121`），这是 **token 漂移**。迁移时统一回 `gray-800`。见 [10-current-audit.md](./10-current-audit.md)。

### Settings controls（`codex-settings-controls.css`，ClawX ported）

| 别名 | 当前 ClawX 值 | 应 alias 到 |
|---|---|---|
| `--sp-menu-bg` | 自定义值 | `var(--color-background-elevated-primary)` |
| `--sp-menu-border` | 自定义值 | `var(--color-border)` |
| `--sp-menu-item-hover` | 自定义值 | `var(--color-background-button-secondary-hover)` |

### Material（ClawX 自创，**应废弃**）

| 别名 | 处理 |
|---|---|
| `--material-elevated` | 废弃 → alias 到 `--color-background-elevated-primary` |
| `--material-modal` | 废弃 → 同上 |
| `--surface-modal` | 废弃 → 同上 |

> 完整病根清单见 [10-current-audit.md](./10-current-audit.md)。

---

## Z-index（层级阶）

> Codex 原始 tokens.css **未定义 z-index token**，z-index 是 ClawX 迁移时新增的 **规范层**（Codex 用 Tailwind `z-*` 散落）。这是为收敛 ClawX 12 个散落 z-index 而引入。

| Token | 数值 | 用途 |
|---|---|---|
| `--z-base` | 0 | 默认流 |
| `--z-raised` | 10 | sticky header / composer 容器 |
| `--z-dropdown` | 30 | dropdown / popover |
| `--z-modal` | 50 | modal / dialog |
| `--z-toast` | 100 | toast / 通知 |

> 详细 z-index 迁移见 [11-migration-roadmap.md](./11-migration-roadmap.md) 阶段 2。

---

## Token 命名规范

### 前缀

| 前缀 | 层级 | 含义 | 例 |
|---|---|---|---|
| `--gray-*` / `--blue-*` / `--green-*` ... | Layer 1 | palette 原始色 | `--gray-900` |
| `--color-background-*` | Layer 2 | 语义背景 | `--color-background-elevated-primary` |
| `--color-text-*` | Layer 2 | 语义文本 | `--color-text-foreground` |
| `--color-icon-*` | Layer 2 | 语义图标 | `--color-icon-accent` |
| `--color-border-*` | Layer 2 | 语义边界 | `--color-border` |
| `--color-decoration-*` | Layer 2 | diff 装饰 | `--color-decoration-added` |
| `--font-*` | — | 字体栈 | `--font-sans-default` |
| `--text-*` | — | 字号 | `--text-base` |
| `--font-weight-*` | — | 字重 | `--font-weight-medium` |
| `--leading-*` | — | 行高 | `--leading-normal` |
| `--tracking-*` | — | 字距 | `--tracking-tight` |
| `--spacing` / `--spacing-token-*` | — | 间距 | `--spacing-token-button-composer` |
| `--radius-*` | — | 圆角 | `--radius-2xl` |
| `--shadow-*` | — | 阴影 | `--shadow-xl-spread` |
| `--blur-*` | — | 模糊 | `--blur-sm` |
| `--z-*` | — | z-index 阶 | `--z-dropdown` |

### 禁用前缀（ClawX 病根）

| 前缀 | 状态 | 处理 |
|---|---|---|
| `--sp-*` | **禁用** | 收敛到 `--color-*` / `--radius-*` |
| `--ccm-*` | **禁用** | 收敛到 `--color-*` |
| `--cdx-*` | **禁用** | 收敛到 `--color-*` |
| `--material-*` | **禁用** | 废弃 |
| `--surface-*` | **禁用** | 废弃 |
| `--cwh-*` | **禁用** | 收敛 |

### 命名规则

- **kebab-case**：`--color-text-foreground-secondary`，不用驼峰
- **语义命名**：`--color-background-elevated-primary`（按角色），不按色值 `--color-blue-light`
- **主题无关**：token 名 **不含 dark/light 前缀**，主题切换在值上，不在名上
- **层级清晰**：Layer 2 名字要能看出是"背景/文本/图标/边界"哪一类

### 新增 token 流程

1. 确认是 Layer 1 / 2 / 3 哪一层
2. Layer 1：在 `tokens.css` `:root` 加 hex，登记到本文档 [Palette](#palette原始色板)
3. Layer 2：在 `tokens.css` 的 `.electron-dark` + `.electron-light` 双声明，登记到本文档对应语义表
4. Layer 3：必须 alias 到 Layer 2，登记到本文档 [Component-specific](#component-specific组件专用)
5. 同步更新 [DESIGN.md](./DESIGN.md) 的 YAML frontmatter（若影响 components recipe）
