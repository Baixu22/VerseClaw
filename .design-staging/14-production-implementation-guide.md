# 14 — 生产实现指南

> 本文是把前 13 份设计文档**落地到生产代码**的工程指南。01-09 解决"设计应该是什么",10-11 解决"现状有什么问题、如何分阶段迁移",12-13 解决"动效与状态机深度",**14 解决"如何在工程层面保证实现质量不退化"**。
>
> 来源:基于 ClawX 的 `AGENTS.md` 工程规范、`package.json` 脚本体系、`harness/specs/` 验证框架,以及 Codex 源码中提取的工程实践模式。
>
> **核心原则**:每个 UI 变更必须伴随 E2E 覆盖;每个 token 变更必须跑 `pnpm contract:check`;每个动效变更必须跑 reduced-motion 验证;**功能未覆盖测试不算完成**。

---

## 目录

1. [生产实现哲学](#生产实现哲学)
2. [工程清单(Per-Component)](#工程清单per-component)
3. [质量门(Quality Gates)](#质量门quality-gates)
4. [测试策略](#测试策略)
5. [性能预算与验证](#性能预算与验证)
6. [无障碍验收清单](#无障碍验收清单)
7. [代码评审检查表](#代码评审检查表)
8. [风险管理与回滚策略](#风险管理与回滚策略)
9. [生产就绪检查表](#生产就绪检查表)
10. [常见陷阱与解决方案](#常见陷阱与解决方案)

---

## 生产实现哲学

### 三条工程铁律

1. **测试驱动 UI 变更**
   - 任何用户可见的 UI 变更必须包含或更新一个 Electron E2E spec
   - 交互行为(点击 / 键盘 / hover)必须有对应的 Playwright 用例
   - 视觉回归关键路径(sidebar / composer / dropdown)必须有截图快照

2. **Token 变更走契约检查**
   - 任何 `tokens.css` / `host-api.ts` / `shared/host-api/contract.ts` 的变更必须跑 `pnpm contract:check`
   - 语义 token 新增必须同步更新 [02-tokens.md](./02-tokens.md)
   - 别名 token(`--sp-*` / `--ccm-*` 等)必须最终指向 Layer 2 语义 token,不能指向 Layer 1 raw hex

3. **动效变更走 reduced-motion 验证**
   - 任何新增 `transition` / `animation` 必须带 `prefers-reduced-motion` 旁路
   - 周期性动画必须验证在 reduced-motion 下**完全关闭**(非"跑一次")
   - `will-change` 必须显式声明且动画后清理

### 与 Codex 源码的对齐策略

Codex 源码不是"参考",而是**单一真实来源(Single Source of Truth)**:

| 来源 | 角色 | 可信度 |
|---|---|---|
| `FakeCoding-main/codex-reference/tokens.css` | token 字典 | 100%(PostCSS 原始输出) |
| `FakeCoding-main/codex-reference/css/*.css` | 组件 CSS | 100%(MSIX 提取) |
| `FakeCoding-main/codex-conversation-render/` | JS 逻辑 | 100%(asar 提取) |
| `FakeCoding-main/web/src/codex-dropdown.css` | FakeCoding 端复刻 | 95%(已验证对齐) |
| 本设计文档(01-13) | ClawX 迁移依据 | 派生自信源 |

**冲突解决**:当本设计与 Codex 源码冲突时,以 Codex 源码为准;当 ClawX 现有代码与本设计冲突时,以本设计为准(除非有明确的 ClawX-specific 取舍记录在 [10-current-audit.md](./10-current-audit.md))。

---

## 工程清单(Per-Component)

> 实现/修改每个组件时,逐项核对清单。

### 通用清单(所有组件)

```
□ 1. 引用 Layer 2 语义 token(var(--color-text-foreground)),不引 Layer 1 raw hex(var(--gray-0))
□ 2. 主题切换走 .electron-dark / .electron-light,不写 dark: 双声明
□ 3. 圆角用 token(var(--radius-2xl)),不写硬编码值(20px)
□ 4. 间距用 token(var(--spacing) * 2),不写硬编码值(8px)
□ 5. 阴影用 token(var(--shadow-xl-spread)),不写自定义 shadow
□ 6. 透明叠加用 color-mix(in oklab, ...),不用 rgba()
□ 7. 动效走 token(var(--default-transition-duration)),不带硬编码时长(0.15s)
□ 8. 所有 transition/animation 带 prefers-reduced-motion 旁路
□ 9. will-change 显式声明且动画后清理
□ 10. z-index 走阶(var(--z-dropdown)),不写硬编码值(z-50)
```

### Button 组件清单

```
□ 1. 变体落到 4 种之一(primary / secondary / tertiary / icon),没有第 5 种
□ 2. 4 档 token 完整(-default / -hover / -active / -inactive)
□ 3. :hover 用 var(--color-background-button-*-hover)
□ 4. :active 用 var(--color-background-button-*-active) + active:scale-[0.98]
□ 5. :disabled 用 cursor:not-allowed + opacity:0.4,hover 完全失效
□ 6. :focus-visible 用 2px var(--color-token-focus-border) outline + 2px offset
□ 7. focus:outline-none 强制隐藏鼠标点击的 outline
□ 8. icon-only 按钮必须有 aria-label
□ 9. loading 状态用 JS 替换 icon + animate-spin,不用 aria-busy
□ 10. reduced-motion 下 active:scale-100(不缩放)
```

### Dropdown 组件清单

```
□ 1. 容器用 bg-token-dropdown-background + rounded-2xl(20px) + shadow-xl-spread + backdrop-blur-sm(8px)
□ 2. 容器内边距 4px(var(--codex-dropdown-pad))
□ 3. item 用 rounded-lg(12.5px) + px-8 + py-6 + min-h-32 + text-sm(12px)
□ 4. item hover 过渡 80ms(比通用 150ms 更快)
□ 5. 选中态(radio)仅显示 check icon,不填背景
□ 6. 选中态(picker)填 color-mix(in srgb, gray-0 6%, transparent)
□ 7. danger item 仅 hover 时变色,平时与普通 item 同色
□ 8. 进入动画 0.32s cubic-bezier(.23,1,.32,1) + 30ms 延迟
□ 9. data-state=open 由 Radix 驱动,不自定义状态属性
□ 10. 宽度落到 4 档之一(188 / 200 / 280 / min(260, sidebar-16))
□ 11. reduced-motion 下 animation:none
```

### List Row 组件清单

```
□ 1. 用 var(--color-token-list-hover-background) 做 hover overlay
□ 2. hover / selected / focus-visible / active 共享同一背景色(统一反馈)
□ 3. selected 用 [data-selected=true] 或 [aria-selected=true]
□ 4. disabled 用 [aria-disabled=true] 或 [data-disabled=true],opacity:0.25
□ 5. loading 用 [data-command-menu-loading=true],opacity:0.6 + cursor:default
□ 6. empty-state 用 [data-command-menu-empty-state=true],opacity:1 + cursor:default
□ 7. content-visibility: auto(性能优化,不在视口时跳过渲染)
□ 8. 可点击行用 30% 透明的 list-hover-background(保留卡片内容可读性)
□ 9. 已选中行的子元素 visibility 切换,pointer-events 仍开(允许 hover)
□ 10. 键盘导航支持 ArrowDown/ArrowUp/Home/End/Enter
```

### Composer 组件清单

```
□ 1. 容器圆角用 CSS 变量驱动(multi-line 25px / single-line 22px)
□ 2. placeholder 用 data-placeholder 属性 + opacity:0.5
□ 3. focused 时叠加 1-2px var(--color-token-focus-border) 蓝色 ring
□ 4. invalid 时红边 + 2px 20% 红色 ring(替代 focus ring)
□ 5. submitting 时 send 按钮替换为 spinner(animate-spin)
□ 6. empty 时 send 按钮切到 inactive(3-4% 透明)
□ 7. footer 用 container query 切换元素可见性(@container composer-footer)
□ 8. Enter 提交,Shift+Enter 换行,Escape(运行中)中止,/ 触发斜杠命令,@ 触发提及
□ 9. textarea 有 aria-label
□ 10. 不直接调用 window.electron.ipcRenderer.invoke,走 host-api.ts
```

### 动效清单

```
□ 1. 默认 0.15s + cubic-bezier(0.4, 0, 0.2, 1)
□ 2. 进入用 ease-enter(cubic-bezier(0.19, 1, 0.22, 1))
□ 3. 退出用 ease-in(cubic-bezier(0.4, 0, 1, 1))
□ 4. 退出时长 = 进入时长的 50%-70%
□ 5. 退出位移 = 进入位移的 50%,方向相反
□ 6. 大幅位移(sidebar / modal)用 0.3s(--transition-duration-relaxed)
□ 7. stagger 用 --fade-delay CSS 变量驱动,JS 只算延迟
□ 8. stagger 参数 16/96(不要"优化"成 8/64 或 32/128)
□ 9. 周期性动画显式 will-change
□ 10. 周期性动画在 reduced-motion 下完全关闭(animation:none)
□ 11. 新代码用反向写法 @media (prefers-reduced-motion: no-preference)
□ 12. 只动 transform / opacity / filter(GPU 合成),不动 layout 属性
□ 13. 弹性回弹 ≤1.05(除粒子爆裂)
□ 14. shimmer 用 steps(48, end) 模拟逐字扫光
```

### 主题切换清单

```
□ 1. :root 声明 color-scheme
□ 2. .electron-dark / .electron-light 选择器下覆盖同一组 --color-* token
□ 3. 组件 CSS 不出现 dark:bg-* 双声明
□ 4. 系统主题检测用 window.electronBridge?.getSystemThemeVariant?.()
□ 5. 主题切换不引起组件重渲染(只走 :root 切换)
□ 6. dark 模式 elevated-primary 必须 color-mix(in oklab, gray-800 96%, transparent) + backdrop-blur(8px)
□ 7. light 模式 elevated-primary 必须 color-mix(in oklab, gray-0 70%, transparent)
□ 8. status 色(dark 14% / light 7%)补偿暗底对比度
```

---

## 质量门(Quality Gates)

### CI/CD 质量门矩阵

| 质量门 | 命令 | 何时跑 | 失败行为 |
|---|---|---|---|
| **TypeScript 类型检查** | `pnpm run typecheck` | 每次 PR | 阻止合并 |
| **ESLint** | `pnpm run lint` | 每次 PR | 阻止合并 |
| **单元测试** | `pnpm test` | 每次 PR | 阻止合并 |
| **契约检查** | `pnpm contract:check` | token/host-api 变更 | 阻止合并 |
| **i18n 完整性** | (harness 检查) | 新增用户可见文案 | 阻止合并 |
| **E2E smoke** | `pnpm run test:e2e:agent-dev-quality:smoke` | 每次 PR | 阻止合并 |
| **E2E 完整** | `pnpm run test:e2e:agent-dev-quality` | 发布前 / 主要功能 | 阻止发布 |
| **Comms 回放** | `pnpm run comms:replay` | 通信路径变更 | 阻止合并 |
| **Comms 比较** | `pnpm run comms:compare` | 通信路径变更 | 阻止合并 |
| **Harness 验证** | `pnpm harness validate --spec <spec>` | 任务规范变更 | 阻止合并 |
| **Harness CI** | `pnpm run harness:ci` | GitHub Actions | 阻止合并 |

### 本地开发循环

```bash
# 快速循环(无 Electron 重建)
pnpm agent-dev:fast

# 日常循环(复用构建)
pnpm run build:vite
pnpm agent-dev:deep-test:reuse

# 完整诊断(新鲜构建)
pnpm agent-dev:deep-test

# 类型检查缓存版(日常循环证据)
pnpm run typecheck:cached

# 类型检查完整版(PR/发布前)
pnpm run typecheck

# Workbench 证据
pnpm agent-dev:workbench

# 审计 maturity scorecard
pnpm agent-dev:audit
```

### 性能预算监控

| 指标 | 预算 | 测量方式 | 命令 |
|---|---|---|---|
| e2e-build | (基线) | `pnpm agent-dev:deep-test` 报告 | `cat artifacts/agent-dev-deep-test/report.json` |
| typecheck | (基线) | 同上 | 同上 |
| playwright-agent-dev | (基线) | 同上 | 同上 |
| decision.status | `daily-loop-ok` | 同上 | 同上 |
| budget severity | 无 `limit` | 同上 | 同上 |

**关键规则**(来自 `AGENTS.md`):
- 若 `artifacts/agent-dev-deep-test/report.json` 显示某 gate `limit` severity,先优化或拆分该 gate,再扩展 Agent Dev 覆盖
- 若 `decision.status` 为 `needs-full-gate`,把本次运行视为日常循环证据,在 PR/发布前跑 `decision.requiredFullGates`
- 审计 `evidenceInventory` 在源文件更新后标记 evidence 为 stale,即使报告在正常年龄窗口内

---

## 测试策略

### 测试金字塔

```
                    ┌───────────────────┐
                    │   E2E (Playwright) │  ← 关键用户流程
                    │   ~10%             │
                    └───────────────────┘
                  ┌───────────────────────┐
                  │  集成测试(Vitest + jsdom)│  ← 组件交互
                  │  ~30%                  │
                  └───────────────────────┘
              ┌───────────────────────────────┐
              │  单元测试(Vitest, node env)   │  ← 纯逻辑
              │  ~60%                          │
              └───────────────────────────────┘
```

### E2E 测试规范(来自 `AGENTS.md`)

> **UI change validation**: Any user-visible UI change should include or update an Electron E2E spec in the same PR so the interaction is covered by Playwright.

#### 必须覆盖 E2E 的场景

1. **Sidebar 项目切换**:点击项目 → 切换 → 验证激活态
2. **Sidebar 会话切换**:点击会话 → 切换 → 验证内容加载
3. **Composer 发送流程**:输入 → Enter → 验证消息出现在列表
4. **Dropdown 打开/关闭**:点击 trigger → 验证 open → 选择 item → 验证关闭
5. **设置对话框**:打开 → 切换 tab → 修改设置 → 关闭 → 验证持久化
6. **主题切换**:light → dark → 验证 token 切换
7. **键盘导航**:Tab 遍历 → Enter 激活 → Escape 关闭

#### E2E 测试命令

```bash
# 完整 E2E
pnpm run test:e2e

# Agent Dev 质量 E2E
pnpm run test:e2e:agent-dev-quality

# Agent Dev smoke(Workbench 记录循环)
pnpm run test:e2e:agent-dev-quality:smoke

# 特定 spec
pnpm run test:e2e tests/e2e/<spec>.ts
```

#### E2E 编写规范(来自 `AGENTS.md`)

- 测试文件支持在 WSL 中编写(POSIX 引号),在 Windows 中执行
- E2E 测试需要 Electron(Win32 进程),必须从 Windows 环境执行
- 先构建:`pnpm run build:vite`(同时构建前端 + Electron)

### 单元测试规范

#### 测试环境分离(来自 `AGENTS.md`)

```bash
# Agent Dev 完整单元路径
pnpm agent-dev:unit

# 快速别名(同上)
pnpm agent-dev:unit:fast
```

**关键**:node 环境逻辑测试与 jsdom host-api facade 测试**分离**,不要混用。

#### 必须单元测试的逻辑

1. **Token 解析**:验证 `--color-*` token 在 dark/light 切换下值正确
2. **Stagger 引擎**:`wT()` / `TT()` / `ET()` 函数的延迟计算
3. **虚拟列表**:`computeVisibleRange()` 的二分查找
4. **流式解析**:`SSEParser.push()` 的边界处理
5. **防抖逻辑**:`scheduleHighlight()` 的 120ms 窗口
6. **状态机转移**:button / dropdown / list 的状态转换

### 视觉回归测试

#### 关键路径快照

| 路径 | 快照位置 | 何时更新 |
|---|---|---|
| Sidebar(展开) | `tests/e2e/snapshots/sidebar-expanded.png` | sidebar 布局变更 |
| Sidebar(折叠) | `tests/e2e/snapshots/sidebar-collapsed.png` | sidebar 布局变更 |
| Composer(空) | `tests/e2e/snapshots/composer-empty.png` | composer 样式变更 |
| Composer(输入中) | `tests/e2e/snapshots/composer-typing.png` | composer 样式变更 |
| Dropdown(打开) | `tests/e2e/snapshots/dropdown-open.png` | dropdown 样式变更 |
| 对话流(短) | `tests/e2e/snapshots/conversation-short.png` | 消息渲染变更 |
| 对话流(长) | `tests/e2e/snapshots/conversation-long.png` | 消息渲染变更 |
| Dark 主题 | 所有上述快照 + `-dark.png` 后缀 | 主题切换逻辑变更 |
| Light 主题 | 所有上述快照 + `-light.png` 后缀 | 主题切换逻辑变更 |

#### 快照更新流程

```bash
# 1. 故意更新快照(确认视觉变更正确)
pnpm run test:e2e -- --update-snapshots

# 2. 人工审查 diff
git diff tests/e2e/snapshots/

# 3. 提交快照(同 PR)
git add tests/e2e/snapshots/
git commit -m "test: update snapshots for <feature>"
```

### 通信路径测试(来自 `AGENTS.md`)

> **Comms-change checklist**: If your change touches communication paths (gateway events, runtime send/receive, delivery, or fallback), run `pnpm run comms:replay` and `pnpm run comms:compare` before pushing.

```bash
# 通信回放指标
pnpm run comms:replay

# 通信基线刷新(仅在确认基线变更后)
pnpm run comms:baseline

# 通信回归比较
pnpm run comms:compare
```

---

## 性能预算与验证

### 性能预算表

| 维度 | 指标 | 预算 | 测量方式 |
|---|---|---|---|
| **首屏** | FCP | ≤1.5s | Lighthouse / DevTools Performance |
| **首屏** | LCP | ≤2.5s | Lighthouse |
| **首屏** | CLS | ≤0.1 | Lighthouse |
| **交互** | FID | ≤100ms | Lighthouse |
| **交互** | INP | ≤200ms | Lighthouse |
| **动效** | 单次 transition | ≤150ms | DevTools Performance |
| **动效** | 单次 animation(非周期) | ≤500ms | DevTools Performance |
| **动效** | 周期性动画 FPS | ≥60fps | DevTools FPS meter |
| **流式** | 每 token 渲染 FPS | ≥60fps | DevTools Performance |
| **流式** | 代码高亮防抖 | 120ms | `lastStartedAtMs` 机制 |
| **stagger** | 单段延迟(线性) | ≤96ms | JS 计算 |
| **stagger** | 单段延迟(衰减) | ≤4ms | JS 计算 |
| **滚动** | 事件响应 | ≤1帧(16ms) | rAF 节流 |
| **虚拟化** | overscan | 上下各 3 条 | `computeVisibleRange` |
| **虚拟化** | 默认估算高度 | 280px | `DEFAULT_TURN_HEIGHT` |
| **自动跟底** | 视口可见阈值 | 2/3 | `VISIBILITY_RATIO_THRESHOLD` |
| **自动跟底** | 距底阈值 | 1px | `NEAR_BOTTOM_PX` |
| **自动跟底** | spring 时长 | 0.5s | `SPRING_CONFIG.duration` |
| **自动跟底** | 24px 阈值归零 | ≤24px | `forceScrollToBottom` |

### 性能验证流程

```bash
# 1. DevTools Performance 录制
#    - 打开 DevTools > Performance
#    - 录制 5 秒典型操作(发送消息 / 滚动 / 切换 sidebar)
#    - 检查 Main thread 不超过 50ms 长任务

# 2. DevTools FPS meter
#    - 打开 DevTools > Rendering > FPS meter
#    - 触发流式输出
#    - 验证 FPS ≥60

# 3. Lighthouse
#    - 在 Electron 主窗口运行 Lighthouse
#    - 验证 Performance ≥90

# 4. agent-dev:deep-test(性能证据)
pnpm agent-dev:deep-test
cat artifacts/agent-dev-deep-test/report.json | jq '.diagnostics'

# 5. agent-dev:deep-test:reuse(日常循环)
pnpm run build:vite
pnpm agent-dev:deep-test:reuse
```

### 关键性能反模式(禁用)

```css
/* ❌ transition: all(卡顿) */
.btn { transition: all 0.15s; }

/* ❌ 动 layout 属性(触发重排) */
.card { transition: width 0.15s, height 0.15s; }

/* ❌ 永远 will-change(浪费 GPU 内存) */
* { will-change: transform; }

/* ❌ @media (prefers-reduced-motion: reduce) { .shimmer { animation-duration: 0.01ms; } } */
/* 应该:animation: none(完全关闭周期动画) */

/* ❌ 视差滚动 / 滚动触发动画 */
.window { transform: translateY(calc(var(--scroll-y) * 0.5px)); }

/* ❌ 弹性回弹 >1.05(除粒子爆裂) */
.card--active { transform: scale(1.2); }
```

```js
/* ❌ 直接动 style.animationDelay(JS) */
element.style.animationDelay = `${delay}ms`;
/* 应该:setProperty('--fade-delay', ...) */

/* ❌ 每像素触发滚动补偿 */
scrollContainer.addEventListener('scroll', () => { ... });
/* 应该:rAF 节流 + IntersectionObserver 101 档 */

/* ❌ 流式渲染时全量重渲染 */
function MessageList({ messages }) {
  return messages.map(m => <Message key={m.id} {...m} />);  /* 缺 memo */
}
/* 应该:React.memo + 仅在内容稳定后解析 markdown */
```

---

## 无障碍验收清单

### WCAG 2.1 AA 验收清单

#### 1. 感知(Perceivable)

```
□ 1.1.1 非文本内容
  □ 所有 icon-only 按钮有 aria-label
  □ 装饰性 SVG 标注 aria-hidden="true"
  □ 图片有 alt 属性(空 alt 用于装饰性图片)

□ 1.3.1 信息与关系
  □ 语义化 HTML(button / nav / main / aside / dialog)
  □ 列表用 ul/ol,不用 div + role
  □ 表单 label 与 input 关联

□ 1.4.3 对比度(最低)
  □ 文本对比度 ≥4.5:1
  □ 大文本(18pt+)对比度 ≥3:1
  □ 验证 dark 模式下所有 token 对比度

□ 1.4.6 对比度(增强,AA+ 目标)
  □ 文本对比度 ≥7:1
  □ 大文本对比度 ≥4.5:1

□ 1.4.11 非文本对比度
  □ UI 组件(按钮/表单)边框对比度 ≥3:1
  □ focus ring 对比度 ≥3:1
```

#### 2. 操作(Operable)

```
□ 2.1.1 键盘
  □ 所有功能可用键盘操作
  □ 无键盘陷阱(modal 例外,但 Esc 必须能关闭)
  □ Tab 顺序符合视觉顺序

□ 2.1.2 键盘陷阱
  □ Modal 打开后焦点进入 modal
  □ Modal 关闭后焦点还原到 trigger
  □ Dropdown 关闭后焦点还原到 trigger

□ 2.4.3 焦点顺序
  □ Tab 顺序与视觉顺序一致
  □ 不跳过重要元素

□ 2.4.7 焦点可见
  □ 所有可聚焦元素有可见的 focus indicator
  □ :focus-visible 用 2px var(--color-token-focus-border) + 2px offset
  □ focus:outline-none 不滥用(仅在 focus-visible 替代时)

□ 2.4.11 焦点不被遮挡
  □ 聚焦元素不被 sticky header / footer 遮挡
  □ scrollIntoView({ block: 'nearest' }) 用于键盘导航
```

#### 3. 理解(Understandable)

```
□ 3.2.1 可预测
  □ 相同组件在不同位置行为一致
  □ 不自动跳转焦点(除非用户主动操作)

□ 3.2.2 输入错误
  □ 表单校验失败用 aria-invalid="true"
  □ 错误信息用 role="alert" 或 aria-live="assertive"
  □ 错误信息关联 aria-describedby

□ 3.3.2 标签
  □ 所有 input 有 label 或 aria-label
  □ placeholder 不替代 label
```

#### 4. 健壮(Robust)

```
□ 4.1.2 名称、角色、值
  □ 所有 UI 组件有正确的 role
  □ 所有 UI 组件有可访问名称(aria-label 或内部文本)
  □ 状态变化通过 aria-* 属性传达(aria-expanded / aria-pressed / aria-selected)

□ 4.1.3 状态消息
  □ 流式消息用 aria-live="polite"
  □ 错误消息用 role="alert" 或 aria-live="assertive"
  □ 状态变化不抢焦点(除非紧急)
```

### 自动化 a11y 测试

```bash
# axe-core 集成(若已配置)
pnpm test:e2e -- --grep "accessibility"

# Lighthouse Accessibility audit
# 在 DevTools > Lighthouse 跑 Accessibility audit,目标 ≥95

# 手动键盘测试
# 1. 拔掉鼠标,仅用键盘完成所有功能
# 2. 验证 Tab / Shift+Tab / Enter / Space / Arrow / Escape / Ctrl+Cmd 组合
# 3. 验证 focus 顺序与视觉顺序一致
```

### 屏幕阅读器测试

| 屏幕阅读器 | 平台 | 关键测试点 |
|---|---|---|
| VoiceOver | macOS | 流式消息朗读、modal 焦点陷阱 |
| NVDA | Windows | 同上 |
| Narrator | Windows | 同上 |

**测试要点**:
- 流式输出时,新段落是否被朗读(`aria-live="polite"`)
- Dropdown 打开时,选项是否被朗读为 "menu item"
- 折叠组件展开时,内容是否被朗读
- 错误消息是否立即被朗读(`role="alert"`)

### Reduced-motion 验证

```bash
# macOS:系统偏好设置 > 辅助功能 > 显示 > 减少动态效果
# Windows:设置 > 轻松使用 > 显示 > 显示动画(关闭)

# 验证点:
□ 1. 所有 transition 时长压到 0.01ms
□ 2. 所有一次性 animation 直接显示终态
□ 3. 周期性动画(shimmer / pulse / spin)完全关闭(animation:none)
□ 4. 周期性动画的静态占位显示(如 "Thinking..." 文本)
□ 5. active:scale 不缩放(motion-reduce:active:scale-100)
```

---

## 代码评审检查表

### PR 评审必查项

#### 设计体系合规

```
□ 1. 引用 Layer 2 语义 token,不引 Layer 1 raw hex
□ 2. 主题切换走 .electron-dark / .electron-light,不写 dark: 双声明
□ 3. 圆角 / 间距 / 阴影用 token,不写硬编码值
□ 4. 透明叠加用 color-mix(in oklab, ...),不用 rgba()
□ 5. z-index 走阶(var(--z-dropdown)),不写硬编码值
□ 6. 动效走 token(var(--default-transition-duration))
□ 7. 组件变体落到 4 种之一(primary / secondary / tertiary / icon)
□ 8. Dropdown 落到 4 档宽度之一(188 / 200 / 280 / min(260, sidebar-16))
```

#### 动效合规

```
□ 1. 所有 transition/animation 带 prefers-reduced-motion 旁路
□ 2. 周期性动画在 reduced-motion 下完全关闭
□ 3. 进入/退出不对称(时长、缓动、位移方向)
□ 4. stagger 用 --fade-delay CSS 变量驱动
□ 5. will-change 显式声明且动画后清理
□ 6. 只动 transform / opacity / filter,不动 layout 属性
□ 7. 弹性回弹 ≤1.05(除粒子爆裂)
```

#### 无障碍合规

```
□ 1. icon-only 按钮有 aria-label
□ 2. 装饰性 SVG 标注 aria-hidden="true"
□ 3. 折叠组件用 aria-expanded + inert
□ 4. Toggle button 用 aria-pressed,不用 aria-expanded
□ 5. Modal 用 role="dialog" + aria-modal="true"
□ 6. focus:outline-none 与 focus-visible:outline-* 配对使用
□ 7. :disabled 与 [aria-disabled="true"] 严格区分
□ 8. 键盘导航支持(Esc / Arrow / Enter / Tab)
```

#### 工程合规

```
□ 1. UI 变更包含/更新 E2E spec
□ 2. token / host-api 变更跑 pnpm contract:check
□ 3. 通信路径变更跑 pnpm run comms:replay + comms:compare
□ 4. 新增文案走 react-i18next,覆盖 en / zh / ja / ru
□ 5. 不直接调用 window.electron.ipcRenderer.invoke,走 host-api.ts
□ 6. 不直接 fetch Gateway HTTP,走 Main-process proxy
□ 7. 不创建新 token 前缀(--xyz-*),复用现有 --color-* 语义层
□ 8. typecheck + lint + test 全绿
```

### PR 描述模板

```markdown
## 变更说明

<!-- 简述变更目的 -->

## 关联设计文档

<!-- 列出本变更涉及的设计文档章节,如 07-components.md > Button > primary -->

## 关联问题

<!-- 列出本变更修复的问题,如 P0-1(13+ 套并行 token 前缀),详见 10-current-audit.md -->

## 验证清单

- [ ] typecheck 通过
- [ ] lint 通过
- [ ] unit test 通过
- [ ] E2E smoke 通过
- [ ] contract:check 通过(token/host-api 变更)
- [ ] comms:replay 通过(通信路径变更)
- [ ] comms:compare 通过(通信路径变更)
- [ ] reduced-motion 验证(动效变更)
- [ ] 键盘导航验证(交互变更)
- [ ] 截图/录屏(视觉变更)

## 风险与回滚

<!-- 简述风险与回滚策略 -->
```

---

## 风险管理与回滚策略

### 风险分类

| 风险等级 | 描述 | 示例 | 应对 |
|---|---|---|---|
| **P0** | 阻塞核心功能 | token 变更导致主题切换崩溃 | 立即回滚,PR 不合并 |
| **P1** | 影响次要功能 | dropdown 圆角错位 | 当 PR 修复,不阻塞发布 |
| **P2** | 视觉细节 | hover 颜色微偏 | 下一迭代修复 |
| **P3** | 性能 | 动画掉帧 | 优化或拆分 |

### 回滚策略

#### 1. Token 变更回滚

```bash
# 1. 立即回滚 tokens.css
git revert <commit-hash> -- src/styles/codex-tokens.css

# 2. 验证主题切换
pnpm dev
# 手动切换 light/dark,验证无崩溃

# 3. 跑 E2E smoke
pnpm run test:e2e:agent-dev-quality:smoke
```

#### 2. 组件变更回滚

```bash
# 1. 回滚组件文件
git revert <commit-hash> -- src/components/<component>.tsx

# 2. 跑相关 E2E
pnpm run test:e2e tests/e2e/<spec>.ts

# 3. 验证视觉
pnpm dev
```

#### 3. 动效变更回滚

```bash
# 1. 回滚 CSS
git revert <commit-hash> -- src/styles/<file>.css

# 2. 验证 reduced-motion
# macOS:系统偏好设置 > 辅助功能 > 显示 > 减少动态效果(开启)
# 验证无动画卡死

# 3. 验证 FPS
pnpm dev
# DevTools > Rendering > FPS meter,验证 ≥60fps
```

### Feature Flag 策略(推荐)

对于风险较高的变更,推荐使用 feature flag 渐进式推出:

```typescript
// shared/feature-flags.ts
export const FEATURE_FLAGS = {
  USE_NEW_TOKEN_SYSTEM: process.env.FEATURE_USE_NEW_TOKEN_SYSTEM === 'true',
  USE_NEW_DROPDOWN: process.env.FEATURE_USE_NEW_DROPDOWN === 'true',
  USE_STAGGER_ANIMATION: process.env.FEATURE_USE_STAGGER_ANIMATION === 'true',
};

// 使用
import { FEATURE_FLAGS } from '@/shared/feature-flags';
const Dropdown = FEATURE_FLAGS.USE_NEW_DROPDOWN ? NewDropdown : OldDropdown;
```

```bash
# 启用 feature flag
FEATURE_USE_NEW_DROPDOWN=true pnpm dev

# 灰度发布(若支持)
FEATURE_USE_NEW_DROPDOWN=true pnpm build
```

---

## 生产就绪检查表

### 发布前必查

#### 设计体系

```
□ 1. 所有组件引用 Layer 2 语义 token
□ 2. 主题切换无 dark: 双声明残留
□ 3. 圆角 / 间距 / 阴影 / z-index 全部走 token
□ 4. 透明叠加全部用 color-mix(in oklab, ...)
□ 5. 13+ 套并行 token 前缀已收敛(或已建 alias)
□ 6. 5 套 dropdown 已收敛到 1 套 codex-dropdown.css
□ 7. 5 套 button 系统已收敛到 4 种变体
```

#### 动效

```
□ 1. 所有 transition/animation 带 prefers-reduced-motion 旁路
□ 2. 周期性动画在 reduced-motion 下完全关闭
□ 3. 进入/退出不对称规则已应用
□ 4. stagger 引擎已迁移(参数 16/96)
□ 5. will-change 全部显式声明且动画后清理
□ 6. 只动 transform / opacity / filter
□ 7. 弹性回弹 ≤1.05
□ 8. 性能预算满足(FPS ≥60,FCP ≤1.5s)
```

#### 无障碍

```
□ 1. WCAG 2.1 AA 对比度满足
□ 2. 所有 icon-only 按钮有 aria-label
□ 3. 装饰性 SVG 标注 aria-hidden="true"
□ 4. 折叠组件用 aria-expanded + inert
□ 5. 键盘导航完整(Tab / Enter / Space / Arrow / Esc)
□ 6. 屏幕阅读器测试通过(VoiceOver / NVDA)
□ 7. reduced-motion 测试通过
```

#### 工程

```
□ 1. typecheck 通过
□ 2. lint 通过
□ 3. unit test 通过
□ 4. E2E smoke 通过
□ 5. E2E 完整通过(发布前)
□ 6. contract:check 通过
□ 7. comms:replay + comms:compare 通过(若涉及通信)
□ 8. harness validate 通过(若涉及任务规范)
□ 9. agent-dev:deep-test 通过(性能证据)
□ 10. agent-dev:audit 通过(maturity scorecard)
□ 11. README.md / README.zh-CN.md / README.ja-JP.md 已同步(若涉及功能/架构)
□ 12. harness specs 已更新(若涉及新功能/约束)
```

#### 文档

```
□ 1. 本设计文档(01-14)已同步更新
□ 2. 02-tokens.md 已登记新增 token
□ 3. 07-components.md 已更新组件 recipe
□ 4. 10-current-audit.md 已更新问题状态(已修复/部分修复/未修复)
□ 5. 11-migration-roadmap.md 已更新进度
```

### 发布后监控

```
□ 1. 错误率监控(若已集成 Sentry / 类似工具)
□ 2. 用户反馈收集(若已集成反馈渠道)
□ 3. 性能监控(若已集成 RUM)
□ 4. 主题切换成功率
□ 5. 流式渲染成功率
□ 6. E2E smoke 持续绿
```

---

## 常见陷阱与解决方案

### 陷阱 1:dark: 双声明残留

**症状**:主题切换时部分组件颜色"半残"。

**原因**:组件层使用 `bg-white dark:bg-gray-900` 这种 Tailwind 双前缀,没有走 token 切换。

**解决方案**:

```css
/* ❌ 错误 */
.card {
  @apply bg-white dark:bg-gray-900;
}

/* ✅ 正确 */
.card {
  background-color: var(--color-background-elevated-primary);
}
/* :root 或 .electron-dark/.electron-light 下定义 token,组件层只引语义 token */
```

### 陷阱 2:z-index 冲突

**症状**:dropdown 弹层和 modal 抢同一层级,谁赢看运气。

**原因**:z-index 散落在组件里(`z-10` / `z-50` / `z-999` 等)。

**解决方案**:

```css
/* tokens.css */
:root {
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal-backdrop: 900;
  --z-modal: 1000;
  --z-toast: 1100;
  --z-tooltip: 1200;
}

/* 组件层 */
.dropdown { z-index: var(--z-dropdown); }
.modal-backdrop { z-index: var(--z-modal-backdrop); }
.modal { z-index: var(--z-modal); }
```

### 陷阱 3:stagger 动画闪烁

**症状**:流式输出时,已渲染的段落反复闪烁。

**原因**:`onAnimationEnd` 未正确标记 `settledKeys`,导致每次重渲染都重新触发动画。

**解决方案**:

```jsx
// ✅ 正确:用 settledKeys 跟踪
function AT({ className, segmentKey, timeline }) {
  return {
    // 已 settled 的段不再加 fadeIn 类
    className: timeline?.settledKeys.has(segmentKey) ? undefined : className,
    onAnimationEnd: (e) => {
      if (e.target === e.currentTarget) timeline.settledKeys.add(segmentKey);
    },
    // ...
  };
}
```

### 陷阱 4:周期动画在 reduced-motion 下仍跑

**症状**:用户开启 reduced-motion,但 shimmer / pulse 仍在动。

**原因**:仅压时长(`animation-duration: 0.01ms`),未完全关闭。

**解决方案**:

```css
/* ❌ 错误 */
@media (prefers-reduced-motion: reduce) {
  .shimmer { animation-duration: 0.01ms; }
}

/* ✅ 正确 */
@media (prefers-reduced-motion: reduce) {
  .shimmer { animation: none; opacity: 0; }  /* 完全关闭 */
  .shimmer__static { display: block; }       /* 显示静态占位 */
}
```

### 陷阱 5:will-change 永远声明

**症状**:GPU 内存持续增长,长时间使用后卡顿。

**原因**:`will-change` 永远声明,浏览器持续为合成层分配内存。

**解决方案**:

```css
/* ❌ 错误 */
* { will-change: transform; }

/* ✅ 正确 */
.shimmer::before {
  will-change: transform;          /* 仅在动画时声明 */
  animation: 3s linear infinite sweep;
}
/* 动画结束后(JS 控制) */
// element.style.willChange = 'auto';
```

### 陷阱 6:动 layout 属性

**症状**:动画卡顿,Main thread 长任务。

**原因**:`transition: width 0.15s, height 0.15s` 触发重排。

**解决方案**:

```css
/* ❌ 错误 */
.card { transition: width 0.15s, height 0.15s; }

/* ✅ 正确 */
.card { transition: transform 0.15s; }
.card--active { transform: scale(0.98); }
```

### 陷阱 7:icon-only 按钮无 aria-label

**症状**:屏幕阅读器朗读"按钮"而无具体含义。

**原因**:icon-only 按钮缺少 aria-label。

**解决方案**:

```jsx
/* ❌ 错误 */
<button onClick={onClose}><Icon name="x" /></button>

/* ✅ 正确 */
<button aria-label="关闭" onClick={onClose}>
  <Icon name="x" aria-hidden="true" />
</button>
```

### 陷阱 8:placeholder 替代 label

**症状**:屏幕阅读器不朗读表单字段含义。

**原因**:用 placeholder 替代 label。

**解决方案**:

```jsx
/* ❌ 错误 */
<input placeholder="邮箱" />

/* ✅ 正确 */
<label htmlFor="email">邮箱</label>
<input id="email" placeholder="example@domain.com" />
/* 或 */
<input id="email" aria-label="邮箱" placeholder="example@domain.com" />
```

### 陷阱 9:Modal 焦点陷阱缺失

**症状**:Tab 跳出 modal,焦点跑到背景元素。

**原因**:Modal 未实现焦点陷阱。

**解决方案**:

```jsx
function Modal({ isOpen, onClose, children }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const modal = modalRef.current;
    if (!modal) return;

    // 焦点进入 modal
    const firstFocusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    firstFocusable?.focus();

    // 焦点陷阱
    const handleTab = (e) => {
      if (e.key !== 'Tab') return;
      const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    modal.addEventListener('keydown', handleTab);
    return () => modal.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  return isOpen ? (
    <div role="dialog" aria-modal="true" ref={modalRef}>
      {children}
    </div>
  ) : null;
}
```

### 陷阱 10:直接调用 IPC

**症状**:CORS 错误 / 环境漂移 / 安全问题。

**原因**:Renderer 直接调用 `window.electron.ipcRenderer.invoke` 或 `fetch('http://127.0.0.1:18789/...')`。

**解决方案**(来自 `AGENTS.md`):

```typescript
// ❌ 错误
const result = await window.electron.ipcRenderer.invoke('some-channel');
const response = await fetch('http://127.0.0.1:18789/api/data');

// ✅ 正确
import { hostApi } from '@/lib/host-api';
import { apiClient } from '@/lib/api-client';

const result = await hostApi.someChannel();
const response = await apiClient.fetchData();
```

---

## 附录:命令速查

### 开发循环

```bash
pnpm run init                    # 安装依赖 + 下载 uv
pnpm dev                          # 开发服务器
pnpm run lint                     # ESLint(自动修复)
pnpm run typecheck                # 类型检查
pnpm test                         # 单元测试
pnpm run build:vite               # 构建前端
```

### Agent Dev

```bash
pnpm agent-dev:fast               # 快速 PR 循环
pnpm agent-dev:unit               # 完整单元测试
pnpm agent-dev:unit:fast          # 别名(同上)
pnpm agent-dev:workbench          # Workbench 证据
pnpm agent-dev:deep-test          # 完整诊断(新鲜构建)
pnpm agent-dev:deep-test:reuse    # 复用构建的日常循环
pnpm agent-dev:deep-test:reuse:full  # 复用构建的完整 E2E
pnpm agent-dev:audit              # maturity scorecard(严格)
pnpm agent-dev:audit:report       # 仅生成报告(不失败)
```

### E2E

```bash
pnpm run test:e2e                 # 完整 E2E
pnpm run test:e2e:agent-dev-quality         # Agent Dev 完整 E2E
pnpm run test:e2e:agent-dev-quality:smoke   # Agent Dev smoke
pnpm run test:e2e:agent-dev-quality:run     # 不重建的完整 E2E
pnpm run test:e2e tests/e2e/<spec>.ts       # 特定 spec
```

### 通信

```bash
pnpm run comms:replay             # 通信回放
pnpm run comms:baseline           # 基线刷新
pnpm run comms:compare            # 回归比较
```

### 契约与规范

```bash
pnpm contract:check              # 契约检查
pnpm harness context --spec <spec>  # 任务规范上下文
pnpm harness validate --spec <spec> # 任务规范验证
pnpm harness run --spec <spec>      # 任务规范执行
pnpm run harness:ci               # GitHub Actions 基线检查
```

### TypeScript

```bash
pnpm run typecheck               # 完整类型检查(无缓存)
pnpm run typecheck:cached        # 缓存版(日常循环证据)
pnpm run typecheck:agent-dev     # Agent Dev 类型检查(同 typecheck)
```

---

## 与其他文档的关系

| 文档 | 解决问题 | 与 14 的关系 |
|---|---|---|
| 01-design-philosophy | 设计哲学 20 条 | 14 提供"如何落地哲学"的工程方法 |
| 02-tokens | token 字典 | 14 验证 token 使用合规 |
| 03-colors | 颜色系统 | 14 验证颜色对比度 / 主题切换 |
| 04-typography | 字体系统 | 14 验证字体使用 |
| 05-spacing-shapes-elevation | 间距 / 圆角 / 阴影 | 14 验证尺寸合规 |
| 06-motion | 基础动效 | 14 验证动效 reduced-motion |
| 07-components | 组件 recipe | 14 验证组件实现合规 |
| 08-composer-subsystem | Composer 子系统 | 14 验证 Composer 实现 |
| 09-theme-and-dark-mode | 主题切换 | 14 验证主题切换无崩溃 |
| 10-current-audit | 现状问题 | 14 验证问题已修复 |
| 11-migration-roadmap | 迁移路线图 | 14 提供迁移每阶段的工程方法 |
| 12-motion-depth | 动效深度 | 14 验证复杂动效编排合规 |
| 13-interaction-state-machine | 交互状态机 | 14 验证状态机实现合规 |

**14 是工程层面的"质量保障层"**,确保前 13 份文档的设计意图在生产代码中不退化。
