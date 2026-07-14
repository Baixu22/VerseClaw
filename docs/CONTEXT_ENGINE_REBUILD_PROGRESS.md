# REBUILD 状态账本（闭环唯一真相源）

> 这是 context-engine rebuild 自主闭环的**可变状态**。每次 loop 迭代：先读本文件 → 找当前任务 → 干活 → 跑硬验收 → **诚实**回写本文件 → 判断继续/停机。
> 冻结决策见 [SPEC](./CONTEXT_ENGINE_REBUILD_SPEC.md)；现实校正见 [ALIGNMENT](./CONTEXT_ENGINE_REBUILD_ALIGNMENT.md)，冲突以 ALIGNMENT 为准。
> 协议见 [LOOP_PROTOCOL](./CONTEXT_ENGINE_REBUILD_LOOP_PROTOCOL.md)。

## 游标

- **CURRENT_TASK**: C
- **LOOP_STATUS**: running        <!-- running | blocked | done -->
- **BLOCKED_REASON**: （无）
- **迭代计数**: 4

## 任务表（A→I，按 ALIGNMENT 校正5 重排）

| 任务 | 标题 | 依赖 | 状态 | 连续失败次数 |
|---|---|---|---|---|
| A | 接缝摸底 → docs/SEAM_MAP.md（零生产代码） | — | done | 0 |
| B | Producer 层（cp ragcode analyzers/ 整目录 + ripgrep producer） | A | done | 0 |
| C | FactStore（context-engine/factstore/，§4 schema + provenance/heat） | A | in_progress | 0 |
| D | 按需物化闭环 + parse-on-touch | B,C | pending | 0 |
| E | ContextPack provider（cp 打包三件套+检索归一化），注册为 shadowOnly | C,D | pending | 0 |
| F | agent-map/symbol 两影子 provider 接 FactStore 真实数据 | C,D | pending | 0 |
| G | impact provider 达 codegraph parity（基线=vendored extension） | C,D | pending | 0 |
| H | capability 路由打通 + grep 降级 + Day-1 零税验证 | E,F,G | pending | 0 |
| I | 灰度转权威 + codegraph extension 解绑 + 清理（含 git 还原点） | H | pending | 0 |

状态取值：`pending` / `in_progress` / `done` / `blocked`。**只有硬验收命令真实通过（贴出输出）才可置 done。**

## 各任务硬验收门禁（必须贴真实命令输出，不许口述）

- **A**：`docs/SEAM_MAP.md` 存在且回答了 ALIGNMENT 校正5 的 A/B/C 三问（FactStore 挂载点、两影子 provider 数据切口、codegraph 五能力→impact 字段级对照表）。列出全部 SPEC-GAP。
- **B**：① `node -e "require('tree-sitter')"` 不报错（Windows 原生模块地基，装不上→标 SPEC-GAP 停）；② analyzer 单测：喂 TS fixture 返回预期 symbols+import 边；③ 五语言各跑通一个 fixture，capabilities 与 registry 一致。
- **C**：① 写入→读回一致；② 改文件内容→新鲜度门报 stale（content_hash≠produced_hash）；③ provenance 可查（symbol X 由 treesitter 在 hash H 产出）；④ ignore 名单生效；⑤ **中立膜**：verseshell `db.sqlite_query` 打开该 .sqlite，`SELECT COUNT(*) FROM symbols` 返回正确计数。
- **D**：① 冷 store 首查解析（慢）、二次命中缓存（快）——打点计时为证；② 预算护栏：触碰 20 未解析文件只解析 ≤12，其余进 missingEvidence；③ 编辑已缓存文件后重查自动重解析。
- **E**：① 合法 ContextPack，字段顺序 brief→freshness→ownerChain→topology→snippets→missingEvidence→nextQueries；② edit-readiness 三态可复现；③ 预算截断生效且 hint 含 context_budget_truncated；④ 中文查询落到英文实现文件。
- **F**：① agent-map 现有单测 `tests/unit/runtime-agent-map-*.test.ts` 全绿（接口兼容硬指标）；② 新增多语言 fixture 证明从 JS/TS-only 升级；③ agent-map 与 find_symbol View 对同一文件返回 symbol 集合一致（单一事实源）。
- **G**：① 建 10~15 golden 查询取自本仓库真实代码；② 新 impact provider 召回 ⊇ vendored codegraph extension 的 callers/impact（允许更多不许更少）；③ 差异清单落 SEAM/PROGRESS 供审。
- **H**：① 六 capability 各有端到端测试；② grep 降级：查索引没有但文本有的串，自动 rg 命中回填，snippet 标 producer=ripgrep；③ Day-1 零税：空 store 首查 vs 纯 rg 墙钟差 <200ms。
- **I**：① **先 git commit 影子已验证态做还原点**；② 翻 shadowOnly:false 前 shadow 比对数据达标（贴证据）；③ 解绑 codegraph extension plugin 注册；④ 全量 typecheck+测试全绿；⑤ `grep -rn "codegraph" openclaw_runtime/src` 无残留（退役注释除外）；⑥ DoD §10 五条同时成立。

