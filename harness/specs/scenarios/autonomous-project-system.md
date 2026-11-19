---
id: autonomous-project-system
title: 从系统目标到项目任务、执行会话与证据交付
type: scenario
requiredRules:
  - identity-scope-boundary
  - contract-first-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - session-derivation-ui-contract
  - task-forest-autoclose-and-roles
  - context-family-boundary
  - disk-temp-policy
---

本场景是待实施合同；不表示下面路径已经可用。细分与门禁见autonomous-project-system-plan。

1. Agent模拟用户点击项目名称进入Project Agent；折叠按钮只展开列表。负责人、任务、会话、资源均绑定显式project/workspace scope。
2. 用户给出目标，负责人读取既有事实，在任务owner建立可验收任务和依赖；讨论会话可有空清单，执行前自动绑定任务，无需真人填表。
3. 负责人在有效模型、工具权限、资源和预算内派发；worker使用独立执行环境，accepted与运行、报告、验证、任务接受分开呈现。
4. 使用VB/VS/工作树执行，注入一次可恢复故障；由既有owner返回效果、资源和清理回执，不以timeout盲重发外部副作用。
5. 验证者回读固定候选与产物，有限修复后由任务owner完成验收；换代、重启或晚到消息不会重复执行或覆盖新的任务状态。
6. 总控汇总至少两个项目，处理资源争用和全局暂停；可逆配置经preview/apply/reload/readback/rollback，重大决策呈现具体选项。
7. 已完成任务提炼记忆candidate，经既有接受/评估路径使用并可撤销；跨项目摘要不泄漏私有原文，资源回收不删除唯一证据。
8. Agent在同一候选上执行UI、故障、真实provider和源码/冻结包验证，保留各自边界、命令、退出码、计数、hash与actor；所有自动产物标agent，不声称real-human或产品发布批准。

项目完成通知的代次验收见 `harness/specs/tasks/project-coordinator-continuation.md`：agent 驱动 worker 写入，等待负责人自动续行，重启后检查重放次数，重置负责人后拒绝旧代结果。

负责人交接等待在途工具操作结清，再转移同一任务与 checkpoint；新负责人使用新的 writer epoch 读写任务。旧会话保留历史，迟到的完成通知不会触发旧负责人。

在模型请求仍在途时重启 Gateway，核对原进程确已退出、会话代次和 writer epoch 未变、未决效果为零，随后从同一任务的 checkpoint 续行。回读 Task Ledger，确认只有一次运行替换和一条恢复 checkpoint。

注入缺少回执的效果时，重启后保留原检查点，回执核对完成前不续行。暂停派发保留现有运行，停止运行保留任务，取消任务阻止新效果并等待原效果结清；恢复派发后，已取消的子任务不会被重新领取。

取消真实在途执行者后，释放延迟的模型回包并重启 Gateway，确认取消后的结果不唤醒负责人、不写文件。终态失败且无未结效果时，负责人根据失败通知继续独立的就绪任务，依赖失败任务的子项继续等待。
