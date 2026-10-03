> 2026-09-30 政策修订：2026-09-27 AGENTS.md 优先于下文历史口径。TF-0009 以具名 agent 三 profile 各 10 条、安全/kill/rollback 和 continue/shrink/stop 裁决验收；证据齐全可收口。真人 0/10 仅为事实局限，不是节点前置。下文旧轮次数值及 review_needed/degraded 判定按当时快照保留。当前决策见 `docs/dev/tf0009-policy-decision-20260930.md`。

# 组件受控投用验收清单

> P0 状态：完成。P1 agent-surrogate 工程流程完成，真人投放延后；任何硬性 NO-GO 仍立即停止 canary 或扩大灰度。

## A. P0 变更集完整性

- [x] Context Orchestrator、kill switch、SEKB/Browser 黄金路径、P0 gate 已进入 staged inventory
- [x] 必要 docs 与 artifacts 与源码处于同一 change set
- [x] `.tmp-compass-skills/`、压缩包、一次性脚本未混入 staged 交付
- [x] `git diff --cached --check` 通过
- [x] shadow checkout 可构建 runtime/renderer 并执行关键验收

## B. 安全默认与回滚

- [x] DCS context tools 默认 off
- [x] working-memory 默认 off
- [x] VToken assembly/bridge 默认 off
- [x] Runtime Memory inject/persist 默认 off
- [x] SEKB 默认 off 且无 auto writeback
- [x] Browser private network 默认 deny
- [x] Browser mode upgrade 需要用户批准
- [x] Context enhancement kill switch 可切断 memory/VToken/DCS/CVK addition
- [x] host sender 缺失、错误 id 或错误 URL 时 fail-closed

## C. P0 功能门禁

- [x] `pnpm run p0:accept`：8 files / 107 tests
- [x] `pnpm test:dcs`：32 files / 253 tests
- [x] `pnpm lint:dcs`
- [x] `pnpm contract:check`
- [x] VToken/host-api/knowledge focused unit：3 files / 70 tests
- [x] Runtime Memory enhanced eval：17 files / 159 tests（scripted/synthetic）
- [x] `pnpm run dcs:prod-p0:smoke`
- [x] `pnpm run build:vite`
- [x] `pnpm run maturity:validate`

## D. Electron 真实路径

- [x] DCS Settings surface
- [x] DCS W5 default-off/on-demand path
- [x] DCS W5 enabled persistence/read path
- [x] DCS W5 config-sync/Gateway path
- [x] SEKB human-confirm golden path
- [x] Browser approval/vault/recovery path
- [x] 主工作区关键组合 6/6
- [x] staged-patch shadow 关键组合 6/6

## E. P0 证据治理

- [x] maturity evidence 35 findings fresh、0 stale
- [x] 本轮有意改动与 evidence hash 对应
- [x] 无新增宽泛 drift allowlist
- [x] 机器报告记录命令、结果、Git inventory 与 residual
- [x] task-forest 已 validate/export
- [x] `LATEST.md` 指向 TF-0009 的唯一下一步

## F. P1 启动前仍需完成

- [x] 工程证据差距审计已落盘，fixture/synthetic/E2E/Harness 不计入真实 run：`docs/dev/tf0009-engineering-evidence-audit.md`
- [x] agent-surrogate 三 profile 各 `10/10`、agent kill/rollback 通过；证据固定非 human/live，任务只可降级为 `review_needed`
- [x] Day-1 L0/L1/L2 门禁已归档；冷构建 SEKB 缺口修复后最终 Electron 联合矩阵 `9/9`
- [ ] 明确 owner 与最小 cohort
- [x] 为 DCS/SEKB/Browser profile 写明启用和关闭步骤（runbook 已具备；尚未获 owner 批准）
- [x] 固化 token、时延、命中、拒绝、错误和回滚指标（字段已定义；尚无真实分布）
- [ ] 固化隐私、数据保留与删除边界
- [x] 执行至少一轮 agent kill/rollback 演练（真人 canary drill 仍未执行）
- [ ] 参与者确认这是 opt-in canary，不是 GA
- [ ] 记录最小真实任务及负责人继续/缩小/停止结论

## G. 硬性 NO-GO

任一项发生即禁止启动或扩大灰度：

- [ ] 未授权 host/workspace/write 行为
- [ ] SEKB 未确认写入
- [ ] Browser 私网默认开放或审批可绕过
- [ ] Runtime Memory 危险字符串/原始记录泄漏
- [ ] 关键 E2E、maturity evidence 或 staged source 不可复现
- [ ] 通过修改默认值来“证明可用”
- [ ] 把 controlled canary 宣称为 default-on、liveReady、productApproved 或联合系统 GA
