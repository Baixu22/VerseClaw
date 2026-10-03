# ClawX Coding 能力深度优化调研报告

> 2026-07-14 | 基于 ClawX 自身架构阅读 + 10 个外部工具/论文的 anysearch 调研
>
> 历史快照：本文保留 2026-07-14 的调研结论与数据；P0 后续处理见 [2026-08-15 收尾记录](P0-FIX-DISPATCH-CLOSEOUT-2026-08-15.md)，当前进度见 [最新交接](../../docs/dev/handoffs/LATEST.md)。

---

## 一、ClawX 当前架构：优势与差距

### 1.1 读能力 (Reading)

| 维度 | ClawX 现状 | 评级 |
|------|-----------|------|
| **文本搜索** | Grep/ripgrep 工具可用，model 自主调用 | ✅ 基础完善 |
| **结构化索引** | codegraph 插件被 Electron env 屏蔽，CVK codebase-index 仅有元数据(files/symbols checksum)无内容级代码理解 | ❌ 致命缺口 |
| **Context Engine** | 可插拔生命周期(bootstrap→maintain→assemble→compact→afterTurn)，CVK 编译系统，DCS Block 体系(8 种 Block) | ✅ 架构先进 |
| **Context Block** | 8 种 Block(persona/task_state/working_memory/tool_registry/knowledge/experience/environment/notes)，5 flags 全 off | ❌ 电死 |
| **Context 工具** | context_read/search/write 工具存在(D1-D2)，但未注册为 agent tools | ❌ 致命 |
| **CVK System Prompt** | 编译 toolset/skill/project_rule → checksum + compact view + selectors，max 8000 chars | ✅ 可用 |
| **记忆系统** | Routing memo (JSONL append-only，Jaccard 相似度)，Shadow/Active 两阶段路由 | ✅ 创新设计 |
| **Compaction** | 通过 delegate 桥接到内建 compactEmbeddedAgentSessionDirect | ✅ 可用 |

**短任务读**：grep + file read 基本够用，ClawX 不缺基础工具。
**长任务读**：缺少结构性代码理解(调用链/继承图/影响分析)，导致 agent 靠反复 grep+read 探索，token 消耗巨大。这是 ClawX 读能力的**最大短板**。

### 1.2 写能力 (Writing)

| 维度 | ClawX 现状 | 评级 |
|------|-----------|------|
| **Edit 工具** | 精确字符串替换(oldText→newText)，去重检测，LF 归一化 | ✅ 成熟 |
| **Write 工具** | 全文件覆写，mkdir -p，readback 幂等验证 | ✅ 成熟 |
| **Apply Patch** | OpenAI 风格 patch envelope 解析(Add/Update/Delete/Move chunks)，WorkingMemory envelope | ✅ 成熟 |
| **沙箱** | 无 bubblewrap/Docker 级隔离 | ⚠️ 待加强 |
| **事务回滚** | 无 write transaction / rollback 机制 | ❌ 缺失 |
| **工具竞争分组** | Resource Scheduler 按 shell/write 分组串行化 | ✅ 基本可用 |

**短任务写**：Edit + Write + Apply Patch 三件套足够稳定。
**长任务写**：缺少事务回滚和沙箱隔离是主要风险。多步修改失败后无法回滚，只能依赖 git。

### 1.3 并发写能力 (Concurrent Writing)

| 维度 | ClawX 现状 | 评级 |
|------|-----------|------|
| **Worktree 隔离** | Agent tool 支持 worktree 隔离(isolation: "worktree") | ✅ 可用 |
| **工具竞争分组** | Resource Scheduler 按 shell/write 分组避免工具冲突 | ✅ 基本可用 |
| **Blackboard 冲突检测** | Claim 级别冲突检测(normalized subject + conclusion) | ✅ 创新 |
| **AST/文件级锁** | 无 | ❌ 缺失 |
| **Merge 自动化** | 无(依赖 git merge) | ❌ 缺失 |
| **并发写事务** | 无 | ❌ 缺失 |

**核心问题**：worktree 隔离 + git merge 是 post-hoc 冲突解决，agent 工作完成后才合并——此时可能已经基于不一致的假设做了大量工作。Blackboard 检测到 claim 级别的冲突但没有文件级别的并发控制。

---

## 二、外部工具深度对比

### 2.1 Claude Code (Anthropic)

**架构范式**：while-loop 单 agent + 多层 context 管理

