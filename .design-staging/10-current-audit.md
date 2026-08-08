# 10 — ClawX 当前样式现状诊断

> 本文是对 `c:\Users\27933\Desktop\clawx\ClawX-ui-polish` 仓库的 **只读诊断**。所有问题按 P0/P1/P2 分级，标注文件路径 + 行号。
>
> 证据来源：对仓库的 Grep / Read 检查（2026-08-03）。所有数字均为实测，非估算。
>
> **用途**：决定迁移优先级。P0 必须先修，P1 紧随，P2 可延后。

---

## 目录

1. [诊断总览](#诊断总览)
2. [P0 — 结构性病根](#p0--结构性病根)
3. [P1 — 体系不一致](#p1--体系不一致)
4. [P2 — 细节问题](#p2--细节问题)
5. [问题清单速查表](#问题清单速查表)

---

## 诊断总览

| 维度 | 现状 | 目标 | 严重度 |
|---|---|---|---|
| Token 前缀 | 13+ 套并行（`--sp-*` / `--ccm-*` / `--cdx-*` / `--material-*` / `--surface-*` / `--cwh-*` ...） | 1 套（`--color-*`） | P0 |
| Token 引用量 | 403 处（11 个 CSS 文件） | 0 处并行前缀 | P0 |
| Z-index | 13 个不同值散落（`z-10` / `z-20` / `z-30` / `z-40` / `z-50` / `z-[60]` / `z-[70]` / `z-[80]` / `z-[90]` / `z-[95]` / `z-[100]` / `z-[120]` / `z-auto`） | 5 阶语义（`--z-*`） | P0 |
| Z-index 引用量 | 57 处（30 个 tsx 文件） | 全部走 `--z-*` token | P0 |
| `dark:` 双声明 | 200 处（15 个 tsx 文件） | 0 处 | P0 |
| Dropdown 系统 | 5+ 套各自为政 | 1 套 recipe | P0 |
| Button 系统 | 5+ 套不匹配 | 3 变体 + 1 icon | P1 |
| 圆角 | Composer 25px + dropdown 15px（脱节） | 3xl(25) + 2xl(20) + lg(12.5) | P1 |
| 硬编码 hex | tooltip `#2d2d2d` 等 | 0 处（除 palette） | P1 |
| 硬编码 rgba | `border-white/[0.082]` 等 | 0 处（用 color-mix） | P1 |
| 字号半档 | `text-[13px]` 等 | 0 处（用 11/12/14） | P2 |
| `font-bold` | 散落 | 0 处（上限 500） | P2 |
| 自定义 shadow | 散落 | 全部用 `--shadow-*` | P2 |

---

## P0 — 结构性病根

> P0 是 **结构性病根**，不修则后续所有改动都建立在错误基础上。必须最先修。

### P0-1: 13+ 套并行 token 前缀

**现状**：403 处并行前缀引用，散落在 11 个 CSS 文件：

| CSS 文件 | 引用数 |
|---|---|
| `src/styles/codex-settings-controls.css` | 151 |
| `src/styles/codex-sidebar.css` | 93 |
| `src/styles/codex-composer-menu.css` | 38 |
| `src/styles/codex-welcome-hero.css` | 12 |
| `src/styles/codex-workspace-panel.css` | 9 |
| `src/styles/codex-settings-archived.css` | 42 |
| `src/styles/globals.css` | 30 |
| `src/styles/codex-settings.css` | 10 |
| 其余 3 个文件 | 18 |

**病根**：同一个语义被多个前缀表达：
- `--sp-menu-bg` / `--ccm-surface` / `--cdx-dropdown-bg` / `--material-elevated` / `--surface-modal` 实际都是 `color-mix(in oklab, gray-800 96%, transparent)`
- 改一处改不动其他四处

**目标**：收敛到 1 套 `--color-*` 前缀。

**修复**：见 [11-migration-roadmap.md](./11-migration-roadmap.md) 阶段 1。

---

### P0-2: Z-index 完全无规范

**现状**：57 处 z-index 引用，散落在 30 个 tsx 文件，**13 个不同值**：

| Z-index 值 | 出现位置（例） |
|---|---|
| `z-10` | `AgentTraceGraph.tsx:501`、`SettingsDrawerRoute.tsx:147,148` |
| `z-20` | `apple-drawer.tsx:130`、`Cron/index.tsx:1908`、`Sidebar.tsx:1371`、`BrowserTaskDetailsPanel.tsx:93` |
| `z-30` | `TopicSelector.tsx:57` |
| `z-40` | `ResourceChip.tsx:100`、`SessionSearchModal.tsx:189` |
| `z-50` | `Models/index.tsx:660`、`ResourceChip.tsx:106`、`Knowledge/index.tsx:3428,3599`、`SessionSearchModal.tsx:199` |
| `z-[60]` | `apple-drawer.tsx:113` |
| `z-[70]` | `apple-drawer.tsx:119` |
| `z-[80]` | `sheet.tsx:29`、`Knowledge/index.tsx:1971,2101` |
| `z-[90]` | `sheet.tsx:39` |
| `z-[95]` | `apple-drawer.tsx:143` |
| `z-[100]` | `tooltip.tsx:24`、`select.tsx:112` |
| `z-[120]` | `TitleBar.tsx:59` |
| `z-auto` | `Cron/index.tsx:1908`（lg 断点） |

**病根**：
1. **dropdown（z-30）和 overlay（z-40）层级接近**，dropdown 弹层可能被 overlay 盖住
2. **modal（z-50）和 drawer overlay（z-60/70）层级冲突**，同时出现时谁赢看运气
3. **tooltip（z-100）和 titlebar（z-120）层级混乱**，titlebar 不应该比 tooltip 高
4. **`z-[95]` 是中间值**，没有任何语义，是"为了避开 100 又比 90 高"的临时补丁

**目标**：5 阶语义 z-index：
```css
--z-base: 0;
--z-raised: 10;
--z-dropdown: 30;
--z-modal: 50;
--z-toast: 100;
```

**修复**：见 [11-migration-roadmap.md](./11-migration-roadmap.md) 阶段 2。

---

### P0-3: `dark:` 双声明泛滥

**现状**：200 处 `dark:(bg|text|border)-` 双声明，散落在 15 个 tsx 文件：

| 文件 | 引用数 |
|---|---|
| `src/pages/Skills/index.tsx` | 68 |
| `src/components/agents/RolesOrchestrationPanel.tsx` | 64 |
| `src/components/agents/AgencyRolePromotionPanel.tsx` | 9 |
| `src/components/agent-browser/BoundaryChoiceDialog.tsx` | 9 |
| `src/components/agents/RoleProfileEditor.tsx` | 8 |
| `src/components/agents/RoleCard.tsx` | 8 |
| `src/pages/TaskLedger/index.tsx` | 6 |
| `src/pages/UiV2Showcase/index.tsx` | 5 |
| `src/components/agents/SubagentRunnerPanel.tsx` | 5 |
| `src/components/ai-elements/chain-of-thought.tsx` | 4 |
| `src/components/ai-elements/card.tsx` | 4 |
| 其余 4 个文件 | 10 |

**典型违规**：
```tsx
// apple-drawer.tsx:113
className="... bg-black/24 dark:bg-black/60"
// sheet.tsx:29
className="... bg-black/24 dark:bg-black/60"
// ResourceChip.tsx:106
className="... border-black/10 ... dark:border-white/10"
```

**病根**：
1. 主题切换时颜色"半残"（某 token 没在 dark 块定义，`dark:` 声明指向不存在值）
2. 改一处改不动全栈（改 dark dropdown 背景要找 5 个组件的 `dark:bg-gray-800/96`）
3. 与 token 体系脱节（`dark:bg-gray-900` 硬编码值，改 token 不影响它）

**目标**：0 处 `dark:` 双声明，全部走 token 切换。

**修复**：见 [11-migration-roadmap.md](./11-migration-roadmap.md) 阶段 3。

---

### P0-4: 5+ 套 Dropdown 各自为政

**现状**：Codex 只允许 1 套 dropdown recipe，但 ClawX 有 5+ 套各自手写：

| Dropdown | 圆角 | 阴影 | 来源 |
|---|---|---|---|
| `TopicSelector.tsx:57` | `rounded-xl`（15px） | `shadow-xl` | 手写（应为 2xl 20px + xl-spread） |
| `Knowledge/index.tsx:1971` | `rounded-lg` | `shadow-xl` | 手写（圆角错） |
| `ResourceChip.tsx:106` | `rounded-lg` | `shadow-xl` | 手写（圆角错） |
| `select.tsx:112` | `rounded-lg` | `shadow-lg` | shadcn 默认（阴影错） |
| `codex-composer-menu.css` | `--ccm-surface` 自定义 | 自定义 | ported（前缀错） |
| `codex-settings-controls.css` | `--sp-menu-bg` 自定义 | 自定义 | ported（前缀错） |

**病根**：
1. 圆角不统一（15 / 12 / 20 混用）
2. 阴影不统一（lg / xl / xl-spread 混用）
3. 背景不统一（`--ccm-surface` 用 `#2d2d2d` 不是 `gray-800`，token 漂移）

**目标**：1 套 recipe（`codex-dropdown.css`），所有 dropdown 共用。

**修复**：见 [11-migration-roadmap.md](./11-migration-roadmap.md) 阶段 4。

---

## P1 — 体系不一致

> P1 是 **体系不一致**，不影响功能但破坏视觉一致性。P0 修完后紧随修复。

### P1-1: 圆角体系脱节

**现状**：
- Composer 容器 `25px`（对的，3xl）
- 但 dropdown 是 `15px`（`rounded-xl`，应为 20px）
- list row 部分是 `8px`（应为 12.5px）
- tooltip 是 `rounded-[12.5px]`（对的，但用了任意值语法而非 token）

**病根**：dropdown 浮层"陷进"Composer 容器（15 < 25，视觉错位）；list row 节奏断裂（8 与按钮 10 不匹配）。

**目标**：三级圆角节奏 —— 3xl(25) / 2xl(20) / lg(12.5)。

---

### P1-2: 硬编码 hex

**现状**：
```tsx
// tooltip.tsx:24
className="... bg-[#2d2d2d] border-white/[0.082] ..."
```

**病根**：
1. `#2d2d2d` 是硬编码 hex（应为 `var(--color-background-elevated-primary)`，且应是 `gray-800` `#212121` 不是 `#2d2d2d`）
2. `border-white/[0.082]` 是 rgba（应为 `color-mix(in oklab, var(--gray-0) 8%, transparent)`）
3. `#2d2d2d` ≠ `gray-800` `#212121`，这是 **token 漂移** —— 早期某次手写用了 `#2d2d2d`，没对齐官方

**目标**：0 处硬编码 hex（除 palette 定义），0 处 rgba。

---

### P1-3: Button 系统 5+ 套不匹配

**现状**：Codex 只允许 3 变体 + 1 icon，但 ClawX 有：
- shadcn 默认 button（`bg-primary text-primary-foreground`）
- codex-composer-menu.css 的 `--ccm-button-*`
- codex-settings-controls.css 的 `--sp-button-*`
- 各组件手写 button（`bg-blue-500 text-white` 等"彩色 CTA"）
- composer 内部按钮（28px，对的）

**病根**：主操作有时是墨色（对），有时是蓝色（错），有时是绿色（错，绿色是 status 不是 CTA）。

**目标**：3 变体 + 1 icon，primary 永远墨色。

---

### P1-4: `--ccm-surface` token 漂移

**现状**（来自项目记忆）：
```css
/* codex-composer-menu.css */
--ccm-surface: color-mix(in oklab, #2d2d2d 90%, transparent) + backdrop-blur(8px);
--ccm-surface-light: rgba(255, 255, 255, 0.92) + backdrop-blur(8px);
```

**病根**：
1. `#2d2d2d` 不是官方 `gray-800`（`#212121`）—— 漂移了
2. `rgba(255,255,255,0.92)` 是 rgba 不是 `color-mix`
3. 透明度 90% 不是官方 96%

**目标**：`--ccm-surface` alias 到 `var(--color-background-elevated-primary)`，废弃自定义值。

---

## P2 — 细节问题

> P2 是 **细节问题**，不影响整体但破坏精致感。可延后到 P0/P1 修完后批量处理。

### P2-1: 字号半档 `text-[13px]`

**现状**：
```tsx
// tooltip.tsx:24
className="... text-[13px] ..."
```

**病根**：13px 是 12 和 14 之间的"半档"，Codex 体系没有这一档（要么 12 caption 要么 14 正文）。

**目标**：改为 `text-sm`（12px）或 `text-base`（14px）。

---

### P2-2: `font-bold` 散落

**现状**：部分组件用 `font-bold`（700）当强调。

**病根**：Codex 字重上限 500，没有 600/700 的用武之地。强调来自字号和颜色，不来自加粗。

**目标**：0 处 `font-bold` / `font-semibold`，上限 `font-medium`（500）。

---

### P2-3: 自定义 shadow

**现状**：部分组件手写 `box-shadow: 0 4px 12px rgba(0,0,0,0.15)` 等。

**病根**：阴影是封闭集合（6 阶 + hairline），禁止自定义。

**目标**：全部用 `--shadow-*` token。

---

### P2-4: `stroke-width` 不统一

**现状**：部分图标 `strokeWidth={1.8}`（如 `SettingsDrawerRoute.tsx:147`）。

**病根**：Lucide 标准是 `stroke-width: 2`，1.8 太细。

**目标**：统一 `strokeWidth={2}`。

---

### P2-5: `ease-out` 用错

**现状**：
```tsx
// sheet.tsx:39
className="... transition-[transform,opacity] duration-180 ease-out ..."
```

**病根**：
1. `duration-180` 不是标准阶（应为 150 或 300）
2. `ease-out` 用于退出，但 sheet 是进入（应用 `ease-enter`）

**目标**：进入用 `ease-enter`，退出用 `ease-in`，时长用 150 或 300。

---

### P2-6: `backdrop-blur-[2px]` 过浅

**现状**：
```tsx
// Knowledge/index.tsx:3428
className="... backdrop-blur-[2px] ..."
```

**病根**：`blur(2px)` 太浅看不出玻璃感（应至少 8px）。

**目标**：`backdrop-blur-sm`（8px）。

---

## 问题清单速查表

### P0（必须先修）

| ID | 问题 | 引用量 | 修复阶段 |
|---|---|---|---|
| P0-1 | 13+ 套并行 token 前缀 | 403 处 / 11 文件 | 阶段 1 |
| P0-2 | Z-index 13 值散落 | 57 处 / 30 文件 | 阶段 2 |
| P0-3 | `dark:` 双声明 | 200 处 / 15 文件 | 阶段 3 |
| P0-4 | 5+ 套 Dropdown 各自为政 | 5+ 处 | 阶段 4 |

### P1（紧随修复）

| ID | 问题 | 修复阶段 |
|---|---|---|
| P1-1 | 圆角体系脱节（Composer 25 + dropdown 15） | 阶段 4 |
| P1-2 | 硬编码 hex（`#2d2d2d`） | 阶段 5 |
| P1-3 | Button 系统 5+ 套 | 阶段 4 |
| P1-4 | `--ccm-surface` token 漂移 | 阶段 1 |

### P2（延后批量）

| ID | 问题 | 修复阶段 |
|---|---|---|
| P2-1 | `text-[13px]` 半档 | 阶段 5 |
| P2-2 | `font-bold` 散落 | 阶段 5 |
| P2-3 | 自定义 shadow | 阶段 5 |
| P2-4 | `stroke-width` 不统一 | 阶段 5 |
| P2-5 | `ease-out` 用错 | 阶段 5 |
| P2-6 | `backdrop-blur-[2px]` 过浅 | 阶段 5 |

---

## 验证方法

迁移后用以下方法验证：

### 1. Token 前缀

```powershell
# 应返回 0
Grep --pattern "--(sp|ccm|cdx|material|surface|cwh)-" --glob "*.css" --path <repo>
```

### 2. Z-index

```powershell
# 应返回 0（所有 z-index 走 token）
Grep --pattern "z-\[?\d{2,5}\]?" --glob "*.tsx" --path <repo>/src
```

### 3. dark: 双声明

```powershell
# 应返回 0
Grep --pattern "dark:(bg|text|border)-" --glob "*.tsx" --path <repo>/src
```

### 4. 硬编码 hex

```powershell
# styles.css 应返回 0（ALIGNMENT.md 标准）
Grep --pattern "#[0-9a-fA-F]{3,8}" --glob "styles.css" --path <repo>/src/styles
```

### 5. rgba

```powershell
# 应返回 0
Grep --pattern "rgba\(" --glob "*.css" --path <repo>/src/styles
```

### 6. font-bold

```powershell
# 应返回 0
Grep --pattern "font-(bold|semibold)" --glob "*.tsx" --path <repo>/src
```

---

## 注意事项

- 本诊断是 **2026-08-03** 的快照。仓库持续演进，引用数会变。
- 修复时按 [11-migration-roadmap.md](./11-migration-roadmap.md) 的阶段顺序执行，不要跳阶段（P0 之间有依赖：token 前缀先收敛，z-index 才有地方落）。
- 每修完一个 P0，重跑对应验证命令确认。
- 不要"顺手修"P2 —— 它们依赖 P0/P1 先到位（如 `font-bold` 修复依赖 button 变体先收敛）。
