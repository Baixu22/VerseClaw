# 13 — 交互状态机

> 本文是 [07-components.md](./07-components.md) 的**状态维度深挖**。07 解决"组件长什么样、尺寸是多少",13 解决"组件在每个状态下视觉如何变化、状态之间如何转移、键盘和鼠标如何驱动"。
>
> 来源(均为已逐行核对的源文件):
> - `FakeCoding-main/codex-reference/tokens.css`(button / list / focus token)
> - `FakeCoding-main/codex-reference/DROPDOWN.md`(dropdown 官方 recipe)
> - `FakeCoding-main/web/src/codex-dropdown.css`(dropdown 完整实现)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/app-VS6Z-TiK.pretty.css`(Tailwind 状态工具类)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/cmdk-uRuhKLE-.pretty.css`(cmdk list 状态机)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/composer-approval-request-card-IKpIrw8U.pretty.css`(ModelPicker 状态)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/composer-layout-B6-UZ6B5.pretty.css`(composer 容器状态)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/composer-footer-DqStEw03.pretty.css`(composer footer 状态)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/prompt-editor-DD1RABrS.pretty.css`(ProseMirror placeholder)
> - `FakeCoding-main/codex-conversation-render/css-all/prettified/thread-user-message-navigation-rail-CZzXjFhl.pretty.css`(rail marker 状态机)
> - `FakeCoding-main/web/src/components/ImagePreviewDialog.tsx`(模态对话框 ARIA)
> - `FakeCoding-main/web/src/components/Composer.tsx`(输入框键盘)
> - `FakeCoding-main/web/src/primitives/ToolActivityDisclosure.tsx`(Disclosure 折叠 ARIA)
>
> **核心规则**:状态用 CSS 变量分层(`-default` / `-hover` / `-active` / `-inactive`),不替换颜色;`:disabled` 与 `[aria-disabled="true"]` 严格区分;`:focus` 与 `:focus-visible` 严格区分;`data-state` 由 Radix UI 驱动(open / closed / delayed-open / checked / unchecked);loading 状态**不用 `aria-busy`**,用专属类 + `data-*` 属性。

---

## 目录

