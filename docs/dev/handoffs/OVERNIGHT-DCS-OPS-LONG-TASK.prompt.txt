You are taking over an ongoing agent session. Resume from the context below. Do not re-open settled decisions unless current files or verified evidence contradict them. If this prompt conflicts with current workspace evidence, prefer current evidence and explain the conflict.

This is an OVERNIGHT LONG RUN. The user is asleep. Maximize tomorrow-morning harvest: machine-readable evidence, runnable canary ops pack, and any fix that unblocks controlled internal use of DCS — without flipping defaults or claiming GA. Work until acceptance criteria below are met or you are hard-blocked; then write a clear morning brief.

【工作目录】
C:\Users\27933\Desktop\clawx\ClawX-maturity-p0

【用户目标】
深度保证 DCS 真正能够投入使用（controlled internal use / opt-in canary），不是 demo 绿、不是 default-on、不是联合系统 GA。
明天醒来要有可审查收获：证据包 + 可执行运行包 + 明确 go/no-go 结论（continue|shrink|stop 的技术预判）。

【硬性要求】
1. 只推进 TF-0009（P1 小范围受控内测运行包）；全局仍属 TF-0007 in_progress。
2. TF-0006 保持 blocked：禁止 liveReady=true / productApproved=true / readyForDefaultFlagGraduation=true / jointSystemGa。
3. 默认值全部保持 off/fail-closed：
   - DCS context view tools 默认 off
   - working-memory / vToken 默认 off
   - Runtime Memory diagnostics-only，禁止默认注入
   - SEKB 无 auto writeback；cutoverAllowed 保持 false
   - Browser 私网默认 deny；mode upgrade 需审批
4. 禁止为“证明可用”修改生产默认常量或放宽 senderAuth。
5. 无用户新授权：禁止 commit / push / PR / 发布 / 改生产外部状态。可写工作区内 docs、artifacts、tests、必要修复代码（未 stage 提交亦可，但要列清单）。
6. 一次不要开并行 mega-surface；不要把 Agent Dev 绿写成 DCS GA。
7. 所有用户可见文案走 i18n；宿主调用走 host-api，不直连 gateway HTTP。
8. 诚实残差：合成/录制证据不得伪装成 live production corpus。

【已确认事实与决策】
- [verified] P0 组件受控投用已关闭：verdict=p0-closed-p1-canary-ready；p1CanaryExecuted=false。
- [verified] DCS Round ACCEPT 2.0 = accept-with-residuals；productionMode=opt-in；defaultsUnchanged=true。
- [verified] 本机曾通过：dcs:prod-p0:smoke、dcs:prod-p0；历史 closeout：P0 107 / DCS 253 / focused 70 / RM eval 159 / Electron 关键 6/6 / maturity findings 35 fresh。
- [verified] 红线仍成立：view tools off、staleWriteGuard false、isolation shared、worktree inprocess、symbolLease/patchFlow/shadows default false。
- [verified] 残差：C1 live A/B 未过 5x；C6 live64k 缺失；C7 cutover 禁止；RM 仅 scripted-synthetic。
- [verified] 启动包已写：docs/dev/dcs-deep-test-week1-kickoff.md 与 artifacts/dcs-deep-test-week1/profiles.json（owner 未填）。
- [verified] dcs-canary / dcs-corpus 证据目录基本空壳；capability claims 矩阵偏旧（2026-07-05）。
- [inferred] 用户睡眠期间无法做人审 SEKB 确认 / Browser UI 审批；真实人工路径应尽量脚本化、影子化、或做成“一键明早点跑”的半自动包。
- [verified] COMPASS：playbook=docs/dev/Sustained-Development-Playbook.md；handoff=docs/dev/handoffs/LATEST.md。

【Task-forest】
- TF-0007 in_progress — 受控内测投用收口（非 GA）
- TF-0008 done — P0 交付基线与 DCS 真实集成证据
- TF-0009 ready — 本会话唯一执行节点
- TF-0006 blocked — 缺真实 corpus + human live A/B + soak + product approval

【已完成（勿重复扩面）】
- P0 closeout、W5 senderAuth 修复路径、DCS packaging/runbook/Settings 旗标面板、深度测试启动文档骨架。
- 不要重做 P0 maturity 全量，除非出现回归。

【本夜交付物（明天必须看得到）】
全部写入/更新：
1. artifacts/dcs-deep-test-week1/
   - day1-gates.json（L0/L1/L2 自动化结果，含命令、exit、耗时、sha）
   - profiles.json（owner 可用 local-dev-nightly 占位，但字段齐全）
   - rollback-drill.json（至少脚本级/配置级 kill 顺序演练记录；若不能动真实 gateway，做 dry-run + 断言 defaults）
   - runs/ 下 ≥3 条 run JSON（允许 synthetic-or-scripted，但必须标明 evidenceClass）
   - summary.json + decision.md（技术预判 continue|shrink|stop；禁止 GA 措辞）
2. docs/dev/dcs-ops-canary-runbook.md（给真人用的最短投用手册：启用→任务→指标→kill→回滚，10 分钟内可读完）
3. docs/dev/handoffs/LATEST.md + NEXT-GOAL.md 更新为明早状态
4. 若发现阻塞“可投入使用”的代码/测试缺口：最小修复 + 对应测试；写入 artifacts/dcs-deep-test-week1/fixes.md
5. （可选高价值）scripts 或 pnpm 脚本：dcs:ops:preflight / dcs:ops:package 一键汇总上述证据

