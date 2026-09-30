# TF-0009 / TF-0007 节点决策与落地

日期：2026-09-30；执行者：`codex/root`；`driven_by: agent`。

采用 **修订 R7 守卫**。依据 AGENTS.md 2026-09-27 所有者长期政策及本轮“做好节点决策之后开始落地开发”授权。2026-09-10/20 的 blocked/50 和具名真人前置不再有效；历史报告中的真人 `0/10` 继续保留，作为未观测人群的事实局限，不作为永久阻塞 residual。

本轮只推进 TF-0009；TF-0007 是其父节点的证据联动收口。四项验收保留实质要求：三 profile 各 10 条具名 agent 记录；安全观察与 kill/rollback；归因、零真人计数与冻结边界；根据账本记录 agent `continue/shrink/stop` 裁决。状态由证据决定，不通过就修复自动化路径，不硬编码 done。

当前 campaign 使用 v2：记录 policy、driver、candidate commit/tree/dirty。v1 报告归档于 `artifacts/first-product-preview/TF-0009/historical-20260729/`，仅供历史验证，不能授权当前收口。July `evidence-audit.json` 与 UAS-00 frozen manifest 不重签。共享校验器同时服务 preflight、工程验收 adapter 和 UAS-00；当前节点收口还要求 clean candidate 与磁盘证据核验。

首轮复跑发现旧 SEKB 驱动缺少当前 distillation 所需的 tool step 和完整 runtime lineage，导致 `SEKB suggestion 1 missing`。修复驱动，记录实际执行的临时文件读取及 agent lineage；生产 eligibility 守卫不变。SEKB 仍只验证 capture/suggest/reject/retrieve，确认写入为零。Browser 仍是真实状态机/执行器配合隔离页面替身，无公网或真人批准声称。

验证采用 `scoped-development-validation`：campaign、相关 root tests、adapter 回归、lint、类型检查、Harness diff-aware validate/dry-run、Task Forest validate/export。没有 UI 或通信传输行为改动，不重跑整个 RC-09/Electron/付费模型矩阵；本次不是新候选的正式 RC/GA 认证。README 三语言已检查，本次不改变安装、用户流程或公开接口，无需翻译更新。

后续节点决策：

- TF-0010 / TF-0028：已有 RC-09/10 收口是下一轮复核输入，不能直接批量改绿；仍需按各自完整验收条目核验。
- TF-0129 / TF-0130 / TF-0141 / TF-0144：先按 TF-0138 字段清单重新估价与收窄范围，保留依赖顺序。
- TF-0151：涉及冻结默认值，本轮不授权翻转。
- TF-0047：保留明确的 Docker 延后产品决策，不启动重型沙箱。
- TF-0013：下一实施候选；先将 RC-02/03 当前证据映射到 assembly authority、预算、组合覆盖与 flag-off 四项 residual，再决定最小代码缺口。

外部设计输入：`D:/ClawX-acceptance/rc09-20260929/NEXT-CYCLE-ACCEPTANCE-DESIGN.md`。门输入摘要与同候选续跑需维持 fail-closed：不明原因非零退出不得直接当环境失败；Verifier 只能复用自己的、同候选同输入的已验证结果，不能继承 Executor 结果来声称独立复验；release 仍须双方完整冷跑。此为后续设计约束，本轮不实施继承/重试机制。

发布、GA、TF-0006、`liveReady` / `productApproved` / `defaultOn`、C1 keep-off、Runtime Memory diagnostics-only 与 SEKB 自动写回边界均不变。

最终验收与节点状态见同目录交接 `handoffs/LATEST.md` 及 `artifacts/first-product-preview/TF-0009/policy-acceptance/verification.json`。

收口结果：TF-0009 / TF-0007 均 done/100，clean candidate 812cba73f；三 profile 各 10/10、候选单测 102/102、收口后守卫 28/28。封存 20 文件，凭据扫描 0；validate/export 通过。历史 TF-0008 证据复用，未冒充本轮 Electron/maturity 重跑。
