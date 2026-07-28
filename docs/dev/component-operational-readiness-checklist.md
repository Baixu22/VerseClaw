# 组件受控投用验收清单

> P0 状态：完成。P1 状态：ready、尚未实际投放。任何硬性 NO-GO 仍立即停止 canary 或扩大灰度。

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

- [ ] 明确 owner 与最小 cohort
- [ ] 为 DCS/SEKB/Browser profile 写明启用和关闭步骤
- [ ] 固化 token、时延、命中、拒绝、错误和回滚指标
- [ ] 固化隐私、数据保留与删除边界
- [ ] 执行至少一轮 kill/rollback 演练
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
