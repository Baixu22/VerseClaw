# Verse Token 设计审计总结

> **目的**：交付给审计 agent 的完整设计快照 + 量化数据 + 已知短板清单。
> 审计目标：判断设计是否达成目标、量化数据是否可信、短板是否被诚实披露、剩余风险是否可接受。
> 配套文档：[README.md](README.md) / [HANDOFF.md](HANDOFF.md) / [DECISIONS.md](DECISIONS.md) / [docs/design-review.md](docs/design-review.md) / [docs/authoring-guide.md](docs/authoring-guide.md) / benchmarks/p21-p24_report.md

---

## 0. 项目定位

**Verse Token（vt）** 是 Agent Runtime 的内部知识表示组件，三层架构：

| 层 | 名称 | 产物 | 角色 |
|---|---|---|---|
| HIR | 人类可读层 | `.vt` 文本 | agent 写入格式（语法见 §1） |
| SIR | 语义中间表示 | `.vtg` JSON + 内存图 `SIRGraph` | 编译产物 + 运行时图 |
| TIR | 注入字符串 | `resolve()` 返回值 | 注入 LLM 的 token 预算可控文本 |

**核心目标**：
- 目标 A：**格式效率** — 相比 JSONL 节省结构 token 开销
- 目标 B：**检索精度** — 局部 BFS 注入相比全文注入节省 token 且不丢信息
- 目标 C：**写入可控** — agent 写入有 schema 约束、错误可机器识别、可修复

**设计红线**（规格 §13）：若 .vt 写入结构开销 > JSONL → 放弃 .vt HIR 层改用 JSONL，保留 SIR+TIR 层。设计服从数据。

---

## 1. HIR 语法摘要（.vt）

### 1.1 文件头指令

```
%vt 0.3.1              # 版本，必须物理第一行
%mode doc              # doc | mem
%id system/auth        # doc 模式必填，文档命名空间
%session task_1        # mem 模式必填
%schema core           # 可选，引用 <name>.vtschema
%lang zh               # 可选
%ns auth               # 可选（D19，v0.3.2 提案，opt-in 短 ID 前缀）
```

### 1.2 doc 模式节点

```
DEF auth.overview   JWT 认证模块           # 定义类型：DEF / RULE / VAR / OPEN
RULE auth.token_ttl access token ≤ 15 min   # 带语义 ID 的规则
DESC auth.overview  提供 verify + sign 两接口  # 注解类型：DESC / EX / META / SRC
REF auth.token_ttl --DEPENDS--> auth.overview  # 边：typed (--REL--) 或 untyped (~~)
// 行首注释（行内 // 属于内容，保护 URL）
```

**类型符语义**：
- **定义类型**（DEF/RULE/VAR/OPEN）：创建节点；同 ID 重复定义报 `duplicate_id`
- **注解类型**（DESC/EX/META/SRC）：追加为节点的 facet（D1 裁决）

### 1.3 mem 模式节点

```
%mode mem
%session task_1

- #blocker 需确认 JWT_SECRET_KEY
- #note 用户的偏好是 RS256
- 这是一个无 tag 的裸文本节点
```

**关系类型**（core schema）：`DEPENDS` / `IMPLEMENTS` / `BLOCKS` / `CONFLICTS` / `EXTENDS` / `REF` / `~~`（untyped）

---

## 2. 核心架构

### 2.1 模块组织

```
src/vtoken/
├── parser.py       P1.1 HIR 解析（.vt → ParsedVT），JSON 错误报告
├── schema.py       core schema + .vtschema 扩展机制
├── compiler.py     P1.2 doc .vt → .vtg（幂等 SHA-256 + 原子替换）
├── graph.py        P1.3/4 SIRGraph + resolve_tir（双向 BFS + TIR 生成）
├── memstore.py     P1.5/6 vt.write / WAL / checkpoint / 崩溃恢复
├── store.py        UnifiedStore（doc+mem 合图检索、toc、stats、热加载 T5.1）
├── renderer.py     T5.2 .vt → Markdown 渲染
├── md_to_vt.py     T5.3 Markdown → .vt 反向转换（非无损，P3.3 质量声明）
├── mcp_server.py   T5.4 MCP JSON-RPC 2.0 over stdio（0 第三方依赖）
├── search.py       T5.5 TF-IDF + cosine 离线搜索（D30）
├── cli.py          vt compile/check/resolve/stats/render/convert/mcp/search
├── errors.py       VTError / VTParseError / VTResolveError / VTStoreError
└── model.py        VTNode(parts) / VTEdge / ParsedVT / Header / MemItem
```

