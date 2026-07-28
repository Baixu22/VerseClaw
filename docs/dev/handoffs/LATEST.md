你正在接手一个持续开发会话。请基于下面的当前状态继续，不要重新打开已裁决的架构决策。若本提示与工作区证据冲突，以工作区为准，说明冲突后继续推进。

【工作目录】

`C:\Users\27933\Desktop\clawx\ClawX-maturity-p0`

【用户目标】

先闭合 First Product Controlled Preview 的非真人工程与证据，再集中处理独立验收、具名角色、真实凭据和远端副作用。当前唯一工程任务是 `FP-P2-07`；slices 1-2 已收口，下一切片是标准化 patch parser/adapter。不要跳到 `FP-P2-08` 或 UAS。

【必须遵守的要求】

- 保留大量既有脏改动；不 reset、checkout、清理或覆盖无关文件。
- 未经授权不 stage、commit、push、创建 PR，不执行真实 GitHub 评论、metadata 修改或 merge。
- FP-P1-07/08 在独立 G5 未完成前保持 `in_progress`；自动化证据不得冒充真人验收。
- 当前只是 `FP-P2 pre-canary engineering`，不是 controlled canary；`liveReady=false`、`productApproved=false`、`defaultOn=false`。
- 本地 Git authority 始终是 `electron/services/git-api.ts`；文件 mutation、snapshot、recovery、undo 始终归 Coding write journal。
- Renderer 只通过 `src/lib/host-api.ts` / `src/lib/api-client.ts` 调 Main；禁止 Renderer 直连 GitHub、执行 `git`/`gh` 或自行切换 transport。
- unknown/incomplete/truncated、分页失败、缺 head SHA、stale head/readiness/approval 一律 fail closed。
- 远端副作用必须绑定 provider/repository/pr/headSha/action/payloadDigest，审批单次消费；Agent merge 默认 OFF。
- Task Forest 只允许 CLI proposal -> 用户确认 -> apply；禁止手改 canonical data，本会话不得 apply 已保存 proposal。
- 每次只推进 `FP-P2-07` 的一个可验收切片；收口后同步 task progress、STATUS、开发日志与 evidence。

【已确认事实与裁决】

- [verified] `docs/dev/first-product-controlled-preview/STATUS.md` 当前 phase 是 `FP-P2 pre-canary engineering`，active task 是 `FP-P2-07`；FP-P1 出口仍待独立 G5。
- [verified] FP-P1-07 真 Electron/Gateway E2E 为 `4 passed (2.6m)`，覆盖成功主链与六类失败；独立 G5 仍待处理。
- [verified] FP-P1-08 聚焦门禁为 claim/chat `2 files / 60 tests`、default matrix/launch `2 files / 39 tests`，contract、i18n 与 claim scan 通过。
- [verified] 2026-07-28 最新 claim scan：16 个当前产品面、686 个命中路径、6386 个历史/治理命中、0 current product violations、0 skipped files。
- [verified] P1-07/08 均已完成 G1-G4，但 G5 后置，因此两项仍为 `in_progress`；STATUS 已登记 engineering-only sequencing deviation。
- [verified] P2 顺序固定为 `FP-P2-07 -> FP-P2-08 -> FP-P2-09 -> FP-P2-10`，只允许无真人、无真实远端副作用的工程切片先行。
- [verified] MergeBeacon 快照为 262 files / 4,428,869 bytes，root SHA-256 `4e8255d3...152a4`；Apache-2.0、无 NOTICE，README 0.8.0 与 manifests 0.10.0 漂移已入档。
- [verified] 本地快照内容对应 PR 54 单提交之前的父树，但 exact parent SHA 因 GitHub API 限流和 clone 网络重置仍未解析；`directSourceCopyAllowed=false`，只允许 clean-room contract/adapter 设计，不得复制实现文本。
- [verified] 唯一共享 Harness spec 是 `harness/specs/tasks/remote-forge-controlled-preview.md`，覆盖 P2-07 至 P2-10。
- [verified] Slice 2 已冻结唯一 `GitPatchArtifact/v1` / `RemoteForgeError/v1`：exact schema、v1 additive fields、unknown enum/new schema fail closed；完整性、逐行映射、仓库相对 POSIX path、binary/metadata 和 safe error 均由 strict decoder 锁定。
- [verified] `REMOTE-FORGE-CONTRACTS.md` 已记录现有 producer 迁移矩阵；尚未迁移 consumer，local Git 与 Coding write journal authority 未改变。

【任务森林状态】

- [verified] canonical graph hash 是 `3608e45643bf3498950c50217b05c274a9bad8fc653ea30662d1144305882177`；`TF-0007=in_progress`，`TF-0009=ready`，`TF-0006=blocked`，`TF-0010` 至 `TF-0019` 保持 proposed。
- [verified] 已通过 CLI 保存 proposal `TFP-first-product-precanary-sync-20260728`，候选内容是把 `TF-0009` 同步为 `in_progress`、补充 P1/P2 evidence，并记录 engineering-only sequencing deviation。
- [verified] proposal 状态仍为 `proposed`，绑定上述 base graph hash；保存后复读 `TF-0009` 仍是 canonical `ready`，没有 apply。
- [verified] 该 proposal 早于 slice 2 收口，execution hint 已过时；即使 graph hash 未变也不得直接 apply，后续须重生成或人工复核。
- [verified] 用户确认前不得运行 `proposal-apply`；若以后确认，必须先重读 list/todo 并检查 stale hash。

【已完成】

