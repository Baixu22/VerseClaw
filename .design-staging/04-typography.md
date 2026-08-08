# 04 — 字体系统

> Codex 的字体是 **系统栈 + 紧凑密度**。本文档定义字体族、字号阶、字重上限、行高、字距，以及排版组合（type scale / type pairing）。
>
> 来源：`FakeCoding-main/codex-reference/tokens.css`（typography 段）+ `codex-design-system.css`。
>
> **核心规则**：系统字体栈（不打包 web font，除 KaTeX）；base `14px`（不是 16px）；weight 上限 `500`；强调来自字号和颜色，不来自加粗。

---

## 目录

1. [设计哲学](#设计哲学)
2. [Font family 字体族](#font-family-字体族)
3. [Font size 字号阶](#font-size-字号阶)
4. [Font weight 字重](#font-weight-字重)
5. [Line height 行高](#line-height-行高)
6. [Letter spacing 字距](#letter-spacing-字距)
7. [Type scale 排版组合](#type-scale-排版组合)
8. [Mono 等宽子系统](#mono-等宽子系统)
9. [Do / Don't](#do--dont)

---

## 设计哲学

Codex 的排版有四条铁律：

1. **系统字体栈**：`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` —— Mac 看到 SF Pro，Windows 看到 Segoe UI，Linux 看到 system sans。从不打包 web font（除 KaTeX 数学公式必需）。这让首次渲染无 FOUT，且原生贴合平台气质。
2. **base 14px**：不是常规的 16px。这是 **开发者工具密度** 的决定 —— 14px 让一屏塞下更多代码、更多 diff、更多 turn。代价是阅读舒适度略降，但 Codex 用户是开发者，不是阅读者。
3. **weight 上限 500**：display 用 `400`，正文用 `400`，按钮/tab 用 `500`。**没有 `600`/`700` 的用武之地**。强调来自字号和颜色对比，不来自加粗。
4. **mono 是子系统**：`ui-monospace, SFMono-Regular, ...` 栈，所有 code / terminal / diff 行内联都用它。Mono 字体有独立的字号规则（比正文小 1px）和字重规则（normal-only）。

---

## Font family 字体族

### Token

```css
:root {
  --font-sans-default: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-openai-sans: "OpenAI Sans", var(--font-sans-default);
  --font-mono-default: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
```

### 字体解析

| Token | Mac | Windows | Linux |
|---|---|---|---|
| `--font-sans-default` | SF Pro Text | Segoe UI | system sans（Cantarell / Ubuntu） |
| `--font-openai-sans` | OpenAI Sans（若装了）→ fallback sans | 同 | 同 |
| `--font-mono-default` | SF Mono | Consolas | Liberation Mono / DejaVu Sans Mono |

### 使用规则

| 场景 | 用哪个 | Tailwind 类 |
|---|---|---|
| 默认所有文本 | `--font-sans-default` | `font-sans`（默认） |
| OpenAI 品牌位（hero / logo 副标） | `--font-openai-sans` | `font-openai-sans`（自定义） |
| 代码块 / 终端 / diff 行 | `--font-mono-default` | `font-mono` |

### Web font 例外

| 字体 | 用途 | 是否打包 |
|---|---|---|
| KaTeX（60+ 字重文件） | 数学公式渲染 | 是（必需） |
| OpenAI Sans | 品牌字 | 否（仅在装了 Codex app 时可用） |
| Carlito（27 文件） | Calibri 兼容 fallback | 是（仅 document 编辑） |

**规则**：除上述外，**禁止 `@font-face` 引入新字体**。需要"设计感"时换字号 / 字重 / 字距，不换字体。

---

## Font size 字号阶

### Token

```css
:root {
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 28px;
  --text-2xl: 36px;
  --text-3xl: 48px;

  --text-heading-sm: 18px;
  --text-heading-md: 20px;
  --text-heading-lg: 24px;
}
```

### 字号阶对照

| Token | px | Tailwind 别名 | 用途 |
|---|---|---|---|
| `--text-xs` | 11 | `text-xs` | chip / badge / 元信息 / timestamp |
| `--text-sm` | 12 | `text-sm` | dropdown item / toolbar / caption / sidebar 二级文本 |
| `--text-base` | **14** | `text-base` | **正文 / 消息气泡 / 代码块 / 输入框** |
| `--text-lg` | 16 | `text-lg` | 小标题 / 强调正文 |
| `--text-heading-sm` | 18 | — | 二级标题（section header） |
| `--text-heading-md` | 20 | — | **页面 H1** |
| `--text-heading-lg` | 24 | — | 大标题（dialog 标题） |
| `--text-xl` | 28 | `text-xl` | display |
| `--text-2xl` | 36 | `text-2xl` | 大 display |
| `--text-3xl` | 48 | `text-3xl` | **最大 display**（hero） |

### 关键规则

- **base 14px，不是 16px**。这是开发者工具密度。禁用 `text-base` 被改成 16px。
- **禁用 13px**。13 是 12 和 14 之间的"半档"，Codex 体系没有这一档。要么 12（caption）要么 14（正文）。
- **禁用 10px 以下**。最小 11px。10px 在 Retina 上还能读，在低 DPI 上糊。
- **display 最大 48px**。不要为"大标题"造 64px / 72px。Codex 没有 marketing hero 的需求。

### 字号递增比例

| 从 → 到 | 比例 | 备注 |
|---|---|---|
| xs(11) → sm(12) | 1.09× | 紧凑递增 |
| sm(12) → base(14) | 1.17× | base 跳一档 |
| base(14) → lg(16) | 1.14× | 标题过渡 |
| lg(16) → heading-sm(18) | 1.13× | 标题递增 |
| heading-sm(18) → heading-md(20) | 1.11× | 标题递增 |
| heading-md(20) → heading-lg(24) | 1.20× | 跳一档 |
| heading-lg(24) → xl(28) | 1.17× | display 过渡 |
| xl(28) → 2xl(36) | 1.29× | display 跳 |
| 2xl(36) → 3xl(48) | 1.33× | 最大跳 |

**比例不均匀** —— 这是故意的。中间档（11→14→18）紧凑递增，大档（28→36→48）跳跃递增。这让密度区紧凑、display 区有节奏。

---

## Font weight 字重

### Token

```css
:root {
  --font-weight-light: 300;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

### 使用边界

| Weight | 用途 | 备注 |
|---|---|---|
| `300` light | 稀有（大 display 副标） | 慎用，低 DPI 糊 |
| `400` normal | **正文 / 标题 / 段落默认** | 主力 weight |
| `500` medium | **按钮 / tab / 选中态 / 强调标题** | **上限** |
| `600` semibold | **禁用** | Codex 不用 |
| `700` bold | **禁用** | Codex 不用 |

### 关键规则

- **weight 上限 500**。要强调，换字号或换颜色，不要 `font-bold`。
- **正文永远 400**。不要为"让正文更显眼"加 weight —— 那是错的。如果正文不显眼，是字号或对比度问题。
- **按钮和 tab label 用 500**。这是 500 的唯一主战场。
- **display 用 400**。不要 `text-3xl font-bold` —— 那是 marketing 写法。

### 系统字体的 weight 可用性

系统字体栈在不同平台的 weight 可用性：

| Weight | SF Pro (Mac) | Segoe UI (Win) | system sans (Linux) |
|---|---|---|---|
| 300 | ✓ | ✓ | 视发行版 |
| 400 | ✓ | ✓ | ✓ |
| 500 | ✓ | ✓（Semibold） | ✓ |
| 600 | ✓ | ✓ | 视发行版 |
| 700 | ✓ | ✓ | ✓ |

虽然系统支持 600/700，但 **Codex 设计上禁用** —— 不是技术限制，是风格选择。

---

## Line height 行高

### Token

```css
:root {
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
}
```

### 使用对照

| Token | 值 | Tailwind 别名 | 用途 |
|---|---|---|---|
| `--leading-tight` | 1.25 | `leading-tight` | 标题 / heading / display |
| `--leading-snug` | 1.375 | `leading-snug` | 紧凑（dropdown item / button label） |
| `--leading-normal` | 1.5 | `leading-normal` | **正文默认** |
| `--leading-relaxed` | 1.625 | `leading-relaxed` | 宽松（长段落 / markdown 正文） |

### 关键规则

- **正文 1.5**。markdown 正文 / 消息气泡用 `--leading-normal`。
- **标题 1.25**。display / heading 用 `--leading-tight`。
- **长 markdown 用 1.625**。阅读舒适度优先于密度时（markdown 主体）。
- **紧凑元素 1.375**。dropdown item / chip / button label 用 `--leading-snug`。

### 行高 vs 字号

行高随字号变化：

| 字号 | 行高 | 比例 |
|---|---|---|
| 11px | 1.375 | 紧凑（chip） |
| 12px | 1.375 | 紧凑（caption） |
| 14px | 1.5 | 正文 |
| 18px+ | 1.25 | 标题 |

**规则**：字号越大，行高比例越小（标题 1.25 < 正文 1.5）。这是排版的常识，但 Codex 严守。

---

## Letter spacing 字距

### Token

```css
:root {
  --tracking-tight: -0.025em;
  --tracking-normal: 0em;
  --tracking-wide: 0.025em;
}
```

### 使用对照

| Token | 值 | Tailwind 别名 | 用途 |
|---|---|---|---|
| `--tracking-tight` | -0.025em | `tracking-tight` | **大标题（heading-lg 及以上）** |
| `--tracking-normal` | 0em | `tracking-normal` | 默认（正文 / 中标题） |
| `--tracking-wide` | 0.025em | `tracking-wide` | caption / label / uppercase |

### 关键规则

- **大标题用 tight**。`text-heading-lg` 及以上字号配 `tracking-tight`，让标题"紧凑有力"。
- **正文 normal**。不要给正文加 tight 或 wide。
- **caption / 全大写用 wide**。全大写文本（如 `NEW` badge）必须 `tracking-wide`，否则字母挤在一起。

---

## Type scale 排版组合

> 这是 token 的实际组合，组件实施时直接照抄。

### 页面 H1（page title）

```tsx
<h1 className="text-heading-md font-medium leading-tight tracking-normal">
  {title}
</h1>
```
- 字号 20px
- weight 500
- 行高 1.25
- 字距 0

### 页面 H2（section header）

```tsx
<h2 className="text-heading-sm font-medium leading-tight">
  {section}
</h2>
```
- 字号 18px
- weight 500
- 行高 1.25

### Dialog 标题

```tsx
<h2 className="text-heading-lg font-medium leading-tight tracking-tight">
  {dialogTitle}
</h2>
```
- 字号 24px
- weight 500
- 行高 1.25
- 字距 tight（-0.025em）

### Display hero

```tsx
<h1 className="text-3xl font-normal leading-tight tracking-tight">
  {hero}
</h1>
```
- 字号 48px
- **weight 400（normal，不是 medium）** —— display 不加重
- 行高 1.25
- 字距 tight

### 正文段落（消息气泡 / markdown）

```tsx
<p className="text-base font-normal leading-relaxed">
  {content}
</p>
```
- 字号 14px
- weight 400
- **行高 1.625（relaxed）** —— markdown 正文用宽松，提升阅读

### 次要描述

```tsx
<p className="text-sm text-token-foreground-secondary leading-snug">
  {description}
</p>
```
- 字号 12px
- 颜色 secondary（70% alpha）
- 行高 1.375

### Caption / 元信息

```tsx
<span className="text-xs text-token-foreground-tertiary tracking-wide">
  {timestamp}
</span>
```
- 字号 11px
- 颜色 tertiary（50% alpha）
- 字距 wide

### 按钮文字

```tsx
<button className="text-sm font-medium leading-snug">
  {label}
</button>
```
- 字号 12px
- **weight 500（medium）** —— 按钮 500
- 行高 1.375

### Dropdown item

```tsx
<MenuItem className="text-sm font-normal leading-snug">
  {label}
</MenuItem>
```
- 字号 12px
- **weight 400（normal，不是 medium）** —— dropdown item 不加粗
- 行高 1.375

### Chip / Badge

```tsx
<Badge className="text-xs font-medium tracking-wide">
  NEW
</Badge>
```
- 字号 11px
- weight 500
- 字距 wide（全大写必加）

### 代码块

```tsx
<pre className="font-mono text-sm leading-normal">
  <code>{code}</code>
</pre>
```
- **mono 字体**
- 字号 12px（比正文 14 小一档）
- 行高 1.5

---

## Mono 等宽子系统

### 字体栈

```css
--font-mono-default: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

`ui-monospace` 是关键 —— 它让浏览器选 **当前平台的默认 mono**（Mac SF Mono / Win Consolas / Linux Liberation），保证字形与系统代码编辑器一致。

### 字号规则

| 场景 | 字号 | 备注 |
|---|---|---|
| 代码块（block） | 12px（`text-sm`） | 比正文 14 小一档 |
| 行内代码（inline） | 13px | 比 base 小 1px（用 `text-[13px]`） |
| 终端 | 12px | 同代码块 |
| diff 行 | 12px | 同代码块 |

**规则**：mono 字体 **永远比同位置 sans 小 1-2px**。因为 mono 字符宽度大，同字号会显得"挤"。

### 字重规则

- **mono 永远 normal（400）**。不要 `font-mono font-bold` —— 那是错的。
- 强调代码用 **背景色**（`--color-editor-added` 等），不用 weight。

### 语法高亮

Codex 用 Shiki（见 [CODEX-UI-RESOURCE-MAP.md](../../FakeCoding-main/CODEX-UI-RESOURCE-MAP.md) §D2）做语法高亮，主题用 `codex-dark` / `codex-light`。**不要手写语法高亮 token**，用 Shiki 主题。

---

## Do / Don't

### Do

```tsx
{/* 正文 */}
<p className="text-base leading-relaxed">{content}</p>

{/* 标题 */}
<h1 className="text-heading-md font-medium leading-tight">{title}</h1>

{/* 强调：换字号或颜色，不加粗 */}
<strong className="text-base font-medium">{emphasized}</strong>

{/* mono 代码 */}
<code className="font-mono text-sm">{code}</code>

{/* caption 全大写加 wide */}
<Badge className="text-xs font-medium tracking-wide">NEW</Badge>
```

### Don't

```tsx
{/* ❌ base 16px（开发者工具不要） */}
<p className="text-base" style={{fontSize: 16}}>{content}</p>

{/* ❌ weight 700（Codex 不用） */}
<h1 className="text-xl font-bold">{title}</h1>

{/* ❌ 用 weight 强调 */}
<p>正文 <strong className="font-bold">强调</strong></p>

{/* ❌ 13px 半档 */}
<span style={{fontSize: 13}}>...</span>

{/* ❌ 引入 web font */}
<style>{`@font-face { font-family: 'Inter'; src: url(...) }`}</style>

{/* ❌ mono 加粗 */}
<code className="font-mono font-bold">{code}</code>

{/* ❌ 渐变文字 */}
<h1 className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
  {title}
</h1>
```
