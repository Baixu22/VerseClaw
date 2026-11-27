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
- 条件等待只拥有监听与有界游标，绑定原读取者、目标代次、ScopedRun 和条件。原运行终态、会话空闲与 TaskSystem 回执分别读取；取消、超时和卸载释放监听，重连补读与未知事件缺口不制造完成事实。

- Renderer 使用 typed host-api / host:invoke；Main 持有 Gateway WebSocket。新增协作模块不直连 Gateway，也不恢复本地 HTTP fallback。
- 优先扩展现有 sessions_list、session_status 的只读模式、sessions_history 和 sessions_send；新增有条件等待仅拥有订阅及结果引用。
- 消息用途、消息投递状态与执行动作分开。消息来源由当前运行上下文绑定；外来消息保持 inter_session/工具级信任，不能代替用户授权或扩大接收者能力。
- 新消息意图拒绝调用者提交的 source/actor/权限；原运行或 Main 活动 Workspace/Session owner 产生来源。稳定摘要覆盖源目标代次、正文和引用，首次 run/actor/时间由原回执保留，重试不改签来源。
- 当前 sessions.steer 为中断后发送，同一运行追加输入消费已有 guide/输入路径。stop、truncate、compact、fork、接力和环境迁移分别使用原 owner 合同。
- 源/目标 generation 和稳定 ID 在实际副作用边界重新核对。相同 ID 异内容拒绝；未知发送先查原回执；旧代不能影响新代。
- 持久接受、排队、交给 agent、回复与任务验收分别确认。消息不能自己完成任务、迁移 writer 或绕过发送者/接收者的拒绝规则。
- 被动观测模型调用为 0。额外摘要和自动通知受既有 budget/A2A/队列 owner 控制，记录 coordination 消耗，合并重复变化并能够停止。

## 成果、资源和恢复

- 共享材料包含原 task/revision、source session/run、证据引用、内容/产物哈希、敏感性、时间与有效条件。fact/claim/accepted decision 分开，原文和完整历史按需读取。
- 共享材料发布由当前运行和原 TaskSystem writer 绑定。按当前任务修订与领取代次核对证据回执和文件哈希，只有对应字节得到验证的结论或产物可标为 evidence-backed。通用任务事件流跳过具备会话权限范围的材料正文。
- 旧 WorkingContext 只经过确认的任务关联桥接；优先消费当前 TaskSystem 的合同/checkpoint/evidence。source 变化、撤销、过期、冲突与缺失可回读。
- 任务上下文与材料的 Main 入口在读取前后绑定当前活动会话和代次；Gateway 回读上下文后复核读取者与目标的 scope，旧读取者不接收迟到结果。
- 检索候选、展示、引用和实际消费分开计量；经验接受与记忆写回继续由原 owner 负责。
- 实际消费与响应回执绑定请求开始时持久保存的模型调用任务、运行和会话代次；读取者切换任务不改签旧请求的归属。
- Provider 在序列化并发送请求前等待异步 onPayload，并采用返回的载荷。材料复核接受合法 JSON 前导空白，记录的消费对应实际发送内容。
- 最终载荷的有界材料扫描无法完整执行时中止发送，返回 MATERIAL_PAYLOAD_SCAN_INCOMPLETE；不将跳过复核当成材料缺失。
- 载荷回调只接收材料引用，完成后再按实际请求中的授权引用注入正文；普通文本前后缀或扁平化丢失结构时不注入。诊断回调在材料处理完成后记录最终请求字节数。
- 材料与任务上下文在返回正文前复查当前可见性、A2A 和来源关系。最终材料复核使用单次有界 Gateway 批次，在异步准备完成后同步采集各原 owner；模型信封保留 claim/evidence-backed 状态。
- 合同、上下文与证据使用同一 TaskSystem 读取快照。最终模型载荷再次核对已知到期时间，剔除到期材料；有界冲突扫描未能排除有效冲突时保持 unknown。
- 异步 payload hook 结束后再读取材料的原来源与有效状态，失效内容通过结构化信封移除。来源删除后的材料读取仍执行当前 visibility、A2A 和 sandbox 策略，任务关联不能替代权限。
- session/task-subtree/model-call/host/project 的统计范围分开。调用/attempt、进程/owner 去重；held 与 spent、已知小计与未知值分别呈现。缺 usage/价格或未测量的共享进程不填 0。
- source session 删除和执行根回收遵循现有 retention，保留任务所需原证据。回退只撤回本叶挂接或触发，未知外部效果不盲重放。

## 界面与验收

- 系统/项目/工作区消费一个协作模块，复用原 worker 阅读页和会话入口。默认摘要、选中详情、原始来源逐层展开。
- 新文案覆盖 en/zh/ja/ru，复用 design token；状态用文字/图标，键盘焦点可见，异步更新保留选择、筛选、草稿和滚动。状态通知有明确上下文并控制数量。
- 每个 UI 叶含对应 Electron E2E；通信叶运行 contract、comms replay/compare 和窄 Harness。完成依据是原 owner 事实与磁盘回执。
- 所有自动场景 driven_by: agent，记录真实 actor、模型路由、输入/源码/候选/产物哈希及第一轮失败。阶段审查按用户指定使用星驰 ccs-ai/gpt-6.1-sol。
- 需要索引时先通过 D5 的消费者/规模/延迟复核，另立可重建 derived-index 写集；本合同不改变 TF-0647 历史、产品锁、冻结默认或多机 SessionStore 边界。


- 协作提示只读取原 TaskSystem 和 SessionAdmissionRegistry；同文件引用不推断写入争用，等待原因区分任务依赖、未结算效果和准入清退。精确请求绑定实际读取者及目标代次，动作跳转原任务入口并沿用原执行核验。
- 活动工作区 ID 变化必须发布原导航通知。协作提示在整个异步读取期间记录导航失效，切走后切回也丢弃旧结果；UI 同时清除旧观测和在途响应，并按新读取者重新查询。
