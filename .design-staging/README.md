# Codex 设计体系迁移规范（ClawX 适用）

> 本目录是 **从真实 Codex 桌面 app 提炼的设计体系**，配合对当前 ClawX 项目的现状诊断，给出"如何形成与 Codex 一致、避免结构性错乱"的可复用规范。
>
> 风格参考：`awesome-design-md-main/design-md/airtable/`（YAML frontmatter + 散文式 prose + token 引用 + Do/Don't）。
> 内容来源：`FakeCoding-main/CODEX-UI-RESOURCE-MAP.md` + `codex-reference/`（1137 个真实 token，45 个组件 CSS）+ `codex-conversation-render/`（运行时 + prettified 源码）。
>
> **生成日期**：2026-08-03（初版 v0.1）/ 2026-08-04（深度补充 v0.2 / v0.3）  
> **来源版本**：openai-codex-electron@26.715.52143 / 26.721.4979.0  
> **状态**：v0.3 完整企业级设计体系（26 份文档），覆盖全部子系统，待迭代完善

---

## v0.3 新增内容（2026-08-04）

v0.3 在 v0.2 的 14 份文档之上，新增 **12 份子系统规范**（15-26），通过深度调研 Codex 源码 CSS 逐一提取，把设计体系从"基础规范 + 深度规范"推进到"**全子系统覆盖的企业级设计语言**"：

| 新文档 | 解决问题 |
|---|---|
| [15-conversation-rendering.md](./15-conversation-rendering.md) | 对话渲染：Markdown 排版、代码块、diff 渲染、流式 shimmer、节奏式思考动画、工作点波浪 |
| [16-layout-architecture.md](./16-layout-architecture.md) | 布局架构：容器查询策略、侧边栏折叠/展开、三层 shell、响应式断点体系 |
| [17-settings-forms-overlays.md](./17-settings-forms-overlays.md) | 设置与表单：Settings 页导航、表单控件规范、模态框/浮层、开关/滑块 |
| [18-states-icons-a11y.md](./18-states-icons-a11y.md) | 状态/图标/无障碍：9 种加载状态、空状态、错误 token、Lucide 189 图标、ARIA 模式、reduced-motion 策略 |
| [19-command-palette-system.md](./19-command-palette-system.md) | 命令面板：cmdk 3 变体、Hotkey Window Home 3 层 shell、Quick Chat mask-image 滚动渐隐、窗口缩放适配、content-visibility 性能 |
| [20-onboarding-first-run-experience.md](./20-onboarding-first-run-experience.md) | 引导体验：bouncing arrow 动画、Codex↔ChatGPT 内容过渡（不对称 0.26s/0.18s）、首次运行几何、hljs 代码高亮 token、侧边栏 4 阶段滚动渐隐、Toast back-out 动画 |
| [21-avatars-identity-system.md](./21-avatars-identity-system.md) | 头像与身份：玻璃胶囊材质（3 变体）、活动栈 mask-image 渐隐（3 模式）、Profile 加载 steps(48) 扫光、照片编辑徽章 20px 模糊、reply-stop mix-blend-mode |
| [22-data-visualization-progress.md](./22-data-visualization-progress.md) | 数据可视化：Recharts 图表主题、进度环 SVG dashoffset 动画、Chart Tooltip/Legend 交互、滚动容器策略、Box 布局原语 |
| [23-plugins-extensions-grid.md](./23-plugins-extensions-grid.md) | 插件与扩展：容器查询响应式网格（581px 断点）、PDF.js 文本层/注释层、Box 布局原语完整 API |
| [24-voice-dictation-presentation.md](./24-voice-dictation-presentation.md) | 语音与演示：录音浮球 glassmorphism 材质（blur 18px + saturate 1.45）、听写暗色主题就地覆盖、Popcorn 演示面板三态容器查询布局（748/688/749px）、a11y 三层防御 |
| [25-collaboration-chips-modals.md](./25-collaboration-chips-modals.md) | 协作系统：芯片入场动画（280ms cubic-bezier overshoot 102%）、点阵呼吸场（1.75s 对角线 mask）、Discord Blurple 扫光/绽放、三段式主题 token 架构（语义→本地→硬编码回退）、color-mix 透明度合成 |
| [26-worktree-review-mermaid.md](./26-worktree-review-mermaid.md) | 代码工作流：进度条 scaleX 形变（0%→0.001% 瞬间跳变）、ANSI 16 色终端调色板、Mermaid 容器查询宽块策略（100cqi）、Markdown 排版系统（24 网格表格列宽、行高公式）、Carlito 字体分包、Radix Tooltip 浮层定位 |

