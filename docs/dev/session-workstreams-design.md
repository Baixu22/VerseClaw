# 会话工作线（Session Workstreams）— 分组交互重设计

> 2026-08-11 · 分支 `codex/ui-polish` · 替代「嵌套工作组」交互
> 2026-08-18 修订：**工作组只存在于项目内部且最多一级；时间视图直接按活动时间排序，不再渲染溯源子层或日期分片**。

## 一、问题定义

原始诉求：*「在这个项目工作树下的提示开发工作可以溯源、进行相对的分类。」*

嵌套工作组失败的原因，不是样式，是模型错配：

| 症状 | 根因 |
|---|---|
| 整理成本高，没人愿意归档 | 树形归档要求用户先想清楚层级——prompt 开发是发散的，层级事前不存在 |
| 嵌套交互危险（F2 曾是数据破坏级 bug） | 树的 rename/delete/move 语义随深度复杂化，收益却为零 |
| 「溯源」完全没有解决 | 溯源是**关系**（这个会话从哪个会话 fork/handoff 出来），不是**容器**；文件夹表达不了关系 |
| 无任何辅助 | 分类 100% 手动，系统掌握的信息（fork 关系、时间）一点没用上 |

关键事实（本次调研确认）：
- 分组是 workspace profile 内的数据，不是跨项目的全局会话属性；
- `parentSessionKey` 是会话来源信息，不应在侧边栏中自动制造第二级分组；
- `parentId` 只作为旧数据兼容输入，读取和新建时统一归一为 `null`。

## 二、设计

两个明确视图，各自只回答一个问题：

```
█ 项目 / 工作组（手动，单层） —— 「这个项目内如何分类？」
· 时间（全局直接列表）         —— 「最近处理过哪些会话？」
```

### 1 · 工作线（原工作组，平铺化）

- 分组数据保存在各自 workspace 的 `sessionFolders` + `sessionFolderAssignments` 中；项目行即使只有一个项目也必须显示。
- 每条线一个**确定性颜色**（folder.id 哈希 → 8 色精选色板，dark/light 双主题调校）：
  - 头行：6px 色点 + 13px 名称 + 右侧计数/聚合状态（hover 时切为改名/删除）；
  - 成员行：左侧 2px **色轨**（色点同色 32% 透明，hover 提亮）——视觉上把成员绑进线里，替代缩进+chevron 的树形语法。
- legacy 嵌套数据读取时平铺为独立根级组，不显示路径前缀；新建一律根级。
- 同一个会话若被旧数据中的多个项目重复认领，只在第一个项目显示；拖放也拒绝跨项目归组。

### 2 · 时间视图

- 切换到时间排序后不显示项目、工作组、「今天 / 本周 / 更早」标签或 lineage 缩进。
- 所有属于当前 agent 的 workspace 会话按最近活动时间倒序直接显示。

### 3 · 归线菜单（一步完成「建线 + 归线」）

- portal 面板（沿用防裁切改造）：当前线打勾 → 「无工作组」→ 各线（色点 + 名称，最近使用置顶）→ 底部「**新建工作线…**」inline 输入，回车即**建线并把该会话归入**——把两步合成一步，是「辅助」的最小闭环。

### 4 · 项目归属靠置顶表头，不靠每行副标题（2026-08-19 修订）

问题：项目名曾以副标题挂在**每一条会话行**下面，行高因此从 30px 涨到 44px——为一个「同组内每行都一样」的事实付两行高度，而这个事实只在自己的表头滚出视野时才需要回答。

- 分区大标题在项目视图下改读「项目」（时间视图仍是「会话」），并 `position: sticky; top: 0` 置顶；
- **项目行随之置顶**，吸附在大标题下方（`--cdx-sticky-heading-h`），滚到列表深处仍能看到当前会话属于哪个项目；
- 每行副标题移除，行高回到官方 30px + 1px 节奏；项目名仍在该行 tooltip 里。

耦合约束（改动前必读）：折叠动画的内层裁切必须是 `overflow: clip` 而不是 `hidden`——`hidden` 会把元素变成滚动容器，置顶表头会被困在一个永不滚动的盒子里而失效；同理 `.task-collection-list` 上不能再放 `content-visibility: auto`。

### 5 · 会话右键菜单（迁移 / 分叉 / 接力 / 复制路径）