- [verified] 已创建 P1-07/08 evidence、原始门禁摘要和 claim report；任务书、tasks README、STATUS 已同步，G5 未伪造。
- [verified] 已创建 P2-07 slice 1 的 `source-license-manifest.json`、`evidence.md`、`slice-1-gates.log` 与唯一 Remote Forge Harness spec。
- [verified] slice 1 的 manifest JSON、Harness context、结构 validate、隔离 clean-diff canonical validate、contract、i18n 均通过。
- [verified] 主工作树 canonical Harness validate 因会纳入数百个既有脏文件而失败；没有扩大 `touchedAreas` 伪造通过。
- [verified] `pnpm run lint:check` 被两个既有 BOM 文件拦截：`scripts/dcs-ops-preflight.mjs`、`tests/unit/dcs-ops-canary-hard-veto.test.ts`；它们不属于本切片，不要修改。
- [verified] 已确认 P1-07/08 和 P2-07 的 artifact 全部被 `.gitignore:78` 的 `artifacts/*` 忽略，且 `git ls-files` 无对应记录；任务/evidence 已登记可交付性风险，本会话没有改 ignore policy 或 stage。
- [verified] Slice 2 contract/decoder、兼容策略和 focused tests 已完成：`1 file / 10 tests`，standalone strict TS、contract、i18n、Harness structural validate 通过；无 consumer/UI 变化，build/Electron E2E 留给后续切片。
- [verified] 根 Vitest/tsc 命令链接不完整，full typecheck 受阻；全仓 lint 仍被两个既有 BOM 拦截。已用 direct Vitest/standalone tsc 验证本切片，未改依赖或无关文件。

【未完成 / 待验证】

1. `FP-P2-07` slice 3：实现标准化 parser/adapter，消费统一 diff 输入并产出唯一 `GitPatchArtifact/v1`；不要迁移 Git/Code Review/DCS consumer。
2. Parser corpus 至少锁定 CRLF、add/delete、rename/copy、binary、metadata-only、bare/malformed hunk、truncated/unavailable、空输入、`\\ No newline` 与 old/new line mapping；任何不可信边界返回 unavailable/truncated，不 panic、不伪装 complete。
3. 先复读 `shared/types/git.ts`、`electron/services/code-review-api.ts`、diff extension parser/render 和 DCS edit/write shape，以 adapter 连接现有 producer，不创建第二 schema、local Git service 或 write journal。
4. 通过可复现上游历史源补 exact parent SHA 与 NOTICE 复核仍是 residual；在解析前继续禁止源码复制。
5. 正式交付 change set 前处理被忽略 artifact 的可交付性，确保 P1-07/08 与 P2-07 evidence/manifest/log 全部被纳入；当前仍禁止 stage。

【最终集中真人阶段（现在不要请求或执行）】

- FP-P1-07 独立 G5 与 P1 phase 出口确认。
- FP-P2-01 的 owner/operator/safetyReviewer/productApprover、固定 SHA、Provider/Model、sandbox repository、credential scope、stop conditions 与 rollback policy。
- FP-P2-02 的至少 10 次真人联合任务：至少 3 read、2 review、1 sandbox merge，并保留完整阻断矩阵和 `notHumanProductChat=false` 证据。
- 真人阶段后再做 FP-P2-03 分面 continue/shrink/stop 裁决以及 FP-P2-04/05/06 校准；不得提前宣称批准、default-on 或 GA。

【关键文件 / artifact】

- `docs/dev/first-product-controlled-preview/STATUS.md`
- `docs/dev/first-product-controlled-preview/DEFINITION-OF-DONE.md`
- `docs/dev/first-product-controlled-preview/tasks/FP-P1-07.md`
- `docs/dev/first-product-controlled-preview/tasks/FP-P1-08.md`
- `docs/dev/first-product-controlled-preview/tasks/FP-P2-07.md`
- `docs/dev/first-product-controlled-preview/REMOTE-FORGE-CONTRACTS.md`
- `harness/specs/tasks/remote-forge-controlled-preview.md`
- `shared/types/remote-forge.ts`
- `tests/unit/remote-forge-contracts.test.ts`
- `artifacts/first-product-preview/FP-P1-07/`
- `artifacts/first-product-preview/FP-P1-08/`
- `artifacts/first-product-preview/FP-P2-07/`
- `.agent-workbench/task-forest/proposals/TFP-first-product-precanary-sync-20260728.json`
- `docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md`

【不要重复 / 不要做】

- 不重跑已通过且昂贵的 FP-P1 全量 E2E，除非相关源码变化或证据失效。
- 不修两个无关 BOM 文件，不清理 codegraph README 的既有 Markdown hard-break。
- 不整仓移植 MergeBeacon 的 Tauri/Vue/Rust，不建立第二 local Git service、第二 write journal 或第二 patch/error 真源。
- 不访问真实凭据，不运行真实评论、metadata、merge，不进入 GitLab/Gitee、PR DAG、Queue/Train、FP-P4 或 UAS。
- 不 apply Task Forest proposal，不 stage/commit/push/PR。

【下一步】

1. 运行 `pnpm harness context --spec harness/specs/tasks/remote-forge-controlled-preview.md`，读取最小相关规则。
2. 审计现有 parser、patch producer 和 line/size semantics，先写 slice 3 corpus 与 adapter API；保持 v1 contract 不分叉。
3. 实现标准化 parser/adapter 与 focused fail-closed tests，不迁移 consumer、不触发远端副作用。
4. 运行适用门禁并收口 slice 3 evidence/账目；`FP-P2-07` 继续保持 `in_progress`，不得自动进入 `FP-P2-08`。