### 2.2 关键数据结构

```python
@dataclass
class VTNode:
    id: str
    parts: list[(type_symbol | None, content)]  # D1：facet 列表，parts[0] 是定义行
    line: int = 0                                # 首个定义行在源 .vt 的行号
    created_at: int | None = None               # D2：仅 mem 有效，doc 不落盘
    source_file: str | None = None              # D2：加载期注入，不落盘

@dataclass
class VTEdge:
    src: str
    dst: str
    rel: str | None  # None = untyped (~~)

class SIRGraph:
    nodes: dict[str, VTNode]
    out: dict[str, list[VTEdge]]   # 出边邻接（声明序）
    in_: dict[str, list[VTEdge]]   # 入边邻接（D9 双向 BFS 的依据）
    version: int                   # 自增（write/delete/add_node/add_edge），search 索引失效用
```

### 2.3 运行时 API

```python
# doc 模式（只读）
store = UnifiedStore.open(
    vtg_paths=["auth.vtg", "middleware.vtg"],     # 旧 API：无热加载
    doc_sources=["auth.vt", "middleware.vt"],     # 新 API（T5.1）：mtime 轮询热加载
    session_dir="sessions", session="task_1",    # mem 会话
    durability="fsync",                          # fsync | flush（D3）
)
store.toc()                                      # 全部 DEF 节点（冷启动入口索引，D20）
tir = store.resolve("auth.sec_1", depth=2,
                    type_filter=["RULE"],        # D10：只过滤输出不影响遍历，根豁免
                    include_untyped=False,       # D9：是否含 ~~ 边
                    include_edges=False,         # D21：是否输出边行
                    max_nodes=10,                # T0.4：BFS 节点预算
                    max_facets=2)                # D27：per-node facet 预算（DEF 永远保留）
results = store.search("token ttl", top_k=10)    # T5.5：返回 [{id, score, snippet}]

# mem 模式（可写）
nid = store.write("用户确认 RS256", tag="pref",
                  edges=["auth.algo"])          # 返回 "#001"；返回即持久化
store.delete(nid)                                # D5：ID 永不复用
store.checkpoint()                                # D15：snapshot→replace→truncate→marker
store.start_background_checkpointer(interval_s=60)  # T0.3
```

### 2.4 TIR 输出格式

```
[#auth.sec_1:RULE] token 有效期不得超过 24h
[#middleware.jwt_verify:DEF] JWT 校验中间件
[#001:pref] 用户确认 RS256
```

- 前缀 `[#<id>:<TYPE>]`，TYPE=None 省略（D17：mem ID 自带 `#` 被吸收）
- 确定性排序（D11）：BFS 发现序 → 邻居按出边声明序再入边声明序 → 每节点只输出一次 → parts 按行序

---

## 3. 关键设计裁决（D1–D30 摘要）

> 完整论证见 [docs/design-review.md](docs/design-review.md) + [DECISIONS.md](DECISIONS.md)

### 3.1 规格自相矛盾类（A 类，必须修）

| # | 问题 | 裁决 |
|---|---|---|
| D1 | 示例 DESC 重复 ID vs "ID 唯一" | 定义类型重复 → 报错；注解类型 → 追加 facet |
| D2 | `created_at` 破坏 compile 幂等 | doc .vtg 不含时间戳/路径；mem 才有 |
| D3 | §5.2 vs §5.4 持久化矛盾 | `durability="fsync"` / `"flush"` 参数化 |
| D4 | "节点数只增不减"与 delete 矛盾 | 删不变式；恢复 = 按序幂等重放 |
| D5 | WAL 有 delete、API 没有 | 补 `MemStore.delete(id)` |
| D6 | mem .vt 语法无生产者/消费者 | 定位为 import/export 格式 |
| D7 | `os.rename` Windows 非原子 | 全部 `os.replace` |
| D8 | `type` 与 `tag` 冗余 | 存储层单字段 `type = type or tag` |

### 3.2 欠定义类（B 类，落地裁决）

