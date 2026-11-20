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

项目收口旅程见 project-coordinator-closeout.md：agent 写入不能通过检查的产物，负责人提交后派发只读评审；消费原契约的一次修复预算，修复并检查整合后的文件，再提交新候选、取得新评审并验收。回读账本与效果回执，确认旧评审拒绝新候选、修复超限被拒绝、完成只记录一次。

系统总览的只读验收见 system-agent-portfolio.md：两个项目在相同Task authority或独立目录下读取各自计划与验证引用；一个目录暂不可用时保留旧观测并继续刷新另一个项目。核对四语、明暗、宽窄窗口和键盘返回的筛选保留，项目读取前后Workspace状态相同且模型调用为零。

TF0686连续性验收使用既有 Working Context、Task context 与30对冻结评估入口。覆盖同workspace不同任务字段、跨workspace快照、读取期间owner变化、关键预算溢出、交接后计划决策与文件引用及产物篡改；结构投影指标与live模型质量分别记录。

TF0684总控派发旅程验证后台项目A写入、项目B模型在途时全局暂停后写入被拒，UI活动workspace保持不变。三个项目在真实ResourceFabric准入队列中的等待和失败隔离由定向测试回读；重复请求不重复派发，恢复后旧控制版本拒绝。

TF0685配置旅程包括只读预览、实际重载、两次重载失败后的degraded、页面重载后由当前owner恢复，以及四语的desired/configured/effective/runtime-generation展示。未知费用、全局扩权、自改evaluator、secret参数、共享Agent和陈旧revision均拒绝。

TF0687经验治理验证成功/失败Mission候选、审核前不可见、原session使用、跨session拒绝、撤销/替代/过期后后续读取失效。真实Gateway canary核对pending/accepted/foreign/revoked四次provider请求，并区分selector receipt和最终prompt delivery；8个留出查询复用既有预算评估，不把结构覆盖作为live模型质量。