**读能力**：
- **5 层 Compaction Pipeline**：不是简单截断，而是阶梯式处理：summarize → archive → compress → truncate → emergency
- **CLAUDE.md 系统**：透明、可版本控制的文件式记忆，用户可见可编辑
- **Context-as-Scarce-Resource**：将 context 视为稀缺资源进行渐进式管理，是设计第一原则
- **无结构化代码索引**：Claude Code 也依赖 grep + file read，没有 tree-sitter 索引——但通过 compaction 减少 token 浪费
- **Subagent delegation**：子 agent 独立 context，通过 JSON 回传结果

**写能力**：
- **Reversibility-weighted risk assessment**：可逆操作(read/file read)低门槛，不可逆操作(shell/bash)需要高级别权限
- **Defense in depth**：多层安全(permission system + sandbox + deny-first)
- **Edit 工具**：精确字符串替换，与 ClawX 相同模式
- **无事务回滚**：依赖 git + 人工审查

**并发写**：
- **Worktree isolation**：每个 subagent 在独立 git worktree 中运行
- **12 个隔离原则**：子 agent 不共享 parent context/permissions
- **Post-hoc merge**：依赖标准 git merge 解决冲突

**关键数字**：
- AI 决策逻辑仅占代码 1.6%，98.4% 是 operational infrastructure
- 93% 用户批准率下，改为 auto-mode 分类器而非更多警告
- 750 session 后才达到 40%+ auto-approve 率

**ClawX 可借鉴**：
1. 5 层 Compaction 的渐进式思路(vs ClawX 当前单层 compact)
2. Context-as-scarce-resource 作为架构第一原则
3. 可逆性加权风险评估(Read < Write < Shell)
4. File-based transparent memory (ClawX 已有 routing memo JSONL，可扩展)

### 2.2 Codex CLI (OpenAI) — v0.142 系列 (2026-06)

**架构范式**：Rust 重写 + SQLite 持久化 + 分层工具系统 + 结构化索引通过 MCP

**读能力**：
- **四层检索模型** (行业共识架构)：
  - Layer 1: grep/ripgrep (广泛覆盖、低成本)
  - Layer 2: Tree-Sitter AST (结构约束)
  - Layer 3: LSP / Type Resolution (符号级精度)
  - Layer 4: Semantic Embeddings (概念相似度)
- **Tool Search (v0.142.2)**：BM25 驱动的按需工具发现，defer_loading 减少 90% 工具 schema token 消耗
- **codebase-memory-mcp 集成**：外部 MCP server 提供 Tree-sitter KG，Django 6 秒索引(49K nodes, 196K edges)，Linux kernel 3 分钟(4.81M nodes, 7.72M edges)
- **120x token 节省**：对于导航查询，从 412K tokens (逐文件探索) → 3.4K tokens (图查询)
- **AGENTS.md 导航协议**：编码多文件变更的检索策略到项目规则

**写能力**：
- **Apply Patch (Lark grammar)**：形式化补丁解析和验证，比 Claude Code 的字符串替换多了结构化验证层
- **Bubblewrap Sandbox**：Linux 内核级沙箱隔离
- **SQLite Thread Persistence**：跨进程重启的 session 持久化
- **Rollout Token Budgets**：三层花费控制(per-goal / per-rollout / per-account)，超支自动 abort

**并发写**：
- **Hierarchical multi-agent**：spawn_agent / wait_agent / send_input / close_agent 四件套
- **3 种 Delegation 模式**：disabled / explicit-request-only / proactive
- **max_threads + max_depth**：并发度和嵌套深度都受控
- **Rollout Token Budget 跨 agent 共享**：所有 subagent 的 token 消耗统一追踪

**关键数字**：
- 67K+ GitHub stars，10-15 commits/day
- 500 万周活跃用户(2026-06)
- v0.142: 194 changes (39 features, 22 improvements, 12 perf, 98 fixes)

**ClawX 可借鉴**：
1. **四层检索模型是行业共识**——ClawX 需要补 Layer 2-4
2. Tool Search / defer_loading 模式可大幅压缩 tool schema token
3. 结构化 apply_patch 验证(Lark grammar level)
4. Rollout token budgets 模式
5. Delegation 模式三级控制

### 2.3 Cursor (Anysphere)

**架构范式**：VS Code fork + 双模型架构(稀疏补全 + 前沿生成) + 混合检索

