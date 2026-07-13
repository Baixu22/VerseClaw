# REBUILD 状态账本（闭环唯一真相源）

> 这是 context-engine rebuild 自主闭环的**可变状态**。每次 loop 迭代：先读本文件 → 找当前任务 → 干活 → 跑硬验收 → **诚实**回写本文件 → 判断继续/停机。
> 冻结决策见 [SPEC](./CONTEXT_ENGINE_REBUILD_SPEC.md)；现实校正见 [ALIGNMENT](./CONTEXT_ENGINE_REBUILD_ALIGNMENT.md)，冲突以 ALIGNMENT 为准。
> 协议见 [LOOP_PROTOCOL](./CONTEXT_ENGINE_REBUILD_LOOP_PROTOCOL.md)。

## 游标

- **CURRENT_TASK**: A
- **LOOP_STATUS**: running        <!-- running | blocked | done -->
- **BLOCKED_REASON**: （无）
- **迭代计数**: 0

## 任务表（A→I，按 ALIGNMENT 校正5 重排）

| 任务 | 标题 | 依赖 | 状态 | 连续失败次数 |
|---|---|---|---|---|
| A | 接缝摸底 → docs/SEAM_MAP.md（零生产代码） | — | pending | 0 |
| B | Producer 层（cp ragcode analyzers/ 整目录 + ripgrep producer） | A | pending | 0 |
| C | FactStore（context-engine/factstore/，§4 schema + provenance/heat） | A | pending | 0 |
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

（迭代发现后追加于此。空=无阻塞。）

## 运行日志（每次迭代 append 一行，最新在下）

- （init）账本建立，游标置 A，等待首次迭代。
