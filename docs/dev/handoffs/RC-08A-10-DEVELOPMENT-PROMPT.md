# RC-08AR → RC-10 开发任务与验收闭环 — 交接提示词

> 用途：交给下一位开发 agent 的完整任务提示词（含 RC-08AR、RC-08BR、RC-09A/RC-09、RC-10）。
> 前置：RC-01R..RC-07R 8 包已全部独立候选验收双 PASS（2026-08-07，候选链 `edeca7267 → 1e1c3557e`，产物 `artifacts/agent-engineering-acceptance/runs/rc01r-accept-1..rc07-accept-1`，详见 `docs/dev/handoffs/LATEST.md` "RC-01R → RC-07R 独立验收 PASS" 章节）。
> 验收方法：沿用 `docs/dev/handoffs/RC-01R-07R-ACCEPTANCE-PROMPT.md` 的独立候选验收流程（候选 worktree + 累积链 + `pnpm acceptance:agent:full` 双 actor 双 PASS）。
> 状态红线：`STATUS.md.accepted_work_packages` 保持空；RC-10 保持 blocked；`liveReady/productApproved/defaultOn/promotionAuthorized=false`；不调用真实 provider/channel 验收；不宣称 accepted/done。

---

## 0. 总体要求（每包通用）

1. 工作目录只能 `C:\Users\27933\Desktop\clawx\ClawX`；禁止在主工作树 worktree add/remove/prune、cherry-pick、rebase、checkout、stash、reset、clean、`git add -A`。候选构建只在独立候选 worktree（bash 命令）中进行。
2. **保护 workstream 不得触碰**：`.agent-workbench/task-forest/**`、`src/pages/Chat/ChatInput.tsx`、`src/stores/chat*`、`shared/chat/types.ts`、`openclaw_runtime/src/agents/tool-loop-detection.ts`（P0-3）、`openclaw_runtime/src/gateway/**`（checkpoint gateway）、`docs/dev/handoffs/**`、研究文档、`tests/unit/chat-*.test.*`。这些文件的失败只能记录，不得伪装成修复或绕过。
3. 每个包开始前：`pnpm harness context --spec harness/specs/tasks/<spec>.md`，读 rules、调用方、相邻实现与测试；涉及 `openclaw_runtime` 先读 `openclaw_runtime/AGENTS.md` 与受影响子目录 AGENTS.md。
4. 串行顺序固定：`RC-08AR -> RC-08BR -> RC-09A/RC-09 -> RC-10`。任一包验收未 PASS，下一包不得启动。
5. 修改后先跑最小相关测试，再扩大到该包 spec 的 requiredTests，再跑全局 `lint:check`/`typecheck`/`pnpm test`，最后才构建候选验收。
6. 新增/修改路径必须精确落入对应 RC spec 的 `touchedAreas`；禁止宽 glob 覆盖保护改动；行为变化同步检查 README 三语与 runtime-convergence 控制文档（STATUS/WORK-PACKAGES/TARGET-ARCHITECTURE/AGENT-START），但不得改 `accepted_work_packages`。
7. 每包结束记录：命令与 exit/test counts、改动文件、未跑项、残余风险、当前包状态（追加到 LATEST.md 与 RC-04-07-DEVELOPMENT-PROMPT.md 同格式的验收记录）。

---

## 1. RC-08AR — MCP Host/Native Tool Convergence

**Spec**：`harness/specs/tasks/rc08a-mcp-host-native-tool-convergence.md`
**touchedAreas**：`openclaw_runtime/src/mcp/**`、`openclaw_runtime/src/agents/**`、`openclaw_runtime/src/config/**`、`shared/types/**`、`electron/services/**`、`tests/unit/**`、`harness/specs/**`、`artifacts/runtime-authority-convergence/rc-08a/**`
**requiredProfiles**：fast；**requiredRules**：agent-engineering-acceptance-boundary
**requiredTests**：
- `pnpm exec vitest run tests/unit/rc08a-mcp-host-native-tool-convergence.test.ts`
- `pnpm --dir openclaw_runtime exec vitest run src/agents/tool-convergence.test.ts`
- `pnpm exec vitest run tests/unit/work-provider.test.ts tests/unit/work-providers-api.test.ts`
- `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts`
- `pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts`
- `pnpm harness validate --spec harness/specs/tasks/rc08a-mcp-host-native-tool-convergence.md`