hover 操作条每加一个按钮就吃掉一截标题宽度，涨到 5 个时未读小圆点已经和状态球、按钮条挤在同一条右边缘上。因此：

- 偶发操作全部进入**右键菜单**（`SessionContextMenu`，沿用 `.codex-dropdown` 配方并 portal 到 `<body>`）：迁移工作线、重命名、标记未读、置顶、分叉、接力、复制工作路径、复制会话 ID、删除；
- hover 条只留下 pin / 迁移 / 重命名 / 删除四个，「标记未读」按钮撤销；
- 「迁移工作线」是**同一面板的第二页**而不是二级弹层——二级弹层要自己一套翻转碰撞与 hover 意图计时，第二页两者都不需要；
- 未读小圆点移到行左侧缩进空位（`--task-indent`），与状态球、按钮条彻底不再重叠；置顶图钉在 hover 时让位给按钮条。
- 接力需要草稿对话框，而那属于 chat 页：侧边栏切到该会话并在 `stores/session-intent.ts` 寄存一次性意图，chat 页确认 `currentSessionKey` 已跟上后再执行，过期意图直接丢弃。

## 三、不做什么

- 会话行可拖到同一项目的另一会话行，自动建线/并线；不做跨工作区拖拽，也不引入第二级嵌套。
- 不做自动打标、自动 lineage 缩进或日期分片。
- host API 保留 `parentId` 输入兼容，但归一化后不再持久化嵌套关系。
- 折叠态、状态点、移动菜单 portal 等既有能力全部保留。

## 四、验收锚点

- 单测：旧 parent 数据归一为根级、跨项目重复认领隔离、根会话活动时间倒序、改名/删除按 id 精确派发。
- e2e：单项目仍显示项目边界；时间视图无项目、分组、日期标签；菜单一步建线归线。
- 走查：mock fixture 同时包含旧 parent 数据和不同活动时间，用于验证迁移与排序。

## 五、历史验收结果（2026-08-11，已被 2026-08-18 修订取代）

**全绿。** `pnpm verify:render` = 48 单测 + 15 web e2e，exit 0；`tsc`/`eslint` 增量 0 错。

| 验收面 | 结果 | 证据 |
|---|---|---|
| 纯函数语义 | ✅ 7 例 | `tests/unit/session-workstreams.test.ts`（溯源吸附、链折叠、**环防丢**、时间分片边界、平铺路径、色板稳定） |
| 组件回归（F2/F3 不变式） | ✅ 11 例 | `tests/unit/session-folder-tree.test.tsx` + `sidebar-render-containment` 原样通过——testid 与按-id 派发全部保留 |
| e2e 交互 | ✅ 7 例 | `tests/e2e-web/sidebar-folder-tree.spec.ts`：平铺+前缀、改名/删除精确、移出、**溯源双场景**（线内+未归线）、时间分片、**一步建线归线** |
| 视觉（dark/light） | ✅ | `reports/assets/session-workstreams-20260811/`（01 静置、02 hover、03 归线菜单、04 菜单内建线、05 light） |

实施中顺带修复的真缺陷（都有测试锁定）：
1. **溯源数据断链**：`stores/chat.ts` 真正生效的 `loadSessions`（带 in-flight 去重的那份）从未解析 `parentSessionKey`/`forkedFromParent`——fork 来源信息在列表侧一直是丢的。已补齐。
2. **环状 parent 链会话静默消失**：两个会话互为 parent 时双双被判为子行、无宿主不渲染。`threadSessionsByLineage` 加 lost-and-found 兜底。
3. **归线菜单溢出视口**：旧定位只 clamp top 不算菜单高度，低处行/多线时菜单出屏。改为放不下即向上翻 + 超高滚动。

本轮文件增量（并入渲染线提交清单）：
`SessionFolderTree.tsx`（重写）、`session-buckets.ts`（+纯函数）、`codex-sidebar.css`（工作线样式段）、`stores/chat.ts`（lineage 解析）、`mock-host-bridge.ts`（fixture）、四语 `chat.json`（工作线术语+timeSlice/origin/newStream）、`session-workstreams.test.ts`（新）、`sidebar-folder-tree.spec.ts`（重写）、`scripts/capture-workstreams-evidence.cjs`（新）、本文档、`reports/assets/session-workstreams-20260811/`。
