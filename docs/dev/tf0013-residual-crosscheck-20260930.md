# TF-0013 四项 residual 与 RC-02/03 对照

2026-09-30；actor: codex/root；driven_by: agent。
本轮是归档证据核读与当前源码检查，HEAD `6104cd9a147737e8d6ec037f1a81fafc814598d2`，不是新一轮 RC 或 TF-0013 正式验收。

## 证据身份

- RC-02：`artifacts/runtime-authority-convergence/rc-02/acceptance/{manifest,finalReport}.json`；候选 `78dc12d1c1e989f33cf7ca85955998ed40887352`；runId `7de63c1a-7a54-4921-af59-e7696c1b4c5f`。归档 Verifier pass，9500 passed / 0 failed / 50 skipped。
- RC-03：`artifacts/runtime-authority-convergence/rc-03/acceptance/{manifest,finalReport}.json`；候选 `01398fb6fa0386d05ec17bac78cae56d2c43252b`；runId `474dc741-e6dc-476d-a365-7b26fa65d95a`。归档 Verifier pass，9532 passed / 0 failed / 50 skipped。
- 两组 manifest/report 的 runId 与 manifestDigest 引用相等，报告均为 verifier，Executor/Verifier 身份不同，consistency.errors 为空、identicalGateContracts=true。RC-03 的 SHA256SUMS 五文件重算全部匹配。测试数来自磁盘归档，本轮未重跑，也未重建完整日志证据链。

## 四项对照

| TF-0013 原 residual | RC 已覆盖的边界 | 剩余限制 |
|---|---|---|
| 完整 provider payload | RC-02 八入口 census、网络实际字节 digest 与双收据关联；RC-03 增加 seal | 已测入口的观测覆盖不是全字段 producer/transform 图，也不是所有输入已经受预算仲裁。RC-02 未测 bundled plugin discovery/channel plugin 层，CLI compact 未单独驱动；RC-03 补的是 summarizer 路径 |
| ContextEngine messages replacement | RC-03 注册 producer，seal hook 记录 replacement attempt 并封存 model-call bundle | 记录替换与 digest 不自动证明替换内容经过增强候选的排序、去重和预算；收口需区分 history 与新增注入语义 |
| COMPASS SSP | RC-03 记录 SSP/retrieval contribution，按内容匹配归因并绑定 system prompt digest | `get-reply-run.ts:634-662` 仍在 context-engine 外构造并直接拼入 extraSystemPromptParts；`rc03-seal-hook.ts:146-183` 只登记/归因，不收费。总预算缺口仍存在 |
| 最终 wire boundary | RC-02 实际请求字节 hash；RC-03 v1 双收据覆盖 tool loop、retry、fallback、summarizer、fork、handoff；seal 后语义变化可报告 census failure | 是 RC 已验收范围内的边界证据，不代表 COMPASS 预算收口或全部未测插件路径已证明 |

引用：`docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md` RC-02/03；`openclaw_runtime/src/context-engine/rc03-producers.ts`、`rc03-seal-hook.ts`；`openclaw_runtime/src/auto-reply/reply/get-reply-run.ts`；RC-02 entry acceptance tests 与 `openclaw_runtime/src/agents/rc03-entry-transitions.acceptance.test.ts`。

## 下一最小工程项

在 TF-0013 内将 COMPASS SSP / retrieval 新增注入接入现有 ContextCandidate 仲裁与 turn ledger。先用超额注入反例复现不收费，再覆盖排序去重、多个来源同时启用、flag-off/kill-switch 零查询零注入及 seal/wire 一致性。必须证明最终投影文本与收费值一致，不能只在 contribution 归因函数增加计数。

本次仅刷新 next_action 与证据说明，不改变 TF-0013 blocked/60 的历史状态，不声称四项 residual 已全部解决；后续实施可按证据更新状态，不能继续以等待 RC-02/03 或真人输入作为原因。TF-0010/TF-0028 D7 冻结解除留在决策边界。NEXT-GOAL.md 的旧真人阻塞入口已替换，自动化证据必须如实标记 agent 驱动。未改变产品功能或接口，README 三语版无需更新。
