# 会话工作线（Session Workstreams）— 分组交互重设计

> 2026-08-11 · 分支 `codex/ui-polish` · 替代「嵌套工作组」交互
> 结论先行：**砍掉嵌套，改为单层「工作线」+ 自动溯源链 + 时间分片**。

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
- 渲染端从未提供创建嵌套组的 UI——嵌套只是数据模型允许的意外形态；
- **溯源数据已经存在**：runtime 每个会话下发 `parentSessionKey`/`forkedFromParent`（`translator.ts:1482`），store 已解析（`session-actions.ts:141`），只是侧边栏从未消费。

## 二、设计

三个正交层，每层各答一个问题：

```
█ 工作线（手动，单层）   —— 「这属于哪条线的工作？」   粗分类，一步归线
⑂ 溯源链（自动，零成本） —— 「这从哪来？」            fork/handoff 子会话自动附着在源会话下
· 时间分片（自动，兜底） —— 「没整理的呢？」          今天 / 本周 / 更早
```

### 1 · 工作线（原工作组，平铺化）

- 数据模型不动（`sessionFolders` + `sessionFolderAssignments`，host API 原样）；**UI 只呈现单层**。
- 每条线一个**确定性颜色**（folder.id 哈希 → 8 色精选色板，dark/light 双主题调校）：
  - 头行：6px 色点 + 13px 名称 + 右侧计数/聚合状态（hover 时切为改名/删除）；
  - 成员行：左侧 2px **色轨**（色点同色 32% 透明，hover 提亮）——视觉上把成员绑进线里，替代缩进+chevron 的树形语法。
- legacy 嵌套数据平铺显示，名称前加淡色路径前缀（「审计回归 ⧸ 深层用例」），行为不变、数据无损。
- 新建一律根级。

### 2 · 溯源链（本设计的核心增量）

- `parentSessionKey` 命中同列表内父会话时，子会话**自动吸附**显示在父会话行之后：额外缩进 + 12×12 的 `└` 细连接线 + `⑂` 字形，tooltip「源自 ⟨父名⟩」。
- 纯自动：用户 fork/handoff 的那一刻分类就完成了，零整理成本——这直接回答「提示开发工作可溯源」。
- 防环 & 跨线：父会话不在当前列表（被删/另一条线）时子会话正常平铺，不做跨容器强吸附。

### 3 · 时间分片（兜底）

- 未归线会话按活跃时间切「今天 / 本周 / 更早」，10px 大写小标签，替代原来一坨平铺。

### 4 · 归线菜单（一步完成「建线 + 归线」）

- portal 面板（沿用防裁切改造）：当前线打勾 → 「无工作组」→ 各线（色点 + 名称，最近使用置顶）→ 底部「**新建工作线…**」inline 输入，回车即**建线并把该会话归入**——把两步合成一步，是「辅助」的最小闭环。

## 三、不做什么

- 不做拖拽（菜单先行；拖拽是后续增强，不影响本层结构）。
- 不做自动打标/AI 分类（溯源链已覆盖最大的自动分类面；语义打标属另一条产品线）。
- 不动 host API/存储结构；不迁移数据。
- 折叠态、状态点、移动菜单 portal 等既有能力全部保留。

## 四、验收锚点

- 单测：`session-buckets` 纯函数（溯源吸附防环/排序、时间分片边界）+ 组件回归（改名/删除仍按 id 精确派发）。
- e2e（web project）：F2/F3 语义不变式在新 UI 下重锁；新增：溯源行可见且缩进、时间分片标签、菜单一步建线归线。
- 走查：mock fixture 增加一条 fork 关系（审计回归验证 ⑂← 主会话）驱动全部视觉态；截图存证。

## 五、验收结果（2026-08-11 实施完成）

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