**读能力**：
- **Merkle Tree 差分索引**：代码库 92% 相似度复用团队索引，新成员从小时级→秒级
- **AST 语义分块**：按函数/类/方法边界分块(非 256-token 机械切分)，tree-sitter 40+ 语言
- **混合检索**：Embedding 语义搜索 + 依赖图遍历，多轮检索(Pass 1: ANN → Pass 2: 依赖图遍历 → Pass 3: 重排序)
- **768 维 Embedding**：turbopuffer 托管，1T+ vectors / 80M+ namespaces
- **每轮重新摘要**：不是线性堆积消息，而是每轮重新精炼 storyline

**写能力**：
- **Speculative Edits**：70B 模型→~1000 tokens/s (13x 加速)，源文件作为"草稿 token"
- **Reinforcement Learning 反馈环**：每 90 分钟基于用户接受/拒绝重训练
- **Revert 能力**：可回退到任意历史步骤

**并发写**：无公开多 agent 并发架构信息(Cursor 主要是单人使用模式)

**关键数字**：
- 400M+ AI requests/day，~100 工程师
- $1B ARR in 24 months
- 语义搜索提升 12.5% 准确性

**ClawX 可借鉴**：
1. 混合检索(向量语义 + 依赖图 + 重排序)是 Cursor 的护城河
2. Token 高效的上下文摘要(每轮重写而不是线性堆积)
3. Merkle Tree 差分索引的理念(团队/企业场景)

### 2.4 Aider

**架构范式**：Python 单 agent + RepoMap + tree-sitter 符号提取 + PageRank 排序

**读能力**：
- **RepoMap**：tree-sitter 提取所有文件的关键符号(函数签名/类定义)，构建文件依赖图
- **PageRank 图排名**：在 token 预算内选择最相关的代码部分，默认 1K tokens
- **动态调整**：无文件时自动扩展到 8x (map_mul_no_files=8)
- **Tree-sitter Language Pack**：支持 50+ 语言的符号提取标记

**写能力**：
- **Git 作为安全网**：每个 change 自动 commit，Git rollback 是主要安全机制
- **Edit Formats**：多种编辑策略(editor diff / search replace / whole file)
- **Linting/Dry-run**：修改后自动检查

**并发写**：无多 agent 支持(单 agent 模型)

**ClawX 可借鉴**：
1. RepoMap 的 PageRank 排名算法——如何从大型 repo 中选出最相关的 1K tokens
2. Tree-sitter 符号提取的 tag 查询模式
3. Token 预算驱动的动态调整机制

### 2.5 Windsurf (Codeium)

**架构范式**：VS Code 兼容 + 双 AI 层(SWE-1 规划 + 前沿模型生成) + Cascade 状态机

**读能力**：
- **RAG 代码库索引**：768 维 embedding + M-Query 检索(改进 cosine similarity)
- **Cascade 状态机**：实时追踪编辑/终端输出/导航历史，非静态上下文
- **多层 Context Pipeline**：Rules → Memories → Open Files → Indexed Snippets → Recent Actions
- **`.windsurfrules`**：项目级+全局规则系统（类似 CLAUDE.md 但分层）

**写能力**：
- **Cascade Write/Agent 模式**：最多 25 个 tool calls/prompt，支持 continue
- **Revert 能力**：可回退到任意步骤
- **Auto-Execution Modes**：Off / Auto / Turbo 三级

**并发写**：无多 agent 并发架构

**ClawX 可借鉴**：
1. Cascade 的实时 action tracking 注入上下文
2. M-Query 的检索精度提升思路
3. 多层规则系统(global → project → session)

### 2.6 Factory AI

**架构范式**：Coordinator + 专用 Droid 角色(Code/Review/Test/Docs/Knowledge) + Missions 分解

**读能力**：
- **Knowledge Droid**：专用 agent 索引 repo/docs/tickets，向下游 droid 提供共享上下文
- **Deferred Context Engine**：MCP tools/skills/plugins 按需加载，不加载全量 schema
  - 平均减少 15.1% input tokens
  - p90 减少 39.4%
  - 100+ tools 时减少 50.8%
- **Context Dilution Prevention**：确保每个 agent 轨迹里只有相关上下文

**写能力**：
- **TDD at Two Levels**：Worker 写测试+代码，Validator 独立验证
- **Separation of Concerns**：实现者和验证者是不同 agent，避免自我评估偏差
- **Missions 系统**：大任务自动分解成独立验证的微任务

**并发写**：
- **Coordinator → Worker 模式**：单协调者分配+多 worker 并行执行
- **Sandboxed Cloud Workspaces**：每个 droid 在隔离环境中运行
- **Validator → Orchestrator → Fix Worker**：验证失败不自动修复，而是创建新的 fix feature

