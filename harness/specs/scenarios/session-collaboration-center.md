---
id: session-collaboration-center
title: 会话发现、消息协作、成果复用和资源回读整链
type: scenario
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - durable-task-system-boundary
  - comms-regression
  - disk-temp-policy
---
# 会话协作中心场景

A2 通过 typed sessionActivity.query 与 sessions_list(collaboration=true)、session_status(readOnly=true) 共用有界发现和详情读取。正反场景核对目标搜索、工作区/会话过滤、分页/字段上限、来源状态、游标与 reset 拒绝、visibility/A2A/sandbox 读取策略，以及原 owner 前后状态；完整 transcript 读取与模型调用保持 0。

回复中的旧 requester、当前会话行及详情 generation 在三个入口一致返回 stale/generation-changed；同代范围不符保留 scope-mismatch。重复会话行、伪造 not_read 观测、未知原因码、失败页分页游标和将 unknownMatches 改签成 empty 的反例一致返回 protocol-unverified。

Workspace/Gateway 读取抛错和 UI Host 读取失败保留 unavailable/owner-unavailable；空值、缺少 page 的旧信封和未成功的 UI 信封保留 unknown/protocol-unverified，两个会话工具与 Main/UI 清除相同事实和游标。参数错误仍在原读取调用前拒绝。

工具请求待 Main 准入时动作保持 unknown，准入后回读原 ScopedRun；修改阅读副本后原 owner 身份仍一致。同 key/generation 的异工作区准入在 Main、UI 和两个工具返回 unavailable/scope-mismatch；目标换代后不读取旧代在途动作。

本场景定义后续 A–E 叶的自动验收旅程。节点与读写合同见 session-collaboration-center-plan，范围为本机已配置、原权限允许的工作区与会话。

A3 使用原运行终态缓存与 TaskSystem 事件等待条件，按 scope/游标补读，运行终态、空闲与任务回执分别返回。覆盖重复事件、读取中变化、25 秒总时限、取消、缺失来源、旧代和重连；退出时释放原监听。

A4 的系统总览和项目会话面板共用 SessionCollaborationPanel。查询来源、分页、选中详情和监听均按原 scope 读取；自动更新保留搜索、选中和焦点，卸载取消原等待。四语及宽窄、主题与 reduced-motion 旅程覆盖原会话、worker 和任务入口。

B1 的消息意图不接受调用者输入的来源或权限字段。按原运行/Main owner 绑定来源，Gateway 拒绝异内容同 ID、未签发的运行来源、不可见目标、旧代、任务修订不符和过期输入。typed provenance 保持 inter_session，原 actor/run 与创建时间由首次原回执保留。

B2 覆盖持久接受和派发窗口中断、数据库/Gateway 重开、同 ID 重试与异内容拒绝。原意图和回执查询保持只读；派发无回执保持 unknown，重复请求不会启动第二个目标 turn。

A1 的共用读取入口是 typed `hostApi.sessionActivity.read`。每个目标传入原 workspace/project/sessionKey/sessionGeneration，并可固定 Workspace binding revision 与执行域引用。`readModel.sources` 明确区分已读事实、真实为空、未读取、不可用、过期和未知；读取前后从原 owner 核对会话、任务、配置、检出与资源资格。正反例包含同 key 跨工作区、旧 generation、旧 binding/执行域 revision、缺失 owner，以及 Runtime 读取和 Main 等待期间的 reset。