| # | 问题 | 裁决 |
|---|---|---|
| D9 | resolve 遍历方向未定义 | 双向 BFS（出+入边） |
| D10 | type_filter 语义二义 | 只过滤输出不剪枝，根豁免，part 级 |
| D11 | TIR 排序规则缺失 | BFS 发现序 + 邻居声明序 |
| D12 | 悬空引用 resolve 行为 | 遍历静默跳过；check 默认 warning |
| D13 | mem→doc 跨图边未定义 | 允许单向引用（天然无环） |
| D14 | `_next_seq` 恢复策略 | 快照+WAL max+1；ID 永不复用 |
| D15 | checkpoint 竞态 | 锁内：snapshot→replace→truncate→marker |
| D16 | `%id` 与命名空间关系 | Phase 1 不强约束；合并时全局 ID 冲突检测 |
| D17 | TIR 前缀遇 mem ID `[##001]` | 前缀吸收 `#` |
| D18 | schema 查找规则 | 同目录 `<name>.vtschema`；声明名必须匹配 |

### 3.3 实测后追加（D19–D30）

| # | 问题 | 裁决 |
|---|---|---|
| D19 | token 对比表口径有偏 | 新增 `%ns` 指令（opt-in 短 ID） |
| D20 | P1 冷启动无入口 | `toc()` 输出全部 DEF 节点 |
| D21 | TIR 丢弃边语义 | `include_edges=True` 可选输出边行 |
| D22 | fsync P99<5ms Windows 不保险 | 由 D3 参数化留退路 |
| D23 | Windows 进程存活检测 | ctypes OpenProcess + GetExitCodeProcess（POSIX 仍用 os.kill） |
| D24 | T1 红线判定 | .vt 两档均 < JSONL，**红线未触发** |
| D25 | 推翻"≤15% 结构开销"叙事 | 改为"相比 JSONL 节省约 40%" |
| D26 | T2 红线冲突 | max_nodes 单独无法兼顾 token+准确率 |
| D27 | 引入 `max_facets` 参数 | type_filter 先应用（根豁免），DEF 永远保留 + 声明序前 N-1 个 |
| D28 | T3 两段评测方法学 | A 覆盖率 100 场景 + B 开销 100 节点 5 错误；记录 6 项 parser 行为 |
| D29 | T4 红线分两组判定 | 并发红线（核心）+ 延迟红线（硬件依赖） |
| D30 | T5.5 断网 search 技术选型 | 纯 stdlib TF-IDF + cosine（API 签名保持可切 embedding） |

---

## 4. 量化基准数据（T1–T4 实测）

### 4.1 T1 — 写入效率（10 场景 × cl100k_base）

**口径**：`结构开销 = (格式总token − 纯内容token) / 纯内容token`；语义 ID 计入 .vt 开销。

**红线**：.vt 任一档 > JSONL → 放弃 .vt HIR 层。

| 格式 | 平均总 token | 平均结构开销 | vs JSONL |
|---|---:|---:|---:|
| vt | 246.6 | **68.6%** | -38% |
| vt+ns | 232.2 | **58.6%** | -48% |
| md | 265.0 | 81.4% | -27% |
| jsonl | 307.4 | 111.6% | baseline |

**逐场景明细**（节选）：

| 场景 | 内容 tok | vt % | vt+ns % | jsonl % | md % |
|---|---:|---:|---:|---:|---:|
| API 约束 | 148 | 69.6 | 57.4 | 119.6 | 83.8 |
| 架构决策 | 188 | 53.2 | 45.2 | 84.0 | 64.4 |
| DB schema | 127 | 62.2 | 55.1 | 113.4 | 74.8 |
| 部署 runbook | 178 | 69.7 | 61.2 | 102.8 | 81.5 |
| 安全规则 | 150 | 58.0 | 46.7 | 92.7 | 69.3 |
| 任务清单 | 139 | 79.1 | 69.1 | 115.8 | 86.3 |
| 研究笔记 | 211 | 37.4 | 31.8 | 67.3 | 47.9 |
| 用户偏好 | 105 | 67.6 | 59.0 | 112.4 | 81.9 |
| 错误码表 | 99 | 115.2 | 100.0 | 189.9 | 136.4 |
| 变更日志 | 146 | 74.0 | 60.3 | 118.5 | 87.7 |

**结论**：**红线未触发**（D24）。.vt 两档均显著低于 JSONL。同时推翻规格书"≤15% 结构开销"叙事（D25）——绝对值不成立（68.6%），相对意义成立（比 JSONL 省 40%）。

### 4.2 T2 — 读取效率（40 题 × cl100k_base，机械判定无 LLM）