---

## v0.2 新增内容（2026-08-04）

v0.2 在 v0.1 的 11 份基础文档之上，新增 3 份**深度规范**，把设计体系从"该长什么样"推进到"如何在生产环境落地并保持质量不退化"：

| 新文档 | 解决问题 |
|---|---|
| [12-motion-depth.md](./12-motion-depth.md) | 复杂动效编排：stagger 引擎（`fadeSegmentDelayMs=16` / `fadeSegmentMaxDelayMs=96`）、三轨并行（scale + translate + fade）、进入/退出不对称矩阵、8 种状态指示动效谱系、三级 reduced-motion 退让策略、will-change 管理、性能预算 |
| [13-interaction-state-machine.md](./13-interaction-state-machine.md) | 组件状态机：Button 5 态 + Dropdown 4 态 + List 8 态 + Composer 5 态 + Disabled 三态（`:disabled` / `[aria-disabled]` / `peer-disabled`）+ Loading 10 种谱系 + Focus 管理 + 完整 ARIA 角色/属性/键盘映射 + 状态转移图（Statechart） |
| [14-production-implementation-guide.md](./14-production-implementation-guide.md) | 工程落地：Per-Component 工程清单（Button/Dropdown/List/Composer/动效/主题）、CI 质量门矩阵、测试策略（E2E/单元/视觉回归/通信）、性能预算表、WCAG 2.1 AA 验收清单、代码评审检查表、风险管理与回滚策略、生产就绪检查表、10 个常见陷阱与解决方案 |

---

## 目录导航

### 基础规范（v0.1，01-11）

| 文档 | 角色 | 何时阅读 |
|---|---|---|
| [DESIGN.md](./DESIGN.md) | **主设计规范**（airtable 风格 YAML + prose 总览） | 入口必读，整套体系的索引 |
| [01-design-philosophy.md](./01-design-philosophy.md) | Codex 设计哲学 20 条 | 决策前先读，避免战术争论 |
| [02-tokens.md](./02-tokens.md) | 全量 token 参考（按分组） | 实施时查表 |
| [03-colors.md](./03-colors.md) | 颜色系统（palette + semantic + dark/light） | 上色时查表 |
| [04-typography.md](./04-typography.md) | 字体系统（family / size / weight / line-height） | 排版时查表 |
| [05-spacing-shapes-elevation.md](./05-spacing-shapes-elevation.md) | 间距 + 圆角 + 阴影 + 模糊 | 布局与卡片时查表 |
| [06-motion.md](./06-motion.md) | 动画与过渡 + reduced-motion（基础） | 动效时查表（基础） |
| [07-components.md](./07-components.md) | 组件规范（dropdown / button / card / list 等） | 实施组件时查表 |
| [08-composer-subsystem.md](./08-composer-subsystem.md) | Composer 输入区子系统深入 | 改 Composer 时必读 |
| [09-theme-and-dark-mode.md](./09-theme-and-dark-mode.md) | 主题切换策略与暗色模式 | 涉及主题时必读 |
| [10-current-audit.md](./10-current-audit.md) | ClawX 当前样式现状诊断（P0/P1/P2 问题清单） | 决定迁移优先级时读 |
| [11-migration-roadmap.md](./11-migration-roadmap.md) | 迁移路线图（分阶段 + 验收清单） | 落地执行时读 |

### 深度规范（v0.2 新增，12-14）

| 文档 | 角色 | 何时阅读 |
|---|---|---|
| [12-motion-depth.md](./12-motion-depth.md) | **动效深度规范**（stagger 引擎 / 三轨编排 / 不对称矩阵 / 退让策略 / 性能预算） | 复杂动效编排、流式渲染、性能优化时必读 |
| [13-interaction-state-machine.md](./13-interaction-state-machine.md) | **交互状态机**（Button / Dropdown / List / Composer / Disabled / Loading 状态机 + ARIA + 键盘导航） | 设计/实现组件交互时必读 |
| [14-production-implementation-guide.md](./14-production-implementation-guide.md) | **生产实现指南**（工程清单 / 质量门 / 测试策略 / 性能预算 / a11y 验收 / 代码评审 / 风险管理） | 工程落地、PR 评审、发布前必读 |

### 子系统规范（v0.3 新增，15-26）

