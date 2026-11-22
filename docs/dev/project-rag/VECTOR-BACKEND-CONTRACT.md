# 项目向量投影后端

设置 > 模型与服务的“项目向量索引”在 embedding 已就绪后显式构建索引。可移植精确检索使用共享 SQLite 的 float32 BLOB；原生 ANN 使用 memory-wiki 持有的 LanceDB Embedded 库，不注册 memory-lancedb 的写入、recall 或 capture hooks。

每个 namespace 的 SQLite 记录拥有单一 active generation。新 generation 先构建，最后比较 intent sequence、workspace、space、backend 和已写行数后切换指针。中断构建在重启时标为失败，旧合格 generation 可以继续提供相同空间的查询；更换模型空间立即隔离旧向量。后台清理只处理非 active generation。

当前工作区或物理会话变化后，设置页提供新的配置入口并隐藏旧 generation；显式配置会排空旧作用域，再建立新索引。ANN 表丢失，或行数、作用域、完整 ID 集合与 SQLite 收据不匹配时，原 generation 先失去读取资格，新 generation 使用 SQLite 中仍符合当前来源版本的向量恢复。后台同步中的重建和优化请求各保留一个待执行意图，禁用时一并取消。

`VectorProjection/v1` 保存 chunk ID/digest、来源 generation、owner SourceRef、workspace/namespace/space 和向量。LanceDB 行保存这些身份与过滤字段，不保存可直接作答的正文。SQLite 同时保存派生向量以支持恢复和可移植查询。

LanceDB 数据放在 runtime 状态目录的 `ann/` 下，表名使用紧凑的 generation UUID；namespace 隔离由表身份与行过滤共同保持。原生 capability 在实际目录完成一次小型写入和读取后才报告可用，检测结果在本次后端生命周期内复用。Windows 目录过深导致原生写入失败时，系统会报告 capability 不可用并选择 portable。

打包脚本按 memory-wiki 的依赖图物化 LanceDB、Arrow 和当前平台的原生模块，运行时从插件包位置加载。配置在其他磁盘的 pnpm virtual store 按安装记录纳入打包；宿主 OpenClaw peer 由宿主提供。

来源生命周期继续归既有 projection owner。向量服务读取当前合格 chunks，仅为缺失的 ID 调用已选 embedding provider；原文和格式化输入不成为新知识权威。native 写入成功后才保存 SQLite 行收据，中断后的重试可以幂等补齐。query 不触发整库构建。

查询先从共享 SQLite 取得当前可读的 vector ID 集合，然后在后端评分前过滤 workspace、namespace、space、generation 和这些 ID。LanceDB 使用默认 prefilter，包含刚追加的未索引行；没有调用会漏掉新行的 `fastSearch()`。结果只返回 ID 与距离，引用正文由 source owner 按原 pin 复读，返回前再次确认 active generation 和资格。

portable 精确扫描复用一个后端持有的 worker，缓存当前 generation 的向量与范数。SQLite 在向量写入和删除的同一事务内递增 `vector_revision`；下次查询按该修订刷新缓存，并重新应用本次 owner 的可读 ID 集合。取消、30 秒查询期限或后端关闭会终止 worker，后续请求可以重新打开。

配置、禁用和维护操作按同一个控制队列执行，旧向量构建排空后才安装新轮询。词法准备和查询的等待可被取消，查询始终绑定开始时的取消信号，晚到结果被拒绝。ANN 查询的排队和执行共用 30 秒调用期限；原生维护完成后再关闭底层句柄。`optimize` 使用 cosine HNSW SQ 和安全的旧版本清理，保持 `deleteUnverified: false`。缺少 native capability 时，设置页显示可用性提示，并在 portable 容量内继续提供检索。

参考容量为 portable 20k、ANN 100k eligible chunks，768 维是容量测量的参考维度。每个实际平台记录冷/热 query、Recall@20、构建时间、RSS 和磁盘。ANN 对同一 eligible 集合的 exact vector 对照需要 Recall@20≥0.98。容量脚本的确定性合成向量用于工程测量，语义质量另由冻结查询评测验证。

运行 `scripts/knowledge-rag-vector-capacity.ts <新的输出目录> <portable|ann>` 可生成容量报告。脚本单独记录冷查询和 30 次热查询，以 Recall@20≥0.98 和热查询 P95（portable≤900 ms、ANN≤2500 ms）同时判定；目录已有报告时拒绝覆盖。原生模块缺失可用 `scripts/knowledge-rag-vector-probe.ts <报告文件> <已校验GGUF路径> --native-missing` 验证：Node 解析钩子自动模拟缺包，报告明确记录故障注入及 portable 恢复结果。