**ClawX 可借鉴**：
1. Deferred Context Engine 的按需加载模式 = ClawX tool_registry Block 的理想形态
2. Knowledge Droid 的概念 = ClawX CVK codebase-index 的内容层升级
3. 实现/验证分离是防止自我评估偏差的关键(ClawX Orchestrator 已有 verifier 角色但未完全实现)

### 2.7 Codebase-Memory MCP (DeusData)

**架构范式**：Tree-sitter 知识图谱 + MCP 协议 + Hybrid LSP 语义解析

**读能力**：
- **158 语言** tree-sitter 解析 + **10 语言** Hybrid LSP(类型解析)
- **多阶段并行 Pipeline**：Parse → Build → Serve
- **Property Graph**：Function/Class/Route 节点 + CALLS/IMPORTS/DEFINES/IMPLEMENTS/INHERITS/HTTP_CALLS 边
- **120x Token 节省**：412K → 3.4K tokens (导航查询)
- **83% Answer Quality** vs 92% 文件探索 agent，但 10x tokens 和 2.1x tool calls 减少
- **Sub-ms 查询延迟**：Django 49K nodes 6 秒索引，Linux Kernel 4.81M nodes 3 分钟
- **14 MCP Tools**：get_architecture, search_graph, search_code, trace_path, detect_changes, semantic_query, find_dead_code

**关键限制**：
- 83% answer quality 意味着不能单独使用——必须与 text search 组合
- 图质量在生成代码上退化
- Cross-module type resolution 只覆盖 10 种语言

**ClawX 可借鉴**：这是 ClawX **读能力最短路径升级**——通过 MCP 集成 codebase-memory-mcp，补上 Layer 2-3 结构化检索，无需自己实现 tree-sitter 管线。

---

## 三、并发写专项调研

### 3.1 主流方案矩阵

| 方案 | 隔离级别 | 冲突解决 | 合并方式 | 语言支持 | 效果 |
|------|---------|---------|---------|---------|------|
| **Git Worktree** (Claude Code / Codex) | 进程级 | 事后 git merge | Text diff | 全语言 | 冲突率高 |
| **Grit** | AST 函数级 | 事前符号锁 | 自动 rebase + merge | 13 语言 | 50 agents 0 冲突 |
| **STORM** | 文件依赖级 | 写时检测+拒绝 | Agent 重试 | 全语言 | +18.7 Commit0-Lite |
| **CoAgent (MTPO)** | 事务级 | 通知-修复 | Saga 逆操作 | 工具级 | 63/71 pass rate |
| **CodeCRDT** | CRDT 级 | 自动收敛 | 无冲突合并 | 全语言 | 100% 收敛 |
| **CAID** | 进程级 | 分支+merge | Git merge | 全语言 | +26.7% PaperBench |
| **ClawX 当前** | Worktree 隔离 | Blackboard claim 检测 | Git merge | 全语言 | 无数据 |

### 3.2 关键洞察

**Grit 的 AST 函数级锁是最成熟的生产方案**：
- 在同一个文件里，Agent-1 lock `login()`，Agent-2 仍可以编辑 `logout()`
- 13 种语言 tree-sitter 提取符号，SQLite/Azure/S3 后台存锁状态
- 50 agents x 原始 git → 90% work wasted；Grit → 0%
- 但只有 101 GitHub stars(实验性项目)

**STORM 的 "写时检测" 模型更通用**：
- 不要求 AST 解析→所有语言可用
- Agent 写文件时检查其读过的依赖文件是否被其他 agent 修改
- 如有冲突→拒绝写入→返回最新内容→agent 基于正确基线重试
- Commit0-Lite +18.7，PaperBench +1.4

**CoAgent (MTPO) 最学术前沿**：
- 利用 LLM 自身判断冲突写是否无效化其计划
- 运行时通知而非锁阻塞
- Saga 风格的逆操作实现 undo
- $1.4\times$ speedup，near-serial token cost

**ClawX 并发写推荐路径**：
1. **短期**：在现有 worktree 隔离上叠加 **STORM 式依赖检测**（检测 agent 读过的文件是否在写之前被修改）
2. **中期**：引入 **Grit 式 AST 函数锁**（通过外部 tree-sitter MCP 或自建）
3. **长期**：探索 **CoAgent 式 LLM 辅助冲突判断**（ClawX 的 Blackboard 已有 claim 检测，是天然基础）

