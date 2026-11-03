# 恢复契约集成分支（2026-11-04）

> `driven_by: agent` · `actor: recovery-contract-integrator` · `realHumanEvidence: false`

## 这是什么

三个独立工作树完成的契约层节点，在 `codex/recovery-integration-20261103` 上集成：

| 节点 | 内容 | 来源 commit |
|---|---|---|
| TF-0709 | 恢复评测契约：5 窗口 / 3 重复 / 30 对 / 9 指标 / 纯评分器 | `e8df80ea7` |
| TF-0713 | 五入口恢复映射 + RecoveryAuthority 类型化契约 | `9bed567d8` |
| TF-0717 | 执行 phase 8 状态机 + K1–K5 kill 窗口映射 | `4b1f61580` →

集成后 commit：`e48cd32f7` → `a50978ea5` → `a850c068a`（`83fe09645` 为冲突重放前身，已废弃）。

## 已经验证的（可复算）

- `vitest run` 三套契约测试：**3 files / 35 tests passed**。
- `node harness/src/cli.mjs validate --spec ...`：三个 spec 在各自分支均 **Spec is valid (exit 0)**。
  - 集成分支上跨 spec 的 diff 覆盖检查会报 `touchedAreas` 不足，这是组合态假阳性，不是 spec 缺陷；每个 spec 的 touchedAreas 只覆盖自身变更集。
- 真实恢复路径回归：`main-session-restart-recovery` **4/4 passed**，`.flow` **4/4 passed**。
- 评分器行为：
  - 空样本 → `EVIDENCE_INSUFFICIENT`，9 指标全 `null`，`qualityClaimAllowed=false`。
  - 完整样本 → `PASS`，`mustPreserveFidelity=1`、`duplicateEffects=0`、`P95=1168ms`。

## 明确没有做的

1. **没有真实故障注入。** K1–K5 只是契约与状态机映射，没有真杀进程/重启回读。
2. **没有生产接线。** 五入口仍各跑各的恢复逻辑；没有 RecoveryAuthority 实现。
3. **没有翻转任何默认值。** `taskflow` writer、`OPENCLAW_EXECUTION_PHASE_WRITER`、`runtime.eventLog.*` 全部保持 legacy/off。
4. **没有收益数字。** 本分支只冻结口径；量化收益必须由 TF-0710/0711/0721/0722 在真实进程上采集。
5. **构建未全绿。** `build:vite` 在 `packages/versebrowser` 环节因依赖解析失败（环境态，非本分支代码）；`typecheck` 的 web 子项 exit 0，node/test 子项受依赖环境阻塞。

## 下一步

按 TF 依赖顺序：TF-0710（真实故障注入驱动器）→ TF-0711（legacy baseline）→ TF-0714（RecoveryAuthority 只读 shadow）→ TF-0718（intent/EffectReceipt 桥接）→ TF-0721/0722（真实测量）。