1. Agent 建立两个独立会话 A/B 和 A 的子会话 C，使用既有任务/session owner 绑定各自目标、代次、运行和检出。系统/项目入口读取同一总览；B 的任务与 C 的 parent 不从界面文字推断。
2. A 按任务主题查到 B 的工作，读取其短摘要、当前实际操作及成果入口。打开 C 的原历史，返回时筛选、选中、草稿和滚动仍保留。UI 与模型工具的身份/状态相同。
3. A 订阅 B 的 run 终态与任务验收。B 结束当前 turn 而任务尚在 review 时返回两个准确状态；对目标的被动状态模型请求数为 0。断线后按原游标与 owner 事实补读。
4. A 用带 source/target generation、稳定 messageId 和任务引用的信封给 B 发送请求。接受、入队、交给 agent、回复及证据分别可查；同 ID 重复投递只有一次有效意图，异 payload 拒绝。
5. 在发送接受后丢失回包并重启，核对原 receipt 再恢复。目标 reset 后释放迟到消息，旧代不进入新会话。消息里声称获得授权或要求改配置时由原权限与 provenance 边界拒绝。
6. B 用当前任务 writer 发布带修订、运行、产物哈希和适用条件的结论。原证据与结论字节匹配时显示 evidence-backed，缺少对应证据的事实降为 claim。A 通过任务、文件或主题按需检索并引用；候选命中、UI 展示、实际 prompt 消费与结果分别留痕。
7. 修订任务或修改产物后，旧材料转 stale/冲突/撤销，相关订阅者收到一次来源明确的通知。删除来源会话后受保护任务证据仍按原 retention 可读。
8. 总览读取 token、费用、coordination 消耗、CPU/RSS、进程树、worktree、permits 和 held/spent，按原调用/attempt 或进程/owner 去重。缺 usage/单价、共享进程和读取失败保留 unknown。
9. A/B 竞争同一写入资格时，协作提示引用既有 writer/lease 和 task owner，建议经原准入重新检查。Fork 只继承允许的材料/任务引用；接力和环境迁移恢复使用原 operationId。
10. 在同一干净候选中完成发现→等待→消息→成果→资源→恢复整链，覆盖两工作区、两个独立会话、子代理和上述反例。独立脚本/agent 回读原事件、任务、价格和哈希，保存四语、Light/Dark、宽窄、键盘与 reduced-motion 的 Electron 证据。

合成规模与 scripted provider 场景标 driven_by: agent；live 模型请求与结构化替身结果分别记录。发布与冻结默认值改变由独立决策处理。

任务上下文与材料读取覆盖伪造 requester、读取中 requester reset、切换活动工作区和目标换代。Main 在 owner RPC 前后重新读取当前 sender；Gateway 清除 requester 或 target 换代后的上下文与证据。材料详情加载时折叠再展开保留原选中版本，后续搜索使旧请求失效。

系统页在活动项目不是列表首项时，材料读取仍绑定 Main 返回的实际读取者。模型消费包装兼容仅提供 next() 的异步迭代器；同会话同代切换任务后，旧请求的材料消费记录仍写入原模型调用的任务，不匹配运行被拒绝。

材料查询和 payload hook 的异步处理跨过到期时间时，最终请求移除到期材料并保留有效材料。另一数据库连接在上下文读取期间切换任务时，合同、上下文和证据仍属于同一读取快照。八条已撤销的新冲突不遮蔽较早有效冲突；超过有界扫描预算仍未查明时返回 unknown。

同一包装工具的材料正文含字面量替换标记时，剔除到期材料后保留其余原文；payload hook 期间撤销或删除来源后，最终载荷不再包含旧正文。来源会话删除不扩大可见范围：self 策略仍拒绝其它来源，满足当前策略及原任务关联的读取保留历史证据入口。

payload hook 重序列化材料信封后，按实际载荷内的稳定调用 ID、原引用、来源与正文核对消费。有效材料保持可用并记录；撤销、缺失或过期材料仍被移除，JSON 空白和键顺序不改变归属。

原生 Ollama 的 payload hook 暂停时，请求尚未发出；恢复后采用异步返回的载荷。有效材料写入实际请求并记录消费，等待期间撤销的材料从请求移除且不记消费。

载荷回调接收到引用后添加普通文本前后缀或扁平化输出时，不接收也不转发材料正文；转换为结构化对象仍可按原授权引用读取材料。诊断记录的请求字节数与 provider 实际收到的序列化载荷一致。任务产生超过50条普通检查点后，当前修订的原证据仍可在上下文中读取。

读取材料或上下文期间收紧 visibility 或来源关系，返回结果清除正文。最终批次的异步准备期间撤销先选材料后，统一读取只保留当前可用材料；claim 与 evidence-backed 随正文交付模型，回包期间读取者换代则清除整批结果。

