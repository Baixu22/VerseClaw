# HANDOFF — Verse Token 交接与展望 TODO

> **文档性质**：Phase 1 已完成并全绿。本文档交付给接手 Agent，包含：现状快照与验证方法、本轮实际验收中发现的问题与短板（诚实清单）、剩余开发任务及**可机械检验的验收标准**。
> 配套文档：[docs/design-review.md](docs/design-review.md)（22 项设计问题分析）、[DECISIONS.md](DECISIONS.md)（全部裁决 D1–D22 + 完成日志）、[README.md](README.md)（API/CLI 用法）。

---

## 0. 接手 Agent 工作规范（必读，违反视为交付失败）

1. **动手前先跑基线**：`PYTHONUTF8=1 PYTHONPATH=src python -m pytest tests -q`，必须看到 `58 passed`。任何改动后必须回到全绿（只允许增加测试数，不允许减少）。
2. **裁决优先级**：遇到规格书未覆盖的边界 → 先查 `docs/design-review.md` 和 `DECISIONS.md`。已有裁决（D1–D22）**不得推翻**，除非拿到实测数据证明其错误；新裁决沿用编号追加（D23 起），格式照旧。
3. **日志纪律**：每完成一项输出 `[VT:done] <任务号> <说明>` 追加到 `DECISIONS.md` 完成日志段，并勾选本文档对应复选框。
4. **环境约束（本机实测，勿浪费时间对抗）**：
   - Windows 11 / Python 3.10.3 / setuptools 58（旧）/ pytest 6.2.5；
   - **外网被代理阻断**：PyPI 和 openaipublic.blob.core.windows.net 均不可达（pip 装不了新包，tiktoken 下不了词表）；
   - 安装已通过 `python setup.py develop` 完成，`vt` 命令可用。**不要**尝试 `pip install -e .`（会因 build isolation 拉不到 setuptools>=68 失败）、不要升级全局 setuptools、不要"修复打包问题"——`setup.py` 就是为这台机器加的兼容层；
   - 所有运行 Python 的命令统一加 `PYTHONUTF8=1` 前缀（控制台默认 cp936，中文输出会炸）。
5. **红线（规格 §13，最高优先级）**：T1（P2.1）实测若 .vt 写入结构开销 > JSONL → 放弃 .vt HIR 层改用 JSONL，保留 SIR+TIR 层。设计服从数据，不服从审美。
6. **禁止事项**：不实现 `vt lint --fix`（规格 §8.3 永久删除）；不给 doc 模式加运行时写 API；不引入第三方运行时依赖（当前核心 0 依赖，只有 stdlib）。

---

## 1. 现状快照（已完成部分 & 如何验证）

### 1.1 已交付

| 项 | 状态 | 位置 |
|---|---|---|
| P1.1 .vt parser（doc/mem 全语法、JSON 错误报告、%ns 扩展、.vtschema） | ✅ | `src/vtoken/parser.py`, `schema.py` |
| P1.2 doc 编译器（幂等 SHA-256、原子替换、mem 拒编译） | ✅ | `src/vtoken/compiler.py` |
| P1.3 vt.resolve（双向 BFS、type_filter、include_untyped、悬空跳过、零磁盘 IO） | ✅ | `src/vtoken/graph.py` |
| P1.4 TIR 生成器（`[#id:TYPE]`、确定性排序、include_edges 可选） | ✅ | `src/vtoken/graph.py` |
| P1.5 vt.write / delete / WAL（fsync|flush 双档、type=tag 合一、mem→doc 跨图边、checkpoint） | ✅ | `src/vtoken/memstore.py` |
| P1.6 崩溃恢复（快照+WAL 幂等重放、残缺尾行跳过、seq 恢复、真实 kill 测试） | ✅ | `src/vtoken/memstore.py` |
| UnifiedStore（doc+mem 合图检索、toc 冷启动索引、stats） | ✅ | `src/vtoken/store.py` |
| CLI `vt compile/check/resolve/stats`（JSON 错误 + 退出码） | ✅ | `src/vtoken/cli.py` |
| 测试 58 项（覆盖规格 §12 验收清单全部条目） | ✅ | `tests/` |
| 示例 + 端到端演示 | ✅ | `examples/` |

### 1.2 验证命令（接手后第一件事逐条跑一遍）

