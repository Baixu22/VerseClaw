---
doc: 17-settings-forms-overlays
name: Settings, Form Controls & Overlay Systems
category: Components
status: production-ready
source_version: openai-codex-electron@26.715.52143
sources:
  - codex-reference/tokens.css
  - codex-reference/fakecoding-bridge.css
  - codex-reference/DROPDOWN.md
  - codex-reference/ALIGNMENT.md
  - codex-reference/css/model-picker-power-slider-impl-ShOI3rhA.css
  - codex-reference/css/composer-approval-request-card-IKpIrw8U.css
  - codex-reference/css/cmdk-uRuhKLE-.css
  - codex-reference/css/dropdown-Ba118dXc.css
  - codex-reference/css/referral-invite-modal-CoMV3aAJ.css
  - codex-reference/live-capture/settings-content-all.json
  - codex-pure-source/runtime-dom/stylesheets-rules.json
---

# 17 — Settings, Form Controls & Overlay Systems

> 设置面板、表单控件、工具提示、对话框、模态、通知是 Codex 的"管理表面"。本文规定了这些组件的完整规范，包括 VS Code token 桥接、表单验证颜色、Radix 原生动画时序。

---

## 目录

1. [设置面板结构](#1-设置面板结构)
2. [表单控件](#2-表单控件)
3. [工具提示（Tooltip）](#3-工具提示tooltip)
4. [对话框 / 模态](#4-对话框--模态)
5. [通知 / Toast](#5-通知--toast)
6. [悬停卡 / 弹出层](#6-悬停卡--弹出层)
7. [确认对话框](#7-确认对话框)
8. [表单验证](#8-表单验证)

---

## 1. 设置面板结构

### 1.1 页面-列表结构

设置面板采用"固定左导航 + 滚动右内容"结构，每个页面包含 `pageTitle`、可选 `pageDesc` 和 `sections[]`，每个 section 有 `title` 和 `rows[]`，每个 row 有 `title`、`description` 和 `control` 对象。

### 1.2 控件分类

| `kind` | 用途 | 观测行高 |
|--------|------|----------|
| `input` | 单行文本（hex 色、字体名、px 值、搜索） | 28–60.6 px |
| `switch` | 布尔切换 | 36–60.6 px |
| `select` | 下拉选择（麦克风、审批策略、沙箱） | 28–61.2 px |
| `button` | 操作按钮（"保存"、"重置"、"选择"） | 56.9–88 px |
| `textarea` | 多行文本（自定义指令，160×768px） | 160 px |
| `segmented` | 分段控件或快捷键显示行 | 52–120 px |
| `none` | 只读原始文本 | 60.6 px |

### 1.3 页面几何

| 属性 | 值 |
|------|-----|
| 页面 banner 背景 | `rgb(34, 34, 34)` = `--gray-800` |
| 默认行高（标题+描述+控件） | 60.6px |
| 紧凑行高（搜索/顶部选择） | 28px |
| 高行（按钮+描述+宠物选择） | 88px |
| Textarea 固定尺寸 | 768×160px |
| 主题色输入行 | 44px |
| 主题色切换行 | 36px |

### 1.4 页面清单

| 页面 | 章节 | 行数 |
|------|------|------|
| 外观 | 7 | 14 |
| 语音 | 9 | 8 |
| 配置 | 10 | 8 |
| 个性化 | 6 | 7 |
| 宠物 | 12 | 12 |
| 键盘快捷键 | 0（平铺列表） | 多 |

### 1.5 设置专属 Token 桥接

```css
--vscode-settings-headerForeground:    var(--color-text-foreground);
--vscode-settings-headerBorder:        var(--color-border);
--vscode-settings-sashBorder:          var(--color-border);
--vscode-settings-dropdownBackground:  var(--color-background-elevated-primary-opaque);
--vscode-settings-dropdownForeground:  var(--color-text-foreground);
--vscode-settings-dropdownBorder:      var(--color-border);
--vscode-settings-dropdownListBorder:  var(--color-border);
--vscode-settings-checkboxBackground:  var(--color-background-elevated-primary);
--vscode-settings-checkboxForeground:  var(--color-text-foreground);
--vscode-settings-checkboxBorder:      var(--color-border);
--vscode-settings-textInputBackground: var(--color-background-elevated-primary);
--vscode-settings-textInputForeground: var(--color-text-foreground);
--vscode-settings-textInputBorder:     var(--color-border);
--vscode-settings-numberInputBackground: var(--color-background-elevated-primary);
--vscode-settings-numberInputForeground: var(--color-text-foreground);
--vscode-settings-numberInputBorder:    var(--color-border);
--vscode-settings-focusedRowBackground: var(--color-background-elevated-primary);
--vscode-settings-rowHoverBackground:   var(--color-background-elevated-secondary);
--vscode-settings-focusedRowBorder:    var(--color-border-focus);
--vscode-settings-modifiedItemIndicator: var(--color-accent-orange);
```

---

## 2. 表单控件

### 2.1 文本输入

**Token 桥接**：
```css
--color-token-input-background: var(--vscode-input-background);
--color-token-input-border:     var(--vscode-input-border, transparent);
--color-token-input-foreground: var(--vscode-input-foreground);

/* VS Code 桥接 */
--vscode-input-background:  var(--color-background-control);
--vscode-input-border:      var(--color-border-heavy);
--vscode-input-foreground:  var(--color-text-foreground);
```

**解析值**：

| 主题 | background | border | foreground |
|------|------------|--------|------------|
| Dark | `--gray-800` = `#212121` | `--gray-700` = `#303030` | `--gray-0` = `#fff` |
| Light | `--gray-0` = `#fff` | `--gray-300` = `#afafaf` | `#0d0d0d` |

### 2.2 切换开关（Switch/Toggle）

设置中 `kind: "switch"` 行高为 36px（紧凑）或 60.6px（标准）。

**最接近的开关 CSS**（来自审批卡片的 ViewToggle）：

```css
._ViewToggle_15yqt_19 {
  color: var(--color-token-text-tertiary);
  margin: 0 !important;
  border-radius: 8px !important;
  margin-inline-start: -8px !important;
  min-height: 32px !important;
  padding: 4px !important;
}
._ViewToggle_15yqt_19:hover,
._ViewToggle_15yqt_19:focus { background: transparent !important; }
._ViewToggle_15yqt_19:not([data-disabled]):hover ._ViewToggleContent_15yqt_627,
._ViewToggle_15yqt_19:not([data-disabled]):focus ._ViewToggleContent_15yqt_627 {
  background: var(--color-token-list-hover-background);
}
._ViewToggleContent_15yqt_627 {
  border-radius: 6px;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 2px 4px;
  display: flex;
}
```

**圆角形状 token**（决定 on 态 thumb 外形）：
```css
--codex-corner-shape: superellipse(1.5);   /* 不要用普通圆形替代 */
```

### 2.3 下拉选择（Select）

**官方 recipe**（`DROPDOWN.md`）：

```css
.bg-token-dropdown-background.text-token-foreground.rounded-2xl.shadow-xl-spread
```

| 属性 | 值 |
|------|-----|
| 背景 | `color-mix(in oklab, gray-800 96%, transparent)` ≈ `#212121f5` |
| 圆角 | `radius-2xl` = **20px** |
| 阴影 | `shadow-xl-spread` = hairline + xl |
| 模糊（玻璃变体） | `backdrop-blur-sm` = **8px** |

**Item recipe**：
```css
rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm
```

| 属性 | 值 |
|------|-----|
| `padding-row-x` | 8px |
| Item min-height | 32px |
| Item 圆角 | `radius-lg` ≈ 12.5px |
| 字号 | `text-sm` = 12px |

**标准宽度**：

| 上下文 | 宽度 |
|--------|------|
| 侧边栏溢出 | 188px |
| 项目操作 | 200px |
| 项目选择器 | 280px |
| 模式切换 | `min(260px, sidebar-16)` |

**底部对齐定位器**：
```css
._parentBottomAlignedContent_uoph8_1 {
  --dropdown-content-parent-bottom-transform:
    translateY(calc(var(--radix-dropdown-menu-trigger-height) + .5rem - 100%));
  transform: var(--dropdown-content-parent-bottom-transform);
}
```

### 2.4 滑块（Power/Effort Slider）

```css
._Track_m3zgh_423 {
  background: color-mix(in srgb, var(--color-token-foreground) 10%, transparent);
  height: 24px;
  box-shadow: inset 0 0 0 .5px var(--color-token-border);
  border-radius: 12px;
  flex-grow: 1;
  position: relative;
  overflow: hidden;
}
._Range_m3zgh_451 {
  background-color: var(--color-token-charts-blue);
  border-radius: 12px 0 0 12px;
  width: 100%;
  height: 100%;
  position: absolute;
  inset-inline-start: 0;
  overflow: hidden;
}
._Tick_m3zgh_79 {
  width: 4px;
  height: 4px;
  cursor: var(--cursor-interaction);
  pointer-events: auto;
  will-change: transform, translate, opacity;
  border-radius: 50%;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%) translate(0, 0);
}
._Tick_m3zgh_79[data-selected=true]  { background-color: #ffffff4d; }
._Tick_m3zgh_79[data-selected=false] {
  background-color: color-mix(in srgb, var(--color-token-description-foreground) 50%, transparent);
}
._Thumb_m3zgh_23 {
  border: .5px solid var(--color-token-border-heavy);
  background: #fff;
  border-radius: 50%;
  display: block;
  position: absolute;
  inset: 0;
  box-shadow: 0 0 2px #0000001a;
}
```

**滑块菜单过渡**：
```css
._Menu_15yqt_1[data-transitions-ready=true] {
  transition: height .3s cubic-bezier(.23, 1, .32, 1);
}
._Menu_15yqt_1[data-transitions-ready=true] ._ViewTrack_15yqt_7 {
  transition: transform .3s cubic-bezier(.23, 1, .32, 1);
}
._Menu_15yqt_1[data-transitions-ready=true] ._ViewToggle_15yqt_19 {
  transition: opacity .3s cubic-bezier(.23, 1, .32, 1),
              translate .3s cubic-bezier(.23, 1, .32, 1);
}
._Menu_15yqt_1[data-reduced-motion=true] { transition: none; }
```

**Ultra 模式颜色覆写**：
```css
._FastModeToggle_15yqt_21[data-fast-mode-enabled=true] {
  color: var(--color-token-charts-blue);
}
._FastModeToggle_15yqt_21[data-fast-mode-enabled=true][data-max-power-selection=true] {
  color: var(--color-token-charts-purple);   /* ultra = 紫色 */
}
```

### 2.5 复选框（ProseMirror 任务列表）

```css
._editor_11vxc_8 .ProseMirror .task-list-item-checkbox input {
  appearance: none;
  width: 1rem;            /* 16px */
  height: 1rem;           /* 16px */
  color: inherit;
  border: .9px solid var(--oai-wb-control-border);
  cursor: pointer;
  pointer-events: auto;
  background: transparent;
  border-radius: 0.125rem;   /* 2px */
  place-content: center;
  display: inline-grid;
}
/* 勾选标记 */
input::before {
  content: "";
  border-right: 2px solid var(--oai-wb-on-accent);
  border-bottom: 2px solid var(--oai-wb-on-accent);
  transform-origin: 50% center;
  width: 0.25rem;        /* 4px */
  height: 0.5rem;        /* 8px */
  transform: rotate(45deg) scale(0);
}
input:checked {
  background: currentcolor;
  border-color: currentcolor;
}
input:checked::before {
  transform: rotate(45deg) scale(1);    /* 勾选动画 */
}
/* 不确定状态 */
input:indeterminate {
  background: currentcolor;
  border-color: currentcolor;
}
input:indeterminate::before {
  background: var(--oai-wb-on-accent);
  border-bottom: none;
  border-right: none;
  width: 0.5rem;          /* 8px */
  height: 0.125rem;       /* 2px */
  transform: none;
}
```

### 2.6 单选按钮（VS Code 桥接）

```css
--vscode-radio-activeForeground:        var(--color-text-foreground);
--vscode-radio-activeBackground:         var(--color-background-accent-active);
--vscode-radio-activeBorder:             var(--color-border-heavy);
--vscode-radio-inactiveBorder:           var(--color-border-heavy);
--vscode-radio-inactiveHoverBackground:  var(--color-background-elevated-secondary);
```

### 2.7 文本域（Textarea）

- 固定尺寸：768×160px
- 用于"自定义指令"
- 无独立 `._textarea_*` 模块 — 与单行输入共享 `--color-token-input-*` token

---

## 3. 工具提示（Tooltip）

### 3.1 定位器

```css
._positioner_1b9wx_1 {
  width: clamp(0px,
    calc(var(--radix-tooltip-trigger-width, 0px) - 64px),
    var(--radix-tooltip-content-available-width, 100vw));
  height: min(420px,
    var(--radix-tooltip-content-available-height, 420px),
    calc(100vh - 16px));
  pointer-events: none;
  flex-direction: column;
  justify-content: flex-end;
  display: flex;
  overflow: visible;
}
```

**关键限制**：
- 最大高度：**420px** 或 `100vh - 16px`
- 宽度：`trigger-width - 64px`，clamp 到可用宽度
- 定位器 `pointer-events: none`，内表面 `pointer-events: auto`

### 3.2 表面

```css
._surface_1b9wx_45 {
  pointer-events: auto;
  align-self: flex-end;
  width: 100%;
  max-height: 100%;
}
```

### 3.3 方向对齐

```css
._positioner_1b9wx_1[data-side="bottom"] ._surface_1b9wx_45 {
  align-self: flex-start;
}
```

### 3.4 Radix 变量

Tooltip 使用 Radix UI 原生变量：
- `--radix-tooltip-trigger-width`
- `--radix-tooltip-trigger-height`
- `--radix-tooltip-content-available-width`
- `--radix-tooltip-content-available-height`
- `data-side` 属性控制对齐翻转

---

## 4. 对话框 / 模态

### 4.1 模态遮罩（Curtain / Backdrop）

```css
._curtain_174ud_1 {
  z-index: var(--max-app-overlay-z-index);   /* 2147480000 */
  pointer-events: auto;
  opacity: 0;
  backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--color-token-bg-primary) 74%, transparent);
  animation-duration: 0.11s;
  animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
  animation-fill-mode: forwards;
  position: fixed;
  inset: 0px;
  transform: scale(1.01);
}
._curtain_174ud_1[data-phase="raise"] { animation-name: _curtainRaise_174ud_1; }
._curtain_174ud_1[data-phase="lower"] { animation-name: _curtainLower_174ud_1; }

@keyframes _curtainRaise_174ud_1 {
  0%   { opacity: 0; transform: scale(1.01); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes _curtainLower_174ud_1 {
  0%   { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.01); }
}
```

| 属性 | 值 |
|------|-----|
| z-index | `2147480000`（接近 2³¹-1） |
| 背景模糊 | 12px |
| 背景色调 | `--color-token-bg-primary` @ 74% |
| 动画时长 | 0.11s |
| 缓动 | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| 缩放 | `1.01 → 1`（raise）/ 反向（lower） |

### 4.2 命令面板对话框（cmdk）

```css
[cmdk-root], [data-cmdk-root] {
  gap: var(--spacing);
  background-color: color-mix(in oklab, var(--color-token-dropdown-background) 95%, transparent);
  min-width: 100%;
  color: var(--color-token-foreground);
  border: 1px solid var(--color-token-border);
  border-radius: var(--radius-3xl);        /* 25px */
  padding: var(--spacing);
  font-size: var(--text-sm);
  backdrop-filter: blur(8px);
  user-select: none;
  z-index: 1000;
  flex-direction: column;
  display: flex;
  transform: translateZ(0);
}
.command-menu-dialog [cmdk-root] {
  box-shadow: var(--shadow-2xl);
  border-radius: var(--radius-2xl);       /* 命令面板用 20px */
  backdrop-filter: none;
  max-height: var(--command-menu-max-height);
  border-color: transparent;
  overflow: hidden;
}
```

**尺寸**：

| 类型 | 宽度 | 列表最大高度 |
|------|------|-------------|
| 命令菜单 | `min(520px, 92vw / zoom)` | `min(300px, max(120px, 90vh/zoom - 64px))` |
| 全局命令菜单 | 同上 | `min(440px, max(120px, 90vh/zoom - 64px))` |
| 进程管理器 | `min(640px, 92vw / zoom)` | — |

### 4.3 cmdk 列表项

```css
[cmdk-item] {
  content-visibility: auto;
  border-radius: var(--radius-lg);       /* 12.5px */
  width: 100%;
  cursor: var(--cursor-interaction);
  color: var(--color-token-foreground);
  padding: var(--padding-row-y) var(--padding-row-x);
  min-height: calc(var(--spacing) * 6);  /* 24px */
  opacity: .75;
  outline: none;
  flex-direction: row;
  align-items: center;
  display: flex;
}
[cmdk-item][aria-disabled=true], [cmdk-item][data-disabled=true] {
  cursor: default;
  opacity: .25;
}
[cmdk-item]:hover:not([aria-disabled=true]),
[cmdk-item][data-selected=true],
[cmdk-item][aria-selected=true],
[cmdk-item]:focus-visible,
[cmdk-item]:active:not([aria-disabled=true]) {
  background-color: var(--color-token-list-hover-background);
  opacity: 1;
}
```

### 4.4 模态本地 Token 覆写（referral-invite 示例）

```css
._modal_fswjq_1 {
  --referral-rate-limit-border: var(--color-token-border);
  --referral-rate-limit-check-background: var(--color-token-charts-green);
  --referral-rate-limit-input-background: var(--color-token-input-background);
  --referral-rate-limit-muted-surface: var(--color-token-list-hover-background);
  --referral-rate-limit-secondary: var(--color-token-text-secondary);
  --referral-rate-limit-success-background:
    color-mix(in srgb, var(--color-token-charts-green) 16%, transparent);
  --referral-rate-limit-success-foreground: var(--color-token-charts-green);
  --referral-rate-limit-surface: var(--color-token-dropdown-background);
}
```

每个模态可以在根元素上声明本地 token 命名空间，子组件引用本地 token 而非全局。

---

## 5. 通知 / Toast

### 5.1 入场/出场动画

```css
@keyframes _toast-open_ykdga_1 {
  0%   { opacity: 0; transform: translateY(-4px); }
  100% { opacity: 1; transform: translateY(0px); }
}
@keyframes _toast-close_ykdga_1 {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}
```

### 5.2 根容器

```css
._root_ykdga_45 {
  flex-direction: column;
  align-items: center;
  transition: opacity 0.24s cubic-bezier(0, 0, 0.2, 1),
              transform 0.24s cubic-bezier(0, 0, 0.2, 1);
  display: flex;
}
._root_ykdga_45[data-state="entering"],
._root_ykdga_45[data-state="entered"] {
  animation: 0.25s cubic-bezier(0.175, 0.885, 0.32, 1) _toast-open_ykdga_1;
}
._root_ykdga_45[data-state="exiting"] {
  animation: 0.25s cubic-bezier(0.4, 0, 1, 1) _toast-close_ykdga_1;
}
```

### 5.3 Alert 主体

```css
._alert_ykdga_85 {
  pointer-events: all;
  min-width: 0px;
  max-width: 100%;
  font-size: var(--text-base);      /* 14px */
  line-height: 1.5;
  box-shadow: rgba(0, 0, 0, 0.1) 0px 4px 12px;
}
```

### 5.4 时序总表

| 状态 | 时长 | 缓动 | 位移 |
|------|------|------|------|
| 入场 | 0.25s | `cubic-bezier(0.175, 0.885, 0.32, 1)` | Y: -4px → 0 |
| 出场 | 0.25s | `cubic-bezier(0.4, 0, 1, 1)` | 仅 opacity |
| 状态过渡回退 | 0.24s | `cubic-bezier(0, 0, 0.2, 1)` | opacity + transform |

**状态机**：`entering → entered → exiting`

| 属性 | 值 |
|------|-----|
| 阴影 | `0 4px 12px rgba(0,0,0,0.1)` |
| 字号 | `--text-base` = 14px |
| 行高 | 1.5 |

---

## 6. 悬停卡 / 弹出层

### 6.1 模型选择器下拉（Popover 范式）

```css
._ModelPickerDropdownContent_1w4ob_203 {
  transform-origin: var(--radix-dropdown-menu-content-transform-origin);
  will-change: opacity, transform;
  overflow: clip;
}
._ModelPickerDropdownContent_1w4ob_203[data-state=open] {
  animation: .32s cubic-bezier(.23, 1, .32, 1) 30ms both
    _model-picker-dropdown-content-enter_1w4ob_1;
}
@keyframes _model-picker-dropdown-content-enter_1w4ob_1 {
  0%   { opacity: 0; transform: scale(.98); }
  to   { opacity: 1; transform: scale(1); }
}
```

| 属性 | 值 |
|------|-----|
| 时长 | 0.32s |
| 缓动 | `cubic-bezier(0.23, 1, 0.32, 1)` |
| 延迟 | 30ms |
| 缩放 | 0.98 → 1 |
| fill-mode | `both` |

### 6.2 Popover 通用规范

Popover 遵循与 Tooltip 和 Dropdown 相同的 Radix 原生模式：
- 使用 `--radix-popover-content-available-width/height`
- 使用 `--radix-popover-trigger-width/height`
- `data-side` 控制对齐翻转
- Surface 使用 dropdown token 集：`--color-token-dropdown-background`、`--color-token-border`、`--color-token-foreground`、`--color-token-list-hover-background`

---

## 7. 确认对话框

Codex 没有独立的 `confirm-dialog` / `destructive` 类。确认流程复用：

1. **模态遮罩**（`_curtain_174ud_1`）作为背景
2. **cmdk-root 外壳** 作为对话框容器：
   ```css
   border-radius: var(--radius-2xl);     /* 20px */
   box-shadow: var(--shadow-2xl);
   border: 1px solid var(--color-token-border);
   ```
3. **破坏性颜色** 取自标准状态 token：
   - `--color-background-status-error: var(--red-900)` = `#4d100e`（dark）
   - `--color-text-error: var(--red-300)` = `#ff6764`（dark）

**实现建议**：引入专用确认对话框时，遵循 cmdk-root + curtain 模式，破坏性按钮用 `--color-background-status-error`，警告标题用 `--color-text-error`。

---

## 8. 表单验证

### 8.1 验证 Token

```css
--color-token-input-validation-error-background:   var(--vscode-inputValidation-errorBackground);
--color-token-input-validation-error-border:       var(--vscode-inputValidation-errorBorder);
--color-token-input-validation-info-background:    var(--vscode-inputValidation-infoBackground);
--color-token-input-validation-warning-background: var(--vscode-inputValidation-warningBackground);
--color-token-input-validation-warning-border:     var(--vscode-inputValidation-warningBorder);
```

### 8.2 VS Code 验证桥接

```css
--vscode-inputValidation-infoBackground:    var(--color-background-accent);
--vscode-inputValidation-infoBorder:        var(--color-border-focus);
--vscode-inputValidation-warningBackground: var(--color-background-status-warning);
--vscode-inputValidation-warningBorder:     var(--color-border-warning);
--vscode-inputValidation-errorBackground:   var(--color-background-status-error);
--vscode-inputValidation-errorBorder:      var(--color-border-error);
```

### 8.3 解析颜色

**Dark 主题**：

| Token | 解析 | Hex |
|-------|------|-----|
| `--color-background-status-error` | `var(--red-900)` | `#4d100e` |
| `--color-background-status-warning` | `var(--orange-900)` | `#4a2206` |
| `--color-background-accent` | `var(--blue-900)` | `#00284d` |
| `--color-border-focus` | `var(--blue-300)` | `#339cff` |
| `--color-text-error` | `var(--red-300)` | `#ff6764` |
| `--color-text-warning` | `var(--orange-300)` | `#ff8549` |

**Light 主题**：

| Token | 解析 | Hex |
|-------|------|-----|
| `--color-background-status-error` | `var(--red-50)` | `#ffd9d9` |
| `--color-background-status-warning` | `var(--orange-50)` | `#ffe7d9` |
| `--color-background-accent` | `var(--blue-50)` | `#e5f3ff` |

### 8.4 列表/编辑器级验证

```css
--vscode-list-invalidItemForeground:  var(--color-text-error);
--vscode-list-errorForeground:       var(--color-text-error);
--vscode-list-warningForeground:     var(--color-text-warning);
--vscode-editorError-foreground:     var(--color-text-error);
--vscode-editorWarning-foreground:   var(--color-text-warning);
--vscode-editorInfo-foreground:      var(--color-text-accent);
--vscode-editorHint-foreground:      var(--color-text-accent);
```

### 8.5 验证应用规则

| 验证类型 | 背景 token | 边框 token | 文字 token |
|----------|-----------|-----------|-----------|
| 错误 | `--color-token-input-validation-error-background` | `--color-token-input-validation-error-border` | `--color-text-error` |
| 警告 | `--color-token-input-validation-warning-background` | `--color-token-input-validation-warning-border` | `--color-text-warning` |
| 信息 | `--color-token-input-validation-info-background` | `--color-border-focus` | `--color-text-accent` |

---

## 全局 Token 参考

### 间距与圆角

```css
--spacing: 0.25rem;                         /* 4px 基础单位 */
--codex-corner-radius-scale: 1.25;          /* 全局圆角乘数 */
--codex-corner-shape: superellipse(1.5);    /* 圆角形状（不要用普通圆形） */
--radius-xs:  5px;  --radius-sm: 7.5px;  --radius-md: 10px;
--radius-lg:  12.5px; --radius-xl: 15px;  --radius-2xl: 20px;
--radius-3xl: 25px;  --radius-4xl: 30px;  --radius-full: 9999px;
--radius-token-row: 9999px;                /* 胶囊行 */
--radius-token-composer-single-line: 22px;
--composer-border-radius: var(--radius-3xl); /* 25px */
```

### 阴影

```css
--shadow-sm:           0px 1px 2px -1px #00000014;
--shadow-md:           0px 2px 4px -1px #00000014;
--shadow-md-stronger:  0px 2px 4px -1px #00000021;
--shadow-lg:           0px 4px 8px -2px #0000001a;
--shadow-xl:           0px 8px 16px -4px #0000001f;
--shadow-2xl:          0px 16px 32px -8px #00000030;
--shadow-hairline:     0px 0px 0px .5px #0000001a;
--elevation-stroke:    0 0 0 .5px var(--color-token-border-heavy);
--max-app-overlay-z-index: 2147480000;     /* 模态遮罩 */
```

### 模糊

```css
--blur-xs: 4px;  --blur-sm: 8px;  --blur-md: 12px;
--blur-lg: 16px; --blur-xl: 24px; --blur-2xl: 40px; --blur-3xl: 64px;
```

### 布局尺寸

```css
--titlebar-h: 34px;
--sidebar-w: var(--spacing-token-sidebar, 274px);
--spacing-token-sidebar: clamp(240px, 275px, min(520px, calc(100vw - 320px)));
--review-w: 356px;
```

---

## Do / Don't

### Do
- 表单控件用 VS Code token 桥接（`--vscode-input-*` → `--color-token-input-*`）
- 模态遮罩用 `backdrop-filter: blur(12px)` + `scale(1.01 → 1)` 0.11s 动画
- Toast 用 0.25s `cubic-bezier(0.175, 0.885, 0.32, 1)` 入场，Y 位移 -4px
- Popover 入场用 0.32s `cubic-bezier(0.23, 1, 0.32, 1)` + 30ms 延迟 + scale(0.98→1)
- 滑块 track 用 `color-mix(in srgb, foreground 10%, transparent)` 背景
- Ultra/最大功率模式用紫色（`--color-token-charts-purple`）
- 复选框勾选标记用 `rotate(45deg) scale(0→1)` 动画
- 每个模态在根元素声明本地 token 命名空间

### Don't
- 不要给开关 thumb 用普通圆形 — 必须用 `superellipse(1.5)` 形状
- 不要用固定 hex 做验证颜色 — 必须走 `--color-background-status-*` token
- 不要给模态遮罩用低于 `2147480000` 的 z-index
- 不要给 cmdk 对话框用 `--radius-3xl`（25px）— 命令面板用 `--radius-2xl`（20px）
- 不要给 Toast 出场加位移 — 只淡出
- 不要给确认流程创建独立组件类 — 复用 cmdk-root + curtain 模式