| 文档 | 角色 | 何时阅读 |
|---|---|---|
| [15-conversation-rendering.md](./15-conversation-rendering.md) | **对话渲染系统**（Markdown / 代码块 / diff / 流式 / shimmer） | 改对话/消息渲染时必读 |
| [16-layout-architecture.md](./16-layout-architecture.md) | **布局架构**（容器查询 / 侧边栏 / 三层 shell / 响应式） | 涉及布局/响应式时必读 |
| [17-settings-forms-overlays.md](./17-settings-forms-overlays.md) | **设置与表单**（Settings / 表单控件 / 模态框 / 浮层） | 改设置/表单时必读 |
| [18-states-icons-a11y.md](./18-states-icons-a11y.md) | **状态/图标/无障碍**（加载/空/错误 / Lucide 189 图标 / ARIA / reduced-motion） | 涉及状态/图标/a11y 时必读 |
| [19-command-palette-system.md](./19-command-palette-system.md) | **命令面板**（cmdk / Hotkey Window / Quick Chat / 窗口缩放） | 改命令面板/快捷键时必读 |
| [20-onboarding-first-run-experience.md](./20-onboarding-first-run-experience.md) | **引导与首次运行**（arrow 动画 / 内容过渡 / hljs / 滚动渐隐） | 改引导/首次运行时必读 |
| [21-avatars-identity-system.md](./21-avatars-identity-system.md) | **头像与身份**（玻璃胶囊 / 活动栈 mask / Profile 扫光 / 编辑徽章） | 改头像/身份/Profile 时必读 |
| [22-data-visualization-progress.md](./22-data-visualization-progress.md) | **数据可视化**（Recharts / 进度环 / Tooltip / Legend / 滚动容器） | 改图表/进度时必读 |
| [23-plugins-extensions-grid.md](./23-plugins-extensions-grid.md) | **插件/PDF/Box**（容器查询网格 / PDF.js / Box 原语） | 改插件页/PDF 时必读 |
| [24-voice-dictation-presentation.md](./24-voice-dictation-presentation.md) | **语音/演示**（浮球材质 / 听写主题 / Popcorn 三态） | 改语音/演示时必读 |
| [25-collaboration-chips-modals.md](./25-collaboration-chips-modals.md) | **协作/芯片/模态**（芯片动画 / 呼吸场 / Blurple 扫光 / 三段式 token） | 改协作/限流/模态时必读 |
| [26-worktree-review-mermaid.md](./26-worktree-review-mermaid.md) | **工作树/审查/Mermaid**（进度条 / ANSI 色板 / Mermaid 宽块 / Markdown / Carlito / Radix 浮层） | 改代码工作流/Mermaid/终端时必读 |

---

## 核心结论（TL;DR）

1. **Codex 的设计哲学可以用一句话概括**：dark-first + token-first + color-mix(in oklab) + 1.25× 圆角缩放 + 单一品牌色 `#339cff` + 紧凑开发工具密度（base 14px）。
2. **ClawX 当前的主要病根**：13+ 套并行 token 前缀（`--sp-*` / `--ccm-*` / `--cdx-*` / `--material-*` / `--surface-*` / `--cwh-*` ...）+ z-index 完全无规范（12 个不同层级散落）+ 5 套下拉菜单各自为政 + 5 套按钮系统不匹配 + Composer 容器 25px 圆角与下拉 15px 脱节。
3. **迁移策略**：不是推倒重来，而是先建立"统一 token 层 + z-index 阶 + 单一下拉基类 + 单一按钮变体"，再把现有 ported CSS（codex-sidebar / codex-composer-menu / codex-settings-controls）逐步重定向到统一层。预计 5 个阶段（见 [11-migration-roadmap.md](./11-migration-roadmap.md)）。
4. **v0.2 补充**：在迁移落地时，必须遵守 [12-motion-depth.md](./12-motion-depth.md) 的动效编排规则（stagger 16/96 参数、进入/退出不对称、reduced-motion 三级退让）、[13-interaction-state-machine.md](./13-interaction-state-machine.md) 的状态机规则（`:disabled` vs `[aria-disabled]`、`:focus` vs `:focus-visible`、loading 不用 `aria-busy`），以及 [14-production-implementation-guide.md](./14-production-implementation-guide.md) 的工程清单与质量门。
5. **v0.3 补充**：12 份子系统规范（15-26）完成了对 Codex 全部 CSS 源码的逐行覆盖。关键企业级模式包括：容器查询优先于媒体查询（[16](./16-layout-architecture.md)/[23](./23-plugins-extensions-grid.md)/[26](./26-worktree-review-mermaid.md)）、就地主题覆盖用于沉浸式场景（[24](./24-voice-dictation-presentation.md) 的听写暗色主题）、三段式 token 架构（[25](./25-collaboration-chips-modals.md) 的语义→本地→硬编码回退）、`color-mix` 透明度合成替代 rgba（[25](./25-collaboration-chips-modals.md)/[26](./26-worktree-review-mermaid.md)）、a11y 三层防御（`prefers-reduced-transparency` / `forced-colors` / `prefers-reduced-motion`，[24](./24-voice-dictation-presentation.md)）、以及 `box-decoration-break: clone` / `:has()` / `content-visibility` 等现代 CSS 实践。

