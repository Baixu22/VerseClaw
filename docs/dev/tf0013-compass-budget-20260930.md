# TF-0013：COMPASS 共享预算开发增量

> 2026-10-09 保留边界：本文所述验证目录、临时脚本及逐轮日志已转为本地历史，不随干净检出提供；下文命令记录的是原运行，不是当前必需门禁。恢复见 [源码保留与本地归档](repository-artifact-retention.md)，持续回归以 `harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md` 中的源码测试为准；未重签历史结论。

2026-09-30；actor: codex/root；driven_by: agent。

COMPASS SSP / pre-reply retrieval 现在作为 knowledge 候选进入既有 ContextCandidate 排序、去重和 turn ledger。回复准备不再直接把这两段拼入 extraSystemPrompt；即时回复、排队续跑、CLI 和原生 harness 均传递或投影同一份准备结果。没有新增预算、产品开关或修改 6000/0.1 默认值。

准备阶段在读取 SSP / facts 前检查 enhancement kill switch，执行阶段重新检查 source flags。内置执行保留现有延迟投影；CLI 与原生 harness 使用同一个 standalone 投影入口，并及时释放 collection / ledger。原生插件仍只消费投影后的 extraSystemPrompt，不要求插件认识新的准备结果。

收据登记裁剪后的实际文本。当前 projection 已包含的 source/text 不再作为外部 contribution 重复累计，但 producer refs 与后续重开 collection 的归因保留。检索组只有完整投影才计入 fact-use 统计；截断组的字数仍保留在 candidate lineage，不声称其中所有事实已注入。

## 验证与复现

运行 `python artifacts/tf0013-compass-budget-20260930/verify.py`。每门命令、退出码、耗时和日志写入该目录的 `verification.json`，性质为 development-only。

本轮测试覆盖：原生 harness 正常/kill 2 项；getReplyFromConfig 到执行参数 1 项；候选、orchestrator、assembler、turn budget、seal wiring 111 项；真实 embedded entry / tool-loop / retry / fallback / compact / fork / handoff 11 项；根目录入口扫描、CLI prompt 和 memory receipt 13 项。共 138 项，具体最终结果以磁盘日志为准。真实 wire 测试拦截网络请求并核对 digest / 双收据，显式要求超额 SSP 的 requested 等于原长度、applied=6000、正文仅出现一次。

两侧类型检查、oxlint、comms replay/compare 与 diff check 的结果保存在同目录。该轮未运行新 RC-09/10、Electron、付费 provider 或原生插件真实服务；原生 harness 证据是在真实选择/分发函数下注册测试 harness，不冒充 Copilot 等外部服务实测。

Harness 全工作树检查被既有未跟踪的 `/%SystemDrive%/` Windows 缓存目录越界拦下。范围检查通过临时 `core.excludesFile` 仅排除该目录，仍执行真实 diff 检查、未使用 `--no-diff`，结果见 `harness-results.json`。没有移动或删除缓存，也没有把缓存加入 task ownedPaths。

格式检查保留三份已有未格式化文件的原风格：`embedded-agent-runner/run.ts`、`rc03-entry-transitions.acceptance.test.ts`、`rc03-seal-hook.ts`。其 HEAD 原文经同一 formatter 检查亦失败，见 `format-baseline.log`；其余本次文件执行格式检查，所有改动执行 diff check。避免为格式化扩成数千行无关差异。

## 复审修复记录

前三轮有效复审分别发现并修复：准备结果漏放入 run payload、seal 重复累计候选字数、原生 harness 绕过 embedded 投影。对应新增了回复准备、wire 预算数值和原生分发回归。原始 findings 保存在 `autoreview-r1/r2/r3.json`；最终复审见 `autoreview.json`。最初一次复审因 Windows junction 路径校验失败未构成有效 verdict，之后从实际 `D:/ClawX` 路径运行同一工具。

## 节点边界与下一步

本增量不等于 TF-0013 整节点完成，也不是对旧 RC 候选重新签字。工作树开发证据与历史 clean-candidate RC-02/03 证据分开；TF-0013 转为 in_progress，保留原 60% 估计，不用局部测试数虚增总完成度。

下一最小项是沿 ContextEngine `assemble().messages` replacement 追踪历史消息与新增注入的边界，核验新增内容是否进入唯一候选仲裁 / 总预算，并补可执行反例；不把 RC-03 的 replacement 归因直接当作预算闭合。随后才能对 TF-0013 四项 acceptance 做当前候选整体验证。未测插件路径仍如原 residual 对照记录。TF-0010/TF-0028 冻结解除、产品锁及发布保持原决策边界。README 英/中/日说明已同步。