1. [状态机设计哲学](#状态机设计哲学)
2. [Button 状态机](#button-状态机)
3. [Dropdown 状态机](#dropdown-状态机)
4. [List Row 状态机](#list-row-状态机)
5. [Input / Composer 状态机](#input--composer-状态机)
6. [Link 与可点击区域](#link-与可点击区域)
7. [Disabled 三态对比](#disabled-三态对比)
8. [Loading 状态谱系](#loading-状态谱系)
9. [Focus 管理与键盘导航](#focus-管理与键盘导航)
10. [ARIA 角色与属性对照](#aria-角色与属性对照)
11. [状态转移图(Statechart)](#状态转移图statechart)
12. [Do / Don't](#do--dont)

---

## 状态机设计哲学

Codex 的状态机有三条铁律:

1. **状态用 CSS 变量分层,而非替换颜色**
   - 每个变体有 4 档 token:`-default` / `-hover` / `-active` / `-inactive`
   - 通过 `:hover` / `:active` / `[data-state=open]` 选择器叠加,而非 JS 切换 class

2. **`:disabled` 与 `[aria-disabled="true"]` 严格区分**
   - `:disabled` = 真正的 HTML 禁用,不触发 click,可叠加 `cursor:not-allowed/wait/default` + opacity 0.4-0.7 + 颜色降级
   - `[aria-disabled="true"]` = 视觉禁用,JS 仍可拦截,仅 `cursor:not-allowed` + `opacity:.6`

3. **`:focus` 与 `:focus-visible` 严格区分**
   - `:focus` = 鼠标点击也会触发
   - `:focus-visible` = 仅键盘聚焦触发
   - Codex 用 `focus:outline-none` 强制隐藏鼠标 outline,再用 `focus-visible:outline-2` 仅键盘聚焦显示蓝色 ring

---

## Button 状态机

### 三变体 × 四档 token

```css
/* codex-design-system.css:239-268(electron-light) */
--color-background-button-primary:          var(--color-text-foreground);
--color-background-button-primary-hover:    color-mix(in oklab, var(--color-text-foreground) 8%, transparent);
--color-background-button-primary-active:   color-mix(in oklab, var(--color-text-foreground) 16%, transparent);
--color-background-button-secondary:        color-mix(in oklab, var(--color-text-foreground) 5%, transparent);
--color-background-button-secondary-hover:   color-mix(in oklab, var(--color-text-foreground) 5%, transparent);
--color-background-button-secondary-active: color-mix(in oklab, var(--color-text-foreground) 4%, transparent);
--color-background-button-tertiary:         color-mix(in oklab, var(--color-text-foreground) 0%, transparent);  /* 透明 */
--color-background-button-tertiary-hover:   color-mix(in oklab, var(--color-text-foreground) 10%, transparent);
--color-background-button-tertiary-active:  color-mix(in oklab, var(--color-text-foreground) 20%, transparent);

/* electron-dark */
--color-background-button-primary:          var(--gray-1000);                              /* #0d0d0d */
--color-background-button-primary-hover:    color-mix(in oklab, var(--gray-1000) 6%, transparent);
--color-background-button-primary-active:   color-mix(in oklab, var(--gray-1000) 10%, transparent);
--color-background-button-secondary:        color-mix(in oklab, var(--gray-0) 5%, transparent);
--color-background-button-secondary-hover:   color-mix(in oklab, var(--gray-0) 8%, transparent);
--color-background-button-secondary-active: color-mix(in oklab, var(--gray-0) 12%, transparent);
--color-background-button-tertiary:         color-mix(in oklab, var(--gray-0) 3%, transparent);
--color-background-button-tertiary-hover:   color-mix(in oklab, var(--gray-0) 7%, transparent);
--color-background-button-tertiary-active:  color-mix(in oklab, var(--gray-0) 10%, transparent);
```

### 变体差异矩阵

| 变体 | Dark default | Dark hover | Dark active | Hover 增量 | Active 增量 | 用途 |
|---|---|---|---|---|---|---|
| **primary** | `#0d0d0d` 实色 | `gray-1000 6%` 半透明 | `gray-1000 10%` 半透明 | +6% | +4% | 主操作(发送/确认) |
| **secondary** | `gray-0 5%` 半透明 | `gray-0 8%` | `gray-0 12%` | +3% | +4% | 次要操作(取消) |
| **tertiary** | `gray-0 3%` 极淡 | `gray-0 7%` | `gray-0 10%` | +4% | +3% | 工具栏图标 |
| **icon** | transparent | (同 tertiary) | (同 tertiary) | +4% | +3% | 32×32 方形图标 |

**关键规则**:
- **primary hover 反而变浅**:因为底色 `gray-1000` 已是最暗,只能往上叠白
- **secondary/tertiary hover 逐步加白**:5% → 8% → 12%(secondary);3% → 7% → 10%(tertiary)
- **hover 和 active 的差永远是 ~4%**:不要把 active 做成"完全反色"
- **light 主题 secondary hover 与 default 同色(5%)**:仅靠 active(4%)和 cursor 区分——这是设计取舍

### inactive 变体(空闲态)

```css
/* app-VS6Z-TiK.pretty.css:7063-7091 */
.electron-dark {
  --color-background-button-primary-inactive:   color-mix(in oklab, var(--gray-1000) 3%, transparent);
  --color-background-button-secondary-inactive: color-mix(in oklab, var(--gray-0) 4%, transparent);
}
```

**用途**:Composer 输入框为空时,发送按钮显示为 `inactive`(3-4% 透明,极淡),提示"不可发送";输入有内容后切到 `default`。

### active scale 阶梯

```css
/* app-VS6Z-TiK.pretty.css:10657-10669 */
.active\:scale-95:active              { scale: 0.95 }    /* primary:5% */
.active\:scale-\[0\.97\]:active       { scale: 0.97 }    /* 强反馈 */
.active\:scale-\[0\.98\]:active       { scale: 0.98 }    /* standard */
.active\:scale-\[0\.99\]:active       { scale: 0.99 }    /* light */
.active\:scale-\[0\.995\]:active      { scale: 0.995 }   /* icon:0.5% */
.motion-reduce\:active\:scale-100:active { scale: 1 }    /* reduced-motion */
```

**分级**:primary 用 `scale-95`,secondary 用 `scale-[0.98]`,icon 用 `scale-[0.995]`。详见 [12-motion-depth.md](./12-motion-depth.md) 的微交互章节。

### 完整 5 态组合(生产环境 className)

从 `composer-chips-live.json` 提取的真实按钮 className(已格式化):

```html
<button
  class="
    border-token-border                              /* default:边框 */
    no-drag cursor-interaction                        /* default:cursor */
    items-center gap-1 border
    whitespace-nowrap select-none
    focus:outline-none                                /* 鼠标点击隐藏 outline */
    disabled:cursor-not-allowed disabled:opacity-40   /* disabled */
    flex rounded-full
    electron:rounded-md text-token-foreground          /* default:文字色 */
    enabled:hover:bg-token-list-hover-background      /* hover */
    data-[state=open]:bg-token-list-hover-background  /* open(dropdown trigger) */
    border-transparent electron:p-1 electron:[&>svg]:icon-sm
    flex items-center justify-center p-0.5 h-7 w-7 rounded-md
  "
>
```

**5 态拆解**:

| 状态 | 触发 | 视觉变化 |
|---|---|---|
| **default** | 无 | `text-token-foreground` + 透明背景 + `border-token-border`(0.66px) |
| **hover** | `enabled:hover:` | `bg-token-list-hover-background`(5-8% 白叠层) |
| **focus(键盘)** | `focus-visible:` | `bg-token-list-hover-background` + 2px `--color-token-focus-border` 蓝外框 + 2px offset |
| **active/open** | `data-[state=open]:` 或 `:active` | 与 hover 同背景 + `active:scale-[0.98]`(可选) |
| **disabled** | `:disabled` | `cursor:not-allowed` + `opacity:0.4` + hover 完全失效 |

### focus ring 叠加规则

```css
/* app-VS6Z-TiK.pretty.css:10538-10631 */
.focus-visible\:border-transparent:focus-visible { border-color: #0000 }                  /* 隐藏原生 border */
.focus-visible\:bg-token-list-hover-background:focus-visible {                            /* 复用 hover 背景 */
  background-color: var(--color-token-list-hover-background)
}
.focus-visible\:ring-2:focus-visible {                                                    /* 2px ring */
  --tw-ring-shadow: 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);
}
.focus-visible\:ring-token-focus-border:focus-visible {                                  /* 蓝色 ring */
  --tw-ring-color: var(--color-token-focus-border)                                         /* = #339cff */
}
.focus-visible\:outline-2:focus-visible { outline-width: 2px }
.focus-visible\:outline-offset-2:focus-visible { outline-offset: 2px }
.focus-visible\:outline-token-focus-border:focus-visible {
  outline-color: var(--color-token-focus-border)
}
```

**双重实现**:`outline` + `box-shadow`(ring)。`outline` 不影响 layout,`box-shadow` 可以多层叠加。Codex 同时用两者,确保跨浏览器一致。

### `--color-token-focus-border` 解析链

```
--color-token-focus-border
  ↓
--vscode-focusBorder                          (VSCode 主题 token)
  ↓
--color-border-focus                          (Codex 语义 token)
  ↓
var(--blue-300)                               (palette:#339cff)
```

**所有键盘聚焦的蓝色都来自这一条链**。详见 [03-colors.md](./03-colors.md)。

---

## Dropdown 状态机

### Radix UI 4 态(标准)

| 状态 | 触发 | 视觉 |
|---|---|---|
| **closed** | 默认 | `display:none`(Radix 控制) |
| **opening** | `data-state=open` 触发 | 0.32s `cubic-bezier(.23,1,.32,1)` + 30ms 延迟,从 `scale(0.98) opacity:0` 进入 |
| **open** | 静态显示 | trigger 按钮换 hover-background |
| **closing** | `data-state=closed` 触发 | Radix 反向动画(由 unmount 处理) |

### ModelPicker Dropdown 进入动画

```css
/* composer-approval-request-card-IKpIrw8U.pretty.css:298-313 */
._ModelPickerDropdownContent_1w4ob_203 {
  transform-origin: var(--radix-dropdown-menu-content-transform-origin);
  will-change: opacity, transform;                                    /* 显式 will-change */
  overflow: clip;
}
._ModelPickerDropdownContent_1w4ob_203[data-state=open] {
  animation: 0.32s cubic-bezier(0.23, 1, 0.32, 1) 30ms both _model-picker-dropdown-content-enter_1w4ob_1;
}
._ModelPickerDropdownContent_1w4ob_203._ReducedMotion_1w4ob_15 { animation: none }   /* reduced-motion */

@keyframes _model-picker-dropdown-content-enter_1w4ob_1 {
  0% { opacity: 0; transform: scale(0.98) }
  to { opacity: 1; transform: scale(1) }
}
```

### `data-state` 联动(选择器族)

```css
/* app-VS6Z-TiK.pretty.css:10955-11031 */
/* trigger 按钮 open 时换背景 */
.data-\[state\=open\]\:bg-token-list-hover-background[data-state=open] {
  background-color: var(--color-token-list-hover-background)
}
.data-\[state\=open\]\:\!text-token-foreground[data-state=open] {
  color: var(--color-token-foreground) !important
}

/* tooltip delayed-open(等待悬停时延后展开) */
.group-data-\[state\=delayed-open\]\:h-\[30px\]:is(:where(.group)[data-state=delayed-open] *) { height: 30px }
.group-data-\[state\=delayed-open\]\:opacity-100:is(:where(.group)[data-state=delayed-open] *) { opacity: 1 }

/* has-[data-state=open] 父级联动 */
.has-\[\[data-state\=open\]\]\:pointer-events-auto:has([data-state=open]) { pointer-events: auto }
.has-\[\[data-state\=open\]\]\:opacity-100:has([data-state=open]) { opacity: 1 }
.group-has-\[\[data-state\=open\]\]\:opacity-0:is(:where(.group):has([data-state=open]) *) { opacity: 0 }

/* Checkbox / Radio 切换 */
.data-\[state\=checked\]\:\!bg-token-charts-blue[data-state=checked] {
  border-color: var(--color-token-charts-blue) !important
}
.data-\[state\=unchecked\]\:translate-x-0[data-state=unchecked] {
  --tw-translate-x: 0;
  translate: var(--tw-translate-x) var(--tw-translate-y)
}
```

### Dropdown 完整 recipe(从 DROPDOWN.md)

| 部件 | Token / 类 | 解析值(dark) |
|---|---|---|
| Content shell | `bg-token-dropdown-background text-token-foreground rounded-2xl shadow-xl-spread` | `color-mix(in oklab, gray-800 96%, transparent)` ≈ `#212121f5` + 20px 圆角 + `0 0 0 .5px border + shadow-xl` |
| Glass variant | `backdrop-blur-sm` | `blur(8px)` |
| Item | `rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm` | 12.5px 圆角 + 8px/6px padding + 12px 字号 |
| Item min-height | `min-h-[32px]` | 32px |
| Width (sidebar overflow) | `w-[188px]` | 188px |
| Width (project action) | `w-[200px]` | 200px |
| Width (project picker) | `w-[280px]` | 280px |
| Width (mode switch) | `min(260px, var(--sidebar-w-16))` | 动态 |

### Item 状态机(从 codex-dropdown.css)

```css
.codex-dropdown__item {
  /* default */
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background-color 80ms ease, color 80ms ease;        /* 80ms 极快 */
}
.codex-dropdown__item:hover,
.codex-dropdown__item:focus-visible {
  background: color-mix(in srgb, #fff 7%, transparent);          /* 7% 白叠层 */
  color: #fff;
}

/* 选中态:仅 leading check icon,不填背景(radio 行为) */
.codex-dropdown__item.radio-item.checked,
.codex-dropdown__item.radio-item[aria-checked="true"] {
  background: transparent;
  color: #fff;
}

/* 危险操作(danger)仅在 hover 时变色 */
.codex-dropdown__item.danger { color: var(--text-2); }
.codex-dropdown__item.danger:hover {
  background: color-mix(in srgb, #fff 7%, transparent);
  color: var(--text);
}

/* Leading icon opacity 状态切换 */
.codex-dropdown__icon { opacity: 0.75; }
.codex-dropdown__item:hover .codex-dropdown__icon,
.codex-dropdown__item:focus-visible .codex-dropdown__icon { opacity: 1; }

.codex-dropdown__check { opacity: 0.75; }
.codex-dropdown__item:hover .codex-dropdown__check,
.codex-dropdown__item:focus-visible .codex-dropdown__check,
.codex-dropdown__item.checked .codex-dropdown__check { opacity: 1; }
.codex-dropdown__check.invisible { visibility: hidden !important; opacity: 0 !important; }

/* Project picker selected(与 radio 不同,这里才用浅灰填充) */
.codex-dropdown--picker .project-selector-item.selected,
.codex-dropdown--picker .project-selector-action.selected {
  background: color-mix(in srgb, var(--gray-0) 6%, transparent);
  color: var(--text);
}
```

### Dropdown 进入动画

```css
@keyframes codex-dropdown-in {
  from { opacity: 0; transform: translateY(-3px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}
.codex-dropdown {
  animation: codex-dropdown-in 140ms cubic-bezier(0.19, 1, 0.22, 1);   /* 140ms ease-enter */
}
@media (prefers-reduced-motion: reduce) {
  .codex-dropdown { animation: none; }
}
```

### 关键规则

- **transition 80ms**:dropdown item 的 hover 过渡比通用 150ms 更快,因为 dropdown 是"快速扫描"场景
- **选中态不填背景**:radio 行为仅显示 check icon,不填背景(避免"两个高亮");project picker 选中才填浅灰
- **danger 仅 hover 变色**:平时与普通 item 同色,hover 时才升级为 `--text`(主色),避免危险操作"看起来很显眼"
- **icon opacity 阶梯**:default 0.75 → hover/focus 1.0,提供"次要元素随主元素激活"的视觉

---

## List Row 状态机

### cmdk list item 完整状态机(8 态)

```css
/* cmdk-uRuhKLE-.pretty.css:52-100 */
[cmdk-item] {
  content-visibility: auto;                              /* 性能:不在视口时跳过渲染 */
  border-radius: var(--radius-lg);
  width: 100%;
  cursor: var(--cursor-interaction);
  color: var(--color-token-foreground);
  padding: var(--padding-row-y) var(--padding-row-x);
  min-height: calc(var(--spacing) * 6);
  user-select: none;
  opacity: 0.75;                                          /* default:0.75 */
  outline: none;
  display: flex;
  align-items: center;
}

/* disabled / aria-disabled / data-disabled 三种等价表达 */
[cmdk-item][aria-disabled=true],
[cmdk-item][data-disabled=true] {
  cursor: default;
  opacity: 0.25;                                          /* 强禁用 */
}

/* hover / 选中 / 键盘聚焦 / 按下 都用同一 hover background */
[cmdk-item]:hover:not([aria-disabled=true]),
[cmdk-item][data-selected=true],
[cmdk-item][aria-selected=true],
[cmdk-item]:focus-visible,
[cmdk-item]:active:not([aria-disabled=true]) {
  background-color: var(--color-token-list-hover-background);
  opacity: 1;
}

/* loading 状态:不可点击,但保持 0.6 透明 */
[cmdk-item][data-command-menu-loading=true],
[cmdk-item][data-command-menu-loading=true]:hover,
[cmdk-item][data-command-menu-loading=true][data-selected=true],
[cmdk-item][data-command-menu-loading=true][aria-selected=true],
[cmdk-item][data-command-menu-loading=true]:focus-visible,
[cmdk-item][data-command-menu-loading=true]:active {
  cursor: default;
  opacity: 0.6;
  background-color: transparent;
}

/* 空状态:不可交互,但保持完整可见 */
[cmdk-item][data-command-menu-empty-state=true],
[cmdk-item][data-command-menu-empty-state=true]:hover,
[cmdk-item][data-command-menu-empty-state=true][data-selected=true],
[cmdk-item][data-command-menu-empty-state=true][aria-selected=true],
[cmdk-item][data-command-menu-empty-state=true]:focus-visible,
[cmdk-item][data-command-menu-empty-state=true]:active {
  cursor: default;
  opacity: 1;
  background-color: transparent;
}
```

### 状态矩阵

| 状态 | opacity | background | cursor | 触发 |
|---|---|---|---|---|
| **default** | 0.75 | transparent | pointer | 无 |
| **hover** | 1 | list-hover-background | pointer | `:hover` |
| **selected** | 1 | list-hover-background | pointer | `[data-selected=true]` 或 `[aria-selected=true]` |
| **focus(键盘)** | 1 | list-hover-background | pointer | `:focus-visible` |
| **active(按下)** | 1 | list-hover-background | pointer | `:active` |
| **disabled** | 0.25 | transparent | default | `[aria-disabled=true]` 或 `[data-disabled=true]` |
| **loading** | 0.6 | transparent | default | `[data-command-menu-loading=true]` |
| **empty-state** | 1 | transparent | default | `[data-command-menu-empty-state=true]` |

**关键**:`hover` / `selected` / `focus-visible` / `active` **共享同一背景色**——这是 Codex 列表的"统一反馈"哲学,用户用任何方式激活行都看到相同视觉。

### List Token 三档

```css
/* tokens.css:385-389 */
--color-token-list-focus-outline:                var(--vscode-list-focusOutline);                /* 键盘聚焦描边 */
--color-token-list-active-selection-background: var(--vscode-list-activeSelectionBackground);   /* 当前选中行 */
--color-token-list-active-selection-foreground: var(--vscode-list-activeSelectionForeground);
--color-token-list-hover-background:             var(--vscode-list-hoverBackground);             /* hover 临时 */
```

| Token | 用途 | 使用边界 |
|---|---|---|
| `hover-background` | 临时 hover | `:hover` / `:focus-visible` / `:active` |
| `active-selection-background` | 当前选中行 | 持久选中(非临时) |
| `focus-outline` | 键盘聚焦描边 | `:focus-visible` 的 outline |

### hover background 多档透明

```css
/* app-VS6Z-TiK.pretty.css:5384-5404 */
.bg-token-list-hover-background\/20 {
  background-color: color-mix(in oklab, var(--color-token-list-hover-background) 20%, transparent)
}
.bg-token-list-hover-background\/50 {
  background-color: color-mix(in oklab, var(--color-token-list-hover-background) 50%, transparent)
}
.bg-token-list-hover-background\/60 {
  background-color: color-mix(in oklab, var(--color-token-list-hover-background) 60%, transparent)
}
```

**用途**:
- 20%:可点击行的整体 hover overlay(保留卡片内容可读性)
- 50%:中度强调(如 sidebar 已选中行 hover)
- 60%:强强调(稀有用例)

### Sidebar 行的 selected 与 group 联动

```css
/* app-VS6Z-TiK.pretty.css:9644-9648, 9679-9683 */
/* selected 时子元素 visibility 切换 */
.group-aria-\[selected\=true\]\:visible:is(:where(.group)[aria-selected=true] *) {
  visibility: visible
}
.group-data-\[selected\=true\]\:visible:is(:where(.group)[data-selected=true] *) {
  visibility: visible
}

/* hover/focus-within 才解锁 pointer-events */
.group-\[\:not\(\:hover\)\:not\(\:focus-within\)\]\:pointer-events-none:is(:where(.group):not(:hover):not(:focus-within) *) {
  pointer-events: none
}
```

**机制**:已选中的行**仅控制子元素 visibility**(如 action button 显示),但 `pointer-events` 仍开,允许 hover。只有 hover 或 focus-within 时才解锁子元素的 pointer-events。

### Thread Navigation Rail Marker 状态机(进阶)

```css
/* thread-user-message-navigation-rail-CZzXjFhl.pretty.css */
._marker_1q3nl_1 {
  --marker-progress: 0;                                                    /* CSS 变量驱动 */
  width: 26px;
  transform: scaleX(calc(0.2308 + 0.7692 * var(--marker-progress)));     /* 0.23-1.0 范围 */
  transform-origin: 0;
  transition: transform 0.16s linear(0, .398 10%, .682 20%, .843 30%, .925 40%, .972 50%, 1.004 60%, 1.008 70%, 1.003 80%, 1);
}

/* 邻近 hover 行展开(基于 :has(+...) 选择器做距离判定) */
:is(._row_1q3nl_43:has(+._row_1q3nl_43[data-scrub-target]), ._row_1q3nl_43[data-scrub-target]+._row_1q3nl_43) ._marker_1q3nl_1 {
  --marker-progress: 0.7;                                                  /* 邻近 1 行:0.7 */
}
:is(._row_1q3nl_43:has(+._row_1q3nl_43+._row_1q3nl_43[data-scrub-target]), ...) ._marker_1q3nl_1 {
  --marker-progress: 0.4;                                                  /* 邻近 2 行:0.4 */
}
:is(._row_1q3nl_43:has(+...+...+...[data-scrub-target]), ...) ._marker_1q3nl_1 {
  --marker-progress: 0.2;                                                  /* 邻近 3 行:0.2 */
}

/* 当前/选中行 */
:is(._row_1q3nl_43:focus-visible, ._row_1q3nl_43[data-scrub-target]) ._marker_1q3nl_1 {
  --marker-progress: 1;                                                    /* 当前:1.0 */
}

/* scrubbing 状态:关闭 transition */
._railList_1q3nl_93[data-scrubbing] ._marker_1q3nl_1 { transition-duration: 0s }

/* 非 hover 的当前行变灰(opacity 0.4) */
@media (hover:hover) and (pointer:fine) {
  ._railList_1q3nl_93:not([data-scrubbing]):hover
    ._row_1q3nl_43[aria-current=true]:not(:hover):not(:focus-visible) ._marker_1q3nl_1 {
    background-color: var(--color-token-description-foreground);
    opacity: 0.4;
  }
  ._railList_1q3nl_93:not([data-scrubbing]) ._row_1q3nl_43:hover ._marker_1q3nl_1 {
    --marker-progress: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  ._marker_1q3nl_1 { transition-duration: 0s }
}
```

**亮点**:
- 用 `--marker-progress` CSS 变量(0-1)驱动 scaleX, scale 范围 0.23-1.0
- 邻近 hover 行展开 0.7 / 0.4 / 0.2(基于 `:has(+...)` 选择器做距离判定)
- 当前/选中行 `[aria-current=true]` 在非 hover 时变为 `opacity:0.4` 的灰色,弱化已读
- scrubbing 状态下关闭 transition,做即时响应

---

## Input / Composer 状态机

### ProseMirror placeholder 状态

```css
/* prompt-editor-DD1RABrS.pretty.css */
.ProseMirror .placeholder {
  pointer-events: none;
  user-select: none;
  position: relative;
}
.ProseMirror .placeholder:after {
  color: var(--color-token-input-placeholder-foreground);
  content: attr(data-placeholder);                                       /* 由 data-placeholder 驱动 */
  opacity: 0.5;                                                            /* 区分 empty 状态 */
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 100%;
  position: absolute;
  inset: 0 0 auto;
  overflow: hidden;
}
.ProseMirror .placeholder::selection {
  color: inherit;
  background: transparent;                                                /* placeholder 不可选 */
}
```

**机制**:placeholder 用 `data-placeholder` 属性驱动,`opacity:0.5` 区分 empty 状态。typing 后 placeholder 自动消失(由 ProseMirror DOM 控制)。

### Invalid 输入框

```css
/* app-VS6Z-TiK.pretty.css:10909-10919 */
.aria-invalid\:border-token-error-foreground[aria-invalid=true] {
  border-color: var(--color-token-error-foreground)                       /* 红边 */
}
.aria-invalid\:ring-2[aria-invalid=true] {
  --tw-ring-shadow: 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);
  box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
}
.aria-invalid\:ring-token-error-foreground\/20[aria-invalid=true] {
  --tw-ring-color: color-mix(in oklab, var(--color-token-error-foreground) 20%, transparent)  /* 20% 红色 ring */
}
```

**机制**:`aria-invalid="true"` 触发红边 + 2px ring(20% 透明的 error 色),不破坏 layout。

### Input Token

```css
/* tokens.css:162-170 */
--color-token-input-background:                          var(--vscode-input-background);
--color-token-input-border:                              var(--vscode-input-border, transparent);
--color-token-input-foreground:                         var(--vscode-input-foreground);
--color-token-input-placeholder-foreground:             var(--vscode-input-placeholderForeground);
--color-token-input-validation-error-background:        var(--vscode-inputValidation-errorBackground);
--color-token-input-validation-error-border:            var(--vscode-inputValidation-errorBorder);
--color-token-input-validation-info-background:          var(--vscode-inputValidation-infoBackground);
--color-token-input-validation-warning-background:      var(--vscode-inputValidation-warningBackground);
--color-token-input-validation-warning-border:         var(--vscode-inputValidation-warningBorder);
```

### Input focus 蓝色 ring

```css
/* tokens.css:153 */
--color-token-focus-border: var(--vscode-focusBorder);    /* = var(--color-border-focus) = var(--blue-300) = #339cff */

/* app-VS6Z-TiK.pretty.css:7755-7756, 8884 */
.ring-token-focus-border {
  --tw-ring-color: var(--color-token-focus-border)
}
.\[--color-ring\:var\(--color-token-focus-border\)\] {
  --color-ring: var(--color-token-focus-border)
}
```

**机制**:composer 在 focused 时叠加 1-2px 的 `--color-token-focus-border` 蓝色 ring,与 invalid 的 2px error ring **互斥**(各自只通过 `aria-invalid`/`:focus-visible` 切换 ring color,而非叠加)。

### Composer footer 的 hover/data-state 联动

```css
/* composer-footer-DqStEw03.pretty.css:20-23 */
._homeUtilityBar_uoylu_2 ._utilityBarLabel_uoylu_2:enabled:hover ._dropdownLabelValue_uoylu_2,
._homeUtilityBar_uoylu_2 ._utilityBarLabel_uoylu_2:enabled[data-state=open] ._dropdownLabelValue_uoylu_2 {
  color: var(--color-token-foreground);                                    /* 升级为主色 */
}
```

**机制**:composer 底部 dropdown trigger **在 `:hover` 和 `[data-state=open]` 时把次要文字(`--color-token-text-tertiary`)升级为 foreground 主色**,实现"展开 = 高亮"的视觉提示。

### Composer 容器状态(single-line ↔ multi-line)

```css
/* composer-layout-B6-UZ6B5.pretty.css */
._multilineSurface_1qb5a_2 {
  --composer-border-radius: var(--radius-3xl);                            /* 25px(multi-line) */
  border-radius: var(--composer-border-radius);
}
._singleLineRadiusSurface_1qb5a_2 {
  --composer-border-radius: var(--radius-token-composer-single-line);     /* 22px(single-line) */
  border-radius: var(--composer-border-radius);
}
._attachmentsDefault_1qb5a_2 {
  --composer-attachment-inset: calc(var(--spacing) * 2);
  --composer-attachment-border-radius: max(0px, calc(var(--composer-border-radius) - var(--composer-attachment-inset)));
  padding: var(--composer-attachment-inset);
  padding-bottom: calc(var(--spacing) * 1.5);
}

/* corner-shape: superellipse(实验性) */
@supports (corner-shape: superellipse(1.5)) {
  ._multilineSurface_1qb5a_2,
  ._attachmentsDefault_1qb5a_2 .composer-attachment-surface {
    corner-shape: var(--codex-corner-shape);
  }
}

/* footer 用 container query 切换可见性 */
._footer_1qb5a_2 {
  container: composer-footer/inline-size;
}
@container composer-footer (width <= 440px) {
  ._footerLabel_1qb5a_2 { display: none }                                  /* 窄屏隐藏 label */
}
```

**机制**:
- **容器圆角用 CSS 变量驱动**:multi-line 25px,single-line 22px
- **attachment 圆角 = 容器圆角 - inset**:保持视觉一致
- **corner-shape: superellipse**:实验性超椭圆,支持时启用(更圆润)
- **container query 切换**:footer 在 440px / 475px / 300px / 420px 多个断点切换元素可见性

### Composer 5 态总结

| 状态 | 触发 | 视觉变化 |
|---|---|---|
| **empty** | 无内容 | placeholder `opacity:0.5`,发送按钮 `inactive` |
| **typing** | 输入中 | placeholder 消失,发送按钮切到 `default` |
| **focused** | `:focus-visible` | 1-2px 蓝色 ring(`--color-token-focus-border`) |
| **invalid** | `aria-invalid="true"` | 红边 + 2px 20% 红色 ring(替代 focus ring) |
| **submitting** | 异步提交中 | 发送按钮替换为 spinner(`animate-spin`),整框 `aria-busy` 不用 |
| **disabled** | `:disabled` | `cursor:not-allowed` + `opacity:0.4` |

---

## Link 与可点击区域

### Link 默认无下划线

```css
/* tokens.css:210-213 */
--color-token-text-link-foreground:          var(--vscode-textLink-foreground);
--color-token-text-link-active-foreground:   var(--vscode-textLink-activeForeground);
--text-link-decoration: none;                               /* 默认无下划线 */
```

### Hover 下划线族

```css
/* app-VS6Z-TiK.pretty.css:9448-9457, 10416-10419 */
/* group-hover 触发下划线 */
.group-hover\/inline-mention\:underline:is(:where(.group\/inline-mention):hover *) {
  text-decoration-line: underline
}
.group-hover\/inline-mention\:decoration-current:is(:where(.group\/inline-mention):hover *) {
  text-decoration-color: currentColor
}
.group-hover\/inline-mention\:decoration-dashed:is(:where(.group\/inline-mention):hover *) {
  text-decoration-style: dashed                              /* 虚线 */
}
.group-hover\/inline-mention\:decoration-\[0\.5px\]:is(:where(.group\/inline-mention):hover *) {
  text-decoration-thickness: 0.5px
}
.group-hover\/inline-mention\:underline-offset-2:is(:where(.group\/inline-mention):hover *) {
  text-underline-offset: 2px
}

.hover\:underline:hover { text-decoration-line: underline }
.hover\:no-underline:hover { text-decoration-line: none }
```

### 下划线工具类

```css
/* app-VS6Z-TiK.pretty.css:7019-7024 */
.underline-offset-2 { text-underline-offset: 2px }
.underline-offset-4 { text-underline-offset: 4px }
.underline-offset-\[2px\] { text-underline-offset: 2px }

.decoration-\[1px\] { text-decoration-thickness: 1px }
```

### 可点击行整行 hover overlay

```css
/* app-VS6Z-TiK.pretty.css:9399-9409 */
.group-hover\/end-resource\:bg-token-list-hover-background\/30:is(:where(.group\/end-resource):hover *) {
  background-color: color-mix(in oklab, var(--color-token-list-hover-background) 30%, transparent)
}
.group-hover\/file-attachment\:bg-token-list-hover-background\/30:is(:where(.group\/file-attachment):hover *) {
  background-color: color-mix(in oklab, var(--color-token-list-hover-background) 30%, transparent)
}
```

**机制**:可点击行用 `bg-token-list-hover-background` 的 **30% 透明** 叠加做 hover overlay,而非直接换底色——这保证了行内的卡片 / 图像仍可见,只是表面覆盖一层雾化。

### Forced-colors 备用(forced-colors 模式)

```css
/* app-VS6Z-TiK.pretty.css:10513-10516 */
@media (forced-colors: active) {
  .focus\:outline-hidden:focus {
    outline-offset: 2px;
    outline: 2px solid transparent;                          /* #0000 透明 */
  }
  .focus-visible\:outline-hidden:focus-visible {
    outline-offset: 2px;
    outline: 2px solid transparent;
  }
}
```

**`outline-hidden` 技巧**:在 forced-colors 模式下展示 2px 黑色 outline,在普通模式下隐藏。Codex 的可点击行用 `outline-hidden + focus-visible:outline-2 focus-visible:outline-token-focus-border` 三件套,实现"鼠标点击隐藏 outline / 键盘聚焦显示蓝色 2px outline + 2px offset"。

---

## Disabled 三态对比

### 三态完整对照

```css
/* ===== :disabled(真禁用) ===== */
.disabled\:cursor-default:disabled { cursor: default }
.disabled\:cursor-not-allowed:disabled { cursor: not-allowed }
.disabled\:cursor-wait:disabled { cursor: wait }                                /* 异步进行中 */

.disabled\:\!bg-black\/45:disabled { background-color: #00000073 !important }   /* 强制黑 45% */
.disabled\:bg-token-foreground\/5:disabled {
  background-color: color-mix(in oklab, var(--color-token-foreground) 5%, transparent)
}
.disabled\:\!text-white\/45:disabled {
  color: color-mix(in oklab, var(--color-white) 45%, transparent) !important
}
.disabled\:text-token-text-secondary:disabled { color: var(--color-token-text-secondary) }
.disabled\:text-token-text-tertiary:disabled  { color: var(--color-token-text-tertiary) }
.disabled\:no-underline:disabled { text-decoration-line: none }

/* opacity 分级 */
.disabled\:opacity-40:disabled  { opacity: 0.4 }                                /* 强禁用 */
.disabled\:opacity-50:disabled  { opacity: 0.5 }
.disabled\:opacity-60:disabled  { opacity: 0.6 }
.disabled\:opacity-70:disabled  { opacity: 0.7 }                                /* 弱禁用 */
.disabled\:opacity-100:disabled { opacity: 1 }                                   /* 仅换 cursor */

/* hover 在 disabled 上完全禁用 */
@media (hover: hover) {
  .disabled\:hover\:bg-transparent:disabled:hover { background-color: transparent }
  .disabled\:hover\:no-underline:disabled:hover { text-decoration-line: none }
}

/* ===== [aria-disabled="true"](视觉禁用) ===== */
.aria-disabled\:cursor-not-allowed[aria-disabled=true] { cursor: not-allowed }
.aria-disabled\:opacity-60[aria-disabled=true] { opacity: 0.6 }                 /* 仅 opacity,不换色 */

/* ===== peer-disabled(兄弟 disabled) ===== */
.peer-disabled\:cursor-not-allowed:is(:where(.peer):disabled~*) { cursor: not-allowed }
.peer-disabled\:opacity-70:is(:where(.peer):disabled~*) { opacity: 0.7 }

/* ===== group has disabled child ===== */
.group-has-\[\:disabled\]\:cursor-not-allowed:is(:where(.group):has(:disabled) *) {
  cursor: not-allowed
}
```

### 何时用什么

| 场景 | 选用 | opacity | cursor | 颜色变化 |
|---|---|---|---|---|
| 真禁用(不可点击) | `:disabled` | 0.4-0.7 | not-allowed | 可叠加 text-token-text-secondary/tertiary |
| 视觉禁用(JS 可拦截) | `[aria-disabled="true"]` | 0.6 | not-allowed | **不**自动改色 |
| 异步进行中 | `:disabled` + `cursor-wait` | 0.4 | wait | 可叠加 spinner |
| 弱禁用(toolbar) | `:disabled` + `opacity-70` | 0.7 | not-allowed | 不换色 |
| cmdk 禁用项 | `[aria-disabled=true]` 或 `[data-disabled=true]` | 0.25 | default | 不换色 |
| 仅换 cursor(标签旁禁用 icon) | `:disabled` + `opacity-100` | 1 | default | 不变 |

### opacity vs 颜色变浅

**Codex 优先用 opacity 而非颜色变浅**:

| opacity | 用途 |
|---|---|
| 0.7 | 弱禁用(toolbar 按钮,保留 70% 可读性) |
| 0.6 | 标准禁用(aria-disabled 默认值) |
| 0.5 | 中度禁用 |
| 0.4 | 强禁用(:disabled 默认值) |
| 0.25 | cmdk-item disabled(几乎仅占位) |
| 0 | 完全隐藏 |

**何时用颜色变浅**:仅当需要保留文字可读性时才用 `text-token-text-secondary` / `text-token-text-tertiary`,这种用法在 toolbar 按钮上更常见。

---

## Loading 状态谱系

### Codex 不用 `aria-busy`

经过对 `app-VS6Z-TiK.pretty.css`、`tokens.css`、`codex-design-system.css` 的搜索,Codex **没有定义任何 `.aria-busy` 或 `[aria-busy]` 选择器**。也就是说,Codex 没有采用 WAI-ARIA 的 `aria-busy` 属性来表达按钮/区域的 loading 状态,而是用专属类 + `data-*` 属性。

### Loading 状态分类

| 场景 | 选用 | 机制 |
|---|---|---|
| **整面板加载** | `.mcp-app-loading-pulse` | 3s 周期脉冲背景(dark 14% / light 7%) |
| **列表项加载** | `[data-command-menu-loading=true]` | opacity 0.6 + cursor default + 不换色 |
| **文本思考中** | `._cadencedShimmerActive` | 1s 一次性扫光(每 4s 触发,详见 [12-motion-depth.md](./12-motion-depth.md)) |
| **搜索结果占位** | `._loadingResultsShimmer` | 3s 线性扫光带 + `--loading-results-shimmer-delay` 错峰 |
| **魔法编辑提交中** | `.magic-edit-submitting .ProseMirror` | 2s `background-clip: text` 扫光 |
| **按钮内部 loading** | JS 替换 icon + `animate-spin` | icon 切换为 `loader.svg` + `animate-spin` 工具类 |
| **进度条** | `._statusPillProgress` | `transform: scaleX(1 → 0)` 从右往左收缩 |
| **进度环** | `._fillOnMount` + SVG `stroke-dashoffset` | 0.3s ease-out 从 100px 偏移到 0 |
| **后台活动指示** | `._dots_1888p_1` | 1.75s opacity 0.38 ↔ 0.56 呼吸 |
| **引导箭头** | `._uacArrow_1tl1k_1` | 1s alternate 模式上下往复 |

### cmdk-item loading 完整规则

```css
[cmdk-item][data-command-menu-loading=true],
[cmdk-item][data-command-menu-loading=true]:hover,
[cmdk-item][data-command-menu-loading=true][data-selected=true],
[cmdk-item][data-command-menu-loading=true][aria-selected=true],
[cmdk-item][data-command-menu-loading=true]:focus-visible,
[cmdk-item][data-command-menu-loading=true]:active {
  cursor: default;
  opacity: 0.6;
  background-color: transparent;                              /* 不填背景 */
}
```

**关键**:loading 状态下 **不替换图标、不替换文字**,而是把整个 item 设为 0.6 透明 + 不可点击,让用户感知到该项正在加载子项。

### MCP App Loading Pulse

```css
/* app-VS6Z-TiK.pretty.css:885-912 */
.mcp-app-loading-pulse {
  --mcp-app-loading-base: var(--color-token-main-surface-primary);
  --mcp-app-loading-peak: color-mix(in srgb, var(--color-token-description-foreground) 7%, var(--color-token-main-surface-primary));
  background-color: var(--mcp-app-loading-base);
  position: relative;
}
.mcp-app-loading-pulse:before {
  content: "";
  background-color: var(--mcp-app-loading-peak);
  opacity: 0;
  animation: 3s ease-in-out infinite mcp-app-loading-pulse;
  position: absolute;
  inset: 0;
}
.dark .mcp-app-loading-pulse {
  --mcp-app-loading-peak: color-mix(in srgb, var(--color-token-description-foreground) 14%, var(--color-token-main-surface-primary));
}
@media (prefers-reduced-motion: reduce) {
  .mcp-app-loading-pulse:before { animation: none }
}
@keyframes mcp-app-loading-pulse {
  0%, to { opacity: 0 }
  50%   { opacity: 1 }
}
```

**Dark 模式峰值更高**:14% vs 7%,补偿暗底对比度。

### Tailwind 标准 keyframes

```css
/* app-VS6Z-TiK.pretty.css:162-167 */
:root {
  --animate-spin:  spin 1s linear       infinite;
  --animate-ping:  ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
  --animate-pulse: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.animate-pulse { animation: var(--animate-pulse) }
.animate-spin  { animation: var(--animate-spin) }

@media (prefers-reduced-motion: no-preference) {
  .motion-safe\:animate-pulse { animation: var(--animate-pulse) }
  .motion-safe\:animate-spin  { animation: var(--animate-spin) }
}
```

**`motion-safe:` 反向写法**:仅在不偏好减少动效时启用,详见 [12-motion-depth.md](./12-motion-depth.md) 的 reduced-motion 章节。

---

## Focus 管理与键盘导航

### 模态对话框 ARIA + 键盘导航

```jsx
// ImagePreviewDialog.tsx
<div
  role="dialog"
  aria-modal="true"
  aria-label="图片预览"
  onKeyDown={(e) => {
    if (e.key === 'Escape') closeImagePreview();
    if (e.key === 'ArrowLeft')  previousImagePreview();
    if (e.key === 'ArrowRight') nextImagePreview();
    if (e.key === '+' || e.key === '=') setImagePreviewZoom(zoom + 25);
    if (e.key === '-')                     setImagePreviewZoom(zoom - 25);
  }}
>
  <button aria-label="上一张图片"   onClick={previousImagePreview} />
  <button aria-label="下一张图片"   onClick={nextImagePreview} />
  <button aria-label="缩小图片"     onClick={() => setImagePreviewZoom(zoom - 25)} />
  <button aria-label="放大图片"     onClick={() => setImagePreviewZoom(zoom + 25)} />
  <button aria-label="关闭图片预览" onClick={closeImagePreview} />
</div>
```

**键盘映射**:
- `Escape` → 关闭
- `ArrowLeft` / `ArrowRight` → 上/下一张
- `+` / `=` → 放大
- `-` → 缩小

### Composer 输入框键盘快捷键

```jsx
// Composer.tsx
<textarea
  aria-label="Work with ChatGPT"
  placeholder="继续对话"
  onKeyDown={(event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();                                              /* Enter 提交 */
    }
    if (event.key === 'Escape' && running) {
      event.preventDefault();
      onStop();                                              /* Escape 中止 */
    }
    if (event.key === '/') {
      setSlashMenuOpen(true);                                /* / 触发斜杠命令 */
      setMenuQuery('');
    }
    if (event.key === '@') {
      setMentionMenuOpen(true);                               /* @ 触发提及 */
      setMenuQuery('');
    }
  }}
  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-token-focus-border"
/>
```

**键盘映射**:
- `Enter` → 提交
- `Shift+Enter` → 换行
- `Escape`(运行中) → 中止
- `/` → 触发斜杠命令菜单
- `@` → 触发提及菜单

### Disclosure 折叠组件 ARIA(覆盖式 button 模式)

```jsx
// ToolActivityDisclosure.tsx
<div className="group/activity-header relative inline-flex max-w-full min-w-0 items-center gap-1 self-start">
  <button
    type="button"
    aria-label={disclosure.accessibleLabel}
    aria-labelledby={disclosure.accessibleLabel == null ? summaryId : undefined}
    aria-expanded={disclosure.expanded}
    className="absolute inset-0 cursor-interaction focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none focus-visible:ring-inset"
    onClick={disclosure.onToggle}
  />
  <InlineFlex className="text-size-chat pointer-events-none relative shrink truncate [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
    {iconSpan}
    {summarySpan}
  </InlineFlex>
  {accessory}
  <span className="pointer-events-none relative flex">
    <DisclosureChevron expanded={disclosure.expanded} />
  </span>
</div>

<div
  className={clsx(
    'transition-all duration-200 ease-out',
    effectiveExpanded ? 'overflow-visible' : 'overflow-hidden',
  )}
  style={{
    height: effectiveExpanded ? 'auto' : 0,
    opacity: effectiveExpanded ? 1 : 0,
    pointerEvents: effectiveExpanded ? 'auto' : 'none',
  }}
  aria-hidden={!effectiveExpanded}
  inert={!effectiveExpanded}                                  /* inert:折叠时对辅助技术隐藏 */
>
  <IndentContent ref={bodyRef} indent={indentContent}>
    {children}
  </IndentContent>
</div>
```

**ARIA 模式**:
- `aria-expanded`:标识折叠状态
- `aria-labelledby` / `aria-label`:为覆盖式 button 提供可访问名称
- `aria-hidden` + `inert`:双重控制,折叠时对辅助技术隐藏
- `focus-visible:ring-1`:键盘聚焦环(1px,比标准 2px 更细)

### Chevron 箭头聚焦可见性

```jsx
<Icon
  name="chevron-right"
  size={12}
  className={clsx(
    'icon-2xs shrink-0 text-token-conversation-body transition-transform duration-relaxed',
    'opacity-0 group-focus-visible/activity-header:opacity-100',                  /* 默认隐藏,聚焦显示 */
    'group-focus-visible/activity-header:text-token-foreground',
    'group-has-[:focus-visible]/activity-header:opacity-100',                      /* has 子元素聚焦 */
    '[@media(hover:hover)]:group-[:hover:not(:has([data-agent-activity-file-link]:hover))]/activity-header:opacity-100',
    expanded && 'rotate-90 opacity-100',
  )}
  aria-hidden="true"                                                              /* 装饰性图标 */
/>
```

### Diff 视图模式切换(aria-pressed)

```jsx
// Conversation.tsx
function DiffViewModeToolbar({ mode, onChange }) {
  return (
    <div className="diff-view-mode-toolbar" role="group" aria-label="Diff 视图模式">
      <button
        type="button"
        aria-label="切换到合并视图"
        aria-pressed={mode === 'unified'}
        className={clsx('diff-view-mode-btn', mode === 'unified' && 'active')}
        onClick={() => onChange('unified')}
      >
        <svg aria-hidden="true" /* ... */ />
        <span className="diff-view-mode-label">合并</span>
      </button>
      <button
        type="button"
        aria-label="切换到分栏视图"
        aria-pressed={mode === 'split'}
        className={clsx('diff-view-mode-btn', mode === 'split' && 'active')}
        onClick={() => onChange('split')}
      >
        <svg aria-hidden="true" /* ... */ />
        <span className="diff-view-mode-label">分栏</span>
      </button>
    </div>
  );
}
```

**`aria-pressed`**:用于 toggle button(切换按钮),`true` = 当前按下,`false` = 未按下。与 `aria-expanded`(折叠展开)语义不同。

### DiffFileItem 折叠头(条件 aria-expanded)

```jsx
<button
  type="button"
  className={clsx('turn-item-head', !hasPatch && 'static')}
  aria-expanded={hasPatch ? expanded : undefined}                  /* 仅可展开时设置 */
  onClick={hasPatch ? () => setExpanded((open) => !open) : undefined}
  disabled={!hasPatch}                                              /* 无 patch 时禁用 */
>
```

### 装饰性 SVG 统一 aria-hidden

```jsx
function OfficialMenuCheckIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"                                            /* 装饰性图标 */
      className="icon-xs"
    >
      <path d="M12.8961 3.64101..." fill="currentColor" />
    </svg>
  );
}
```

### 滚动回底按钮 aria-label

```jsx
{!isNearBottom && (
  <button
    className="scroll-bottom"
    aria-label="回到底部"
    onClick={scrollToBottom}
  >
    <Icon name="arrow-down" size={20} />
  </button>
)}
```

---

## ARIA 角色与属性对照

### Codex 使用的 ARIA 角色

| 角色 | 用途 | 例子 |
|---|---|---|
| `role="dialog"` | 模态对话框 | 图片预览、设置对话框 |
| `role="group"` | 按钮组 | Diff 视图模式切换 |
| `role="menu"` | 菜单 | 设置导航菜单 |
| `role="menuitem"` | 菜单项 | 设置菜单项 |
| `role="menuitemcheckbox"` | 可勾选菜单项 | 设置开关项 |
| `role="status"` | 状态提示 | 流式消息(隐式) |
| `role="alert"` | 紧急提示 | 错误提示 |
| `role="log"` | 日志 | 终端输出 |

### ARIA 属性使用

| 属性 | 用途 | 何时用 |
|---|---|---|
| `aria-label` | 可访问名称 | icon-only 按钮 |
| `aria-labelledby` | 关联可见 label | 复杂组件(覆盖式 button) |
| `aria-describedby` | 关联描述 | 表单字段 |
| `aria-expanded` | 折叠状态 | Disclosure / Dropdown trigger |
| `aria-controls` | 控制目标 ID | trigger → content 关联 |
| `aria-pressed` | 切换状态 | toggle button |
| `aria-selected` | 选中状态 | listbox option |
| `aria-current` | 当前位置 | navigation rail |
| `aria-hidden` | 辅助技术隐藏 | 装饰性元素、折叠内容 |
| `aria-modal` | 模态 | dialog |
| `aria-invalid` | 校验失败 | 输入框 |
| `aria-disabled` | 视觉禁用 | JS 拦截的禁用 |
| `aria-busy` | **Codex 不用** | 用专属类替代 |

### 键盘导航标准映射

| 组件 | 键 | 行为 |
|---|---|---|
| Dialog | `Escape` | 关闭 |
| Dialog | `Tab` | 焦点陷阱(在对话框内循环) |
| Dropdown | `Enter` / `Space` | 打开 |
| Dropdown | `Escape` | 关闭 |
| Dropdown | `ArrowDown` / `ArrowUp` | 移动高亮 |
| Dropdown | `Home` / `End` | 跳到首/末 |
| Listbox | `ArrowDown` / `ArrowUp` | 移动选中 |
| Listbox | `Enter` | 确认选中 |
| Tabs | `ArrowLeft` / `ArrowRight` | 切换 tab |
| Disclosure | `Enter` / `Space` | 切换展开 |
| Composer | `Enter` | 提交 |
| Composer | `Shift+Enter` | 换行 |
| Composer | `Escape`(运行中) | 中止 |
| Image preview | `+` / `-` | 缩放 |
| Image preview | `ArrowLeft` / `ArrowRight` | 上/下一张 |

---

## 状态转移图(Statechart)

### Button 状态转移图

```
                    ┌─────────────┐
                    │   default   │ ← 初始
                    └──────┬──────┘
                           │ mouseenter
                           ↓
                    ┌─────────────┐
                    │    hover    │
                    └──────┬──────┘
                           │ mousedown
                           ↓
                    ┌─────────────┐
                    │   active    │ (scale 0.98)
                    └──────┬──────┘
                           │ mouseup
                           ↓
                    ┌─────────────┐
                    │    hover    │
                    └──────┬──────┘
                           │ mouseleave
                           ↓
                    ┌─────────────┐
                    │   default   │
                    └─────────────┘

                    ┌─────────────┐
                    │   disabled  │ ← :disabled
                    │ opacity:0.4 │
                    │ cursor:     │
                    │ not-allowed │
                    └─────────────┘
                    (hover 完全失效)

                    ┌─────────────┐
                    │   inactive  │ ← 输入框为空
                    │  opacity:1  │
                    │ bg:3% 透明  │
                    └─────────────┘

                    键盘路径:
                    default → focus-visible (2px 蓝色 ring + hover bg)
                            → active (Enter/Space)
                            → focus-visible
                            → default (blur)
```

### Dropdown 状态转移图

```
                    ┌─────────────┐
                    │   closed    │ ← 初始
                    └──────┬──────┘
                           │ Enter/Space/click
                           ↓
                    ┌─────────────┐
                    │  opening    │ (data-state=open,30ms 延迟)
                    │ 0.32s ease  │
                    │ scale(.98)  │
                    │ → scale(1)  │
                    └──────┬──────┘
                           │ animationend
                           ↓
                    ┌─────────────┐
                    │    open     │ (trigger 切 hover bg)
                    └──────┬──────┘
                           │ Escape/click outside/select
                           ↓
                    ┌─────────────┐
                    │  closing    │ (data-state=closed,Radix unmount)
                    └──────┬──────┘
                           │ unmount
                           ↓
                    ┌─────────────┐
                    │   closed    │
                    └─────────────┘

                    键盘路径(在 open 状态):
                    open → ArrowDown → 高亮下移
                         → ArrowUp   → 高亮上移
                         → Home      → 跳到首项
                         → End       → 跳到末项
                         → Enter     → 选中并关闭
                         → Escape    → 关闭不选中
```

### List Row 状态转移图

```
                    ┌─────────────┐
                    │   default   │ opacity:0.75
                    │             │ bg:transparent
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ↓            ↓            ↓
        mouseenter   focus-visible   data-selected
              │            │            │
              └────────────┼────────────┘
                           ↓
                    ┌─────────────┐
                    │   active    │ opacity:1
                    │             │ bg:list-hover-background
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ↓            ↓            ↓
        mouseleave    blur         unselected
              │            │            │
              └────────────┼────────────┘
                           ↓
                    ┌─────────────┐
                    │   default   │
                    └─────────────┘

                    特殊状态:
                    ┌─────────────┐
                    │  disabled   │ opacity:0.25
                    │             │ cursor:default
                    └─────────────┘

                    ┌─────────────┐
                    │   loading   │ opacity:0.6
                    │             │ cursor:default
                    │             │ bg:transparent
                    └─────────────┘

                    ┌─────────────┐
                    │ empty-state │ opacity:1
                    │             │ cursor:default
                    │             │ bg:transparent
                    └─────────────┘
```

### Composer 状态转移图

```
                    ┌─────────────┐
                    │    empty    │ placeholder:opacity:0.5
                    │             │ send button:inactive
                    └──────┬──────┘
                           │ input
                           ↓
                    ┌─────────────┐
                    │   typing    │ placeholder:hidden
                    │             │ send button:default
                    └──────┬──────┘
                           │ focus
                           ↓
                    ┌─────────────┐
                    │   focused   │ 2px 蓝色 ring
                    └──────┬──────┘
                           │ validation fail
                           ↓
                    ┌─────────────┐
                    │   invalid   │ 红边 + 2px 20% 红色 ring
                    │             │ (替代 focus ring)
                    └──────┬──────┘
                           │ Enter
                           ↓
                    ┌─────────────┐
                    │ submitting  │ send button → spinner
                    │             │ (animate-spin)
                    └──────┬──────┘
                           │ response done
                           ↓
                    ┌─────────────┐
                    │    empty    │
                    └─────────────┘
```

---

## Do / Don't

### Do

```css
/* 状态用 CSS 变量分层 */
.btn {
  background: var(--color-background-button-primary);
}
.btn:hover {
  background: var(--color-background-button-primary-hover);
}
.btn:active {
  background: var(--color-background-button-primary-active);
}

/* :focus 与 :focus-visible 严格区分 */
.btn {
  focus:outline-none;                                    /* 鼠标点击隐藏 outline */
}
.btn:focus-visible {
  outline: 2px solid var(--color-token-focus-border);   /* 仅键盘聚焦显示 */
  outline-offset: 2px;
}

/* :disabled 与 [aria-disabled] 区分 */
.btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.btn[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.6;                                          /* 仅视觉,JS 可拦截 */
}
```

```jsx
/* 装饰性 SVG aria-hidden */
<svg aria-hidden="true" /* ... */ />

/* icon-only 按钮 aria-label */
<button aria-label="关闭" onClick={onClose}>
  <Icon name="x" aria-hidden="true" />
</button>

/* Disclosure 用 aria-expanded + inert */
<button aria-expanded={expanded} onClick={toggle} />
<div aria-hidden={!expanded} inert={!expanded}>...</div>

/* Toggle button 用 aria-pressed */
<button aria-pressed={isActive} onClick={toggle} />
```

### Don't

```css
/* ❌ 用 rgba 而非 color-mix(in oklab) */
.btn:hover { background: rgba(255, 255, 255, 0.08); }

/* ❌ :disabled 与 [aria-disabled] 混用 */
.btn[aria-disabled="true"] {
  pointer-events: none;                                  /* 应该:允许 JS 拦截 */
}

/* ❌ :focus 与 :focus-visible 不区分 */
.btn:focus {
  outline: 2px solid blue;                               /* 鼠标点击也会触发 */
}

/* ❌ hover 在 disabled 上仍生效 */
.btn:disabled:hover {
  background: var(--hover-bg);                          /* 应该:hover 完全失效 */
}

/* ❌ 用 aria-busy 表达 loading(Codex 不用) */
.btn[aria-busy="true"] { /* ... */ }
/* 应该:用专属类 .mcp-app-loading-pulse 或 data-command-menu-loading */
```

```jsx
/* ❌ 装饰性 SVG 缺 aria-hidden */
<svg /* ... */ />

/* ❌ icon-only 按钮缺 aria-label */
<button onClick={onClose}>
  <Icon name="x" />
</button>

/* ❌ 折叠组件缺 inert */
<button aria-expanded={expanded} onClick={toggle} />
<div aria-hidden={!expanded}>...</div>                   /* 缺 inert,辅助技术仍可聚焦 */

/* ❌ Toggle button 用 aria-expanded */
<button aria-expanded={isActive} onClick={toggle} />     /* 应该:aria-pressed */
```

---

## 与 07 的关系

| 07 解决 | 13 解决 |
|---|---|
| 组件尺寸 / 圆角 / 配色 | 状态机 / 状态间转移 / 键盘驱动 |
| 单条 component recipe | 完整状态矩阵 |
| 标准 disabled / hover | 三态 disabled / loading / empty-state |
| 基础 ARIA | 完整 ARIA 角色 + 属性 + 键盘映射 |

**阅读顺序**:先读 07 建立组件形态认知,再读 13 解决状态维度。两份文档互补,不替代。