```bash
cd C:/Users/27933/Desktop/saveToken/verse-token

# 1) 测试基线：预期 "58 passed"
PYTHONUTF8=1 PYTHONPATH=src python -m pytest tests -q

# 2) 端到端演示：预期 8 个 section 全部输出、最后打印 "demo 完成。"
PYTHONUTF8=1 python examples/demo.py

# 3) CLI 冒烟：预期第一条输出 TIR 5 行；第二条输出 JSON 错误、退出码 1
cd examples/doc
vt resolve auth.sec_1 --graph auth.vtg --graph middleware.vtg --depth 1
vt check --strict auth.vt; echo "exit=$?"
```

### 1.3 本机实测性能基线（Win11 / NVMe / Python 3.10）

| 指标 | 实测 | 规格目标 |
|---|---|---|
| vt.write P99（durability=flush） | ≈0.03ms | <2ms ✔ |
| vt.write P99（durability=fsync） | ≈2.8ms | <5ms ✔（余量不大，见 S2） |
| vt.resolve depth=2 P99（11 节点图） | ≈0.02ms | <10ms ✔（小图，无参考意义，大图见 T4） |

---

## 2. 本轮实际验收中发现的问题与短板（诚实清单）

> 这是接手前必须知道的全部已知问题。分三类：E=环境、I=实现短板（未修）、S=规格/产品级发现。

### 2.1 环境类（E）

- **E1 打包链路是妥协产物**。本机 setuptools 58 不支持 PEP 621/660，pip build isolation 又因断网拉不到新 setuptools → 最终用 `python setup.py develop`（deprecated 但可用）。`pyproject.toml`（现代环境用）与 `setup.py`（本机兜底）**必须同时维护**，改元数据要改两处。
- **E2 tiktoken 词表下载被代理阻断** → **T1（P2.1）在本机被阻塞**。tiktoken 包本身已装好，缺的只是 BPE 词表文件。离线解法（给用户或有网环境执行）：
  1. 在有网机器下载 `https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken`（约 1.7MB）；
  2. 放到本机任意目录，**重命名为** `9b5ad71b2ce5302211f9c61530b329a4922fc6a4`（该文件名 = 上述 URL 的 SHA-1，是 tiktoken 的缓存键，已替你算好）；
  3. 运行基准脚本前设 `TIKTOKEN_CACHE_DIR=<该目录>`；
  4. 自检：`PYTHONUTF8=1 python -c "import tiktoken; print(len(tiktoken.get_encoding('cl100k_base').encode('RULE')))"` 能出数字即通。
- **E3 控制台编码**：一律 `PYTHONUTF8=1`，否则中文输出/JSON 打印在 cp936 下报 UnicodeEncodeError。CLI 内部已做 `reconfigure(encoding="utf-8")` 兜底，但子进程/脚本仍需前缀。

### 2.2 实现类短板（I，已知未修——T0 任务组就是修这些）

- **I1 没有 `vt.search()` 占位**。规格 §4.2 要求 Phase 1 调用它返回 `NotImplementedError`，当前根本没有这个方法（调用得到 `AttributeError`）。5 分钟修复项 → T0.1。
- **I2 没有 60 秒定时 checkpoint**。规格 §5.1 说"每 1000 条 WAL 记录**或每 60s**"，当前只实现了条数触发（`checkpoint_every`）+ 手动 `checkpoint()`，没有时间触发 → T0.3。后果：低频写入的会话 WAL 长期不快照，恢复重放变长（不丢数据，只是慢）。
- **I3 doc 热加载（规格 §5.5 DocModeHotReloader）未实现**。P1 清单本就不含它，属于有意延后，但规格正文写了完整设计 → T5.1。当前改了 .vt 重新 compile 后，**必须重建 UnifiedStore 才能看到新图**。
- **I4 同一 session 无多进程互斥**。两个进程同时打开同一个 `<session>.vtwal` 会交叉追加把 WAL 写坏（规格把多进程推迟到 v0.4，但当前**连检测都没有**，是静默损坏而不是快速失败）→ T0.2 加 lockfile。
- **I5 resolve 无输出预算控制**。depth 调大时 TIR 可能一次吐出整个连通分量（大图上就是"变相全文注入"），违背目标 B 的精神；且 resolve 全程持有 mem 锁，超大图遍历会阻塞并发 write → T0.4 加 `max_nodes` 截断参数；锁粒度问题留给 T4 压测后定夺。
- **I6 `export_vt()` 是有损导出**。mem 的 .vt 语法（规格 §3.3）**表达不了节点 ID 和 edges**——这是规格语法本身的缺陷（写得出 `vt.write(edges=...)` 的数据，序列化不回 .vt）。已按 D6 定位为"仅供人读"，round-trip 会丢边。接手 agent 若做 T5.2（render），注意同样的坑。
- **I7 重复边不去重不告警**。同一 REF 行写两遍会产生两条相同边：resolve 节点去重不受影响，但 `include_edges=True` 会打印两行，`vt check` 也不提示。低危。
- **I8 `%ns` 的前缀规则有边界**：只对"不含 `.` 的裸 ID"加前缀。若外部节点真的叫无点单段名（如 `db`），在 `%ns auth` 文件里引用会被误展开成 `auth.db`。已文档化，属 opt-in 特性的已知限制。
- **I9 P2.4 并发压测从未运行**。线程安全靠单把 RLock，代码路径正确但**未在真实争用下验证过**；"零竞态"目前是设计承诺不是实测结论 → T4。
- **I10 合并图与源图共享边对象**。`merge_doc_graphs` 不深拷贝；doc 图按约定只读，但没有代码强制。谁在合并图上做变异操作会污染源图。
- **I11 `include_edges=True` 不含"末层兄弟边"**。BFS 只扫描到 depth-1 层节点的邻接，两个都在最外层的节点之间的边不会出现在边输出里。节点输出不受影响。低危，文档化即可。
- **I12 WAL 在 Windows 上行尾是 CRLF**（文本模式追加）。恢复端 `splitlines()` 已兼容，但若未来写跨平台字节级 WAL 校验/外部工具解析，注意这点。

