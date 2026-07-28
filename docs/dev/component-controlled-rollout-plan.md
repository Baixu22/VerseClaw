# 组件受控投用补齐计划

> 状态：P0 complete；P1 ready（尚未实际投放）
> 目标：尽快达到 **controlled internal use**，不是 default-on 或联合系统 GA。
> 权威任务图：`.agent-workbench/task-forest/`；正式节点变更需先确认 task-forest proposal。

## 1. 成功标准

最短路径完成时，应同时满足：

1. 所有本轮关键实现、测试、文档和证据均进入精准 staged inventory，并由 shadow checkout 复现；
2. DCS W5 使用真实/授权 host sender 路径，关键 Electron E2E `6/6` 已通过；
3. `maturity:validate` 已通过且无未解释证据漂移；
4. 默认值继续 fail-closed/opt-in，kill switch、人工确认、Browser 私网限制有效；
5. P1 至少一轮小范围内部 canary 有运行记录、故障关闭记录和负责人结论；
6. 未满足 TF-0006 前，不进入 default-on 讨论。

## 2. 执行顺序

严格一次只推进一个 ready 节点。

### P0：交付基线与真实集成证据恢复（已完成）

建议时间盒：1～2 个工作日。

#### P0.1 封装可审查变更集

- 建立本轮组件文件 inventory，区分实现、测试、文档、生成证据和临时文件；
- 将 Context Orchestrator、kill switch、SEKB/Browser E2E、P0 gate、`docs/dev` 与必要 artifacts 纳入同一变更集；
- 排除 `.tmp-compass-skills/`、压缩包、临时脚本等本地安装残留；
- 检查所有 generated evidence 是否应跟踪，并保持源码与证据在同一提交/PR 范围；
- 通过 `git diff --check`，确保没有误覆盖用户其他改动。

验收：关键锚点不再显示 `UNTRACKED`，clean checkout 能运行下面全部门禁。

#### P0.2 恢复 DCS W5 真实接线 E2E

- 不放宽 `senderAuth`，不在生产安全层为测试开后门；
- 优先让 W5 通过 renderer/preload 的公开 host-api 路径发起调用；
- 如确需 Main 内部测试 helper，必须传入与真实 BrowserWindow 一致的授权 sender id 与 URL；
- 增加一条负向断言：空 sender / 非授权 sender 必须继续 fail-closed；
- 将 Gateway readiness 的错误输出补充为最后一次 host validation 错误，避免 180 秒后只看到 `startAttempts: 0`。

验收：

- W5 三条全部通过；
- Browser、SEKB、DCS Settings 不回归；
- sender 安全单测继续通过；
- 无 production bypass 或 test-only allowlist 泄漏到运行时。

#### P0.3 刷新成熟度证据

- 先确认 14 个 hash drift 均来自本轮有意改动；
- 按既有 P0/P1/P7/P8 evidence collector 刷新，不手改 frozen hash；
- 重新运行 `maturity:validate`、capability inventory 和必要的 traceability/residual gates；
- 把本轮审计 JSON 与关键命令输出纳入证据索引。

验收：`pnpm run maturity:validate` exit 0；不存在新增的宽泛 drift allowlist。

#### P0.4 统一验收

必须通过：

```powershell
pnpm run p0:accept
pnpm test:dcs
pnpm lint:dcs
pnpm contract:check
pnpm run eval:runtime-memory:enhanced
pnpm run test:e2e -- tests/e2e/dcs-prod-p0-settings.spec.ts tests/e2e/dcs-production-wiring-w5.spec.ts tests/e2e/sekb-golden-path.spec.ts tests/e2e/browser-security-recovery.spec.ts --workers=1
pnpm run maturity:validate
pnpm harness validate --spec harness/specs/tasks/component-controlled-rollout-readiness.md
git diff --check
```

### P1：小范围受控内测运行包（ready，未执行）

建议时间盒：2～3 个工作日。

只在 P0 全绿后开始。

#### P1.1 固化三类 canary profile

| Profile | 开启范围 | 保持关闭 |
|---|---|---|
| DCS coding canary | on-demand context tools、指定 workspace working-memory、可选 VToken | Runtime Memory default inject、自动 ladder、默认 worktree/patch flow |
| SEKB assisted canary | capture/suggest/confirm/retrieve | 自动写回、无人审批经验提升 |
| Browser supervised canary | 公网 allowlist、用户审批、任务持久化恢复 | 私网默认开放、无人监督模式 |

每个 profile 必须有：负责人、cohort、预算、启用命令、kill switch、数据目录、隐私约束、故障关闭步骤。

#### P1.2 运行最小真实场景

每个 profile 至少执行 10 次有记录的内部任务，覆盖：

- 成功路径；
- flag off parity；
- kill/rollback；
- 重启恢复；
- 权限或审批拒绝；
- 无相关上下文时的零副作用。

记录最少包括：request/session/workspace lineage、启用 flags、耗时、token 增量、命中来源、错误类型、是否回滚。

#### P1.3 内测退出标准

- 安全或隐私泄漏：0；
- 未授权写入：0；
- SEKB 无确认写入：0；
- Browser 私网绕过：0；
- kill switch 演练成功率：100%；
- 关键场景成功率达到内部约定阈值，且失败均可解释；
- 负责人签字决定：继续灰度、缩小范围或停止。

### P2：真实效果与毕业证据

由 TF-0006 承接，不阻塞受控内测，但阻塞 default-on/GA。

需要：

- 非 synthetic 的目标规模 corpus manifest；
- human live A/B；
- soak report；
- product approval；
- Runtime Memory 效用、延迟、冲突消解在真实数据上的复核；
- 分组件毕业，不做联合系统一次性翻转。

## 3. 风险与停止条件

出现以下任一情况立即停止扩大灰度：

- host sender、workspace authority 或审批边界被绕过；
- kill switch 无法在一个操作周期内关闭增强；
- SEKB 出现未确认持久化；
- Browser 访问私网或凭据状态不可解释；
- Runtime Memory 注入危险字符串、原始记录或显著错误事实；
- maturity evidence 再次漂移且无法映射到有意改动。

## 4. 非目标

- 不在本计划内做组件能力扩张；
- 不重构完整 CVK/assembler 双路径，除非它阻塞 P0 验收；
- 不开启多 agent 高并发 workspace 自动修改；
- 不以 Agent Dev 或 synthetic E2E 绿灯替代真实产品证据。
