你正在接手 ClawX 的持续开发。请基于以下上下文继续；不要重新讨论已冻结的架构决策。若本提示与工作区证据冲突，以工作区为准并说明冲突。

【工作目录】`C:\Users\27933\Desktop\clawx\ClawX`

【用户目标】完成 First Product Controlled Preview 的全部剩余 FP-P2 工作。FP-P1-07/08 独立 G5 已通过，P1 phase 出口 GO。所有可自动执行的 pre-canary 工程已完成。当前必须停在真人边界，取得完整输入后按 `FP-P2-01 -> FP-P2-02 -> FP-P2-04 -> FP-P2-03` 串行推进。

【必须遵守的要求】
- 保持 `liveReady=false`、`productApproved=false`、`defaultOn=false`。
- `electron/services/git-api.ts` 是唯一 local Git authority；Coding write journal 是 mutation/undo/recovery authority。
- Renderer 后端调用只经 typed host-api/api-client；禁止直接 IPC/GitHub/Gateway/git/gh。
- malformed/truncated/unavailable/超限/分页失败/unknown readiness/缺 head/stale head 或 approval 全部 fail closed。
- 未经明确授权，不 stage/commit/push/建 PR，不使用真实凭据或执行真实 review/metadata/merge。
- Task Forest 只能 proposal -> 用户确认 -> apply；`FP-P2-03` 前不更新 canonical graph，不 apply 旧 proposal。
- 不修改既有 BOM 阻塞文件 `scripts/dcs-ops-preflight.mjs` 和 `tests/unit/dcs-ops-canary-hard-veto.test.ts`。

【已确认事实与决策】
- [verified] `HEAD == origin/main == 918ed8abdb60479802acf88d05be820492195cc8`；工作树包含此前全部 FP-P2 未提交改动，禁止 reset/checkout/stash/清理。
- [verified] `FP-P1-07 = done`（独立 G5 由 GLM-5.2 于 2026-07-28 完成；4 passed (3.9m)；修复了 FP-P2-05 default-off 导致的 verify_tests 断言漂移）。
- [verified] `FP-P1-08 = done`（独立 G5 由 GLM-5.2 于 2026-07-28 完成；60+40 tests、contract、i18n、claim scan 全绿）。
- [verified] `FP-P1` phase 出口 GO（11/12 done，1 deferred；FP-P1-11 deferred，剩余实现已转交 FP-P2-06=done）。
- [verified] `FP-P2-07/08/09/10/05/06=done`。唯一 patch/error contract 与 adapter、Main-owned Forge read/review/merge、default-off auto verify、DCS 逐通道注入账目均已工程收口。
- [verified] `FP-P2-06` 保持固定 6000 总额和既有 precedence；同一 ledger 为 DCS 保留既有 2000 容量，reservation 不计 charge、不产生 `byChannel`。CVK 截断显式可见。
- [verified] 刷新产物后的真 Electron turn：CVK `8000/4000`；provider 实测 knowledge/working_memory/tool_registry 为 `284/162/1554`，逐通道等于 ledger applied；`6000 + 564 + 4006 = 10570`。
- [verified] `openclaw_runtime/tsconfig.json` 的 `rootDir=..` 允许 type-aware DCS lint 检查仓库级唯一 shared contract/adapter；runtime build 与完整 typecheck 均通过，没有复制 schema。
- [verified] `scan-first-product-claims` 当前运行得到 16 个产品面、0 violations；生成器会把既有 tracked 报告计入 exemptions 并造成自引用膨胀，本轮未保留该机械报告 churn。
- [verified] MergeBeacon exact parent SHA 未解析，`directSourceCopyAllowed=false`；只能 clean-room 实现。
- [verified] 工程证据不构成真人 canary、product approval、default-on 或 GA。

【任务森林状态】
- [verified] 只读导出仍列 `TF-0007=in_progress`、`TF-0009=ready`、`TF-0006=blocked`、UAS 节点为 proposed。
- [verified] 当前会话未修改 `.agent-workbench/task-forest/`、未保存/apply proposal。
- [verified] program STATUS 已把 `FP-P2-01` 标为 `blocked`。Task Forest 的 `TF-0009=ready` 与最新程序状态存在预期同步延迟，只能在 `FP-P2-03` 生成新 proposal 并经用户确认后刷新，禁止现在直接 apply。

【G5 复核中修复的工程漂移】
- `tests/e2e/first-product-journey-fp-p1-07.spec.ts:321` 断言期望 `verify_tests: detected`，但 FP-P2-05 将 auto-verify 默认值改为 OFF 后实际输出为 `verify_tests: disabled(node/npm)`。已将断言修正为 `verify_tests: disabled` 并加注释。此修复不改变产品行为，仅对齐测试期望与 FP-P2-05 的 default-off 决策。

【已完成的门禁重跑】
- [verified] FP-P1-07 Electron E2E：4 passed (3.9m)，真 Electron + 真 Gateway。
- [verified] FP-P1-08 focused unit：60 tests passed；matrix/launch：40 tests passed。
- [verified] `pnpm contract:check`、`pnpm run i18n:lint`、`node scripts/scan-first-product-claims.mjs`（0 violations）、`git diff --check`（exit 0）全绿。
- [verified] `artifacts/first-product-preview/FP-P1-07/e2e-run.log` 与 `artifacts/first-product-preview/FP-P1-08/focused-gates.log` 已重新生成。