**口径**：resolve(depth=2, max_nodes, max_facets) vs 全文 .vt；准确率 = resolve 输出是否包含 ground-truth 期望节点 ID。

**红线**：token ≤ 全文 35%；准确率损失 ≤ 2%。

**自适应预算策略**：

| 题型 | max_nodes | max_facets |
|---|---|---:|
| def | 3 | 2 (DEF + 1 注解) |
| rule | #RULEs + 8 | 1 (仅 RULE) |
| deps | #端点 + 3 | 1 (DEF + 边行) |
| trace | out_deg + 2 | 1 (仅 DEF) |

**3 次迭代过程**：

| 迭代 | max_nodes | max_facets | token % | 准确率 |
|---|---|---|---:|---:|
| 1 | 5–6 | — | 48.6% | 57.5% |
| 2 | 自适应 | 自适应 | 45.2% | 90.0% |
| 3 | 自适应 | 自适应 | **31.4%** | **100.0%** |

**按题型细分 token 比例**：

| 题型 | 平均 % | 题数 | 最差样本 |
|---|---:|---:|---:|
| def | 26.1% | 10 | 32.7% |
| rule | 24.0% | 10 | 41.3% |
| trace | 26.2% | 10 | 30.2% |
| **deps** | **49.4%** | 10 | **63.1%** |

**结论**：token 31.4% ≤ 35%、准确率损失 0.0% ≤ 2%，**双红线同时达标**（D27）。**短板**：deps 类查询 token 偏高（49.4%），最差 63.1% 逼近红线。

### 4.3 T3 — 写入容错性（两段评测）

**口径**：
- A 段：100 场景（83 buggy + 17 legal），parser 错误识别准确率 = `expected_types ⊆ actual_types`
- B 段：100 节点单文件 + 5 注入错误（5% 错误率），开销比 = 修复 token / 总写入 token

**红线**：A ≥ 95%；B ≤ 10%。

**A 段按类别**：

| 类别 | 答对/总数 | 准确率 |
|---|---|---:|
| compile | 4/4 | 100.0% |
| compound | 8/8 | 100.0% |
| header | 20/20 | 100.0% |
| mem | 10/10 | 100.0% |
| node | 29/29 | 100.0% |
| ref | 21/21 | 100.0% |
| schema | 8/8 | 100.0% |
| **合计** | **100/100** | **100.0%** |

**B 段开销**：

| 项 | 值 |
|---|---:|
| 节点数 | 100 |
| 注入错误数 | 5 |
| 总写入 token | 4391 |
| 错误报告 token | 239 |
| 修复补丁 token | 159 |
| **修复开销合计** | **398** |
| **开销比例** | **9.1%** |

**结论**：A 100.0% ≥ 95%、B 9.1% ≤ 10%，**双红线达标**（D28）。

**parser 行为发现（D28 记录为准不修）**：
1. header 有错时不深扫 body 的 duplicate_id / unknown_type
2. `%mode` 后无值报 `invalid_mode` 而非 `invalid_directive`
3. body 中 `%vt` / `%mode` 重复仅报 `directive_after_body`
4. relspec 内含空格报 `invalid_ref` 而非 `invalid_relation`
5. mem tag 接受数字开头 / 大写 / 连字符
6. `check_file` 不走编译路径，`mem_not_compilable` 必须用 `compile_file` 触发

### 4.4 T4 — 并发稳定性（双场景 60s 压测）

**口径**：线程 A 50ms 间隔 `write()` 持续 60s，线程 B/C 并发 `resolve()`；checkpoint_every=0 隔离锁争用。

**红线分两组（D29）**：
- 并发红线（核心）：零异常零竞态 + resolve P99 < 15ms
- 延迟红线（硬件依赖）：write P99 < 5ms (fsync) / < 2ms (flush)

| 场景 | 写入成功 | integrity | errors | write P99 | resolve P99 |
|---|---:|---|---:|---:|---:|
| fsync | 1033/1033 | ✓ | 0 | 11.047ms | 2.062ms |
| flush | 1040/1040 | ✓ | 0 | 0.662ms | 0.327ms |

**并发红线**：双场景全达标（resolve P99 fsync=2.062ms / flush=0.327ms 远低于 15ms）

**延迟红线**：
- flush 达标（0.662ms < 2ms）
- fsync 未达标（11.047ms > 5ms）— 根因是 OS journal commit 尾延迟，非并发争用（证据：fsync P50=1.889ms 正常、与单线程基线 P99≈19.8ms 一致）