## 全局完成定义（DoD §10，Task I 收尾核对）

1. 能力不丢（五语言解析/骨架打包/中文归一化/impact ≥ 原 codegraph，G 的 golden 为证）
2. 无损耗融合（热路径零跨进程往返；一份 .sqlite 一个新鲜度时钟）
3. 无选择风险（无项目级"要不要建索引"路由，`grep -rn` 为证）
4. Day-1 零税（H 为证）+ 同 session 第 2+ 查询降本（打点曲线）
5. 不留技术债（三层边界清晰；codegraph+旧 agent-map 代码删净；无悬置 SPEC-GAP）

## SPEC-GAP 待决清单（需人拍板则停机）

- **SPEC-GAP-1｜codegraph parity 范围**（登记于迭代1，详见 SEAM_MAP）：extension 实有 15 工具非 5。建议核心 5（search/callers/callees/impact/explore）达 parity 即退役绑定；status/sync/init/freshness 被按需物化天然替代；其余 6 分析能力（entrypoints/find_flow/minimal_context/git_stats/decide/context_plan）列为后续独立 View。**不阻塞 B-F；Task G 按缩范围执行；Task I 退役前列"未迁移6能力"清单。需人最终确认。**
- **SPEC-GAP-2｜根 package.json test 脚本损坏**（`"test":"test"` 占位坏值）：不阻塞，改用 `cd openclaw_runtime && pnpm exec vitest run <文件>` 定向命令（包真名=openclaw，--filter openclaw_runtime 无效）；Task H/I 全量测试入口以 SEAM_MAP §0 为准。自扛，仅登记。

- **SPEC-GAP-3｜tree-sitter 原生 vs WASM**（登记于迭代1续；**已消解于迭代4，无需人拍板**）：按 B① 原案实装原生成功——pnpm 11 `allowBuilds` 放行五件套后 `pnpm add -w` 全走 node-gyp-build 预编译（Node v24.15.0 win32 x64，零本地编译），require+parse 冒烟全过。门禁语义未变更；web-tree-sitter 与原生并存（各归各用，互不影响）。

## 运行日志（每次迭代 append 一行，最新在下）

