# Memory Control Plane

Status: active internal engineering boundary (TF-0497)
Schema: `MemoryControlPlaneManifest/v1`
Source: `shared/memory/control-plane.ts`

## Product concept

**Memory** is one reviewable product concept: accepted facts or cards with explicit provenance, scope and lifecycle state. Role Memory, Runtime Memory, embeddings, native retrieval and Dreaming are data domains or derived infrastructure, not separate product memories. Only accepted memory may enter retrieval or prompt context.

Candidates may persist, but `memory-candidate` has `retrieval=none` and `injectable=false`. A candidate can become accepted only through its owning governance/runtime acceptance path.

## Authority matrix

| Data domain | Owner | Scope | Boundary | Retrieval / injection | Retention / delete | Invalidation | Migration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| role-memory-card | role-memory-card-governance | workspace | review-required | accepted-only / accepted-only | owner lifecycle; delete/tombstone removes retrievability | review, evidence, scope or version invalidation | role-memory SQLite stays in place |
| runtime-fact | runtime-memory-store | session, run | owner-accepted | accepted-only / accepted-only | Runtime Memory TTL and eviction; dependent embeddings invalidated | contradiction, stale evidence or scope mismatch | existing Runtime Memory store remains |
| runtime-timeline | runtime-memory-store | session, run | owner-accepted | accepted-only / accepted-only | follows session/run lifecycle | replaced generation or invalid episode | additive schema only |
| runtime-episode | runtime-memory-store | session, run | owner-accepted | accepted-only / accepted-only | Runtime Memory owns deletion and index cleanup | lost execution context or contradiction | existing episode store remains |
| memory-candidate | memory-candidate-queue | workspace, session | review-required | none / never | queue retention; reject/delete or audit tombstone | rejected, superseded or stale candidate never promoted | persisted with accepted-target identity |
| embedding-index | memory-embedding-provider | workspace | derived-only | internal-derived / never | source/provider lifetime; source delete rebuilds | source digest, model or delete invalidation | rebuildable derived data, never sole copy |
| native-file-query | native-file-memory-retrieval | workspace | transient | transient / never | request-bounded | changed source file | native files stay read-only sources |
| dreaming-derived-cache | dreaming-derived-cache | workspace | derived-only | internal-derived / never | phase/cache policy; reset/repair only removes derived artifacts | input change, duplicate repair or reset | rebuildable cache; not migrated as accepted memory |

## Approval and consumption

Memory self-edit operations use `source/kind: agent_self_edit`,
`verificationStatus: agent_approved` and `promotedBy: agent`. This status means
agent acceptance of its own edit, not independent verification or human approval.
Each update/forget appends agent action lineage and tool evidence carrying
`driven_by: agent` / `actor: memory_self_edit`; historical evidence remains intact.
The forgetting tool accepts only `retracted`. Strengthening records usage without
changing fact provenance or verification. Schema guards reject contradictory
self-edit approval records before storage. These values are additive; historical
records are not rewritten and no SQLite migration is run. The TF-0500 persistence
retirement and empty adapter tool list remain unchanged.

- Role cards use review/governance transitions owned by `role-memory-card-governance`.
- Runtime facts/timelines/episodes use the Runtime Memory owner's acceptance and invalidation paths.
- Embeddings and Dreaming consume accepted inputs and may be rebuilt; they cannot accept memory or inject prompt context.
- SEKB remains a Knowledge Runtime Lessons source and does not own a memory store.
- The model-safe product description is exposed by the manifest and the Memory surface; it must not describe Role/Runtime/Dreaming/Embedding as separate user memories.

## User surface and close semantics

TF-0498 adds the single product destination `/memory`. It is a projection and command surface, not another store or accepting authority.