---

## 使用方式

### 1. 决策时
打开 [01-design-philosophy.md](./01-design-philosophy.md) 走一遍 20 条原则，确认决策不违反任何一条。

### 2. 实施时
- 写新组件 → 先查 [02-tokens.md](./02-tokens.md) 找对应 token，不要硬编码
- 上色 → 查 [03-colors.md](./03-colors.md)，所有色必须来自 token
- 排版 → 查 [04-typography.md](./04-typography.md)
- 布局/卡片/阴影 → 查 [05-spacing-shapes-elevation.md](./05-spacing-shapes-elevation.md)
- **基础动效** → 查 [06-motion.md](./06-motion.md)（时长 / 缓动 / 基础 transition）
- **复杂动效**（stagger / 三轨 / 退出） → 查 [12-motion-depth.md](./12-motion-depth.md)
- 实现组件 → 查 [07-components.md](./07-components.md) 找对应 recipe
- **设计组件交互**（状态机 / 键盘 / ARIA） → 查 [13-interaction-state-machine.md](./13-interaction-state-machine.md)
- 改 Composer → 必读 [08-composer-subsystem.md](./08-composer-subsystem.md)

### 3. 改主题时
查 [09-theme-and-dark-mode.md](./09-theme-and-dark-mode.md)。**禁止** 在组件中写 `dark:bg-*` / `dark:border-*` 双声明，所有暗色逻辑走 token 切换。

### 4. 决定迁移优先级时
查 [10-current-audit.md](./10-current-audit.md) 看 P0/P1/P2 问题清单，按 [11-migration-roadmap.md](./11-migration-roadmap.md) 路线图执行。

### 5. 工程落地与质量保障时
- 写/改组件 → 走 [14-production-implementation-guide.md](./14-production-implementation-guide.md) 的 **Per-Component 工程清单**
- 提 PR → 走 **代码评审检查表** 与 **PR 描述模板**
- 发版前 → 走 **生产就绪检查表**
- 遇到陷阱 → 查 **常见陷阱与解决方案**（10 个陷阱）

### 6. 验收时
- 动效验收 → [12-motion-depth.md](./12-motion-depth.md) 的 Do/Don't + [14-production-implementation-guide.md](./14-production-implementation-guide.md) 的 reduced-motion 验证
- 交互验收 → [13-interaction-state-machine.md](./13-interaction-state-machine.md) 的状态转移图 + 键盘导航标准映射
- 无障碍验收 → [14-production-implementation-guide.md](./14-production-implementation-guide.md) 的 WCAG 2.1 AA 验收清单

---

## 文档关系图

