---
id: autonomy-context-system-contract
title: 自治上下文保留来源、任务状态与实际请求身份
type: ai-coding-rule
severity: error
appliesTo:
  - autonomy-context-system-plan
  - autonomy-context-baseline
  - autonomy-context-system
---

上下文整理消费 TaskSystem、Memory/Knowledge、ContextItem、CRK、归档、资源与权限的现有 owner。Context Orchestrator 保持最终候选选择入口，provider transport 保持实际传输证据边界。

- 任务目标、用户有效约束、验收、完成、writer epoch、权限与未知工具效果不能由上下文编辑改变。每次模型调用继续读取当前 TaskSystem 合同；关键内容超预算保留既有明确拒绝。
- 复用 SemanticAtom 与原 owner 状态。confirmed、verified、agent_approved、stale、superseded、unknown 和生命周期状态分别解释；压缩和接力不得把假设、否定、临时要求或未结算效果改成另一语义。
- 受控编辑绑定 operationId、base revision/digest、source pins 与执行侧提供的完整 scope。旧版本、跨 scope、同 ID 异 payload、撤销来源、未解析 selector、半写入和 tool-call 配对破坏在发布前拒绝。
- offload 先归档并重新校验，再改变活跃投影。原 transcript、源文件和历史回执由原 owner 保留；摘要不能成为源事实的唯一副本。
- 结果分别记录 accepted、appliedRevision、effectiveFromModelCall 和 wireObserved。没有实际传输证据的 backend 只能报告对应投影状态。
- 多个 message_replacement 候选必须有确定的互斥和优先级，不能最后写入静默覆盖；任务合同后置恢复仍须进入最终请求核算。
- 模型编辑只进入自己的 notes 和获准的 observation/derived 投影；外部内容保持原信任等级，不能变成 system 指令、持久接受事实或新授权。
- 经验消费保留 condition/action、来源版本、适用 scope、有效期和抑制条件。exposure、citation、adoption、operational outcome 与独立任务 grade 分开；检索或自述不证明收益。
- fork、handoff、负责人换代、restart 与任务 revision 改变时重新读取 owner；继承引用不继承 writer、权限或资源 lease。
- native context/compaction 由 effective backend capability 决定，缺失能力不回退为双重压缩或虚假应用。
- 整理、搜索、摘要、回读和失败重试消耗原任务预算；未知成本不能记零。缓存优化不得延迟约束修订、权限撤销或硬容量拒绝。
- 首次采用走显式试点，flag-off 保持原 prompt、tool、执行、存储、审批和重试行为。关闭策略保留 owner 数据，恢复旧投影流程。已退役 Runtime Memory flags 与旧 self-edit 工具不因本计划恢复。
- 研发 Task Forest 只管理实施进度；产品运行不读取其节点、编号或文件。每叶用实际新候选证据收口；历史已完成节点保持原范围与结论。

验证由版本冲突/跨 scope/撤销/错 toolCallId/未知效果等负例、源到最终请求的身份核对、状态保真继续执行用例、native 降级用例、真实成本配对与关闭回退共同组成。结构回放和脚本模型标记 agent 驱动；长期模型收益另用冻结候选及匹配资源授权验证。