**核心语义（expectedUserBehavior）**：
- MCP SDK runtime（`@modelcontextprotocol/sdk`）是外部协议权威；runtime 不得定义并行 MCP schema。
- Work Provider 是 catalog/projection；Git、storage、terminal、browser 除非由真实 MCP server 支撑，否则标注 host-native。
- 不改变 runtime send 行为、排序、工具、重试、approval、delivery、payload 字节。

**已有脚手架（main）**：`openclaw_runtime/src/mcp/openclaw-tools-serve.ts`、`plugin-tools-handlers.ts`、`plugin-tools-serve.ts`、`tools-stdio-server.ts`；`openclaw_runtime/src/agents/tool-convergence.ts/.test.ts`。

**开发任务**：
1. MCP host/native 工具目录收敛：以真实 MCP server 为 external authority，host-native 工具经目录/投影暴露，不得伪造 MCP schema。
2. Work Provider catalog 接线：生产 caller 使用 catalog/projection；health/readiness 不依赖 npm fallback（`degraded/unavailable` 显式标注）。
3. 反例测试：无生产 caller 的 helper、测试断言本地常量、未接线的 exporter——参照 RC-09 审计表 RC-08A/B 行（`helper 无生产 caller；测试断言本地常量；exporter 不导出`）逐一关闭。

**UI/e2e 风险（务必注意）**：touchedAreas 含 `shared/types/**`、`electron/services/**`——候选 changedPaths 若落入这些路径会触发 `coverage.ui=true → e2e profile`（验收 NO-GO）。按 RC-05R 先例：**UI/electron 侧文件不入候选**（留 main 侧或归主工作树），候选只含 `openclaw_runtime/**` + `tests/unit/**` 内可离线验证的文件；spec touchedAreas 相应保留宽覆盖（覆盖检查只针对实际 changedPaths）。

---

## 2. RC-08BR — OTel Observability Convergence

**Spec**：`harness/specs/tasks/rc08b-otel-observability-convergence.md`
**touchedAreas**：`openclaw_runtime/extensions/diagnostics-otel/**`、`openclaw_runtime/src/observability/**`、`openclaw_runtime/src/trajectory/**`、`openclaw_runtime/src/context-engine/**`、`tests/unit/**`、`harness/specs/**`、`artifacts/runtime-authority-convergence/rc-08b/**`
**requiredProfiles**：fast；**requiredRules**：agent-engineering-acceptance-boundary
**requiredTests**：以 spec 内 requiredTests 为准（含 otel/observability 聚焦测试 + control-pack + harness validate）。

**核心语义（expectedUserBehavior）**：
- OTel/OTLP 是 trace 导出的唯一权威；不得引入第二 trace schema 或 store。
- Ingress、run、model/tool、effect、delivery 共享 correlation IDs。
- Receipts 与 domain journals 是事实证据；trajectory 是 bounded flight-recorder；Observability JSONL 只是可重建缓存（不得授权 lifecycle/effect replay/telemetry truth）。

**已有脚手架（main）**：`openclaw_runtime/extensions/diagnostics-otel/**`（plugin 完整骨架）、`openclaw_runtime/src/observability/correlation-ids.ts`。

**开发任务**：
1. OTLP exporter 真实接线：trace export 经 OTel/OTLP，插件外无并行 trace 路径；correlation IDs 贯通 ingress→run→model/tool→effect→delivery。
2. 证据分级落实：receipt/journal = 事实证据；trajectory = bounded flight recorder；Observability JSONL = rebuildable cache——测试证明删除/重建缓存不影响事实证据。
3. neutral OTLP fixture（不依赖真实 collector）验证 exporter 行为；`exporter 不导出` 审计项关闭。

---

## 3. RC-09A/RC-09 — 审计修复聚合与重新送审

**控制文档**：`docs/dev/unified-agent-system/runtime-convergence/RC-09-REMEDIATION-PLAN.md`（状态：approved-for-planning / implementation-not-started；失败候选 `fac6327a2`；审计证据 `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/independent-audit-2026-08-03.md`）。
**无独立 spec**：RC-09 的 spec 需在启动前新建（`harness/specs/tasks/rc09-*.md`，touchedAreas 覆盖全部修复文件），或按修复计划分 RC-09A（前置修复包）与 RC-09（重新送审包）两个候选验收。

**审计失败基线（修复计划 §3，每行必须有稳定 ID + 反例测试 + 可定位证据）**：

