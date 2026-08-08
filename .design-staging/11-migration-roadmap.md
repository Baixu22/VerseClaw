# 11 — 迁移路线图

> 本文是把 ClawX 从"13+ 套 token 前缀 + 200 处 `dark:` 双声明 + 5 套 dropdown 各自为政"迁移到"统一 Codex 设计体系"的 **5 阶段路线图**。
>
> 每阶段包含：目标 / 前置依赖 / 执行步骤 / 验收清单 / 风险。
>
> **核心原则**：不推倒重来，先建统一层，再把现有 ported CSS 逐步重定向。每阶段可独立验收、独立合并。

---

## 目录

1. [总览](#总览)
2. [阶段 1 — 统一 Token 层](#阶段-1--统一-token-层)
3. [阶段 2 — Z-index 阶](#阶段-2--z-index-阶)
4. [阶段 3 — 清除 `dark:` 双声明](#阶段-3--清除-dark-双声明)
5. [阶段 4 — 收敛 Dropdown 与 Button](#阶段-4--收敛-dropdown-与-button)
6. [阶段 5 — 细节清理](#阶段-5--细节清理)
7. [验收总清单](#验收总清单)

---

## 总览

```
阶段 1: 统一 Token 层           (P0-1, P1-4)  ── 基础，所有后续依赖
   ↓
阶段 2: Z-index 阶              (P0-2)        ── 独立，可与阶段 3 并行
   ↓
阶段 3: 清除 dark: 双声明        (P0-3)        ── 依赖阶段 1（token 先到位）
   ↓
阶段 4: 收敛 Dropdown 与 Button  (P0-4, P1-1, P1-3) ── 依赖阶段 1+3
   ↓
阶段 5: 细节清理                 (P1-2, P2-*)  ── 收尾，批量处理
```

### 阶段依赖

```
阶段 1 ──→ 阶段 3 ──→ 阶段 4 ──→ 阶段 5
              ↑
阶段 2 ──────┘（可与阶段 3 并行，但都要在阶段 4 前）
```

### 原则

1. **不推倒重来**：保留现有 ported CSS 文件（`codex-sidebar.css` 等），只改它们引用的 token。
2. **建统一层优先**：先在 `tokens.css` 建好 `--color-*` 语义层，再让 ported CSS alias 到它。
3. **每阶段独立验收**：每阶段有明确验收命令，跑通才进下一阶段。
4. **不破坏现有功能**：每阶段改完跑 typecheck + lint + E2E smoke。

---

## 阶段 1 — 统一 Token 层

> **目标**：建立 `--color-*` 语义 token 层，把 13+ 套并行前缀收敛到 1 套。
>
> **修复问题**：P0-1（13+ 套并行 token 前缀）、P1-4（`--ccm-surface` token 漂移）。
>
> **前置依赖**：无（基础阶段）。

### 执行步骤

#### 1.1 引入官方 tokens.css

把 `FakeCoding-main/codex-reference/tokens.css`（1137 个官方 token）引入 ClawX：

```css
/* src/styles/index.css */
@import "./codex-tokens.css";   /* 官方 palette + 语义 token */
```

**注意**：官方 tokens.css 已包含 dark/light 主题块（`.electron-dark` / `.electron-light`），直接用即可。

#### 1.2 为并行前缀建 alias

在 `codex-tokens.css` 末尾加 alias 段，把现有并行前缀指向官方语义 token：

```css
/* ===== Migration aliases (临时，迁移完后删除) ===== */

/* codex-settings-controls.css 的 --sp-* */
--sp-menu-bg: var(--color-background-elevated-primary);
--sp-menu-border: var(--color-border);
--sp-menu-item-hover: var(--color-background-button-secondary-hover);
--sp-menu-item-active: var(--color-background-accent);
--sp-menu-text: var(--color-text-foreground);
--sp-menu-text-secondary: var(--color-text-foreground-secondary);
--sp-menu-icon: var(--color-icon-secondary);

/* codex-composer-menu.css 的 --ccm-* */
--ccm-surface: var(--color-background-elevated-primary);
--ccm-surface-light: var(--color-background-elevated-primary);
--ccm-border: var(--color-border);
--ccm-text: var(--color-text-foreground);
--ccm-text-secondary: var(--color-text-foreground-secondary);
--ccm-icon: var(--color-icon-secondary);
--ccm-accent: var(--color-icon-accent);

/* codex-workspace-panel.css 的 --cwh-* */
--cwh-bg: var(--color-background-surface);
--cwh-elevated: var(--color-background-elevated-primary);
--cwh-border: var(--color-border);
--cwh-text: var(--color-text-foreground);

/* codex-conversation.css 的 --cdx-* */
--cdx-dropdown-bg: var(--color-background-elevated-primary);
--cdx-dropdown-border: var(--color-border);

/* 废弃前缀（material / surface） */
--material-elevated: var(--color-background-elevated-primary);
--material-modal: var(--color-background-elevated-primary);
--surface-modal: var(--color-background-elevated-primary);
```

**关键**：所有 alias 必须 **指向 `--color-*`（Layer 2）**，不能直接指向 `--gray-*`（Layer 1）或硬编码值。这样主题切换时 alias 跟着切。

#### 1.3 修 `--ccm-surface` token 漂移

```css
/* ❌ 当前（漂移） */
--ccm-surface: color-mix(in oklab, #2d2d2d 90%, transparent) + backdrop-blur(8px);

/* ✅ 修复后（alias 到官方） */
--ccm-surface: var(--color-background-elevated-primary);
/* 实际值 = color-mix(in oklab, var(--gray-800) 96%, transparent) */
/* gray-800 = #212121（不是 #2d2d2d） */
```

#### 1.4 验证 token 引用

跑验证命令，确认所有前缀都 alias 到 `--color-*`：

```powershell
# 检查并行前缀是否都指向 --color-*
Grep --pattern "--(sp|ccm|cdx|cwh|material|surface)-.*var\(--gray-" --glob "*.css" --path <repo>/src/styles
# 应返回 0（没有 alias 直接指向 gray-*）

Grep --pattern "--(sp|ccm|cdx|cwh|material|surface)-.*#[0-9a-fA-F]" --glob "*.css" --path <repo>/src/styles
# 应返回 0（没有 alias 硬编码 hex）
```

### 验收清单

- [ ] `codex-tokens.css` 引入，包含官方 1137 个 token
- [ ] 所有并行前缀（`--sp-*` / `--ccm-*` / `--cdx-*` / `--cwh-*` / `--material-*` / `--surface-*`）都有 alias 到 `--color-*`
- [ ] `--ccm-surface` 不再硬编码 `#2d2d2d`
- [ ] 没有 alias 直接指向 `--gray-*`（Layer 1），全部指向 `--color-*`（Layer 2）
- [ ] typecheck 通过
- [ ] lint 通过
- [ ] E2E smoke（dropdown 能弹出、颜色正确）

### 风险

- **风险**：alias 指向错误（如把 `--sp-menu-text` 误指向 `--color-background-*`）。
- **缓解**：逐个 alias 对照 [02-tokens.md](./02-tokens.md) 的语义表确认。

---

## 阶段 2 — Z-index 阶

> **目标**：建立 5 阶语义 z-index token，把 13 个散落值收敛。
>
> **修复问题**：P0-2（Z-index 完全无规范）。
>
> **前置依赖**：无（独立阶段，可与阶段 3 并行）。

### 执行步骤

#### 2.1 定义 z-index token

在 `codex-tokens.css` 加 z-index 段（Codex 原始没有，是迁移新增）：

```css
:root {
  --z-base: 0;
  --z-raised: 10;
  --z-dropdown: 30;
  --z-modal: 50;
  --z-toast: 100;
}
```

#### 2.2 映射现有 z-index 到阶

| 现有值 | 用途（从 Grep 推断） | 目标阶 |
|---|---|---|
| `z-10` | 行内选中态 / icon 层叠 | `--z-raised`（10） |
| `z-20` | sidebar resize handle / drawer 内容 | `--z-raised`（10）或 `--z-dropdown`（30，若是浮层） |
| `z-30` | dropdown / popover | `--z-dropdown`（30） |
| `z-40` | overlay backdrop | `--z-modal`（50，overlay 是 modal 的一部分） |
| `z-50` | modal / dialog | `--z-modal`（50） |
| `z-[60]` / `z-[70]` | drawer（apple-drawer） | `--z-modal`（50） |
| `z-[80]` | sheet / knowledge dropdown | `--z-dropdown`（30，若是 dropdown）或 `--z-modal`（50，若是 sheet） |
| `z-[90]` | sheet content | `--z-modal`（50） |
| `z-[95]` | drawer 内 pointer 透传 | `--z-modal`（50） |
| `z-[100]` | tooltip | `--z-toast`（100） |
| `z-[120]` | titlebar | `--z-raised`（10，titlebar 不是浮层） |
| `z-auto` | 静态布局 | `--z-base`（0） |

**关键决策**：
- **titlebar 用 `--z-raised`（10）**：titlebar 是结构性元素，不是浮层，不应高于 dropdown。当前 `z-[120]` 是错的（比 tooltip 还高，导致 tooltip 被 titlebar 盖住）。
- **drawer / sheet 用 `--z-modal`（50）**：drawer 是 modal 的一种，overlay + content 都用 50。
- **tooltip 用 `--z-toast`（100）**：tooltip 应最高，因为它要浮在所有内容上。
- **overlay 用 `--z-modal`（50）**：overlay 是 modal 的背景，和 modal content 同层（content 在 overlay 之上靠 DOM 顺序，不是 z-index）。

#### 2.3 替换组件中的 z-index

```tsx
// ❌ 当前
<div className="z-[100]" />           // tooltip
<div className="z-[120]" />            // titlebar
<div className="z-[60]" />             // drawer overlay

// ✅ 迁移后
<div className="z-toast" />            // tooltip
<div className="z-raised" />           // titlebar
<div className="z-modal" />            // drawer overlay
```

**Tailwind 别名**：在 `tailwind.config.js` 加：
```js
zIndex: {
  base: 'var(--z-base)',
  raised: 'var(--z-raised)',
  dropdown: 'var(--z-dropdown)',
  modal: 'var(--z-modal)',
  toast: 'var(--z-toast)',
}
```

### 验收清单

- [ ] `--z-*` 5 阶 token 定义
- [ ] Tailwind `zIndex` 别名配置
- [ ] 0 处 `z-[数字]` 任意值
- [ ] 0 处 `z-10` / `z-20` / `z-30` / `z-40` / `z-50` 字面量（全部走 token）
- [ ] typecheck / lint / E2E smoke 通过
- [ ] 手动验证：tooltip 浮在 titlebar 之上；dropdown 浮在 sidebar 之上；modal 浮在 dropdown 之上

### 风险

- **风险**：z-index 降级导致浮层被盖（如 titlebar 从 120 降到 10，可能被 dropdown 盖住）。
- **缓解**：titlebar 是 sticky/fixed 的结构性元素，不应被 dropdown 盖（dropdown 在 titlebar 下方区域弹出）。手动验证关键路径。

---

## 阶段 3 — 清除 `dark:` 双声明

> **目标**：把 200 处 `dark:` 双声明改为 token 引用。
>
> **修复问题**：P0-3（`dark:` 双声明泛滥）。
>
> **前置依赖**：阶段 1（token 层先到位，组件才能引用）。

### 执行步骤

#### 3.1 识别 `dark:` 声明的语义

对每处 `dark:bg-X dark:text-Y`，识别它在表达什么语义：

```tsx
// 例：apple-drawer.tsx:113
className="... bg-black/24 dark:bg-black/60"
// 语义：overlay backdrop，dark 下更暗
// → 映射到 --color-overlay-backdrop（新 token）
```

```tsx
// 例：ResourceChip.tsx:106
className="... border-black/10 ... dark:border-white/10"
// 语义：标准 hairline border
// → 映射到 --color-border（已有 token）
```

#### 3.2 补充缺失的 token

有些 `dark:` 声明的语义在现有 token 里没有，需补：

```css
/* codex-tokens.css */
:root {
  --color-overlay-backdrop: color-mix(in oklab, var(--gray-1000) 24%, transparent);
}
.electron-dark {
  --color-overlay-backdrop: color-mix(in oklab, var(--gray-1000) 60%, transparent);
}
```

#### 3.3 替换组件

```tsx
// ❌ 当前
<div className="bg-black/24 dark:bg-black/60" />
<div className="border-black/10 dark:border-white/10" />
<div className="bg-white text-gray-900 dark:bg-gray-900 dark:text-white" />

// ✅ 迁移后
<div className="bg-overlay-backdrop" />
<div className="border-token-border" />   {/* 或 border-border */}
<div className="bg-token-elevated-primary text-token-foreground" />
```

#### 3.4 批量处理

按文件批量处理（15 个文件，200 处）：

| 文件 | 引用数 | 优先级 |
|---|---|---|
| `src/pages/Skills/index.tsx` | 68 | 高（集中） |
| `src/components/agents/RolesOrchestrationPanel.tsx` | 64 | 高 |
| 其余 13 个文件 | 68 | 中 |

### 验收清单

- [ ] 0 处 `dark:(bg|text|border)-` 双声明
- [ ] 补充的 token（如 `--color-overlay-backdrop`）已定义 dark/light 双值
- [ ] typecheck / lint / E2E smoke 通过
- [ ] 手动验证：切换 dark/light 主题，所有组件颜色正确变化

### 风险

- **风险**：漏改某处 `dark:` 声明，导致主题切换时该处颜色"半残"。
- **缓解**：用 Grep 全量扫描确认 0 处。

---

## 阶段 4 — 收敛 Dropdown 与 Button

> **目标**：所有 dropdown 用 1 套 recipe；所有 button 落到 3 变体 + 1 icon。
>
> **修复问题**：P0-4（5+ 套 Dropdown 各自为政）、P1-1（圆角体系脱节）、P1-3（Button 系统 5+ 套）。
>
> **前置依赖**：阶段 1（token）+ 阶段 3（dark: 清除）。

### 执行步骤

#### 4.1 引入 `codex-dropdown.css`

把 FakeCoding 的 `web/src/codex-dropdown.css` 引入 ClawX：

```css
/* src/styles/index.css */
@import "./codex-dropdown.css";
```

`codex-dropdown.css` 包含统一 recipe（见 [07-components.md](./07-components.md) Dropdown 段）。

#### 4.2 替换 5+ 套 dropdown

| Dropdown | 当前 | 迁移后 |
|---|---|---|
| `TopicSelector.tsx:57` | `rounded-xl` + `shadow-xl` + `bg-surface-modal` | 用 `.dropdown` class |
| `Knowledge/index.tsx:1971` | `rounded-lg` + `shadow-xl` | 用 `.dropdown` class |
| `ResourceChip.tsx:106` | `rounded-lg` + `shadow-xl` + `bg-surface-modal` | 用 `.dropdown` class |
| `select.tsx:112`（shadcn） | `rounded-lg` + `shadow-lg` | 重写 shadcn Select 的 className |
| `codex-composer-menu.css` | `--ccm-surface` 自定义 | alias 到 `--color-background-elevated-primary`，圆角改 `--radius-2xl` |
| `codex-settings-controls.css` | `--sp-menu-bg` 自定义 | 同上 |

#### 4.3 修圆角体系

```tsx
// ❌ 当前
<div className="rounded-xl" />     // dropdown 15px（错）
<div className="rounded-lg" />      // list row 12px（错，应为 12.5）

// ✅ 迁移后
<div className="rounded-2xl" />     // dropdown 20px（对）
<div className="rounded-lg" />      // list row 12.5px（对，Tailwind rounded-lg 配置为 var(--radius-lg)）
```

**Tailwind 配置**：
```js
borderRadius: {
  '2xs': 'var(--radius-2xs)',   // 2.5
  'xs': 'var(--radius-xs)',      // 5
  'sm': 'var(--radius-sm)',      // 7.5
  'md': 'var(--radius-md)',      // 10
  'lg': 'var(--radius-lg)',      // 12.5  ← list row / dropdown item
  'xl': 'var(--radius-xl)',      // 15
  '2xl': 'var(--radius-2xl)',    // 20   ← dropdown
  '3xl': 'var(--radius-3xl)',    // 25   ← composer
  '4xl': 'var(--radius-4xl)',    // 30
  full: '9999px',
}
```

#### 4.4 收敛 Button 变体

```tsx
// ❌ 当前（彩色 CTA）
<button className="bg-blue-500 text-white">发送</button>
<button className="bg-green-500 text-white">确认</button>

// ✅ 迁移后
<button className="btn btn--primary">发送</button>     {/* 墨色填充 */}
<button className="btn btn--primary">确认</button>     {/* 同上，primary */}
<button className="btn btn--secondary">取消</button>
<button className="btn btn--icon"><Icon /></button>
```

**移除"彩色 CTA"**：所有 `bg-(blue|green|red)-500` 按钮改为 primary（墨色）或 secondary（灰）。蓝色只在 accent 文本 / 选中态 / focus 用。

### 验收清单

- [ ] 所有 dropdown 用 `.dropdown` class（统一 recipe）
- [ ] 0 处 `rounded-xl` 当 dropdown（应为 `rounded-2xl`）
- [ ] Composer 容器 `rounded-3xl`（25px）
- [ ] 所有 button 落到 3 变体 + 1 icon
- [ ] 0 处 `bg-(blue|green|red)-500` 当 CTA
- [ ] typecheck / lint / E2E smoke 通过
- [ ] 手动验证：dropdown 圆角 20px，浮在 Composer（25px）上不"陷进"；按钮墨色一致

### 风险

- **风险**：shadcn Select 重写 className 可能破坏 Radix 行为。
- **缓解**：保留 Radix 的 data-state 属性选择器，只改视觉类。

---

## 阶段 5 — 细节清理

> **目标**：批量清理 P1-2 / P2-* 细节问题。
>
> **修复问题**：P1-2（硬编码 hex）、P2-1（`text-[13px]` 半档）、P2-2（`font-bold`）、P2-3（自定义 shadow）、P2-4（`stroke-width`）、P2-5（`ease-out` 用错）、P2-6（`backdrop-blur-[2px]`）。
>
> **前置依赖**：阶段 1-4 全部完成。

### 执行步骤

#### 5.1 硬编码 hex 清零

```tsx
// ❌ tooltip.tsx:24
className="... bg-[#2d2d2d] border-white/[0.082] ..."

// ✅ 修复后
className="... bg-token-elevated-primary border-token-border ..."
```

#### 5.2 字号半档清零

```tsx
// ❌ tooltip.tsx:24
className="... text-[13px] ..."

// ✅ 修复后（tooltip 用 caption 字号）
className="... text-xs ..."   // 11px
```

#### 5.3 font-bold 清零

```tsx
// ❌
<h1 className="text-xl font-bold">标题</h1>

// ✅
<h1 className="text-xl font-medium">标题</h1>   {/* 500，不是 700 */}
```

#### 5.4 自定义 shadow 清零

```tsx
// ❌
<div style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} />

// ✅
<div className="shadow-md" />   {/* var(--shadow-md) */}
```

#### 5.5 stroke-width 统一

```tsx
// ❌ SettingsDrawerRoute.tsx:147
<Icon strokeWidth={1.8} />

// ✅
<Icon strokeWidth={2} />
```

#### 5.6 ease 用错修复

```tsx
// ❌ sheet.tsx:39（进入用 ease-out）
className="... ease-out ..."

// ✅（进入用 ease-enter）
className="... ease-enter ..."
```

#### 5.7 backdrop-blur 过浅修复

```tsx
// ❌ Knowledge/index.tsx:3428
className="... backdrop-blur-[2px] ..."

// ✅
className="... backdrop-blur-sm ..."   // 8px
```

### 验收清单

- [ ] 0 处硬编码 hex（除 palette）
- [ ] 0 处 `text-[13px]`
- [ ] 0 处 `font-bold` / `font-semibold`
- [ ] 0 处自定义 `box-shadow`
- [ ] 所有图标 `strokeWidth={2}`
- [ ] 0 处 `ease-out` 当进入动画
- [ ] 0 处 `backdrop-blur-[2px]` 以下
- [ ] typecheck / lint / E2E 全套通过

---

## 验收总清单

### Token 层

```powershell
# 1. 并行前缀都 alias 到 --color-*
Grep --pattern "--(sp|ccm|cdx|cwh|material|surface)-.*var\(--gray-" --glob "*.css" --path <repo>/src/styles
# 期望：0

# 2. alias 不硬编码 hex
Grep --pattern "--(sp|ccm|cdx|cwh|material|surface)-.*#[0-9a-fA-F]" --glob "*.css" --path <repo>/src/styles
# 期望：0
```

### Z-index

```powershell
# 3. 0 处 z-[数字]
Grep --pattern "z-\[?\d{2,5}\]?" --glob "*.tsx" --path <repo>/src
# 期望：0
```

### dark: 双声明

```powershell
# 4. 0 处 dark: 双声明
Grep --pattern "dark:(bg|text|border)-" --glob "*.tsx" --path <repo>/src
# 期望：0
```

### 硬编码值

```powershell
# 5. styles.css 0 处 hex（ALIGNMENT.md 标准）
Grep --pattern "#[0-9a-fA-F]{3,8}" --glob "styles.css" --path <repo>/src/styles
# 期望：0

# 6. 0 处 rgba
Grep --pattern "rgba\(" --glob "*.css" --path <repo>/src/styles
# 期望：0
```

### 字体

```powershell
# 7. 0 处 font-bold / font-semibold
Grep --pattern "font-(bold|semibold)" --glob "*.tsx" --path <repo>/src
# 期望：0

# 8. 0 处 text-[13px] 半档
Grep --pattern "text-\[1[0-9]px\]" --glob "*.tsx" --path <repo>/src
# 期望：0（除 11/12/14 标准阶）
```

### 圆角

```powershell
# 9. dropdown 用 rounded-2xl（20px）
Grep --pattern "dropdown.*rounded-(xl|lg)" --glob "*.tsx" --path <repo>/src
# 期望：0
```

### 完整测试

```powershell
# 10. typecheck
pnpm run typecheck

# 11. lint
pnpm run lint

# 12. E2E smoke
pnpm run test:e2e:agent-dev-quality:smoke
```

---

## 迁移后维护

迁移完成后，**防止回退**：

1. **lint 规则**：加 ESLint 规则禁止 `dark:` 双声明 / `z-[数字]` / 硬编码 hex。
2. **CI 检查**：在 CI 跑验收命令，违规即 fail。
3. **文档同步**：每次组件改造同步更新本文档 + [10-current-audit.md](./10-current-audit.md)。
4. **新增 token**：必须登记到 [02-tokens.md](./02-tokens.md)，否则不合并。

---

## 注意事项

- **不跳阶段**：P0 之间有依赖（token 先收敛，z-index / dark: 才有地方落）。
- **每阶段独立 PR**：便于 review 和回滚。
- **保留 ported CSS**：不要删 `codex-sidebar.css` 等文件，只改它们引用的 token。删文件是阶段 5 之后的事。
- **手动验证关键路径**：每阶段跑完手动点一遍（dropdown 弹出 / 主题切换 / tooltip 显示 / modal 浮层），自动化测试覆盖不到所有视觉情况。
- **不要"顺手改"P2**：P2 依赖 P0/P1 先到位。提前改 P2 会因为 token 还没收敛而改错。