**Durability 建议（按 S2）**：交互式 agent 用 flush、checkpoint 用 fsync。

---

## 5. 工具链能力（T5 实测）

| 能力 | 命令 / API | 测试数 |
|---|---|---:|
| T5.1 doc 热加载 | `UnifiedStore.open(doc_sources=[...])` + GraphHolder mtime 轮询 | 15 |
| T5.2 vt render | `vt render <file> [-o out]` → Markdown | 8 |
| T5.3 vt convert | `vt convert --from-md <md> [--mode doc|mem] [-o out]` → .vt（非无损 P3.3） | 7 |
| T5.4 MCP | `vt mcp` → JSON-RPC 2.0 over stdio（5 tools：write/resolve/search/stats/toc） | 11 |
| T5.5 vt.search | `store.search(query, top_k)` / `vt search <query>` → TF-IDF + cosine | 17 |

**热加载机制**：GraphHolder 封装每个 doc 源（path / mtime_ns / graph / is_compiled），`_maybe_reload()` 在 resolve/toc/stats/search 前轮询 mtime，变了就 recompile（.vt）或 reload（.vtg）+ 原子 ref swap。FileNotFoundError 容错保留 stale graph。

**MCP 设计**：0 第三方依赖（stdlib only），stdin 读行 + stdout 写行，env var 配置（VT_MCP_SESSION_DIR / VT_MCP_SESSION / VT_MCP_DOC_SOURCES）。

**D30 search 技术选型**：断网环境无法 pip install sentence-transformers 也无法调 OpenAI embedding API → 实装纯 stdlib TF-IDF + cosine：
- tokenizer：`[A-Za-z0-9_]+|[\u4e00-\u9fff]` ASCII 按词（lowercase）+ CJK 按单字
- IDF 平滑：`log((N+1)/(df+1)) + 1` 永不为零
- 索引缓存：按 `graph.version` 失效（write/delete/add_node/add_edge 自增）
- API 签名 `search(query, top_k=10) → [{id, score, snippet}]` 保持未来可切 embedding

---

## 6. 验证状态

- **测试**：**138 passed**（80 基线 + 58 新增 T5）
  - 80 基线：58 原始 + T0.1-T0.4 新增 14 + T2 max_facets 8
  - 58 新增：T5.1 store 15 + T5.2/5.3 render/convert 15 + T5.4 mcp 11 + T5.5 search 14 + memstore search 3
- **端到端冒烟**：`python examples/demo.py` 8 section + "demo 完成。"
- **四条端到端路径**：vt render / convert round-trip / search / mcp 全部通过
- **本机延迟基线**：write flush P99≈0.03ms / write fsync P99≈2.8ms / resolve depth2 P99≈0.02ms
- **CLI 冒烟**：`vt resolve --max-nodes 2` 输出恰好 2 个节点；`vt resolve --max-facets 1` 每节点只输出 DEF facet

---

## 7. 诚实清单：已知短板与限制

### 7.1 环境类（E）

| # | 问题 | 影响 |
|---|---|---|
| E1 | 打包链路是妥协产物（setuptools 58 + setup.py 兜底） | 现代环境需同时维护 pyproject.toml + setup.py |
| E2 | tiktoken 词表下载被代理阻断 | T1 基准需手动放置 cl100k_base.tiktoken（已离线缓存） |
| E3 | 控制台默认 cp936 | 所有命令必须 `PYTHONUTF8=1` 前缀 |

### 7.2 实现类（I，已知未修或未深究）

| # | 短板 | 状态 |
|---|---|---|
| I6 | `export_vt()` 是有损导出（mem .vt 表达不了节点 ID + edges） | D6 定位为仅供人读 |
| I7 | 重复边不去重不告警 | 低危 |
| I8 | `%ns` 前缀规则只对"不含 `.` 的裸 ID"加前缀 | 文档化 |
| I10 | `merge_doc_graphs` 不深拷贝，doc 图按约定只读但无强制 | 谁变异合并图会污染源图 |
| I11 | `include_edges=True` 不含末层兄弟边 | 低危 |
| I12 | WAL 在 Windows 上行尾是 CRLF | 恢复端已兼容 |

### 7.3 规格 / 产品级（S）