- **Accepted** lists active/cold Role cards and accepted Runtime facts with scope, source, timestamps, sensitivity, evidence count and current model visibility.
- **Candidates** lists persisted Role proposals and Runtime fact candidates. Every candidate has `retrievable=false`, `injectable=false` and `modelVisible=false`.
- **Approve** delegates to Role Memory review or `memory.proposeFacts.confirm`; it does not write a card/fact directly.
- **Delete** dispatches by owner: role cards are tombstoned; Runtime facts are invalidated with reason `retracted`.
- **Export** reads the same surface projection and writes an owner-neutral JSON snapshot under Electron `userData/exports/memory`. Secret/secret-adjacent content is redacted and the returned SHA-256 covers the exact bytes written.
- **Remember this** calls the existing `memory.propose` gatekeeper/policy/evidence/conflict path with source `user`. It may be accepted or become a persisted review candidate; the UI does not bypass review.

Role Memory off closes Role read/write gates and stops Role prompt retrieval, but does not delete the on-disk cards. Runtime capture, persistence, provider and injection-pilot flags are reported separately. Native OpenClaw memory sources have separate read-only owners; the Memory UI states that disabling this surface's Role/Runtime gates does not claim to disable those sources.

The model-facing projection contains accepted keys whose owner gate and injection-pilot configuration make them currently model-visible. Candidate keys are returned only as an explicit exclusion set for diagnostics/tests and never enter accepted/model-visible data.

## 原子更新边界（TF-0742）

恢复前的 self-edit 与 AUDN curation 使用既有存储 owner 的同步事务：SQLite 复用同一连接及嵌套 savepoint，内存 store 在失败时恢复事实、失效记录、关系、使用计数与容量淘汰状态。新事实、旧事实失效与关系写入中任一步抛错、rejected 或 skipped，均中止更新；不具备原子接口的显式端口在写入前拒绝。

DELETE 在失效写入提交后返回 applied/persisted=true，重复删除返回 already_applied；缺失目标拒绝，禁用路径仍 skipped/flag_disabled。此处不启用已退役的 persist；SQLite 故障注入仅在隔离测试进程模拟标志解析。README en/zh/ja 已审阅，产品可用性与用户流程未变化。

## 读取新鲜度（TF-0743）

恢复前的 memory_query 保留 30 秒缓存复用上限，每次复用先核对同一 SQLite owner 的不透明 revision。revision 同时观察连接内写入和其他连接的提交，包含连接身份，不是跨连接可比较的全局序号。owner 在最外层事务提交后通知进程内缓存失效；回滚不发送提交事件。facts 与派生检索索引同时失效，避免原 fact ID/时间不变的外部编辑仍复用旧索引。

query 和每次重载的 self-edit 入口均返回 loadedAt、sourceRevision、scope、stale。快照 revision 在读取数据的同一事务中采集；异步检索结束时再次核对，提交与读取竞争时明确 stale。缺失 revision 的注入端口与未提交事务不声称 fresh。scope=sqlite-connection-snapshot 只表示所观察的读边界，不能保证返回后另一进程不会再写入。元数据表更新可能保守地使 revision 变化，宁可重新加载，也不把它解释为新增事实。

此节点还对齐现有 agent schema 的 object 参数与内部 handler 的 objectSummary 字段，保持工具输入语义。所有路径继续受 TF-0500 的 persist=false 退役门禁约束；跨进程验证使用隔离 SQLite 与自动退出的 Node 子进程，属于 agent 驱动的恢复前证据。

## Stage5 facade 决策：retire（TF-0744）

选择退役生产采用：Stage5 facade 没有生产工具消费者，也没有生产 barrel 导出；唯一非测试消费者是显式调用的 historical golden-run observer。为它新增生产入口会扩大当前恢复前门禁的范围，且无法改变 persist 已退役的事实。现有工具继续由各自 owner 管理，保持已验证的权限与存储边界。

模块标记 deprecated；direct exports 仅为历史观察复跑和契约测试保留，golden-run 的默认关闭开关与历史产物保持。此处的 retire 是采用决策，不删除历史代码或重写旧验收。契约测试扫描生产源码并以导入、动态导入和 barrel 导出的负例验证判定器。self-edit 文件头说明 adapter 已存在但 persist 仍退役；不得从直接单测接口推断工具已注册。当前生产消费者数为 0，属于静态结构度量，不是运行时收益。未来采用需要单独设计和验收；本节点不修改默认值或产品锁。
