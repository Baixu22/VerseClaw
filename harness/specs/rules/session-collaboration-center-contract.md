---
id: session-collaboration-center-contract
title: 会话协作的身份、来源、读取和资源归因合同
type: rule
appliesTo:
  - session-collaboration-center
  - session-collaboration-center-plan
  - session-collaboration-identity-read-model
  - session-collaboration-a2
---
# 会话协作中心合同

本合同用于会话协作中心及后续窄实施规格。实现按对应 Task Forest 叶推进；当前事实由已有 owner 返回。

## 身份与 owner

- 新边界复用 shared/types/identity-scope.ts、ScopedRunId 与原 task/session/checkout 引用。逻辑 key、物理 generation、run、claim epoch、绑定 revision 和检出实例分别携带，不从字符串或目录猜测。
- SessionActivity 是共用跨 owner 读模型。TaskSystem 持有任务目标、依赖、领取和完成；会话、消息、进程、资源及经验状态各由已有 owner 写入。材料投影与索引不成为第二状态源。
- 每次查询和控制绑定显式 scope。部分来源 unavailable/stale/unknown 逐来源返回；相同 key 在不同工作区不能共用观测或草稿。
- 工具动作的 ScopedRun 保留原 Main 准入身份；待准入请求保持 unknown，同 key/generation 的工作区或项目不符返回 unavailable/scope-mismatch。只读副本不改写原在途请求或准入结果。
- Task 链接只关联工作，不产生会话血缘；真实来源消费 SessionDerivation 与 session store。读取不隐式创建任务、claim、会话或数据库。

## 通信与控制

- 共用发现和详情读取绑定原 requester/target scope；模型参数不成为读取者身份。沿同一 Query 合同消费原 owner，先做 visibility/A2A/sandbox 筛选，再读取任务和动作。字段未选保留 not_read；cursor 绑定 metadata 身份，来源变化或 reset 拒绝旧页。只读状态请求跳过模型配置与转录统计，mutation/admission 分类同样保持只读。
- 共用回复校验保留 generation-changed 与同代 scope-mismatch 的区别，当前会话行与 requester 身份一致。每页会话 key 唯一；not_read 没有观测时间并使用 source-not-read，来源原因码消费原 SessionActivity 合同。未知匹配不能写成 empty，失败或过期页不保留分页游标和计数。
- 发现/详情的 owner 读取失败返回 unavailable/owner-unavailable，已完成读取但缺失合法 Query 页返回 unknown/protocol-unverified；Main、UI 与既有工具使用相同结果。输入和调用者身份的拒绝发生在读取前，不被此错误投影吞掉。

- Renderer 使用 typed host-api / host:invoke；Main 持有 Gateway WebSocket。新增协作模块不直连 Gateway，也不恢复本地 HTTP fallback。
- 优先扩展现有 sessions_list、session_status 的只读模式、sessions_history 和 sessions_send；新增有条件等待仅拥有订阅及结果引用。
- 消息用途、消息投递状态与执行动作分开。消息来源由当前运行上下文绑定；外来消息保持 inter_session/工具级信任，不能代替用户授权或扩大接收者能力。
- 当前 sessions.steer 为中断后发送，同一运行追加输入消费已有 guide/输入路径。stop、truncate、compact、fork、接力和环境迁移分别使用原 owner 合同。
- 源/目标 generation 和稳定 ID 在实际副作用边界重新核对。相同 ID 异内容拒绝；未知发送先查原回执；旧代不能影响新代。
- 持久接受、排队、交给 agent、回复与任务验收分别确认。消息不能自己完成任务、迁移 writer 或绕过发送者/接收者的拒绝规则。
- 被动观测模型调用为 0。额外摘要和自动通知受既有 budget/A2A/队列 owner 控制，记录 coordination 消耗，合并重复变化并能够停止。

## 成果、资源和恢复

- 共享材料包含原 task/revision、source session/run、证据引用、内容/产物哈希、敏感性、时间与有效条件。fact/claim/accepted decision 分开，原文和完整历史按需读取。
- 旧 WorkingContext 只经过确认的任务关联桥接；优先消费当前 TaskSystem 的合同/checkpoint/evidence。source 变化、撤销、过期、冲突与缺失可回读。
- 检索候选、展示、引用和实际消费分开计量；经验接受与记忆写回继续由原 owner 负责。
- session/task-subtree/model-call/host/project 的统计范围分开。调用/attempt、进程/owner 去重；held 与 spent、已知小计与未知值分别呈现。缺 usage/价格或未测量的共享进程不填 0。
- source session 删除和执行根回收遵循现有 retention，保留任务所需原证据。回退只撤回本叶挂接或触发，未知外部效果不盲重放。

## 界面与验收

- 系统/项目/工作区消费一个协作模块，复用原 worker 阅读页和会话入口。默认摘要、选中详情、原始来源逐层展开。
- 新文案覆盖 en/zh/ja/ru，复用 design token；状态用文字/图标，键盘焦点可见，异步更新保留选择、筛选、草稿和滚动。状态通知有明确上下文并控制数量。
- 每个 UI 叶含对应 Electron E2E；通信叶运行 contract、comms replay/compare 和窄 Harness。完成依据是原 owner 事实与磁盘回执。
- 所有自动场景 driven_by: agent，记录真实 actor、模型路由、输入/源码/候选/产物哈希及第一轮失败。独立模型审查和子代理按用户指定使用 ccs-workbuddy/deepseek-v4.1-flash。
- 需要索引时先通过 D5 的消费者/规模/延迟复核，另立可重建 derived-index 写集；本合同不改变 TF-0647 历史、产品锁、冻结默认或多机 SessionStore 边界。