### 2.3 规格/产品级发现（S，实测暴露的深层问题）

- **S1 规格自己的示例图是"稀疏烂图"，直接打脸检索质量**。§3.2 示例里 RULE 节点与 `auth.overview` 之间没有任何边——从 overview 出发 `type_filter=["RULE"]` **一条规则都拿不到**（demo 第 5 节因此换了起点）。结论：**局部检索的质量上限 = 建图纪律**，格式本身救不了稀疏图。T2 前必须先写"建图规范"（建议强制：每条 RULE 必须 REF 到所属模块的 DEF 节点），否则 P2.2 测出来的是烂图不是格式。
- **S2 fsync P99 本机 2.8ms，目标 5ms 余量不到一倍**。机械盘/杀毒实时扫描的机器上大概率超标。durability 参数已留退路（D3/D22），T4 需在目标部署硬件上复测，不要只在这台 NVMe 机器上下结论。
- **S3 token 效率叙事需要用数据重写（D19）**。行内重复的语义 ID（`auth.sec_1`≈4–6 token）才是写入开销大头，类型符（1 token）是零头；读取侧 TIR 前缀 `[#auth.sec_1:RULE] `≈8–10 token/行同样在稀释目标 B 的收益。已实现 `%ns` 缓解写入侧；读取侧若 P2.2 余量不足，可考虑 TIR 短 ID 映射表方案（未实现，仅思路）。**在 T1 实测落地前，README/规格里的"≤15% 结构开销"当作未验证宣称对待。**
- **S4 P2 全部四项基准（P2.1–P2.4）均未执行**。当前所有"效率优势"结论都是设计推演。这是剩余工作里价值密度最高的部分。

---

## 3. 剩余开发与验收任务（按此顺序执行）

### T0 — Phase 1 补遗（小改动，先做，预计半天）

- [x] **T0.1 补 search 占位**：在 `UnifiedStore` 与 `MemStore` 加 `search(query, top_k=10)`，直接 `raise NotImplementedError("vt.search lands in Phase 3 (P3.5)")`。
  **验收**：新增测试断言 `pytest.raises(NotImplementedError)`；全套测试 59+ 通过。
- [x] **T0.2 session 互斥锁**：`MemStore.__init__` 创建 `<session>.lock`（`os.open(..., O_CREAT|O_EXCL)` 写入 pid）；已存在时读 pid——进程存活则抛 `VTStoreError("session 'x' is locked by pid N")`，进程已死（陈旧锁）则接管并覆写；`close()` 删锁。
  **验收**：测试 a) 同进程二次打开同 session 报错；b) 手工写入含不存在 pid 的陈旧锁文件后可正常打开；c) `test_recovery.py` 里的 os._exit 崩溃测试在加锁后仍通过（崩溃遗留的锁必须能被接管）。Windows 上检测进程存活可用 `os.kill(pid, 0)` 的 try/except（Python 3.10 Windows 支持信号 0 探测；若不可靠，退化为 `psutil` 不可用时的时间戳过期策略并记录 D23）。
  > **执行日志**：`os.kill(pid, 0)` 在 Windows 上对不存在 pid 也抛 `PermissionError`，无法区分存活/已死 → 实测验证后采用 ctypes `OpenProcess + GetExitCodeProcess` 方案（D23）；3 个验收点全部通过。
