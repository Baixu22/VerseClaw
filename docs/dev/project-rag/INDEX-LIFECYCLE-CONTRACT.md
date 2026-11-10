# Project RAG 投影与索引生命周期

投影由 `KnowledgeProjectionController`、共享 SQLite 的 `ProjectionStore` 和 Wiki owner adapter 管理。来源读取、版本和权限仍归 owner，索引只保存可重建片段。SQLite 中的 source intent、generation、job 和事件游标支持重启恢复。

## 启用与作用域

索引通过既有 typed Host Gateway 入口调用 `wiki.index.start` 显式启用。Main 从可信的活动 workspace/session 派生 `readIdentity`，覆盖请求内同名字段。Wiki Gateway 只接受 backend 身份，并将一个 vault 的当前启用范围保存到 plugin-scoped SQLite keyed state。服务重启只恢复已保存的启用范围；停止进程不会修改保存的选择，`wiki.index.stop` 会持久停用。

操作入口为 `wiki.index.status`、`reconcile`、`rebuild`、`idle`、`search` 和 `stop`。`status/search` 使用 read scope，其余使用 write scope；前端仍经 `src/lib/host-api.ts` 或 typed API client 调用，不能直接操作数据库或自行派生权限。启用范围绑定 workspace、session key 和物理 sessionId；会话代次变化后请求拒绝，后台 owner 读取也取消旧代次的资格。

## 观察与撤销

启动完整对账、既有 WatcherHub 的页面事件和周期对账进入同一个 source intent 入口。页面事件先取消旧 generation 的可读资格，再去抖重建。完整列表发现删除时写 tombstone；解析失败也取消该来源的可读资格。Wiki subject 使用统一的斜杠标识，避免 Windows 文件路径与 owner 身份分叉。

重复语义不产生新 generation、重置预算或持续增加事件。事件重放保留当前意图，不恢复过去的许可。变更后的 source revision/digest、policy epoch、profile 或显式 rebuild 会生成单调 intent sequence，旧 job 即使完成也不能发布。

## 后台构建与发布

job 记录总期限、三次尝试预算、next-attempt 时间和带 nonce 的租约。过期租约在恢复时回到 pending 或转为 failed；过期 pending 同样转为 failed。预算耗尽后，普通重复对账不会重新授予预算；显式 rebuild 可以创建新意图。

chunking 和 chunk/FTS 写入在 worker thread 中执行，受 BackgroundWorkGate 调度、租约和总期限约束。当前 lexical projection 使用标明为 `lexical-utf8-bytes/v1` 的保守字节计数；模型 tokenizer 和 embedding 空间在后续 provider 生命周期中接入，并产生独立 profile/generation。

worker 构建完成后请求 owner 复读当前 pin，再在共享数据库事务中检查当前意图、租约和期限。chunk、FTS 与 active pointer 一次发布；批量插入受 SQLite 参数数量约束分批执行，但仍属于同一事务。未完成或失败的构建不能成为 active。

旧 generation 是持久的清理线索，后台清理可以幂等重试。清理只删派生 chunk、FTS 和退休 generation，保留当前 generation 与撤销 tombstone。

## 查询与故障

FTS 查询首先只选取当前 eligible generation，再由 owner 重新读取每个命中的精确版本与字节范围。引用摘要、权限、保留政策、作用域和当前 source pin 都通过后才返回 quote。同轮某来源遭拒，已收集的同来源结果也会被移除。

FTS5 的建表由投影 owner 按需执行，通用共享状态 schema 不依赖 FTS 扩展。FTS 缺失或格式损坏时查询返回 `unavailable`；该故障不修改原文或治理资料，也不应阻止共享状态与普通 Chat 启动。Gateway 停止会释放 watcher、timer 和 worker；未完成租约可在下次启用时恢复。