```
┌─────────────────────────────────────────────────────────────────┐
│  基础规范层（v0.1）                                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 01-philosophy  02-tokens  03-colors  04-typography       │   │
│  │ 05-spacing     06-motion  07-components 08-composer     │   │
│  │ 09-theme       10-audit   11-roadmap                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
├─────────────────────────────────────────────────────────────────┤
│  深度规范层（v0.2 新增）                                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 12-motion-depth        ← 06 的动效深挖                   │   │
│  │ 13-state-machine       ← 07 的状态维度深挖                │   │
│  │ 14-production-guide    ← 11 的工程落地方法                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
├─────────────────────────────────────────────────────────────────┤
│  子系统规范层（v0.3 新增，15-26）                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 15-conversation   16-layout    17-settings  18-states   │   │
│  │ 19-cmd-palette    20-onboard   21-avatars   22-dataviz   │   │
│  │ 23-plugins        24-voice     25-collab    26-worktree  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**阅读顺序建议**：
- **新读者**：先读 DESIGN.md → 01-11 基础 → 按需读 12-14 深度 → 按子系统查 15-26
- **实施者**：先读 14 工程指南 → 按需查 02-09 token/组件 → 复杂场景查 12-13 → 改特定子系统查 15-26
- **评审者**：必读 14 代码评审检查表 + 13 状态机规则 → 涉及特定子系统时查 15-26

---

## 文档约定

- 所有 token 引用使用 `{token.name}` 语法（airtable 风格），方便后续 lint
- 颜色 hex 仅在 token 定义处出现一次，prose 中只引用 token
- 文件路径引用使用相对路径（`./02-tokens.md`）
- 代码块标注语言（`css` / `tsx` / `bash`）
- 表格按"用途 / 值 / 说明"三列组织
- 中文 prose，英文标识符（变量名/类名/属性名）
- 所有动效示例必须带 `prefers-reduced-motion` 旁路
- 所有状态机示例必须区分 `:disabled` 与 `[aria-disabled="true"]`、`:focus` 与 `:focus-visible`

---

## 维护

- 本规范是 **活文档**，每次组件改造后应同步更新对应章节
- 每次更新时同步检查 [10-current-audit.md](./10-current-audit.md) 中的问题清单是否已解决
- 新增 token 时必须同步登记到 [02-tokens.md](./02-tokens.md)
- 重大改动（涉及 token 体系或主题策略）需要 review，避免破坏迁移一致性
- 版本号变更遵循：
  - **patch**（v0.1 → v0.1.1）：新增/澄清条目
  - **minor**（v0.1 → v0.2）：token/主题/组件 recipe 结构变化、新增深度章节
  - **major**（v0.x → v1.0）：体系级重构、迁移完成

---

## 来源与可信度

| 来源 | 角色 | 可信度 |
|---|---|---|
| `FakeCoding-main/CODEX-UI-RESOURCE-MAP.md` | UI 区域 → 真实资源映射 | 100%（CDP + ASAR 双源） |
| `FakeCoding-main/codex-reference/tokens.css` | 1137 个 token 全量 | 100%（PostCSS 原始输出） |
| `FakeCoding-main/codex-reference/css/*.css` | 45 个组件 CSS | 100%（MSIX 提取） |
| `FakeCoding-main/codex-conversation-render/css-all/prettified/` | 美化版 CSS | 100%（prettifier 输出） |
| `FakeCoding-main/codex-conversation-render/*/prettified/*.pretty.js` | 美化版 JS（v0.2 深度调研新增） | 100%（prettifier 输出） |
| `FakeCoding-main/codex-pure-source/runtime-dom/` | 运行时 DOM 快照 | 100%（CDP 抓取） |
| `FakeCoding-main/codex-design-system.css` | 综合可读版（带注释） | 高（人为整理，与 tokens.css 一致） |
| `FakeCoding-main/codex-reference/ALIGNMENT.md` | 1:1 对齐工作流 | 高（实测值） |
| `FakeCoding-main/codex-reference/DROPDOWN.md` | Dropdown 实测值 | 100%（CDP 抓取） |
| `FakeCoding-main/web/src/codex-dropdown.css` | FakeCoding 端复刻 | 95%（已验证对齐） |
| `FakeCoding-main/web/src/components/*.tsx` | FakeCoding 端 React 组件（v0.2 调研） | 95%（已验证对齐） |
| `FakeCoding-main/web/src/primitives/ToolActivityDisclosure.tsx` | Disclosure 折叠组件（v0.2 调研） | 95%（已验证对齐） |
| `FakeCoding-main/codex-reference/css/plugins-page-*.css` | 插件页 CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/pdf-preview-panel-*.css` | PDF 预览 CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/global-dictation-*.css` | 语音听写 CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/PopcornElectronPresentationPanel-*.css` | 演示面板 CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/subagent-activity-*.css` | 子代理芯片 CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/rate-limit-reset-*.css` | 限流恢复 CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/referral-invite-modal-*.css` | 邀请模态 CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/worktree-init-*.css` | 工作树 CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/mermaid-diagram-shell-*.css` | Mermaid/Markdown CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/remote-text-edit-session-*.css` | 远程编辑字体 CSS（v0.3 调研） | 100%（MSIX 提取） |
| `FakeCoding-main/codex-reference/css/local-conversation-item-navigation-*.css` | 会话导航 CSS（v0.3 调研） | 100%（MSIX 提取） |

> 当前 ClawX 现状诊断（[10-current-audit.md](./10-current-audit.md)）的证据均来自对 `c:\Users\27933\Desktop\clawx\ClawX-ui-polish` 仓库的只读检查，文件路径 + 行号已标注。
> v0.2 深度规范（12/13/14）的证据来自对 `FakeCoding-main/` 下 Codex 源码的逐行核对，所有代码片段保留了原始文件路径与行号。
> v0.3 子系统规范（15-26）的证据来自对 `FakeCoding-main/codex-reference/css/` 下全部 45 个组件 CSS 的逐行核对，精确到像素与毫秒。