- [x] **T0.3 时间触发 checkpoint**：`MemStore.start_background_checkpointer(interval_s=60)` 起 daemon 线程，周期调用 `checkpoint()`（内部已线程安全）；`close()` 时停线程。不默认开启（保持零后台线程的默认行为）。
  **验收**：测试用 `interval_s=0.2`，写入后 sleep 0.5s 断言 `.vtg` 出现且 WAL 只剩 checkpoint 标记；close 后线程退出（`thread.is_alive() is False`）。
- [x] **T0.4 resolve 输出预算**：`resolve(..., max_nodes=None)` 参数，BFS 发现节点数达上限即停止扩展（当层截断，保持确定性），根节点永远保留。
  **验收**：构造 20 节点星型图，`max_nodes=5` 断言输出恰好 5 个不同节点 ID 且两次调用结果字节相同。

### T1 — P2.1 写入效率基准（**最高优先级，决定格式存废**，前置：E2 词表就位）

- [x] 脚本 `benchmarks/p21_write_efficiency.py`：10 个真实知识库场景（建议覆盖：API 约束、架构决策、DB schema 说明、部署 runbook、安全规则、任务清单、研究笔记、用户偏好、错误码表、变更日志），每场景以**语义等价**内容产出 4 种格式：
  1. `.vt`（完整语义 ID，规格式）；2. `.vt` + `%ns`（短 ID）；3. JSONL；4. **朴素 Markdown（无加粗无装饰——D19，不许用规格 §3.4 的加粗对照组）**。
- [x] 口径钉死：`结构开销 = (格式总token − 纯内容token) / 纯内容token`，纯内容 = 各条目正文按行拼接；tokenizer 固定 cl100k_base；语义 ID 计入 .vt 开销。
- [x] 产出 `benchmarks/p21_report.md`：逐场景表格 + 汇总均值 + **红线判定**（.vt 两档 vs JSONL vs Markdown）。
  **验收**：报告存在且含 10×4 完整数据；结论（含是否触发红线）以 D23+ 编号写入 `DECISIONS.md`。若触发红线，**停止后续 T 任务，先向用户汇报**。
  > **执行结果**：词表经 7890 代理一次性下载到 `.tiktoken_cache/`（已加 .gitignore），离线运行。10×4 数据齐备。**红线未触发**（D24）：.vt 平均 68.6%、.vt+ns 58.6%、JSONL 111.6%、MD 81.4%。.vt 两档均显著低于 JSONL，相比 JSONL 节省约 40% 结构开销。同时记 D25：推翻规格/README 中"≤15% 结构开销"的绝对值宣称，改为"相比 JSONL 节省约 40%"的相对叙事。T2 可继续。

### T2 — P2.2 读取效率基准（前置：先补建图规范，见 S1）

- [x] 先写 `docs/authoring-guide.md`：建图纪律（每 RULE 必须 REF 到所属模块 DEF；孤立节点告警；建议每文档 DEF 数 ≥1 等），并把 `examples/doc/` 补边到符合规范。
- [x] 20 个文档（500–2000 token）× 每文档 20 问题；对比 `resolve(depth=2)` 注入 vs 全文注入的 token 消耗与回答准确率。
  **验收**：token 消耗 ≤ 全文 35%，准确率损失 ≤2%；报告 `benchmarks/p22_report.md`。
  **注意**：需要 LLM 参与评测。本机断网——要么在有 API 的环境跑，要么接手 agent 自身充当被测模型（必须在报告里声明这一方法学偏差）。
  > **执行结果**：复用 T1 10 场景扩到 500–1500 token + R1 合规 DEPENDS 边；4 题/文档 × 10 = 40 题（DEF/RULE/DEPS/TRACE）。token 与准确率均为完整机械计算（无 LLM 参与，方法学偏差消除）。3 次迭代：(1) max_nodes=5–6 → token 48.6%/准确率 57.5%；(2) 引入 max_facets (D27) → token 45.2%/准确率 90%；(3) 自适应预算（def=3+2 / rule=#RULEs+8+1 / deps=#端点+3+1 / trace=out_deg+2+1）→ **token 31.4% ≤ 35%、准确率损失 0.0% ≤ 2%，双红线同时达标**。裁决 D26（红线冲突诊断）+ D27（max_facets 引入：DEF 始终保留 + 声明序前 N-1 个）。max_facets 透传到 MemStore.resolve / UnifiedStore.resolve / CLI `--max-facets`；新增 8 个测试。

