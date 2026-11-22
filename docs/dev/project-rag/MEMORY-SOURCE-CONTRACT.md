# 原生记忆与角色记忆读取

原生 Markdown 和 Role Memory 卡由各自服务读取。Chat 和知识引用通过 `SourceRef/v2` 固定领域、owner、namespace、subject ID、版本、digest 和 UTF-8 原文范围，再交给现有 DCS 装配。

| 来源 | authorityId | namespace | ID 与版本 |
|---|---|---|---|
| 原生记忆文件 | native-memory | 选中的 memory plugin、agent 与工作区路径摘要 | provider 返回的精确文件路径；完整原文 digest 为版本 |
| 角色记忆卡 | memory-slot | 既有 Role Memory SQLite 路径摘要 | 精确 card ID 和 card version |

原生 raw 读取按严格 UTF-8 解码并保留 BOM 与 CRLF。非法 UTF-8 返回来源拒绝，不产生版本、digest 或 pin。

内部 Knowledge 模型执行使用既有 AgentRunContext 绑定 run、session generation 和工作区。绑定覆盖单次 attempt 的读取、装配与模型调用，成功或失败退出时释放该 attempt 的绑定，保留重绑后的新身份。没有可见会话记录的内部读取只接受该运行登记的身份，读取返回前再次核对绑定；运行结束或身份切换后，旧内容返回拒绝。普通会话继续核对 session-store 的当前 generation。

原生搜索回源沿用搜索时选定的 agent，返回该 agent 的 provider 原文和 namespace。记忆引用的独立 revision、contentDigest 与 corpus 条件在 Host 读取时同时生效；SourceSet 的 embedding provider 准入传至 owner，诊断保留原生文件或角色卡的领域、owner 和完整 pin。

首次显式引用使用 `native-memory:memory/example.md` 或 `memory-slot:<card-id>`。读取成功后使用完整 SourceRef pin。显式角色卡地址决定目标 ID，引用行 ID 不参与替换或失败回退。相同文本 ID 不会切换来源；pin 不匹配、来源被撤销或失效时直接返回拒绝。

原生读取复用所选 MemorySearchManager 的安全文件读取和 raw 模式，保留 UTF-8、CRLF 与完整 digest。原有工具分页行为继续使用其默认范围。读取检查 memorySearch 是否启用、plugin slot 是否可读、当前 session generation 和工作区；Runtime Memory 诊断 slot 返回不可用。文件的 ACL、scope、sensitivity、retention、trust 和更新信息通过现有 owner-read 严格解析器检查。搜索从当前原文的命中行范围返回最多 4,000 字符的有 pin 片段，片段行号和 UTF-8 范围一致，版本仍绑定完整文件摘要。

工作区以实际目录绑定，Windows junction 和原路径得到同一 namespace。读取返回前再次核对实际目录、搜索开关、plugin slot、实际注册的 provider、session generation 和取消信号。读取期间发生切换或停用时，旧 provider 的内容返回拒绝；MemorySearchManager 的异步创建也遵守同一 owner 检查。损坏的元数据和 provider 读取错误返回该来源的拒绝结果。

角色卡继续复用 Role Memory 的主开关、版本、作用域、过期、supersession 和 use-gate overlay。pin 的 namespace 在查询卡内容前核对，切换存储目录后不会读取前一 owner 的资料。poison 标记和秘密资料会被拒绝。

Main 的 `knowledge.get`、SourceSet 回答和 Studio 草稿对记忆领域引用调用 `memory.readSource`，保留各自的 ownerSnapshot、原文版本及引用范围。模型调用按来源传递 memory corpus，草稿保留完整 pin。缺少当前 pin 的显式记忆 SourceSet 和 Studio 选择返回拒绝；重新选择已回源的来源后可继续。全部来源被拒时诊断仍保留请求的记忆领域。该只读 Gateway 路由要求 Main 已使用的 operator.admin 权限与 backend 身份，通用 renderer Gateway RPC 在转发前拒绝此方法；返回前核对当前工作区和 session，包括读取期间的重新绑定。正文通过既有 ownerSnapshot 和 DCS，原生文件和卡内容不会写入 Wiki 或新的长期 chunk 表。

QMD raw 读取复用 Memory Host SDK 的 regular-file 和路径检查。工作区及额外目录的父级 junction/symlink 越界均在读正文前拒绝。

原生读取绑定实际注册 runtime 的 plugin ID。仅注册 public artifacts 的桥接 plugin 保留 runtime 的原 owner；选择不提供匹配 runtime 的 slot 时，原生 RAG 不读取旧 owner。既有 dreaming sidecar 继续使用其原来的运行时服务。

知识页打开记忆引用时按 pin 传递 memory corpus。Host 的无 pin memory 请求和 all-corpus 返回的无 pin 记忆正文均返回拒绝；SourceSet 的 96k 字符读取上限同样适用于带完整 pin 的正文。

回滚时停用对应 owner；来源数据、其他记忆服务及普通 Chat 保持可用。回归覆盖同名领域、原文字节、纠正/删除、slot/工作区/代际切换与敏感性限制，Electron 旅程见 `tests/e2e/project-rag-source-domains.spec.ts`。
