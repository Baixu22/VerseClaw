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

本场景定义后续 A–E 叶的自动验收旅程。节点与读写合同见 session-collaboration-center-plan，范围为本机已配置、原权限允许的工作区与会话。

A1 的共用读取入口是 typed `hostApi.sessionActivity.read`。每个目标传入原 workspace/project/sessionKey/sessionGeneration，并可固定 Workspace binding revision 与执行域引用。`readModel.sources` 明确区分已读事实、真实为空、未读取、不可用、过期和未知；读取前后从原 owner 核对会话、任务、配置、检出与资源资格。正反例包含同 key 跨工作区、旧 generation、旧 binding/执行域 revision、缺失 owner，以及 Runtime 读取和 Main 等待期间的 reset。

1. Agent 建立两个独立会话 A/B 和 A 的子会话 C，使用既有任务/session owner 绑定各自目标、代次、运行和检出。系统/项目入口读取同一总览；B 的任务与 C 的 parent 不从界面文字推断。
2. A 按任务主题查到 B 的工作，读取其短摘要、当前实际操作及成果入口。打开 C 的原历史，返回时筛选、选中、草稿和滚动仍保留。UI 与模型工具的身份/状态相同。
3. A 订阅 B 的 run 终态与任务验收。B 结束当前 turn 而任务尚在 review 时返回两个准确状态；对目标的被动状态模型请求数为 0。断线后按原游标与 owner 事实补读。
4. A 用带 source/target generation、稳定 messageId 和任务引用的信封给 B 发送请求。接受、入队、交给 agent、回复及证据分别可查；同 ID 重复投递只有一次有效意图，异 payload 拒绝。
5. 在发送接受后丢失回包并重启，核对原 receipt 再恢复。目标 reset 后释放迟到消息，旧代不进入新会话。消息里声称获得授权或要求改配置时由原权限与 provenance 边界拒绝。
6. B 发布带 task revision、source run、产物哈希和适用条件的结论。A 通过任务/文件/主题按需检索并引用；候选命中、UI 展示、实际 prompt 消费与结果分别留痕。
7. 修订任务或修改产物后，旧材料转 stale/冲突/撤销，相关订阅者收到一次来源明确的通知。删除来源会话后受保护任务证据仍按原 retention 可读。
8. 总览读取 token、费用、coordination 消耗、CPU/RSS、进程树、worktree、permits 和 held/spent，按原调用/attempt 或进程/owner 去重。缺 usage/单价、共享进程和读取失败保留 unknown。
9. A/B 竞争同一写入资格时，协作提示引用既有 writer/lease 和 task owner，建议经原准入重新检查。Fork 只继承允许的材料/任务引用；接力和环境迁移恢复使用原 operationId。
10. 在同一干净候选中完成发现→等待→消息→成果→资源→恢复整链，覆盖两工作区、两个独立会话、子代理和上述反例。独立脚本/agent 回读原事件、任务、价格和哈希，保存四语、Light/Dark、宽窄、键盘与 reduced-motion 的 Electron 证据。

合成规模与 scripted provider 场景标 driven_by: agent；live 模型请求与结构化替身结果分别记录。发布与冻结默认值改变由独立决策处理。