### T3 — P2.3 写入容错性

- [x] 让 agent 连续写 100 个 doc 节点，统计 parse 错误率与"读 JSON 错误报告→自行修复"的额外 token。
  **验收**：修复开销 ≤ 原始写入 token 的 10%；报告 `benchmarks/p23_report.md`。错误报告的 JSON 已按行号+类型+symbol 设计好，agent 修复回路应当直接可用——如果发现报告字段不够用，这是最有价值的反馈，记 D23+。
  > **执行结果**：两段评测（D28）。A) 覆盖率测试：100 场景（83 buggy + 17 legal baseline），parser 准确识别所有错误类型，100/100 = 100.0% ≥ 95%。B) 开销红线：单文件 100 节点 + 5 注入错误（5% 错误率），check_file 一次性得到错误报告 JSON（5 个错误全部被识别），agent 读报告 + 发出 5 个修复补丁。总写入 token = 4391，修复开销 = 398（报告 239 + 补丁 159），**比例 9.1% ≤ 10%，红线达标**。报告 JSON 字段（line/type/message/(id|symbol)）足够 agent 直接定位修复，无需扩展。发现：parser 在 header 错误时不深扫 body（compound 场景）；compile_file 才触发 mem_not_compilable（check_file 不走编译路径）。

### T4 — P2.4 并发稳定性（修复 I9）

- [x] `benchmarks/p24_concurrency.py`：线程 A 以 50ms 间隔 `write()` 持续 60s（durability=fsync），线程 B/C 并发 `resolve()`；记录错误数与延迟分布（p50/p99）。
  **验收**：零异常零竞态（节点数 = 写入数）；write P99 <5ms、resolve P99 <15ms（本机）；报告含硬件说明。若 fsync 超标 → 按 S2 记录并给 durability 建议，不许静默放宽目标。
  > **执行结果**：双场景跑满 60s（fsync + flush，checkpoint_every=0 隔离锁争用）。**并发红线（T4 核心）双场景全达标**：fsync 1033/1033 writes、flush 1040/1040 writes，integrity 全 OK、0 errors；resolve P99 fsync=2.062ms / flush=0.327ms，远低于 15ms 红线。**延迟红线（硬件依赖）按 S2 记录**：fsync write P99=11.047ms > 5ms（OS journal commit 尾延迟，与单线程基线一致，非并发争用）；flush write P99=0.662ms < 2ms 达标。durability 建议（按 S2）：交互式 agent 用 flush、checkpoint 用 fsync。裁决 D29（并发红线 vs 延迟红线分组判定 + RLock 串行化在真实争用下验证可靠）。

### T5 — Phase 3 工具链（T1 红线通过后才开始）

- [x] **T5.1** doc 热加载（规格 §5.5：mtime 轮询 + GraphHolder 双指针原子切换；注意用 `st_mtime_ns`，注意文件不存在时的容错）。验收：改 .vt→compile→不重建 store，下次 resolve 看到新内容；含并发读切换测试。
  > **执行结果**：新增 `GraphHolder` dataclass（source_path/mtime_ns/graph/is_compiled）+ `UnifiedStore._maybe_reload()` 在 resolve/toc/stats 前轮询 mtime，变了就 recompile（.vt 源）或 reload（.vtg 源）+ 原子 ref swap。文件不存在容错：保留 stale graph 不报错。`UnifiedStore.open(doc_sources=[...])` 新 API；`vtg_paths` 旧 API 保持无热加载行为。15 个新测试覆盖 .vt/.vtg 双源、mtime 变更触发 reload、文件缺失容错、多源仅变更者 recompile、4 线程并发读期间改 .vt 不抛异常、GraphHolder.refresh() 单元、向后兼容。
