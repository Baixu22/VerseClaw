# TF-0782 历史候选聚合样例

本目录保留前轮 TF-0782 聚合结构、Windows `win-unpacked` 输入、两个角色的全量门报告样例和独立 verifier 结果。它绑定历史候选 `713e224`，用于验证聚合协议和负例拒绝；当前候选必须按同一结构重新生成证据。

## 可复用边界

- 聚合覆盖 TF-0764–TF-0781，并保留功能、质量、性能、运营、分发和发布结论字段。
- 分发只声明 Windows `win-unpacked`；installer 保持 `not-run`。
- 产品默认值、M0–M4 权限、land/admit、GA、`liveReady`、`productApproved` 和发布授权保持不变。
- 所有产物标注 `driven_by=agent`、`actor=...`、`realHumanEvidence=false`。

## 当前候选重采状态

- 候选：`0a9f8b23b4fb4c5ba7cb080302136c039641fe45`，tree `4a69f3af216c07f635494c7a2df6f03ceb73409b`。
- `D:\tmp\tf0782-p6-005-0a9f8b23` 已完成 preflight、maturity baseline/plan/gates、contract、lint、typecheck、harness:ci、Agent Dev deep-test、Agent Dev E2E 和 release:validate。
- `maturity:validate` 因 56 条历史 hash mismatch 失败。
- `maturity:security:full` 因 root security unit 失败。
- root test 为 10178 passed、2 failed、55 skipped；剩余失败是 clean-checkout active verification 输入与 WP2 历史 MC0 binary。
- clean executor 需要先补齐干净的构建/输入准备，再在最终候选上执行完整门集与不同 actor 的 verifier。