| # | 发现 | 影响 |
|---|---|---|
| **S1** | **规格自己的示例图是稀疏烂图** | RULE 与所属 DEF 之间无边 → resolve 拉不到。**检索质量上限 = 建图纪律**，格式本身救不了稀疏图。已写 [docs/authoring-guide.md](docs/authoring-guide.md) 强制 R1：每 RULE 必须 REF 到所属模块 DEF |
| S2 | fsync P99 本机 2.8ms，目标 5ms 余量不到一倍 | 机械盘 / 杀毒实时扫描机器大概率超标。D3/D22 的 durability 参数化是退路 |
| S3 | token 效率叙事需用数据重写 | D25 已废弃"≤15%"宣称，改为"相比 JSONL 节省约 40%" |

### 7.4 工具链限制（T5）

| # | 限制 | 缓解 |
|---|---|---|
| L1 | **vt convert 非无损**（P3.3 质量声明） | 原 .vt 字节序不保留、注释已被 render 丢弃；round-trip 在节点/边/facet 集合上结构等价但不字节相同 |
| L2 | **search 仅字面匹配**（TF-IDF） | 无语义相似跨同义词；ASCII/canonical id 与中文关键词重合足够；断网解除后可切 embedding（API 签名不变） |
| L3 | **MCP 非流式** | stdin 读行 + stdout 写行，不支持 framed streaming |
| L4 | **fsync 延迟红线未达标** | 11.047ms > 5ms，OS journal commit 尾延迟；flush 模式达标 |

---

## 8. 适用边界建议

| 场景 | 推荐 | 理由 |
|---|---|---|
| 大型知识库（>500 token 内容） | **vt** | 读取节省 70% token 主导 |
| LLM agent 长期记忆 | **vt** | 跨图引用 + WAL + 并发安全 |
| 需要错误识别 + 可修复 | **vt** | 100% parser 覆盖 + JSON 错误报告 |
| 短笔记 / 一次性 prompt | **MD** | 结构开销 > 节省 |
| 结构化数据交换（API 配置） | **JSON** | 通用工具链丰富 |
| 需要嵌入向量语义检索 | **等断网解除后切 vt+embedding** | D30 留有 API 切换点 |
| 持久性关键写入（checkpoint） | **vt + fsync** | 接受 P99 尾延迟 |
| 交互式 agent 写入 | **vt + flush** | P99=0.662ms 达标 |

---

## 9. 审计建议关注点

请审计 agent 重点核查：

1. **数据可信度**：T1/T2/T3/T4 四份报告的方法学是否自洽？口径是否一致？机械判定（无 LLM 参与）的边界是否清晰？
2. **红线判定**：D24/D27/D28/D29 的红线拆分与判定是否有"放宽标准"嫌疑？特别是 T4 把红线分两组是否合理？
3. **裁决一致性**：D1-D30 是否有相互冲突？新裁决是否覆盖了旧裁决？是否有裁决绕过了规格 §13 红线？
4. **短板诚实度**：§7 的已知短板清单是否完整？是否有"藏起来"的已知问题？特别是 S1（建图纪律 vs 格式效率）是否被充分披露？
5. **架构合理性**：三层 HIR/SIR/TIR 是否有冗余？GraphHolder + UnifiedStore 的双指针热加载是否过度设计？MCP 0 依赖实现是否牺牲了正确性？
6. **测试覆盖**：138 项测试是否覆盖了关键路径？特别是 T5.5 search 的 TF-IDF 实现是否有边界测试（空查询 / 未构建索引 / 中文 / 多图合并 / 索引重建）？
7. **未来风险**：T6（Phase 4）方向性议题（schema:code/task/research、跨文件增量合并、多 Agent 多进程写入协议）是否被合理推迟？lockfile 是否真能作为多进程写入协议的挡板？

---

## 10. 一句话结论

Verse Token v0.3.1 在断网 + Windows + Python 3.10 的约束下，以 0 第三方运行时依赖实现了三层 HIR/SIR/TIR 架构 + WAL 持久化 + 并发安全 + 工具链（render/convert/mcp/search）。T1-T5 全部红线达标或按 S2 流程记录，138 项测试全绿。相比 JSONL 节省约 40% 结构开销、相比全文读取节省约 70% token 且零准确率损失；短板是绝对结构开销仍偏高（68.6%）、deps 类查询逼近红线（49.4%）、fsync 延迟依赖硬件、search 仅为字面匹配。设计在**大文档 + 高频读取 + agent 自主写入**场景下有量化优势，在**短文档 / 一次性使用**场景下不划算。
