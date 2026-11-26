---
id: autonomy-context-system
title: 自治任务经过整理、协作和恢复后保持正确判断
type: scenario
appliesTo:
  - autonomy-context-system-plan
  - autonomy-context-baseline
  - gateway-backend-communication
---

场景共同使用当前 TaskSystem 合同、既有权限与资源准入、Context Orchestrator 和最终请求记录。自动执行和判断标记 driven_by: agent，期望状态由独立 oracle 与 owner 证据决定。

| 场景 | 操作与故障 | 必须观察的结果 |
|---|---|---|
| 需求修订 | 长任务中用户撤回旧要求并增加新约束，随后 condense/恢复 | 下一次请求使用新 revision；旧要求标 superseded；完成条件来自当前合同 |
| 否定结论 | 已用证据排除方案 A，压缩后继续调查 | 保留排除状态与适用条件；没有新证据时不重复原调查；新反证可通过原 owner 修订 |
| 精确材料 | 日志含精确 ID/数字与长噪声，offload 后再次需要 | 原文归档可读、selector/checksum 相符；回读内容进入相应实际请求 |
| 效果未知 | 写工具超时后整理上下文、restart | pending/unknown 保留；先由效果 owner 对账，禁止把超时当成无效果并自动重放 |
| 临时要求 | 一次性的格式偏好经过多次接力 | 范围不扩张为长期全局要求；不把偏好升级成硬约束 |
| 不适用经验 | 检索到正确但属于其他阶段/版本的原则 | 保留未选原因；相关症状出现才可能注入；撤销后不继续使用旧版本 |
| 并发编辑 | 两个请求基于同一 working-view revision，另有 owner 修订 | 至多一个提交；其余冲突，无半发布或证据覆盖 |
| 委派与回交 | worker 返回摘要、证据和未验证结论，父会话整理 | 不复制完整 child 历史；保留来源及未决项；不会因 worker 自述改变 Task 完成 |
| 跨任务材料 | 同工作区存在同名任务和较旧共享结论 | 通过明确 task/owner/revision 查询；只读共享不授予写入资格 |
| 负责人换代 | handoff/fork 后旧模型调用迟到 | 旧 generation/epoch 被拒绝；新负责人从当前合同与 checkpoint 重建 |
| 回读失败 | handle 丢失、过期、checksum 错误或权限撤销 | 显式缺口；不注入陈旧内容；有限回读后由既有控制信号报告 |
| 原生 backend | backend 接管 compaction 或不暴露 wire | 单一整理 owner；应用状态准确，unsupported/unknown 不变为成功 |
| 成本抵消 | 输入缩短但摘要、回读、输出或 cache miss 增长 | 全任务账单和延迟体现代价；不凭压缩率判收益 |
| 关闭与恢复 | 中途关闭试点、崩溃、取消或源文件改变 | 旧投影流程可继续，原历史与首次失败保留；版本重新核对 |
| 总控与项目 | 总控读取多个项目，项目负责人委派本项目任务 | 上下文按职责有界；项目间隔离，调度仍由原 owner 决定 |

先完成确定性 fixture、原始环境恢复和 agent 驱动的脚本模型检查，再在相同候选/输入/剩余行动预算下进行配对真实任务。各场景同时保存最终任务结果、关键状态保留、是否重复工作、来源正确性及总成本。当前场景合同尚不表示实现已通过。