---

## 四、学术论文补充

| 论文 | 时间 | 核心发现 | ClawX 启示 |
|------|------|---------|-----------|
| **LoCoEval** (Liu et al.) | 2026-03 | 首个长对话上下文管理 benchmark，64K-256K tokens，50 turns，最佳方法(Mem0R)统一会话+仓库信息到单一记忆 | Context Engine 的 DCS Block 体系正好对应这个"统一记忆"思路 |
| **CatCoder** | 2026 | 类型上下文 + 检索提升代码生成 | CVK tool_registry 加入类型信息 |
| **Code Isn't Memory** (Bhola et al.) | 2026-06 | 结构化索引在 harness 内嵌比外部 tool 暴露更好，索引+grep 互补 | 考虑将结构性索引能力嵌入 Context Engine 而非仅依赖工具调用 |
| **Codebase-Memory** (Vogel et al.) | 2026-03 | Tree-sitter KG via MCP，83% vs 92% 质量但 10x tokens 2.1x tool calls 减少 | 通过 MCP 集成是最快路径 |
| **STORM** (Liu et al.) | 2026-05 | 文件级状态管理的多 agent 协作，比 worktree 隔离 +18.7 | 并发写升级首选参考 |
| **CoAgent/MTPO** (Lyu et al.) | 2026-06 | LLM 辅助并发控制，Saga undo，$1.4\times$ speedup | 前沿方向，长期参考 |
| **CodeCRDT** (Pugachev) | 2025-10 | CRDT 无锁并行代码生成，100% 收敛，但 5-10% 语义冲突率 | 理论有趣但生产风险高 |
| **CAID** (Geng & Neubig) | 2026-03 | Branch-and-merge 是 central coordination mechanism，isolated workspaces + test-based verification | ClawX Orchestrator 可参考的 coordination 模式 |

---

## 五、ClawX 优化路线图(分优先级的可执行方案)

### P0 — 修复致命缺陷 (1-2 周)

| # | 问题 | 方案 | 参考 |
|---|------|------|------|
| D1 | context_read/search/write 未注册为 agent tool | 修复 `createDcsContextAgentTools` 的注册链路 | [context-agent-tools.ts](../../openclaw_runtime/src/agents/tools/context-agent-tools.ts) |
| D2 | task_phase_change 零 producer | 在 orchestration lifecycle 中挂接 phase change 通知 | |
| D3 | 5 flags 全 false | 至少开启 working_memory + tool_registry flags | |
| D4 | CVK codebase-index 仅有元数据 | 补内容级代码符号提取(调用关系/类型引用) | Aider RepoMap tree-sitter 模式 |

### P1 — 读能力：结构化代码检索 (3-4 周)

| 方案 | 难度 | 收益 | 说明 |
|------|------|------|------|
| **A. MCP 集成 codebase-memory-mcp** | 低 | 高 | 最快补上 Layer 2-3，158 语言，sub-ms 查询，120x token 节省。14 个 MCP tools 直接可用 |
| **B. 自建 Tree-sitter 索引** | 高 | 高 | 更深集成(如嵌入 Context Engine、自动注入 CVK system prompt)，可控性强 |
| **C. Aider 式 RepoMap** | 中 | 中 | 轻量级方案：只提取符号签名 + PageRank，不需要完整 KG |

**推荐路径**：A(立即集成 codebase-memory-mcp) → B(逐步将结构化索引嵌入 Context Engine)

### P2 — 写能力：稳定性增强 (2-3 周)

| # | 方案 | 参考 |
|---|------|------|
| 1 | **Write Transaction + Rollback**：多步写入操作前 snapshot，失败后 restore | Codex SQLite persistence + Claude Code reversibility-weighted |
| 2 | **Apply Patch 结构化验证**：在现有 patch parser 上增加 tree-sitter AST 级验证 | Codex Lark grammar apply_patch |
| 3 | **Sandbox 加强**：Shell 命令执行隔离 | Codex bubblewrap / Factory cloud sandbox |

### P3 — 并发写：从 Worktree 到 AST 锁 (4-6 周)

| 阶段 | 方案 | 参考 |
|------|------|------|
| **Phase 1: 写时依赖检测** | 在 agent 写入前检查其 read set 中的文件自上次读取后是否被修改，如有冲突则拒绝+返回最新内容 | STORM |
| **Phase 2: AST 函数级锁** | 通过 tree-sitter 提取函数/类/方法边界，agent claim 具体符号而非整个文件 | Grit |
| **Phase 3: LLM 辅助冲突判断** | 利用 Blackboard 现有 claim 检测 + LLM 判断冲突是否需要修复 | CoAgent / MTPO |

