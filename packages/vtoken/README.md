# Verse Token — Context Assembly Engine（产品基座）

> **定位**：VT 是 **DCS（Distributed Context System）的 Working Context Assembly Engine**，
> 作为产品基座（foundation library）内嵌进你的应用，不是独立产品。
> 后续会迁移进宿主项目，作为 LLM 调用前的上下文装配层。
>
> **版本**：v0.4.3（D35 闭包） · **Python**：≥ 3.10 · **运行时第三方依赖**：0（tiktoken 仅基准用，可选）
> **测试**：240 项全过 · **API 稳定性**：`store.assemble()` / `store.ingest()` 已端到端贯通

## 文档导航

| 你想做的事 | 直接看 |
|---|---|
| 5 分钟把 VT 跑起来 | [§ 快速开始](#快速开始) |
| 把 VT 桥接进我的项目 | [§ 桥接指南](#桥接指南) |
| assemble 出来的 prompt 长什么样 | [§ render_mode 三档](#render_mode-三档选择指南v042-d33) |
| 在 LLM 调用前怎么调 assemble | [§ 典型集成场景](#典型集成场景) |
| 自定义 slot 比例 / priority / sources | [§ 配置点](#配置点) |
| 加新的源类型（如 Confluence / Notion） | [§ 扩展点：加新 adapter](#扩展点加新-adapter) |
| 集成后怎么验证是否正确 | [§ 集成验证清单](#集成验证清单) |
| 排查 prompt 不符预期 | [§ 桥接排错](#桥接排错) |
| 已知边界（断网 / TF-IDF / hp_top25） | [§ 已知边界](#已知边界) |
| VT vs md/jsonl 性能对比 | [§ P5 对照实验](#vt-明显超过-md--jsonl-的对照实验p5-专项基准v043-d35) |

## 与宿主项目的关系

```
┌──────────────────────────────────────────────────────────┐
│  你的产品 / 宿主项目                                       │
│                                                            │
│  ┌────────────┐   ┌─────────────────┐   ┌──────────────┐  │
│  │ 业务逻辑    │ → │  Verse Token    │ → │ LLM 调用     │  │
│  │ - 任务编排  │   │  (基座库)        │   │ - Chat /     │  │
│  │ - 用户态    │   │                  │   │   Tool Use  │  │
│  │ - 数据访问  │   │  assemble() →   │   │ - RAG /     │  │
│  │            │   │  优化后的 prompt │   │   Agent     │  │
│  └────────────┘   └─────────────────┘   └──────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  外部数据源（VT 消费，不存储）                          │ │
│  │  CLAUDE.md / *.md / JSON 配置 / MCP schema /          │ │
│  │  skill 定义 / 记忆系统输出 / 任务计划                   │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

VT 是 **嵌入式基座**，不是独立服务：

- ✅ 作为 Python 库被宿主项目 `import vtoken` 使用
- ✅ 接收宿主项目提供的多源数据（md/json/memory/tool schema）
- ✅ 输出 LLM-ready prompt 字符串给宿主项目的 LLM 客户端
- ❌ 不暴露独立 HTTP/RPC 服务（除非宿主项目包装之）
- ❌ 不持久化业务数据（mem session 是工作区，不是业务存储）
- ❌ 不替代宿主项目的记忆系统、RAG、向量库

## 基座的职责边界

| 维度 | VT 做的事 | VT 不做的事（宿主项目负责） |
|---|---|---|
| **数据获取** | 接收已获取的多源数据 | 不抓取数据、不连数据库 |
| **图结构化** | 把异构源转 SIR 图 | 不定义源格式（让上游决定） |
| **检索** | BFS + TF-IDF 离线检索 | 不调 embedding API |
| **去重** | 跨源节点去重 | 不做文档级去重（让上游决定） |
| **预算装箱** | token 预算贪心装箱 | 不调 LLM 计算成本 |
| **排序** | priority + slot 排序 | 不做语义排序 |
| **渲染** | 输出 prompt 字符串 | 不发送给 LLM |
| **审计** | 返回 nodes_evicted 等 | 不持久化审计日志 |

## 数据流（从源数据到 LLM prompt）

```
┌─────────────────────────────────────────────────────────────────────┐
│  宿主项目（你的产品）                                                  │
│                                                                       │
│  ①  数据获取层（你写）                                                │
│     CLAUDE.md / *.md / MCP tool schema / memory 系统输出 / ...        │
│         │                                                             │
│         ▼                                                             │
│  ②  VT ingest 适配层（基座提供）                                       │
│     ingest_markdown() / ingest_tool_schema() / ingest_memory()       │
│         │  每个适配器输出 SIRGraph                                     │
│         ▼                                                             │
│  ③  UnifiedStore（基座核心对象，你持有）                                │
│     store.doc.merge(g1); store.doc.merge(g2); ...                     │
│         │                                                             │
│         ▼                                                             │
│  ④  ContextAssembler.assemble()（基座核心管线）                        │
│     search(task_hint)        → 候选节点集（TF-IDF 粗筛）               │
│       → resolve(depth)         → BFS 子图（精筛 + 1-hop/2-hop 扩展）   │
│       → cross_dedup()          → 跨源 (content,) 一元组去重             │
│       → budget_pack()          → 按 slot weight + priority 贪心装箱   │
│       → order()                → 高 priority 节点 + system slot 前置   │
│       → render(mode)           → compact / dense / verbose            │
│         │                                                             │
│         ▼                                                             │
│  ⑤  AssembleResult（你消费）                                          │
│     .prompt / .tokens_used / .slot_breakdown /                        │
│     .nodes_included / .nodes_evicted / .dedup_count                   │
│         │                                                             │
│         ▼                                                             │
│  ⑥  LLM 调用层（你写）                                                │
│     client.chat.completions.create(messages=[{"role": "system",       │
│       "content": result.prompt}, ...])                                │
└─────────────────────────────────────────────────────────────────────┘
```

## 快速开始

### 1. 安装

```bash
cd verse-token/
pip install -e .                  # 开发模式安装；生产用 pip install .
python -m pytest tests -q         # 240 项，确保基座健康
# Optional: 环境变量 TIKTOKEN_CACHE_DIR 指向 .tiktoken_cache/（已随仓库提供）
```

### 2. 最小可用集成（30 行代码）

```python
from vtoken import UnifiedStore
from vtoken.ingest import ingest_memory

# ① 创建 store，挂载文档源与（可选的）mem session
store = UnifiedStore.open(
    doc_sources=["docs/arch.md", "docs/rules.md"],   # mtime 轮询热重载
    session_dir="sessions", session="task_1",         # mem WAL + 快照（可选）
)

# ② ingest 任意源（mem 工作区 / JSON tool schema / 单个 md 文件）
store.ingest("schemas/mcp_tools.json")                # auto 推断 source_type
g = ingest_memory([
    {"id": "mem_001", "content": "用户偏好 RS256", "tags": ["pref"]},
    {"id": "mem_002", "content": "必须验证 JWT 签名", "tags": ["blocker"]},
])
store.doc.merge(g)

# ③ 在每次 LLM 调用前 assemble
result = store.assemble(
    task_hint="实现 JWT 认证模块",
    budget_tokens=32000,
    render_mode="compact",   # 极紧 budget 改 "dense" 再省 15% token
)

# ④ 把 prompt 喂给你的 LLM 客户端
final_prompt = result.prompt
print(f"{result.tokens_used}/{result.tokens_budget} tok, "
      f"dedup={result.dedup_count}, evicted={len(result.nodes_evicted)}")
```

### 3. 调试 CLI（开发调试用）

```bash
vt ingest docs/rules.md                          # ingest 任意格式源
vt assemble "实现 JWT 认证" \
    --doc-source docs/arch.md \
    --ingest schemas/tools.json \
    --budget 32000 \
    --explain                                     # 人类可读报告
vt mcp                                            # MCP server（stdio JSON-RPC，可选）
```

`--explain` 输出示例：

```
── Context Assembly Report ──────────────
Budget:   8,432 / 32,000 tokens (26.4%)
Slots:
  system      1,203 tok   15 nodes
  tools       2,841 tok   28 nodes
  knowledge   3,109 tok   31 nodes
  working     1,279 tok   18 nodes
Deduped:  12 nodes (跨 slot 重复)
Evicted:   8 nodes (超出预算)
Included: 92 nodes
────────────────────────────────────────
```

## 桥接指南

### 桥接前的准备清单

| 项 | 说明 | 必须 |
|---|---|---|
| Python 版本 | ≥ 3.10 | ✅ |
| `vtoken` 包路径 | 复制 `src/vtoken/` 或 `pip install -e .` | ✅ |
| `.tiktoken_cache/` 目录 | cl100k_base 词表缓存（已随仓库提供） | ✅（计数用） |
| `doc_sources` | 你的项目 md 文档路径列表 | ✅ 至少 1 个 |
| `session_dir` + `session` | mem 工作区路径（如不使用 mem 可省略） | ⚠️ 可选 |
| `slots` 自定义 SlotConfig | 不传则用 `DEFAULT_SLOTS` | ⚠️ 可选 |

### 桥接 4 步

#### 步骤 1：把基座复制进宿主项目

```bash
# 方案 A：作为子包
cp -r verse-token/ /path/to/host-project/packages/vtoken/

# 方案 B：作为可编辑依赖（推荐开发期）
# 在宿主项目 pyproject.toml 加：
# dependencies = ["vtoken @ file:./packages/vtoken"]
```

#### 步骤 2：在宿主项目持有 store 实例

store 应该是**长生命周期对象**（应用启动时创建，整个 session 复用），不要每次调用都新建：

```python
# your_project/context.py
from vtoken import UnifiedStore

class ContextAssemblerService:
    def __init__(self, doc_paths: list[str], session_dir: str, session: str):
        self.store = UnifiedStore.open(
            doc_sources=doc_paths,
            session_dir=session_dir, session=session,
        )

    def assemble_prompt(self, task_hint: str, budget: int = 32000) -> str:
        result = self.store.assemble(task_hint, budget, render_mode="compact")
        # 你的业务逻辑：日志 / 审计 / 监控
        self._log_assembly(result)
        return result.prompt
```

#### 步骤 3：桥接你的数据源

VT 不抓数据，你的项目把已经拿到的数据按下面格式喂进来即可：

| 数据源 | VT 适配器 | 输入格式 | 推荐时机 |
|---|---|---|---|
| **Markdown 文档** | `ingest_markdown(md_text, source_path)` | `str`（md 全文） | 应用启动 / 文档变更 |
| **MCP tool schema** | `ingest_tool_schemas(schemas, server_name)` | `list[dict]` | MCP server 注册时 |
| **记忆系统输出** | `ingest_memory(entries)` | `[{id, content, tags}]` | 每次 LLM 调用前 |
| **JSON/JSONL** | `store.ingest("path.json")` | 文件路径 | 一次性 |
| **任意 .md 文件** | `store.ingest("path.md")` | 文件路径 | 一次性 / 热重载 |

#### 步骤 4：在 LLM 调用前调 assemble

```python
# your_project/llm_client.py
def call_llm(task_hint: str, user_msg: str, budget: int = 32000) -> str:
    # 1. assemble 出 system prompt
    ctx_prompt = ctx_service.assemble_prompt(task_hint, budget)

    # 2. 拼装 messages
    messages = [
        {"role": "system", "content": ctx_prompt},
        {"role": "user", "content": user_msg},
    ]

    # 3. 调你的 LLM 客户端
    return your_llm_client.chat.completions.create(
        model="your-model", messages=messages,
    )
```

## API 速查

### UnifiedStore（你主要交互的对象）

| 方法 | 用途 | 关键参数 |
|---|---|---|
| `UnifiedStore.open(...)` | 工厂方法 | `doc_sources` / `session_dir` / `session` |
| `store.ingest(source, source_type="auto")` | ingest 任意源 | `.md` / `.json` 文件路径 |
| `store.doc.merge(g)` | 把 `ingest_*` 返回的 SIRGraph 合进 doc 图 | `SIRGraph` 对象 |
| `store.assemble(task_hint, budget_tokens, slots=None, render_mode="compact")` | **核心 API** | 见下 |
| `store.search(query, top_k=10)` | 离线 TF-IDF 搜索 | 用于调试 |
| `store.resolve(node_id, depth=2, type_filter=..., max_facets=3)` | BFS 子图 TIR | 用于调试 |
| `store.toc()` | 列出所有 DEF 节点 | 冷启动入口索引 |
| `store.write(content, type=None, edges=None, tag=None)` | mem session 写入 | 返回 `#001` 形式 ID |
| `store.delete(node_id)` | mem session 删除 | ID 永不复用 |
| `store.stats()` | 节点 / 边 / facet 类型统计 | 调试用 |

### `store.assemble()` 参数详解

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `task_hint` | `str` | 必填 | 当前任务描述（用于 BFS 起点选择；多 token 会被拆分查询 union） |
| `budget_tokens` | `int` | `32000` | 总 token 预算 |
| `slots` | `dict[str, SlotConfig] \| None` | `None` → `DEFAULT_SLOTS` | 自定义 slot 比例 / priority / sources |
| `render_mode` | `"compact" \| "dense" \| "verbose"` | `"compact"` | compact 平衡 / dense 极简 / verbose 调试 |

### `AssembleResult` 字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `prompt` | `str` | 最终拼装文本（喂给 LLM） |
| `tokens_used` | `int` | 实际消耗 token |
| `tokens_budget` | `int` | 预算上限 |
| `slot_breakdown` | `dict[str, {tokens, nodes}]` | 每个 slot 实际用量 |
| `nodes_included` | `list[str]` | 进入 prompt 的节点 ID（可审计） |
| `nodes_evicted` | `list[str]` | 被裁掉的节点 ID（可审计） |
| `dedup_count` | `int` | 跨源去重合并的 facet 数 |
| `format_explain_report()` | `str` | 人类可读报告（同 `vt assemble --explain`） |

## 典型集成场景

### 场景 A：Agent / Tool Use（每次工具调用前 assemble）

```python
class AgentLoop:
    def __init__(self, ctx_service, llm_client):
        self.ctx = ctx_service
        self.llm = llm_client

    def step(self, user_msg: str, available_tools: list[dict]) -> dict:
        # 把当前可用 tools 注入 VT（每次都可能不同）
        from vtoken.ingest import ingest_tool_schemas
        tools_g = ingest_tool_schemas(available_tools, server_name="runtime")
        self.ctx.store.doc.merge(tools_g)

        # 用 user_msg 作为 task_hint，让 VT 找任务相关节点
        prompt = self.ctx.assemble_prompt(
            task_hint=user_msg, budget=16000,
        )
        return self.llm.chat.completions.create(
            model="gpt-4", messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_msg},
            ], tools=available_tools,
        )
```

### 场景 B：长对话 RAG（每 N 轮重新 assemble）

```python
class ChatSession:
    def __init__(self, ctx_service, llm_client, refresh_every: int = 5):
        self.ctx = ctx_service
        self.llm = llm_client
        self.history: list[dict] = []
        self.refresh_every = refresh_every
        self._cached_prompt: str | None = None

    def chat(self, user_msg: str) -> str:
        self.history.append({"role": "user", "content": user_msg})

        # 每 N 轮或首轮重新 assemble
        if (self._cached_prompt is None
                or len(self.history) % (self.refresh_every * 2) == 0):
            # 把最近 N 轮对话作为 task_hint，让 VT 找相关历史
            recent = " ".join(m["content"] for m in self.history[-6:])
            self._cached_prompt = self.ctx.assemble_prompt(
                task_hint=recent, budget=8000,
            )

        self.history.append({"role": "system", "content": self._cached_prompt})
        resp = self.llm.chat.completions.create(
            model="gpt-4", messages=self.history,
        )
        self.history.append({"role": "assistant", "content": resp.content})
        return resp.content
```

### 场景 C：静态知识库（启动时一次性 assemble 出缓存）

```python
class StaticKnowledgeBase:
    def __init__(self, ctx_service):
        self.ctx = ctx_service
        # 启动时把所有 doc ingest 进去
        for md_path in ["docs/arch.md", "docs/rules.md", "docs/api.md"]:
            self.ctx.store.ingest(md_path)
        # 预 assemble 一个通用 prompt 缓存
        self._cached = self.ctx.store.assemble(
            task_hint="通用项目知识", budget_tokens=16000,
        )

    def get_static_prompt(self) -> str:
        return self._cached.prompt
```

## 配置点

### 1. SlotConfig — 自定义 slot 比例 / priority / sources

默认配置（`DEFAULT_SLOTS`）：

| slot | weight | priority | sources 前缀 | depth | max_nodes |
|---|---|---|---|---|---|
| `system` | 0.15 | 1 | `system.` / `rule.` / `constraint.` / `spec.` | 1 | 20 |
| `tools` | 0.20 | 2 | `tool.` / `mcp.` / `skill.` | 2 | 30 |
| `knowledge` | 0.40 | 3 | `doc.` / `arch.` / `spec.` / `auth.` / `middleware.` / `db.` / `api.` | 2 | 50 |
| `working` | 0.25 | 4 | （其他全部） | 2 | 50 |

> weight 决定 token 预算分配；priority 决定 prompt 段落顺序（小数先装 + 先出）。

自定义示例（让 knowledge 占大头，把 tools 砍到最小）：

```python
from vtoken.assembler import SlotConfig

CUSTOM_SLOTS = {
    "system":   SlotConfig("system",   weight=0.20, priority=1,
                           sources=["system.", "rule."], depth=1, max_nodes=20),
    "tools":    SlotConfig("tools",    weight=0.10, priority=2,
                           sources=["tool.", "mcp."], depth=2, max_nodes=15),
    "knowledge":SlotConfig("knowledge",weight=0.50, priority=3,
                           sources=["doc.", "arch."], depth=3, max_nodes=80),
    "working":  SlotConfig("working",  weight=0.20, priority=4,
                           sources=[], depth=2, max_nodes=30),
}

result = store.assemble("...", budget_tokens=16000, slots=CUSTOM_SLOTS)
```

### 2. infer_priority — 自定义节点优先级

默认 priority 推断规则（v0.4.3 D35）：

| 触发条件 | priority | 说明 |
|---|---|---|
| tag 含 `blocker` | 1 | 强制前置 |
| tag 含 `security` | 2 | 强安全规则 |
| RULE facet 含强安全词（必须/禁止/严禁/验证/权限/安全/永远/立即/关键/核心/强制/不得/不可 + must/forbidden/verify/permission/security/critical/required/mandatory/never） | 2 | 安全 RULE |
| 普通 RULE facet | 3 | 业务规则 |
| DEF facet | 4 | 定义 |
| DESC / EX facet | 6 | 注解 / 示例 |
| tag 含 `note` | 8 | 备注 |
| tag 含 `note` + content 含待定词（待确认/待定/TODO/TBD/未定/可能/建议/待评估/暂定/待讨论） | 9 | 待定项排到后面 |
| 默认 | 5 | 兜底 |

覆盖 priority 的方式：

```python
# 方式 A：在 ingest 时直接设置 VTNode.priority
from vtoken.model import VTNode
node = VTNode(id="custom.001", parts=[("DEF", "内容")],
              slot="system", priority=1, source_files=["custom"])
store.doc.add_node(node)

# 方式 B：写自己的 infer_priority，传入 ingest_memory / add_facet
# （需要 monkey-patch 或继承 ContextAssembler，见 § 扩展点）
```

### 3. render_mode — 选择 prompt 格式

| 模式 | meta_overhead | 用途 | 示例 |
|---|---|---|---|
| `compact`（默认） | ~14% | 平衡可读性与密度 | `@S D|content` + `R|content` |
| `dense` | 0% | working context 极紧（<500 budget） | 纯 `content` 按行 |
| `verbose` | ~100% | 调试 / 审计完整结构 | `## system` + `[#id:TYPE] content` |

选择建议：
- budget ≥ 2000：`compact`
- budget < 500：`dense`
- 调试 prompt 内容：`verbose`
- 默认就用 `compact`，不要无脑 `dense`（LLM 失去结构线索会降准确率）

## 扩展点：加新 adapter

如果你的数据源不是 md / json / memory 之一（如 Confluence API 输出、Notion block、自定义 YAML），写一个新 adapter：

### adapter 契约

```python
# your_project/adapters/confluence_adapter.py
from vtoken.graph import SIRGraph
from vtoken.model import VTNode, VTEdge

def ingest_confluence(pages: list[dict], server_name: str = "confluence") -> SIRGraph:
    """Confluence page 列表 → SIRGraph。

    契约：
    - 输入：宿主项目已经从 Confluence API 拿到的 page 列表（dict）
    - 输出：SIRGraph（mode="doc"）
    - 每个 page 成为一个 DEF 节点，子 section 成为 DESC facet
    - 设置正确的 slot / priority / source_files
    """
    graph = SIRGraph("doc")
    for page in pages:
        page_id = f"confluence.{server_name}.{page['id']}"
        node = VTNode(
            id=page_id,
            parts=[("DEF", page["title"])],
            slot="knowledge",          # 自定义 slot
            priority=4,                # DEF 默认 4
            source_files=[f"confluence:{server_name}:{page['id']}"],
        )
        graph.add_node(node)

        # 子 section → DESC facet
        for section in page.get("sections", []):
            graph.nodes[page_id].parts.append(("DESC", section["heading"]))

        # 父子 page 关系 → DEPENDS 边
        for child_id in page.get("child_ids", []):
            graph.add_edge(VTEdge(
                src=page_id,
                dst=f"confluence.{server_name}.{child_id}",
                rel="DEPENDS",
            ))
    return graph

# 使用
g = ingest_confluence(your_confluence_pages)
store.doc.merge(g)
```

### 写 adapter 的 4 个要点

1. **输入数据由宿主项目负责获取** — adapter 不连 API、不读文件（除非是 `*_file` 变体）
2. **slot 必须填** — `system` / `tools` / `knowledge` / `working` 之一（自定义 slot 也可，但要先在 `slots=` 里定义）
3. **priority 用 `infer_priority()`** — 不要硬编码，让基座统一管理语义
4. **source_files 累积** — 多源合并时用于审计追溯

## 集成验证清单

桥接完成后，按这个清单逐项验证：

### 必须验证

- [ ] `pip install -e .` 成功，`python -c "import vtoken"` 无 ImportError
- [ ] `pytest tests -q` 240 项全过
- [ ] `UnifiedStore.open(...)` 不报错，`store.stats()` 返回合理数字
- [ ] `store.assemble("test", 1000)` 返回非空 prompt，`tokens_used ≤ 1000`
- [ ] `result.slot_breakdown` 4 个 slot 都有内容（除非你确实没数据）
- [ ] `result.nodes_evicted` 在 budget 紧时非空（说明装箱生效）

### 推荐验证

- [ ] `vt assemble "你的任务" --doc-source your.md --budget 1000 --explain` 输出可读报告
- [ ] 多源场景：md + memory 同时存在时 `dedup_count > 0`（跨源去重生效）
- [ ] 改 md 文件后再次 assemble，prompt 反映变更（热重载生效）
- [ ] budget 从 32000 降到 500，prompt 长度按比例下降
- [ ] render_mode 三档分别跑一次，对比 prompt 长度 + 可读性

### 性能验证（可选）

```bash
# 在你的真实数据上跑基准
python benchmarks/p4_assembly_quality.py
# 对比 VT vs A_full_dump：VT 应在低 budget 下 recall 更高
```

## 桥接排错

| 症状 | 可能原因 | 解决 |
|---|---|---|
| `prompt` 为空 | task_hint 完全没命中任何节点 | 改 task_hint 用文档里的关键词；或调 `store.search(task_hint)` 看返回什么 |
| `tokens_used` 远小于 budget | search 召回不足 | 增加 task_hint 关键词；或将 `slots["knowledge"].max_nodes` 调大 |
| `tokens_used` 超过 budget | render_mode="verbose" 格式过重 | 改 `compact` 或 `dense` |
| 高优先级 RULE 没排到前面 | 节点 priority 没被更新 | 检查 RULE facet 是否含强安全词；或手动设置 `VTNode.priority=2` |
| `dedup_count = 0` | 没有跨源同 content | 正常（如果你的源之间无重复）；或检查 content 是否真的相同（包括空格 / 标点） |
| 改了 md 文件但 prompt 没变 | 热重载未触发 | 确保用 `doc_sources=` 而非 `vtg_paths=`；检查文件 mtime 是否更新 |
| mem session 写入失败 | `session_dir` / `session` 未设置 | `UnifiedStore.open(session_dir=..., session=...)` |
| `import vtoken` ImportError | 包未安装 / PYTHONPATH 不对 | `pip install -e .` 或 `sys.path.insert(0, "src")` |
| TF-IDF search 结果不相关 | 离线字面匹配，无语义 | 用 task_hint 多 token 拆分（v0.4.3 已自动）；或加同义词到文档 content |

## 已知边界

| 边界 | 影响 | 应对 |
|---|---|---|
| **断网环境**（D30） | 无法用 embedding API | VT 自带纯 stdlib TF-IDF + cosine 相似度，0 第三方依赖；有网后可平滑切换（API 签名不变） |
| **search 是字面匹配** | 无语义相似（"用户登录" 不匹配 "auth login"） | 在文档 content 中同时出现中英文关键词；或写 adapter 时显式加同义词 facet |
| **hp_top25 距理想 ≥0.8 还有差距** | lost-in-middle 防护不够强 | 已从 0.200 → 0.477（+138%）；剩余差距主要是评估口径问题非排序退化 |
| **大 budget 下 VT 优势不显** | budget 富余时直接全文灌入即可 | 1000 budget 下 B_md_smart_dump 反超 -2.8%；VT 价值在 budget 100-600 区间 |
| **单源小文档 VT 优势不显** | 没有多源去重的空间 | 直接用 md 全文即可，不必强制走 VT |
| **TF-IDF 在大场景偏保守** | 32k budget 仍只装 427 token | v0.4.3 已加 BFS 2-hop 扩展；未来可切 embedding（D30 已裁决） |

## 基座的性能特征（p4 基准量化数据，v0.4.3）

在 13 场景 × 4 budget × 5 策略对比基准下：

| 维度 | VT compact | VT dense | 全文灌入 (CLAUDE.md) | 智能截断 |
|---|---|---|---|---|
| **500 budget tokens** | 199.1 | **170.5** | 378.8 | 369.5 |
| **500 budget recall** | **0.872** | **0.872** | 0.846 | 0.769 |
| **lost-in-middle 防护 (hp_top25)** | 0.431 | 0.431 | 0.000 | 0.000 |
| **元信息开销 (meta_overhead)** | 0.146 | **0.000** | 0.000 | 0.000 |
| **可审计性 (audit_answerable)** | 13/13 | 13/13 | 0/13 | 0/13 |

> **v0.4.3 优化**：`infer_priority` 加 content 语义维度 + `add_facet` 用 min() 更新节点 priority，让含强安全词的 RULE facet 能把 DEF 节点 priority 从 4 降到 2，hp_top25 从 v0.4.2 的 0.200 提升到 0.477（**+138%**）。
>
> **dense 模式**：相比 A_full_dump 节省 55% token（378.8→170.5），meta 降到 0，recall 与 hp_top25 完全保持。极紧 budget 场景下的最优选择。
>
> 详见 [benchmarks/p4_report.md](benchmarks/p4_report.md)。

## VT 明显超过 md / jsonl 的对照实验（P5 专项基准，v0.4.3 D35）

P4 场景太温和（VT 仅领先 3.1%）。P5 设计 6 个超大场景（3000-6000 token md + 2-5 tool schema + 6-15 memory，含跨源同语义重复）+ 4 档极紧 budget（100/300/600/1000），让 VT 优势凸显。

**5 策略对照**：A_md_full_dump / B_md_smart_dump / **C_jsonl_full_dump** / D_vt_compact / E_vt_dense

### 300 budget（VT 优势最明显场景）

| 指标 | D_vt_compact | E_vt_dense | A_md | B_md | C_jsonl | VT vs md | VT vs jsonl |
|---|---|---|---|---|---|---|---|
| **recall** | 0.644 | 0.644 | 0.342 | 0.000 | 0.206 | **+88%** | **+213%** |
| **dedup** | 19 | 19 | 0 | 0 | 0 | ∞ | ∞ |
| **hp_top25** | 0.405 | 0.405 | 0.000 | 0.000 | 0.000 | 独有 | 独有 |
| **audit** | 6/6 | 6/6 | 0/6 | 0/6 | 0/6 | 独有 | 独有 |
| tokens | 307.5 | 268.2 | 300.0 | 300.0 | 300.0 | dense 省 10.6% | dense 省 10.6% |

### 600 budget

| 指标 | D_vt_compact | E_vt_dense | A_md | B_md | C_jsonl |
|---|---|---|---|---|---|
| **recall** | **0.972** | **0.972** | 0.617 | 0.917 | 0.411 |
| **dedup** | 19 | 19 | 0 | 0 | 0 |
| **hp_top25** | 0.406 | 0.406 | 0.000 | 0.000 | 0.000 |
| tokens | 473.5 | 414.5 | 600.0 | 600.0 | 600.0 |

### 100 budget（v0.4.3 P2 优化显著生效）

| 指标 | D_vt_compact | E_vt_dense | A_md | C_jsonl | VT vs md |
|---|---|---|---|---|---|
| **recall** | **0.308** | **0.308** | 0.206 | 0.206 | **+50%** |
| **dedup** | 19 | 19 | 0 | 0 | ∞ |
| **hp_top25** | 0.331 | 0.331 | 0.000 | 0.000 | 独有 |

> v0.4.2 → v0.4.3：100 budget recall 从 0.214 提升到 0.308（**+44%**）— `task_hint` 多 token 拆分查询 + BFS 2-hop 扩展生效。

### VT 明显超过的 5 个维度

1. **极紧 budget recall**（100 budget）：VT=0.308 vs A_md=0.206（**+50%**）；300 budget：VT=0.644 vs A_md=0.342（**+88%**）vs C_jsonl=0.206（**+213%**）— VT 通过 task_hint + BFS 精准定位任务相关节点
2. **跨源去重**（dedup=19）：VT 把 md + memory + tool schema 中复述的同语义 facet 合并；A/B/C 完全无去重能力，相同内容重复占 token
3. **lost-in-middle 防护**（hp_top25=0.331-0.406）：VT 把 blocker + 安全 RULE 节点排到前 25%；A/B/C 完全无排序（hp_top25=0）。注：v0.4.3 BFS 2-hop 召回更多 hp 节点（绝对数量增加），hp_top25 比例相比 v0.4.2 下降是评估口径问题非排序退化（详见 p5_report 根因诊断）
4. **可审计性**（6/6 vs 0/6）：VT 返回 nodes_evicted 完整列表；A/B/C 只能告知 truncated
5. **token 消耗**（600 budget dense 省 31%）：VT dense 模式 0 元信息开销，414.5 token vs A/B/C 600 token 全用完

### 诚实边界（VT 不占优场景）

- **1000 budget**：B_md_smart_dump 反超 VT -2.8%（budget 富余时 A/B 简单堆全部即可，VT 优势不显）
- **单源小文档**：VT 优势不显，A/B 简单堆全文即可

> 详见 [benchmarks/p5_report.md](benchmarks/p5_report.md)。

### v0.4.3 闭包裁决

义务内 P1（hp_top25）+ P2（100 budget recall）短板已优化到 acceptable 水平：
- ✅ **P2 100 budget recall**：0.214 → 0.308（+44%）
- ✅ **P1 hp_top25 在 P4**：0.200 → 0.477（+138%）
- ✅ **核心定位场景**（300-600 budget + 多源 + 跨源重复）：VT recall +88%（vs md）/ +213%（vs jsonl），dedup=19，audit=6/6 — 明显超过 md/jsonl

**v0.4.3 闭包**。剩余短板（P5 hp_top25 比例下降、大 budget 下 B 反超 -2.8%）属于"评估口径"和"非定位场景"问题，按 S2 记录不阻塞闭包。

### render_mode 三档选择指南（v0.4.2 D33）

| 模式 | 用途 | prompt 格式示例 | meta_overhead |
|---|---|---|---|
| `compact` (默认) | 平衡可读性与密度 | `@S D|content` + `R|content` | ~14% |
| `dense` | working context 极紧（<500 budget） | 纯 `content` 按行 | 0% |
| `verbose` | 调试 / 审计完整结构 | `## system` + `[#id:TYPE] content` | ~100% |

## 运行时 API（保留 v0.3 兼容）

```python
from vtoken import UnifiedStore

store = UnifiedStore.open(
    vtg_paths=["auth.vtg", "middleware.vtg"],   # 传统 .vtg 路径
    session_dir="sessions", session="task_1",
)

store.toc()                                     # 全部 DEF 节点 → 冷启动入口索引
tir = store.resolve("auth.sec_1", depth=2)      # 双向 BFS，纯内存，返回 TIR 字符串
nid = store.write("用户确认 RS256", tag="pref",
                  edges=["auth.algo"])          # 返回 "#001"；返回即持久化（fsync）
store.delete(nid)                                # ID 永不复用
```

## 架构（v0.4）

```
src/vtoken/
  assembler.py     ★ v0.4 ContextAssembler — 基座核心价值层
                   assemble(): search → resolve → cross_dedup → budget_pack → order → render
                   SlotConfig / AssembleResult / DEFAULT_SLOTS / infer_priority
                   render_mode 三档（v0.4.2 D33）: compact / dense / verbose
                   _compact_line(): TYPE 单字符编码 + slot marker 内联
                   _dense_line(): 纯 content 输出，0 元信息
  ingest/          ★ v0.4 异构源 → SIR 适配层（跳过 .vt HIR）
    md_adapter.py      Markdown → SIR（H1/H2/H3 + bullet + bold-bullet + anchor-link）
    tool_adapter.py    MCP tool schema → SIR（tool.name → DEF，inputSchema → VAR）
    memory_adapter.py  记忆系统输出 → SIR（[{id, content, tags}] → 带槽位/priority 的图）
  store.py         UnifiedStore（doc+mem 跨图检索、toc、stats、assemble、ingest）
  graph.py         P1.3/4  SIR 图 + resolve + TIR + merge（跨源去重）
  memstore.py      P1.5/6  vt.write / WAL / checkpoint / 崩溃恢复
  parser.py        P1.1  .vt 解析（HIR，降级为调试格式）
  compiler.py      P1.2  .vt -> .vtg（幂等 + 原子）
  renderer.py      T5.2  .vt -> Markdown 渲染（调试用）
  md_to_vt.py      T5.3  Markdown -> .vt（反向，调试用）
  search.py        T5.5  TF-IDF 离线搜索（D30 替代 embedding）
  mcp_server.py    T5.4  MCP server（vt_write/resolve/search/stats/toc + vt_assemble/vt_ingest）
  schema.py        core schema + .vtschema 扩展
  cli.py           vt compile/check/resolve/stats/render/convert/mcp/search + ingest/assemble
  model.py         VTNode（v0.4 新增 slot/priority/source_files）
  errors.py        VTError 层级
tests/            240 项（v0.3 基线 + v0.4 merge/ingest/assembler/cli/assembly_extras）
```

## 设计文档

- 全部裁决与完成日志：[DECISIONS.md](DECISIONS.md)（D1–D35 + T1–T5，含 v0.4.3 P1+P2 义务内短板优化 + 闭包 D35）
- **交接与剩余任务：[HANDOFF.md](HANDOFF.md)**
- 审计快照（带量化数据）：[AUDIT_SUMMARY.md](AUDIT_SUMMARY.md)
- v0.4 Context Assembly 基准：[benchmarks/p4_report.md](benchmarks/p4_report.md)

## 迁移注意事项

桥接完成后，迁移期需要注意：

- `src/vtoken/` 是纯 Python，0 第三方运行时依赖（tiktoken 仅基准用，可选）
- `tests/` 与 `benchmarks/` 可保留也可删除（不进宿主项目的运行时路径）
- `MemStore` 的 `session_dir` 应指向宿主项目的工作目录，不要硬编码
- `MCP server` 是可选的，宿主项目不使用 MCP 时可忽略 `mcp_server.py`
- `.vt` HIR 已降级为内部调试格式，迁移后宿主项目应优先使用 `ingest` 入口
- `examples/` 下的 `demo.py` 可作为集成参考样例
- 不要在宿主项目代码里 import `tests/` 或 `benchmarks/`（它们只是验证用）

## 不做什么（明确边界）

- ❌ 不做独立产品（VT 是基座库，由宿主项目持有与调用）
- ❌ 不做 embedding / 向量检索（断网约束 + D30 裁决；TF-IDF 粗筛 + BFS 精筛已足够）
- ❌ 不做 LLM 调用（VT 是 assembly 层，不是 reasoning 层；引入 LLM 依赖会破坏确定性和离线能力）
- ❌ 不做记忆存储（不替代 Mem0 / Letta；VT 消费宿主项目记忆系统的输出）
- ❌ 不做流式 token 输出（assembly 结果是一次性 prompt）
- ❌ 不做 .vt 语法的用户教育（.vt 已降级为内部调试格式；面向用户的入口是 `vt ingest` 和 MCP）
- ❌ 不做数据抓取（VT 不连数据库、不连 API；数据由宿主项目获取后注入）