【建议执行顺序（长任务，尽量一口气做完）】
Phase A — 预飞与基线固化（必须）
1. 读：docs/dev/Sustained-Development-Playbook.md、docs/dev/handoffs/LATEST.md、docs/dev/dcs-deep-test-week1-kickoff.md、docs/dcs-production-p0-runbook.md、artifacts/component-controlled-rollout-p0/final-report.json、artifacts/coding-prod-p0/report.json、artifacts/tf0006-evidence-upgrade/status.json
2. 运行并记录：
   - pnpm run dcs:prod-p0:smoke
   - pnpm run dcs:prod-p0
   - pnpm run lint:dcs
   - pnpm run test:dcs
   - pnpm run dcs:canary:c1
   - pnpm run dcs:corpus:validate（若失败，修 fixture/脚本或记为 residual，不伪装 live）
   - pnpm run p0:accept（若太慢可记时后继续，但尽量跑）
3. 红线断言：任一 defaults 漂移 → 立即修复或 hard-stop 并写 decision=stop

Phase B — 可运营化包装（必须，这是“投入使用”的关键）
4. 把三类 profile 固化为完整运行表（owner/cohort/budget/privacy/metrics/kill/rollback/stop）：
   - dcs-coding
   - sekb-assisted
   - browser-supervised
5. 写最短 ops runbook（docs/dev/dcs-ops-canary-runbook.md），含 Windows 注意点与故障关闭顺序。
6. 补齐 artifacts 模板与校验：拒绝写入 liveReady=true / default-on recommendation（与 dcs-canary-c1 脚本同精神）。
7. 实现/加强一键 preflight：失败时给出下一步，而不是只 dump 日志。

Phase C — 深度保证缺口修复（高优先级，有时间就做）
8. 扫描并修复“声称可 canary 但路径不通”的问题，例如：
   - Settings DCS flags 只读目录与 runtime flags 漂移
   - host-api / W5 路径回归
   - dcs observability export 空/坏
   - canary/corpus 空目录与脚本不一致
   - test:dcs 或 e2e 失败
9. 在不改默认前提下，补最小自动化测试，锁住：
   - defaultsUnchanged
   - kill-switch 关闭增强后不再注入
   - canary decision 不得 default-on
10. 若 Electron E2E 可跑：优先
    tests/e2e/dcs-production-wiring-w5.spec.ts
    tests/e2e/dcs-prod-p0-settings.spec.ts
    tests/e2e/sekb-golden-path.spec.ts
    tests/e2e/browser-security-recovery.spec.ts
    结果写入 day1-gates.json

Phase D — 收口（必须）
11. 写 summary.json（门禁矩阵、残差、风险、明早 3 个动作）
12. 写 decision.md：只能是 continue / shrink / stop 的技术建议；明确“非 GA”
13. 更新 LATEST.md / NEXT-GOAL.md：用户醒来后第一条命令是什么
14. 列出 changed files inventory（未 commit）
15. 最终自检：禁止违禁措辞；TF-0006 仍 blocked；defaults 未变

【验收标准（明天有收获的定义）】
Must-have：
- [ ] day1-gates.json 存在且至少含 dcs:prod-p0:smoke + test:dcs 或明确失败根因与修复
- [ ] profiles.json 三类 profile 字段齐全
- [ ] docs/dev/dcs-ops-canary-runbook.md 存在且可执行
- [ ] summary.json + decision.md 存在
- [ ] LATEST.md 指向清晰“醒来第一步”
- [ ] 无 default-on / GA 宣称；无未授权 commit

Should-have：
- [ ] dcs:canary:c1 产物写入 artifacts/dcs-canary/c1/
- [ ] rollback-drill.json（dry-run 可接受，需标明）
- [ ] 至少 1 个阻塞投用的真实 bug 被修并有测试
- [ ] 关键 E2E 结果

Nice-to-have：
- [ ] pnpm dcs:ops:preflight 一键脚本
- [ ] capability 与 DCS 相关声明的局部刷新说明（不必全量重做 44 项）

【禁止重复 / 禁止做】
- 不重开 P0 大面建设；不重写 honesty pack 替代真实证据
- 不解除 TF-0006；不扩 cohort；不翻默认值
- 不启用 SEKB 自动写回；不开放 Browser 私网默认；不启 RM 默认注入
- 不把 synthetic canary 写成 liveReady
- 不 commit/push/PR

【明早给用户看的输出格式（会话最后一条消息）】
1. 结论：continue | shrink | stop（及一句理由）
2. 今晚完成清单（带路径）
3. 失败/残差（诚实）
4. 用户醒来 3 步操作（复制即跑）
5. 是否需要用户授权 commit

【第一条动作】
先读 docs/dev/handoffs/LATEST.md 与 docs/dev/dcs-deep-test-week1-kickoff.md，再跑 pnpm run dcs:prod-p0:smoke，把结果写入 artifacts/dcs-deep-test-week1/day1-gates.json 的第一条 step，然后按 Phase A→D 连续推进。
