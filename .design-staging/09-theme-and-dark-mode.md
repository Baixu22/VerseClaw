# 09 — 主题切换与暗色模式

> 本文定义 Codex 的主题策略：dark-first、token-only 切换、`color-scheme` 声明、`.electron-dark` / `.electron-light` 选择器机制，以及 ClawX 迁移时禁止 `dark:` 双声明的规则。
>
> 来源：`FakeCoding-main/codex-reference/tokens.css`（Light/Dark 两段）+ `codex-design-system.css` + `codex-reference/ALIGNMENT.md`。
>
> **核心规则**：dark-first；token-only 切换；组件禁用 `dark:` 双声明；light 是 dark 的覆盖层，不是相反。

---

## 目录

1. [设计哲学](#设计哲学)
2. [主题选择器机制](#主题选择器机制)
3. [`color-scheme` 声明](#color-scheme-声明)
4. [Dark theme 完整定义](#dark-theme-完整定义)
5. [Light theme 完整定义](#light-theme-完整定义)
6. [跨主题同值 token](#跨主题同值-token)
7. [主题切换实现](#主题切换实现)
8. [ClawX 当前 dark: 双声明问题](#clawx-当前-dark-双声明问题)
9. [Do / Don't](#do--dont)

---

## 设计哲学

Codex 的主题策略有三条铁律：

1. **Dark-first**：设计在暗色下完成。`#181818` 是 canvas，所有 token 的"原始定义"是暗色值。light 主题是 **覆盖层**，不是平等的第二主题。
2. **Token-only 切换**：主题切换通过重新定义 `--color-*` 语义 token 实现，**组件 CSS 完全无感**。组件只引用 `var(--color-text-foreground)`，不关心当前是 dark 还是 light。
3. **禁止 `dark:` 双声明**：组件层 **禁止** `bg-white dark:bg-gray-900` 这种 Tailwind 双前缀。所有暗色逻辑走 `:root` 选择器。

**为什么 dark-first**：开发者工具用户大多数时间在暗色环境（IDE / 终端都是暗色）。先做 dark 能确保主战场到位，再做 light 覆盖能确保"白天偶尔切"也可用。反过来做（先 light 再 dark）会迫使你用 `rgba` 替代 `color-mix`，破坏颜色原则。

---

## 主题选择器机制

### Codex 的机制

Codex 用 **class 选择器** 切主题，不是 `prefers-color-scheme` 媒体查询：

```css
:root { color-scheme: dark; /* 默认 */ }

.electron-dark, [data-theme="dark"] {
  color-scheme: dark;
  /* dark theme token 定义 */
}

.electron-light, [data-theme="light"] {
  color-scheme: light;
  /* light theme token 覆盖 */
}
```

### 为什么用 class 不用 media query

| 方式 | 优点 | 缺点 |
|---|---|---|
| `prefers-color-scheme` | 跟随系统，零配置 | 用户无法手动切 |
| class（`.electron-dark`） | 用户可手动切，可记住偏好 | 需 JS 设置 class |

Codex 选 class —— 因为开发者工具用户经常需要"系统是 light 但 app 是 dark"（白天在暗色 IDE 环境工作）。class 让用户掌控。

### 优先级

```css
:root { /* 默认 dark */ }
.electron-dark { /* 显式 dark，覆盖默认 */ }
.electron-light { /* 显式 light，覆盖 dark */ }
```

**规则**：`electron-light` 优先级高于 `electron-dark`（同时存在时 light 赢）。这是因为 light 是覆盖层 —— 如果用户同时设了两个 class（bug），偏向 light 是更安全的 fallback（白底黑字比黑底白字在意外情况下更可读）。

### `data-theme` 别名

Codex 同时支持 `data-theme="dark"` / `data-theme="light"` 属性选择器，作为 `.electron-*` class 的别名。两者等价，任选其一。

---

## `color-scheme` 声明

```css
:root { color-scheme: dark; }
.electron-dark { color-scheme: dark; }
.electron-light { color-scheme: light; }
```

### `color-scheme` 的作用

`color-scheme` 是 CSS 原生属性，告诉浏览器这个区域用 dark 还是 light 渲染 **原生控件**：

- 滚动条颜色（dark 下暗色滚动条）
- `<input>` / `<button>` 默认背景
- `color: Canvas` / `color: Field` 等 system color
- `::selection` 选中色

**规则**：每个主题选择器块 **必须** 带 `color-scheme` 声明。否则原生滚动条在 dark 主题下会是亮色，破坏整体感。

### 为什么不只靠 `color-scheme`

`color-scheme` 只影响原生控件，不影响自定义 CSS。所以还需要在 `.electron-dark` / `.electron-light` 下重新定义 `--color-*` token，让自定义组件跟着切。

---

## Dark theme 完整定义

> 这是 Codex 的 **原始定义**，light 主题在它基础上覆盖。

```css
.electron-dark,
[data-theme="dark"] {
  color-scheme: dark;

  /* Surface */
  --color-background-surface: var(--gray-900);                          /* #181818 */
  --color-background-surface-under: black;
  --color-background-editor-opaque: var(--gray-800);                     /* #212121 */
  --color-background-elevated-primary: color-mix(in oklab, var(--gray-800) 96%, transparent);
  --color-background-elevated-primary-opaque: var(--gray-750);           /* #282828 */
  --color-background-elevated-secondary: color-mix(in oklab, var(--gray-0) 3%, transparent);
  --color-background-elevated-secondary-opaque: var(--gray-800);

  /* Button */
  --color-background-button-primary: var(--gray-1000);                    /* #0d0d0d */
  --color-background-button-primary-hover: color-mix(in oklab, var(--gray-1000) 6%, transparent);
  --color-background-button-primary-active: color-mix(in oklab, var(--gray-1000) 10%, transparent);
  --color-background-button-secondary: color-mix(in oklab, var(--gray-0) 5%, transparent);
  --color-background-button-secondary-hover: color-mix(in oklab, var(--gray-0) 8%, transparent);
  --color-background-button-secondary-active: color-mix(in oklab, var(--gray-0) 12%, transparent);
  --color-background-button-tertiary: color-mix(in oklab, var(--gray-0) 3%, transparent);
  --color-background-button-tertiary-hover: color-mix(in oklab, var(--gray-0) 7%, transparent);
  --color-background-button-tertiary-active: color-mix(in oklab, var(--gray-0) 10%, transparent);

  /* Status */
  --color-background-accent: var(--blue-900);                            /* #00284d */
  --color-background-status-success: color-mix(in oklab, var(--green-400) 16%, transparent);
  --color-background-status-warning: var(--orange-900);
  --color-background-status-error: var(--red-900);
  --color-background-danger-active: color-mix(in oklab, var(--red-400) 36%, transparent);

  /* Text */
  --color-text-foreground: var(--gray-0);                                 /* #fff */
  --color-text-foreground-secondary: color-mix(in oklab, var(--gray-0) 70%, transparent);
  --color-text-foreground-tertiary: color-mix(in oklab, var(--gray-0) 50%, transparent);
  --color-text-button-primary: var(--gray-1000);
  --color-text-button-secondary: var(--gray-300);                        /* #afafaf */
  --color-text-button-tertiary: var(--gray-500);                        /* #5d5d5d */
  --color-text-accent: var(--blue-100);                                  /* #99ceff */
  --color-text-on-accent: var(--gray-1000);
  --color-text-success: var(--green-300);
  --color-text-warning: var(--orange-300);
  --color-text-error: var(--red-300);

  /* Icon */
  --color-icon-primary: color-mix(in oklab, var(--white) 90%, transparent);
  --color-icon-secondary: color-mix(in oklab, var(--white) 70%, transparent);
  --color-icon-tertiary: color-mix(in oklab, var(--white) 50%, transparent);
  --color-icon-accent: var(--blue-300);
  --color-icon-success: var(--green-500);
  --color-icon-warning: var(--orange-500);
  --color-icon-error: var(--red-500);

  /* Border */
  --color-border: color-mix(in oklab, var(--gray-0) 8%, transparent);
  --color-border-heavy: color-mix(in oklab, var(--gray-0) 12%, transparent);
  --color-border-light: color-mix(in oklab, var(--gray-0) 5%, transparent);
  --color-border-warning: color-mix(in oklab, var(--orange-500) 15%, transparent);
  --color-border-error: color-mix(in oklab, var(--orange-500) 15%, transparent);
  --color-border-focus: var(--blue-300);
}
```

### Dark 关键值速查

| 角色 | Dark 值 |
|---|---|
| canvas | `#181818` |
| editor | `#212121` |
| elevated primary | `color-mix(gray-800 96%)` ≈ `#212121f5` |
| elevated opaque | `#2822828` |
| button primary | `#0d0d0d` |
| text foreground | `#fff` |
| text secondary | white 70% |
| accent text | `#99ceff`（blue-100） |
| accent bg | `#00284d`（blue-900） |
| border | white 8% |
| focus border | `#339cff`（blue-300） |

---

## Light theme 完整定义

> 这是 dark 的 **覆盖层**。只列出与 dark 不同的 token，其余继承 dark。

```css
.electron-light,
[data-theme="light"] {
  color-scheme: light;

  /* Surface */
  --color-background-surface: var(--gray-0);                              /* #fff */
  --color-background-surface-under: var(--gray-50);                      /* #f9f9f9 */
  --color-background-elevated-primary: color-mix(in oklab, var(--gray-0) 70%, transparent);
  --color-background-elevated-primary-opaque: var(--gray-0);
  --color-background-elevated-secondary: color-mix(in oklab, var(--color-text-foreground) 2%, transparent);

  /* Button */
  --color-background-button-primary: var(--color-text-foreground);        /* #1a1c1f */
  --color-background-button-primary-hover: color-mix(in oklab, var(--color-text-foreground) 8%, transparent);
  --color-background-button-primary-active: color-mix(in oklab, var(--color-text-foreground) 16%, transparent);
  --color-background-button-secondary: color-mix(in oklab, var(--color-text-foreground) 5%, transparent);
  --color-background-button-secondary-hover: color-mix(in oklab, var(--color-text-foreground) 5%, transparent);
  --color-background-button-secondary-active: color-mix(in oklab, var(--color-text-foreground) 4%, transparent);
  --color-background-button-tertiary: color-mix(in oklab, var(--color-text-foreground) 0%, transparent);
  --color-background-button-tertiary-hover: color-mix(in oklab, var(--color-text-foreground) 10%, transparent);
  --color-background-button-tertiary-active: color-mix(in oklab, var(--color-text-foreground) 20%, transparent);

  /* Status */
  --color-background-accent: var(--blue-50);                            /* #e5f3ff */
  --color-background-status-success: color-mix(in oklab, var(--green-500) 7%, transparent);
  --color-background-status-warning: var(--orange-50);
  --color-background-status-error: var(--red-50);
  --color-background-danger-active: color-mix(in oklab, var(--red-500) 90%, transparent);

  /* Text */
  --color-text-foreground: #1a1c1f;                                       /* 不是纯黑 */
  --color-text-foreground-secondary: color-mix(in oklab, #1a1c1f 70%, transparent);
  --color-text-foreground-tertiary: color-mix(in oklab, #1a1c1f 50%, transparent);
  --color-text-button-primary: var(--gray-0);                            /* #fff 反相 */
  --color-text-button-secondary: var(--color-text-foreground);
  --color-text-button-tertiary: var(--gray-500);
  --color-text-accent: var(--blue-300);                                  /* #339cff */
  --color-text-on-accent: var(--gray-1000);
  --color-text-success: var(--green-500);
  --color-text-warning: var(--orange-500);
  --color-text-error: var(--red-500);

  /* Icon */
  --color-icon-primary: var(--color-text-foreground);
  --color-icon-secondary: color-mix(in oklab, var(--color-text-foreground) 70%, transparent);
  --color-icon-tertiary: color-mix(in oklab, var(--color-text-foreground) 50%, transparent);
  --color-icon-accent: var(--blue-300);
  --color-icon-success: var(--green-500);
  --color-icon-warning: var(--orange-500);
  --color-icon-error: var(--red-500);

  /* Border */
  --color-border: color-mix(in oklab, #1a1c1f 8%, transparent);
  --color-border-heavy: color-mix(in oklab, #1a1c1f 12%, transparent);
  --color-border-light: color-mix(in oklab, #1a1c1f 5%, transparent);
  /* warning / error / focus 同 dark */

  /* Light 专用 */
  --color-simple-scrim: rgba(0, 0, 0, 0.1);
}
```

### Light 关键差异

| 角色 | Dark | Light | 差异 |
|---|---|---|---|
| canvas | `#181818` | `#fff` | 反相 |
| elevated primary | `gray-800 96%` | `gray-0 70%` | 透明度更低（白底上需要更不透明） |
| button primary | `#0d0d0d` | `#1a1c1f` | 不用纯黑 |
| text foreground | `#fff` | `#1a1c1f` | 不用纯黑 |
| accent text | `blue-100`（#99ceff） | `blue-300`（#339cff） | 更饱和（白底需要） |
| accent bg | `blue-900`（#00284d） | `blue-50`（#e5f3ff） | 反相 |
| status bg | 深色（#4d100e 等） | 淡色（#ffd9d9 等） | 反相 |

### 为什么 light 前景是 `#1a1c1f` 不是 `#000`

纯黑在白底上对比过强，文字看起来"硬"。`#1a1c1f` 是带一点点蓝绿调的近黑，让文字"软"一点，阅读更舒适。这是 OpenAI 调过的值，不是随便选的。

---

## 跨主题同值 token

> 这些 token 在 dark 和 light 下 **值相同**，不需要在主题块里重复定义。

### Decoration（diff）

```css
/* 跨主题同值 */
--color-decoration-added: var(--green-500);
--color-decoration-modified: var(--orange-700);
--color-decoration-deleted: var(--red-600);
--color-decoration-unchanged: var(--gray-300);
--color-editor-added: color-mix(in oklab, var(--green-500) 15%, transparent);
--color-editor-deleted: color-mix(in oklab, var(--red-600) 15%, transparent);
```

**为什么同值**：diff 装饰色的语义是"代码变更状态"（新增/修改/删除），不是"UI 状态"。绿色永远是"新增"，不因主题变浅。如果 light 下绿色变浅，开发者会误以为"这个新增不那么重要"。

### Terminal ANSI

```css
/* 跨主题同值 */
--terminal-ansi-black: #000;
--terminal-ansi-red: #d53538;
--terminal-ansi-green: #008809;
--terminal-ansi-yellow: #bd5800;
--terminal-ansi-blue: #001bcb;
--terminal-ansi-magenta: #751ed9;
--terminal-ansi-cyan: #0071ea;
--terminal-ansi-white: #666;
```

**为什么同值**：ANSI 色板是终端协议，不随 UI 主题变。终端在 dark/light 下用同一套 ANSI 色，因为终端模拟器自己处理背景（dark 终端用 dark 底，light 终端用 light 底，但 ANSI 色板不变）。

### Border warning / error / focus

```css
/* 跨主题同值 */
--color-border-warning: color-mix(in oklab, var(--orange-500) 15%, transparent);
--color-border-error: color-mix(in oklab, var(--red-500) 15%, transparent);
--color-border-focus: var(--blue-300);
```

**为什么同值**：warning/error 边界用 15% alpha 的状态色，在 dark/light 下视觉感受相近（因为底色不同，混合结果自适应）。focus border 用 `blue-300`，在两个主题下都足够显眼。

---

## 主题切换实现

### JS 设置 class

```ts
// 用户选 dark
document.documentElement.classList.add('electron-dark');
document.documentElement.classList.remove('electron-light');

// 用户选 light
document.documentElement.classList.add('electron-light');
document.documentElement.classList.remove('electron-dark');

// 跟随系统
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.classList.toggle('electron-dark', prefersDark);
document.documentElement.classList.toggle('electron-light', !prefersDark);
```

### Electron 启动时设置

```ts
// main process
mainWindow.webContents.executeJavaScript(`
  document.documentElement.classList.add('electron-${theme}');
`);
```

### 持久化

```ts
// electron-store
store.set('theme', userChoice);   // 'dark' | 'light' | 'system'
```

### CSS 变量更新

切换 class 后，CSS 变量自动重新计算，**无需 JS 手动更新任何组件**。这就是 token-only 切换的优势 —— 组件完全无感。

---

## ClawX 当前 dark: 双声明问题

> 这是 ClawX **第二大结构病根**（仅次于 token 前缀混乱）。详见 [10-current-audit.md](./10-current-audit.md)。

### 现状

ClawX 当前有 **200+ 处 `dark:` 双声明**散落在 15+ 个组件文件：

```tsx
// ❌ 当前 ClawX 写法
<div className="bg-white text-gray-900 dark:bg-gray-900 dark:text-white" />
<div className="bg-black/24 dark:bg-black/60" />
<div className="border-black/10 dark:border-white/10" />
```

### 问题

1. **主题切换时颜色"半残"**：如果某个 token 没在 dark 主题块里定义，组件的 `dark:` 声明会指向一个不存在的值，导致颜色丢失。
2. **改一处改不动全栈**：要改"dark 主题下 dropdown 背景从 `gray-800 96%` 改成 `gray-800 90%`"，得在 5 个组件里找 `dark:bg-gray-800/96` 这种声明逐个改。
3. **与 token 体系脱节**：`dark:bg-gray-900` 是硬编码值，不走 token，改 token 不影响它。

### 迁移目标

```tsx
// ✅ 迁移后写法
<div className="bg-token-elevated-primary text-token-foreground" />
// 或
<div style={{
  background: 'var(--color-background-elevated-primary)',
  color: 'var(--color-text-foreground)',
}} />
```

### 迁移策略

见 [11-migration-roadmap.md](./11-migration-roadmap.md) 阶段 3。核心是：
1. 把 `dark:bg-X` / `dark:text-X` 提取成语义 token
2. 在 `.electron-dark` / `.electron-light` 定义该 token 的 dark/light 值
3. 组件改为引用 token，删除 `dark:` 声明

---

## Do / Don't

### Do

```css
/* token-only 切换 */
:root { color-scheme: dark; --color-text-foreground: var(--gray-0); }
.electron-light { color-scheme: light; --color-text-foreground: #1a1c1f; }

/* 组件只引 token */
.text { color: var(--color-text-foreground); }
```

```tsx
// 组件无主题逻辑
<div className="bg-token-elevated-primary" />
```

### Don't

```css
/* ❌ prefers-color-scheme 当唯一机制 */
@media (prefers-color-scheme: dark) { /* 用户无法手动切 */ }
```

```tsx
// ❌ dark: 双声明
<div className="bg-white dark:bg-gray-900" />
<div className="text-black dark:text-white" />

// ❌ 组件层判断主题
const isDark = useTheme() === 'dark';
<div className={isDark ? 'bg-gray-900' : 'bg-white'} />

// ❌ 纯黑当 light 前景
<div className="text-black" />  {/* 应是 #1a1c1f */}
```