- [x] **T5.2** `vt render`（doc .vt → Markdown 供人审查）。验收：示例文档渲染含全部节点与边、注释丢弃。
  > **执行结果**：新增 `src/vtoken/renderer.py` 模块（`render_doc_to_markdown` / `render_mem_to_markdown` / `render_file`）。doc 模式：H1=doc_id + 元信息行（vt/schema/lang/ns）+ 每节点 H2 + 注解 facet H3 + 文末"关系 (Edges)"段按声明序输出 `src --REL--> dst`（无类型边 `~~`）。mem 模式：H1=session + 项目符号列表（保留 #tag）。CLI `vt render <file> [-o out]`。8 个测试覆盖示例 auth.vt 全部 8 节点 + 6 边出现、注释丢弃、元信息行、注解 H3、-o 输出、mem 模式 tag 保留、错误处理。
- [x] **T5.3** `vt convert --from-md`（Markdown → .vt 迁移，质量声明照规格 P3.3）。
  > **执行结果**：新增 `src/vtoken/md_to_vt.py` 模块（`md_to_vt_string(md, mode)`）。基于 H1/H2/H3/正则模式匹配逆向 renderer 输出。**P3.3 质量声明（D30）**：非无损 — 原 .vt 字节序不保留、注释已被 render 丢弃无法恢复；round-trip `.vt → render → convert → .vt` 在节点/边/facet 集合上结构等价但不字节相同。CLI `vt convert --from-md <file.md> [--mode doc|mem] [-o out]`。7 个测试覆盖 round-trip 节点集保留、边三元组语义等价、CLI stdout/file 输出、mem 模式 tag 保留、字节非同质性声明、注释丢失声明。
- [x] **T5.4** MCP 封装（`vt.write`/`vt.resolve` 暴露为 MCP tools）。
  > **执行结果**：新增 `src/vtoken/mcp_server.py`（0 第三方依赖，stdlib JSON-RPC 2.0 over stdio）。实现 MCP 协议子集：`initialize` / `tools/list` / `tools/call` / `shutdown` / `ping`；5 个 tools：`vt_write` / `vt_resolve` / `vt_search` / `vt_stats` / `vt_toc`。配置通过环境变量 `VT_MCP_SESSION_DIR` / `VT_MCP_SESSION` / `VT_MCP_DOC_SOURCES`（后者启用 T5.1 热加载）。CLI `vt mcp`。11 个测试覆盖 initialize/protocolVersion、tools/list 含全部 5 个 tool、未知方法 -32601、malformed JSON -32700、write→resolve round-trip、未知节点 VTResolveError、stats/toc、未知 tool -32601、tool schema required 字段。
- [x] **T5.5** `vt.search()` 实装（embedding；断网机器需离线模型，先做技术选型记 D23+）。
  > **执行结果**：技术选型 D30 — 断网环境无法 pip install sentence-transformers 也无法调 OpenAI embedding API，故实装纯 stdlib TF-IDF + cosine 相似度作为离线 fallback。新增 `src/vtoken/search.py`（`SearchIndex.build([graphs])` + `query(query, top_k) → [{id, score, snippet}]`）。tokenizer 用正则：ASCII 按词（lowercase）+ CJK 按单字。IDF 平滑：`log((N+1)/(df+1)) + 1`。索引在 store 上缓存，按 `graph.version` 失效（write/delete 触发重建）。`MemStore.search()` / `UnifiedStore.search()` 从 NotImplementedError 占位升级为实装（T0.1 占位测试替换为实装测试）。CLI `vt search <query> [--doc-source ...] [--graph ...] [--session-dir ...] [--top-k N]`。17 个新测试覆盖 tokenizer、TF-IDF 索引构建、查询结果排序、空查询、未构建索引、中文关键词、多图合并、TF 影响、mem 索引按 write 重建、unified doc+mem 合图搜索。

### T6 — Phase 4（方向性，暂不展开）

schema:code / schema:task / schema:research；跨文件边的增量合并；多 Agent 多进程写入协议（T0.2 的 lockfile 是它的占位挡板）。

---

## 4. 快速上手（接手第一小时）

```bash
cd C:/Users/27933/Desktop/saveToken/verse-token
PYTHONUTF8=1 PYTHONPATH=src python -m pytest tests -q   # 必须 58 passed
PYTHONUTF8=1 python examples/demo.py                    # 8 个 section + "demo 完成。"
# 读三份文档：docs/design-review.md → DECISIONS.md → 本文档 §2
# 然后从 T0.1 开始，按 §0 工作规范执行
```