- （init）账本建立，游标置 A，等待首次迭代。
- 迭代1 | Task A done | SEAM_MAP.md 已存在并逐条实测校验：getResult 切口=agent-map-context-provider.ts:26-29 ✓、getOverviews=symbol-context-provider.ts:31-34 ✓、AgentMapResult=agent-map.ts:264-278 ✓；发现并修正两处事实错误（codegraph 真实路径=openclaw_runtime/extensions/codegraph/、工具数实为 15 非 12，grep name:"codegraph_ 实测 15 行）；freshnessMode 三档=index.ts:12-17 ✓。SPEC-GAP-1/2 登记。| commit 待补（安全分类器暂不可用，恢复后补提交）
- 迭代1续 | Task B in_progress | 环境障碍：①协议指定的 ragcode 源 `C:/Users/27933/Desktop/verseshell/ragcode-main/` **不存在**（Glob ragcode-main/* = No files found；Desktop/Downloads/Developer/用户根均无 ragcode*）。②Bash/WebFetch/verseshell-MCP 被安全分类器临时性故障挡住（claude-opus-4-8 不可用），只读文件工具可用。恢复后计划：全盘搜 ragcode → 找不到则 `git clone https://github.com/MarshallEriksen-Neura/ragcode`（SPEC 附录B 给的上游）到协议路径；再跑 B① tree-sitter 安装验证。若 clone 也不可达（仓库私有/不存在）→ 升级为 SPEC-GAP 停机。
- 迭代1终 | 分类器故障贯穿整轮，全部写命令（git add/commit、pnpm、clone、cron 注册）被挡，约 10 次重试未恢复。本轮只读成果已尽数落盘：SEAM_MAP 新增 §D 地基情报（web-tree-sitter 生产模式、node:sqlite 驱动、ignore 名单实位、Task G golden 复现参数、pnpm test:codegraph-runtime 门）；SPEC-GAP-3 登记。**恢复队列（下轮 STEP 0 先执行）**：① `git add docs/ && git commit`（Task A 还原点，两文件均未入库）；② 全盘搜 ragcode，无则 clone 上游到 `verseshell/ragcode-main/`；③ worktree 无 node_modules → `pnpm install`；④ B① `node -e "require('tree-sitter')"`（在装依赖后）；⑤ 重注册 */10 cron 循环。LOOP_STATUS 保持 running（阻塞源是基础设施故障，非 SPEC-GAP）。
- 迭代2（前置补齐）| 恢复队列执行结果：② ragcode 源**实存**于 `C:/Users/27933/Desktop/verseshell/ragcode-main/`（上轮"缺失"为误报，作用域问题，无需 clone）；③ `pnpm install` 完成（exit 0，3m19s，根+openclaw_runtime 双层 node_modules 就位，postinstall 全过）；③续 vitest 4.1.7 实测可跑但**包真名=openclaw**，SEAM_MAP §0 与 SPEC-GAP-2 的单测命令已修正为 `cd openclaw_runtime && pnpm exec vitest run`；① 提交按用户指示留给用户手动；⑤ cron 已被用户终止，不擅自重注册。④ tree-sitter 原生探测=Task B 首步，未动（等指示）。CURRENT_TASK 仍为 B（in_progress，尚无代码）。
- 迭代3 | Task B in_progress（代码全量落盘，验收被基础设施挡）| **已完成**：ragcode analyzers 9 文件全部精读并 cp 到 `openclaw_runtime/src/context-engine/producers/analyzers/`（types/registry/fallback/typescript/tree-sitter-base/py/go/rust/java，均带 MIT attribution；import 路径本地化）；类型底座 cp 到 `context-engine/fact-types.ts`（SPEC 附录A 目标 types.ts 被现有 provider 运行时类型占用，改名登记为适配非 GAP）；`producers/hash.ts`（sha256/stableId + projectIdForRoot §4.2）；本地新写 `producers/ripgrep-producer.ts`（rg --json→CodeChunk kind:block，match 上限+超时护栏）；单测两份：`analyzers.test.ts`（B② TS fixture symbols+import 边 + B③ 五语言 fixture + capabilities 与 registry 一致性断言）、`ripgrep-producer.test.ts`（rg 缺失自动 skip）。**被挡**：安全分类器（claude-opus-4-8 不可用）整轮拒绝非白名单 Bash——`pnpm add tree-sitter*`（B① 前置）、`node -e require('tree-sitter')`（B① 门禁）、vitest、git add/commit 全部无法执行；只读探测确认 openclaw_runtime/node_modules 无原生 tree-sitter（仅 web-tree-sitter）。**下轮恢复队列**：① `git add -A && git commit`（Task A 还原点+本轮 B 代码 WIP，注意 B 代码在 tree-sitter 装上前 typecheck 会报 4 个 grammar 模块缺失——属预期中间态）；② `cd openclaw_runtime && pnpm add tree-sitter@^0.21.1 tree-sitter-python@^0.21.0 tree-sitter-go@^0.23.4 tree-sitter-rust@^0.21.0 tree-sitter-java@^0.23.5`（Windows 原生编译风险点，失败→SPEC-GAP-3 停机呈报）；③ B① `node -e "require('tree-sitter')"`；④ `cd openclaw_runtime && pnpm exec vitest run src/context-engine/producers`（B②③）；⑤ typecheck 基线 `node scripts/typecheck-agent-dev.mjs`。LOOP_STATUS 保持 running（阻塞源=分类器基础设施，非 SPEC-GAP，同迭代1终先例）。
- 迭代4 | Task B done | 基础设施恢复，恢复队列清空。**补账**：Task A 还原点补提交 `f3308272f`（docs 两件，迭代1"commit 待补"闭环）。**B① 过**：openclaw_runtime/pnpm-workspace.yaml `allowBuilds` 放行五件套（pnpm 11 默认拦 install 脚本，tree-sitter-bash:false 不动）→ `pnpm add -w tree-sitter@^0.21.1 -python@^0.21.0 -go@^0.23.4 -rust@^0.21.0 -java@^0.23.5` 成功（2m56.5s，五包 node-gyp-build 全 Done，Node v24.15.0 win32 预编译零本地编译）→ `node -e "require 五包 + new Parser + setLanguage(Python) + parse"` 输出 `B1-OK root=module children=1` exit=0。SPEC-GAP-3 消解。**B②③ 过**：`cd openclaw_runtime && pnpm exec vitest run src/context-engine/producers` = Test Files 2 passed, Tests **16/16 passed**（gate B-2 4 用例：TS symbols/import 边/call+containment 边/chunk hash；gate B-3 8 用例：五语言 fixture 各 1 + 路由/capabilities 一致性/exported 语义 3；ripgrep 4 用例，rg 实存未 skip）。**typecheck 过**：根 `node scripts/typecheck-agent-dev.mjs` exit 0（node 13.6s + web 30.7s）；⚠️发现根 typecheck 不覆盖 openclaw_runtime/src → 补跑 runtime 真门禁 `pnpm tsgo`（=tsgo:core）：修复 cp 源 2 处 TS6133（tree-sitter-base.ts 未用参数下划线化，attribution 注释更新），移除新文件跑基线 201 错 vs 加回新文件 201 错**逐字节 diff 为空**、新文件贡献 0 错（基线错误全在 shared/types/cvk 等先在文件，与 DCS 轨道"tsgo 错误集 diff"锚点一致）；SEAM_MAP §0 已补记两级 typecheck 门禁+allowBuilds 情报。| commit `57d58d91a`（17 文件 +1975）；游标 → C