| 区域 | 已确认问题 | 关闭条件 |
|---|---|---|
| Evidence | RC-01 baseline 未进入候选；无完整 final manifest/Verifier report | clean candidate 自包含 baseline；新 run 生成完整相互绑定 evidence |
| Build health | clean candidate typecheck 2 errors；lint 4 errors/120 warnings；全量 Vitest 159 failures | 新基线先全绿；候选复跑所有最终 gate 仍全绿 |
| Harness | final spec 无法覆盖累计 diff；acceptance 用 `--no-diff` 绕过 | 每个 changed path 精确归属一个 RC；真实 review 不用 `--no-diff` |
| RC-02/03 | receipt digest 可伪造；只有 Anthropic 局部路径；seal/WireReceipt 无真实生产 caller | 所有 source provider 与八类真实入口走最终 guarded boundary；反例和端到端接线测试通过 |
| RC-04/05 | Map 仍 authoritative；raw JSON；状态越级；真实 send 前记 applied | durable owner 单写；严格 CAS 状态机；digest-only；真实 domain outcome 后才 reconciliation |
| RC-06 | create 绕过 revision/初态；deliveryState 未落库；三个 legacy lifecycle owner 未完成 cutover | RC-06A capability proof 真实成立；B/C/D 完成单 writer cutover 证明 |
| RC-07 | 只返回无人消费的 error 字段；静态分类不等于 enforcement | config/startup fail closed；从真实 registry 计数 owner/writer |
| RC-08A/B | helper 无生产 caller；测试断言本地常量；exporter 不导出 | catalog/health/trace 真实接线；MCP initialize fixture 与 neutral OTLP fixture 通过 |
| Validator | `--phase` 未校验；reportDigest 只查 64 hex；source digest 不可移植 | canonical digest 真正重算；phase/actor/gate/source/candidate 全量 tamper tests 通过 |
| Windows gates | comms 脚本入口 Windows no-op；channel conformance 只是源码 regex | 命令主体真实执行并生成校验产物；channel fixture 执行 adapter 行为和故障注入 |

**不可变边界（修复计划 §2，全部保持）**：OpenClaw Gateway/runtime 是唯一 runtime authority；receipt/approval/TaskFlow 只复用既有 openclaw-state SQLite；diagnostic/projection 不得授权 lifecycle/replay/telemetry truth；raw prompt/tool output/credentials 不得默认持久化；unknown effect 不自动 replay；npm fallback 显式 degraded/unavailable；`liveReady/productApproved/defaultOn/promotionAuthorized=false` 不变。

**PASS 定义（修复计划 §1）**：每个审计发现都有代码修复 + 反例测试 + 可定位证据；严格串行；最终候选是自包含 clean commit；全部强制门禁在两个独立 detached worktree 真实执行（退出码 0、skip 符合预算、产物非空、摘要可重算）；独立 Verifier 重跑全部 gate 生成绿色 final-report；工程 PASS 只推进到 `human_acceptance_pending`。

---

## 4. RC-10 — 用户裁决与收尾

**RC-10 不由开发 agent 执行**；工程侧只负责把全部包推进到 `human_acceptance_pending` 并汇报。用户/流程裁决内容包括：

1. **正式 accepted 判定**：确认 8+2+1 包（RC-01R..RC-07R、RC-08AR、RC-08BR、RC-09）全部双 PASS 且 evidence 完整后，在 STATUS.md 记录 accepted（`accepted_work_packages` 按实际验收包列出）。
2. **解除 RC-10**：`blockers` 移除最终-required-gates 类 blocker；`next_action` 记录解除依据。
3. **product locks 依序解除**：`live_ready` → `product_approved` → `default_on`（每次解除需对应真实 provider/channel 验收证据；RC-10 的真人验收不属于工程验收范围）。
4. **promotion 授权**：`promotionAuthorized` 仅在用户明确授权后置 true；RC-09 的最终候选如被重新审计为 NO-GO，全部保持现状。

**工程侧收尾清单（RC-09 PASS 后）**：
- 控制文档更新：LATEST.md / STATUS.md / RC-09-REMEDIATION-PLAN.md（结论区改为 re-submitted + PASS 记录）。
- 验收产物归档：复制到主工作树 `artifacts/agent-engineering-acceptance/runs/`（gitignored）。
- 候选 worktree 保留最终候选与产物；Temp 残留清理。
- 汇报明确剩余事项：正式 accepted 判定、RC-10 解除、product locks——全部保持 false/blocked 待用户与流程裁决。

---

## 5. 每包独立候选验收手册（沿用 RC-01R..07R 已验证流程）