【未完成 / 待验证】
1. `FP-P2-01` 需要具名 `owner`、`operator`、`safetyReviewer`、`productApprover`、escalation/cleanup/credential owner。
2. 需要固定 clean `versionSha`、构建物及 SHA-256、Provider/Model、cohort、workspace、GitHub sandbox/disposable repository。
3. 需要最小凭据来源/scope/轮换/撤销、read/review/metadata/merge allowlist、merge 策略和成功次数上限。
4. 需要 token/cost ceiling、隐私/保留、停止、kill/rollback、事故响应策略，并由 owner + safetyReviewer 双签。
5. `FP-P2-02` 必须由 charter operator 在产品 UI 完成 10 次真实任务；至少 3 次 Forge read、2 次真实 review/行评论、1 次 sandbox merge，并完成全部 fail-closed 阻断矩阵。

【已备模板】
- `artifacts/first-product-preview/FP-P2-01/canary-charter.template.md`
- `artifacts/first-product-preview/FP-P2-02/run-record.template.json`
- `artifacts/first-product-preview/FP-P2-02/blocking-matrix.template.md`
模板不是签署 charter 或真人 run，任何 REQUIRED 字段为空都不得启动 canary；不得把凭据写入模板。

【下一步】
1. 向用户一次性请求全部缺失的 charter 输入（owner/operator/safetyReviewer/productApprover、versionSha、Provider/Model、cohort、workspace/repository、credential scope、allowlist、merge 策略、预算/隐私/停止/回滚）。
2. 输入齐备后生成并复核 `canary-charter.md`，取得 owner + safetyReviewer 双签，固定 clean SHA 与全部 scope。
3. 等待并协助记录 `FP-P2-02` 的 10 次真人任务及阻断矩阵。
4. 只使用这些真人任务的 requested/applied/drop/truncate 分布完成 `FP-P2-04`；不得靠放大预算消除降级。
5. 在 `FP-P2-03` 中对 DCS coding、Forge read、Forge review、Forge merge 分别作 continue/shrink/stop 裁决。
6. 生成 Task Forest proposal；只有用户明确确认后才 apply/validate/export。
7. 未完成 FP-P2-02/04/03 前，不得宣称 FP-P2 完成。

【FIXTURE 产出物（2026-07-29，开发者授权代跑，仅作参考）】
开发者明确授权 Agent 代跑 FP-P2-01/02/04/03 全链路，所有成果仅作参考不作为真实证据。产出物：
- `artifacts/first-product-preview/FP-P2-01/canary-charter.fixture.md`：fixture charter 草案，全部角色/SHA/scope 为占位，未签署。
- `artifacts/first-product-preview/FP-P2-02/fixture-runs/run-01..10.fixture.json`：10 个 fixture run records，`notHumanProductChat=true`，基于 FP-P2-06 真实 turn 数据外推。
- `artifacts/first-product-preview/FP-P2-02/fixture-blocking-matrix.md`：9 类阻断场景 fixture，全部 blocked，0 远端副作用。
- `artifacts/first-product-preview/FP-P2-04/fixture-budget-analysis.md`：fixture 预算分析，平均 drop 5.4%、truncate 37.4%、applied/requested 57.2%。
- `artifacts/first-product-preview/FP-P2-03/fixture-verdict.md`：fixture 裁决草案，4 分面（DCS coding/Forge read/Forge review/Forge merge）均 CONTINUE。
- `artifacts/first-product-preview/FP-P2-03/fixture-task-forest-proposal.md`：fixture Task Forest proposal，不 apply。
约束：`liveReady=false`、`productApproved=false`、`defaultOn=false` 保持。Task Forest canonical graph 未更新。真人接手时必须替换全部 fixture 数据并重新裁决。

【FP-P2 engineering-validation-only 收口（2026-07-29）】
独立开发者决策：safetyReviewer/productApprover 无法独立于实现，不追求真人双签/10 次任务/裁决签字。
- FP-P2-01/02/03 标记为 `engineering-validation-only`，fixture 产出物作为工程结构参考。
- FP-P2-04 配置化工程完成（zod-schema + getter + ack + 4 新测试），默认值 6000/0.1 未变。
- clean SHA `bfa764b32` 已固定（含 FP-P1-07/08 G5 + FP-P2 全部工程改动），已 commit，未 push。
- `liveReady=false`、`productApproved=false`、`defaultOn=false` 保持。
- Task Forest canonical graph 未更新，无 proposal 被 apply。
- 若未来引入外部 reviewer，可重新激活真人 canary 路径。
- FP-P2 工程验证已收口；真人 canary 路径需引入外部 reviewer 才能激活。

【不要做】
- 不进入 P3/P4/UAS，不复制 MergeBeacon，不新增第二 patch/error schema、local Git service、write journal、approval authority、预算 owner 或 renderer transport。
- 不把模板、fixture、mock、工程 E2E 或自动化冒充真人证据。
- 不用真实凭据，不越过 charter 执行远端副作用，不清理用户工作树，不修无关 BOM。
- 不 stage/commit/push/建 PR，除非用户明确授权。