### P4 — Context 管理：对标 Claude Code 的 5 层 Compaction (2-3 周)

| 层级 | 方案 |
|------|------|
| **Summarize** | 当前已有(compact 触发摘要) |
| **Archive** | 将旧 context block 移到 archive store |
| **Compress** | 压缩中间 tool outputs(Codex `tool_output_token_limit` 模式) |
| **Truncate** | Token-pressure 驱动的截断 |
| **Emergency** | 极端情况的 fallback |

### P5 — Tool Registry 按需加载 (2-3 周)

| 方案 | 参考 |
|------|------|
| Tool search / deferred loading：MCP tools 不全部加载到 prompt，按需通过 BM25/text-search 发现 | Codex v0.142.2 + Factory Deferred Context Engine |
| Tool 分类预加载：常用工具(edit/write/bash)预加载，长尾 MCP tools 按需 | 15-50% prompt token 节省 |

### P6 — 知识层增强 (中长期)

| 方案 | 参考 |
|------|------|
| Knowledge Droid 概念落地：专用 codebase context provider，下游 agent 无需重复探索 | Factory |
| 统一记忆系统：将 conversation history + repository structure 统一到一个记忆层 | LoCoEval Mem0R |

---

## 六、ClawX vs 竞品总览表

| 维度 | ClawX | Claude Code | Codex CLI | Cursor | Aider | Factory |
|------|-------|-------------|-----------|--------|-------|---------|
| **代码搜索** | grep | grep | grep + MCP KG | 混合(向量+依赖图) | grep + RepoMap | Knowledge Droid |
| **结构化索引** | ❌ (codegraph 屏蔽) | ❌ | MCP 外部 | ✅ AST+向量+依赖图 | ✅ tree-sitter 符号 | ✅ Knowledge Droid |
| **Context 管理** | CVK + DCS Block(电死) | 5层 Compaction | SQLite 持久化 | 每轮重摘要 | Map Cache | Deferred Context |
| **Write 工具** | Edit/Write/Patch | Edit | apply_patch(Lark) | Speculative Edits | Edit Formats | Missions |
| **事务回滚** | ❌ | ❌ | SQLite 持久化 | ✅ Revert | Git commit | ❌ |
| **沙箱** | ❌ | 权限层 | Bubblewrap | IDE 内 | Git | Cloud Sandbox |
| **并发隔离** | Worktree | Worktree | Worktree | N/A | N/A | Cloud Workspace |
| **并发锁** | 工具竞争分组 | ❌ | ❌ | N/A | N/A | ❌ |
| **并发冲突** | Blackboard claim | Git merge | Git merge | N/A | N/A | Validator |
| **多 agent 协作** | Orchestrator Wave | Subagent | spawn_agent | N/A | N/A | Coordinator+Droid |
| **记忆系统** | Routing Memo | CLAUDE.md | AGENTS.md | .cursorrules | .aider.conf | .factoryrules |
| **扩展性** | MCP + Skills | MCP + Skills + Hooks + Plugins | MCP + Plugins | Extensions | 命令行 | Plugins |

---

## 七、执行建议

**立即启动 (本周)**：
1. 修复 D1-D3 致命缺陷(unblock DCS context tools + flags)
2. 在 ClawX 中集成 codebase-memory-mcp 试运行，评估结构化检索对读能力的提升

**短期 (2-4 周)**：
3. 实现 P1-A：通过 MCP 集成补结构化检索
4. 实现 P3-Phase 1：写时依赖检测(在现有 worktree 隔离上叠加)
5. 实现 P2-1：Write transaction/rollback

**中期 (1-2 月)**：
6. P3-Phase 2：AST 函数级锁(自建 tree-sitter 或复用 MCP)
7. P4：多层 Compaction pipeline
8. P5：Tool deferred loading

**长期 (2-3 月)**：
9. P3-Phase 3：LLM 辅助的语义冲突判断(基于 Blackboard)
10. P6：统一记忆系统 + Knowledge provider

---

> 调研方法：anysearch 搜索 + ClawX 源码阅读(25+ 核心文件) + Claude Code arxiv 论文(2604.14228) + 10 篇学术论文/技术文章
> 数据截止：2026-07-14