1. **候选 worktree**：每包一个（或复用累积 worktree），分支名 `rc08a-candidate` 等；`parent-ref` = 上一包候选 HEAD（RC-08AR 的 `--since` = `1e1c3557e`）。
2. **依赖与资源**：`pnpm install --offline --frozen-lockfile --ignore-scripts`（根 + `openclaw_runtime`）；`node node_modules/electron/install.js`；预置 gitignored 资源：`resources/bin/win32-x64/ae.exe`、`artifacts/uas-06-single-local-exec-canary/live-observations.json`、`artifacts/unified-agent-system/TF-0011/audit-manifest.json`、`openclaw_runtime/apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/tool-display.json`。
3. **候选内容**：从主工作树筛选该包 touchedAreas 内文件；候选自包含修复（全量测试 0 failed、lint 0 errors、typecheck exit 0、`pnpm --dir openclaw_runtime check` 全绿、`pnpm harness validate --spec <spec> --since <parent-ref>` pass）。
4. **commit 候选**：候选 HEAD 必须 clean（`git status --porcelain` 空）；验收期间不得改动候选 worktree（source mutation 检查会 NO-GO）。
5. **验收命令**（候选内）：
   ```
   pnpm acceptance:agent:plan --spec harness/specs/tasks/<spec>.md --since <parent-ref> --output-dir artifacts/agent-engineering-acceptance/runs/<pkg>-accept-<n>
   pnpm acceptance:agent:full --spec ... --executor <pkg>-executor-<n> --verifier <pkg>-verifier-<n> --since <parent-ref> --output-dir ...
   ```
6. **PASS 判定**：`final-report.json` 中 executor.result == "pass" 且 verifier.result == "pass" 且 verifier.engineeringAcceptedByAgent == true，failures 空；`mutationCheck` detached/source 双 clean；changedPaths 恰为该包文件。
7. **产物归档 + 控制文档**：复制 runs/<pkg>-accept-<n> 到主工作树；LATEST.md / STATUS.md / 本提示词追加验收记录。

---

## 6. 已知障碍与解法（RC-01R..07R 实测，直接复用）

1. **tool-display.json 缺失**（detached 全新编译 TS2307）：候选已含 provision `--copy` + `check.mjs` typecheck 前再生（幂等、字节稳定）；候选链内文件勿删。
2. **runtime tsconfig module 保持 ESNext**（`openclaw_runtime/tsconfig.json`）：runtime 源码是 bundler 风格（import 无扩展名），NodeNext 下 tsgo 报 TS2835 洪流；electron 侧 typecheck 用根级 tsconfig（ESNext）不受影响。类型兼容问题（如 TS2322）先找配套文件（相邻模块的未提交修复）而不是改 module。
3. **Windows 偶发原生崩溃 0xC0000409**（runtime-smoke / esbuild，进程 1-2 秒内崩、日志为空）：先本地复现（`node scripts/smoke-openclaw-runtime.mjs` / `pnpm run build:runtime`）；本地过则判定为验收环境偶发，重跑验收（新 executor/verifier 编号 + 新 output-dir）即可。
4. **UI/e2e profile 触发**：候选 changedPaths 严禁含 `src/**`、`electron/**`、`tests/e2e/**`、`shared/**`（rc05 先例：UI 文件留 main 侧）；spec touchedAreas 可保留宽覆盖（覆盖检查只针对实际 changedPaths）。
5. **runtime profile 门禁**（openclaw_runtime changedPaths 必触发）：`runtime check`（tsgo/oxlint/policy guards）、`runtime-unit`、`runtime-build`、`runtime-smoke` 必须全绿；tsgo/oxlint/shrinkwrap/swift 修复已在候选链（`57804a43f` 起），新包勿回退。
6. **shrinkwrap/swift 生成物**：`deps:shrinkwrap:generate`（离线依赖 store）与 host-env swift 生成后需 `.gitattributes -text` 入候选（tracked 文件），或确认已由候选链覆盖。
7. **验收期间禁止改候选**：任何 source 变更（含未 commit 文件）都会使 source mutation 检查 NO-GO；等待 verifier 用分段轮询（wait ≤600s/段），不要长阻塞。

---

## 7. 结束条件（全部完成后向用户汇报）

- RC-08AR、RC-08BR、RC-09A/RC-09 全部 executor + verifier 双 PASS，产出每包 output-dir（归档到主工作树）。
- 控制文档（LATEST/STATUS/RC-09-REMEDIATION-PLAN/本提示词）已更新，候选链 SHA 记录完整。
- 主工作树未触碰保护 workstream；临时 worktree 清理完毕（保留最终候选与产物）。
- 汇报中明确剩余事项：**正式 accepted 判定、RC-10 解除、product locks、promotion 授权——全部保持 false/blocked，仅由用户与流程裁决（RC-10）**。
