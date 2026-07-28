你正在接手 ClawX 的持续开发与独立验收。请从以下状态继续，不要重新讨论已冻结边界。若本提示与当前工作区或 fresh release evidence 冲突，以当前证据为准，记录冲突并 fail closed。

【工作目录】
`C:\Users\27933\Desktop\clawx\ClawX`

【用户目标】
First Product Controlled Preview 的 `FP-P3-01` 已按 fixture-grade 工程卫生范围收口：发布树分类、Forge 源码覆盖、MergeBeacon 来源/许可证证明、clean ref-bound source manifest/full-gate evidence、Windows x64 fresh packaging、app.asar/fuse、installer/feed/release-info、git/gh/gh-auth 与泄漏验证。

这不是 `FP-P3-03/04` 真人验收，不是 public release、default-on、product approval、GA 或 UAS 开工。

【必须遵守的要求】
- `liveReady=false`、`productApproved=false`、`defaultOn=false`、Agent merge OFF 保持。
- P3 phase 保持 `in_progress`；`FP-P3-03/04` 保持 `engineering-validation-only`。
- 未签名 `0.4.9-alpha.0` 仅限内部 fixture-grade 验证，不进入 public latest。
- 不执行 clean VM 13 场景、不伪造出闸签字、不做远端 mutation、不使用真实凭据。
- 不修改 `.agent-workbench/task-forest/`，不 apply proposal，不进入 P4、TF-0011 或 UAS。
- 不 push、不建 PR、不 reset/checkout/stash/清理用户工作。
- 任何 dirty tree、stale HEAD/ref、缺 full gate、manifest/evidence/hash mismatch、credential finding 都必须 fail closed；cached/smoke/reuse 不能替代 full release gates。

【已完成】
- [verified] 任务前分支是 `main`，任务前 HEAD `32839d1e36fa6d7b9d1c8c720208b3a683b76c20`，相对 `origin/main` ahead 3；本轮不 push。
- [verified] STATUS 原 `codeBaseline=bfa764b32` 已改为 `refs/heads/main` + fresh evidence `commit` 的无循环表达。最终 SHA 必须从当前 `git rev-parse HEAD` 与 evidence 读取，不能把提交自己的 SHA 硬编码进自身。
- [verified] 发布源码无 untracked；`dist/`、`release/`、测试输出和历史本地日志为 ignored build/evidence output。只纳入 FP-P3-01 必需源码、脚本、文档和机器证据。
- [verified] `artifacts/first-product-preview/FP-P3-01/required-release-sources.json` 列出 42 个 FP-P2-07–10 provenance/contract/provider/Main/host-api/MCP/UI/i18n/test 文件；RC validator 要求 source manifest 42/42。
- [verified] MergeBeacon PR 54 head `3383256585d91668980349f0ea24abe17d0f01b2` 的唯一父提交是 `14a17c7ecb821af4bdb645d5f492e7cf72bcd293`，tree `95fddba4593a879352a59de157db92c63afa819f`。
- [verified] 该父提交 recursive tree 为 262 blobs，LICENSE 存在、NOTICE 缺失；codeload archive 与本机快照均为 262 files / 4,428,869 bytes / ordinal inventory SHA-256 `4e8255d3e9d4580e8bf5dd4d726f5d2d78b6be6c7dd97f91c62be098826152a4`。
- [verified] 现有 Remote Forge 是 clean-room TypeScript 实现，没有复制/修改上游 Tauri/Vue/Rust 实现文本；`directSourceCopyAllowed=false` 继续保持。
- [verified] `scripts/validate-first-product-release-candidate.mjs` 固化 source coverage/provenance、baseline evidence、x64 installer/latest.yml/release-info、fresh app.asar/fuses、git/gh/gh-auth、credential/private-path/source-body 检查。
- [verified] 新 validator 的 focused test 为 1 file / 6 tests passed；targeted ESLint 与 Node syntax check 通过。
- [verified] fixture charter 的 `versionSha=FIXTURE_VERSION_SHA_REQUIRED`，不是签署 SHA。最终 RC 是重新计数的 fixture-grade engineering SHA，不能声称真人 charter 已固定。

【任务森林状态】
- [verified] 只读 exports 存在；当前 todo 首项仍为 `TF-0009`，`TF-0007` 为关联全局任务，`TF-0006` 仍是延后证据升级，`TF-0010/0011...` 仍属于 UAS 后继。
- [verified] 本轮没有修改 canonical graph、保存/apply proposal 或解锁 TF-0011。
- [inferred] Program STATUS 与 Task Forest 仍有既定同步延迟；FP-P3-01 完成不授权刷新 TF-0009 或启动 UAS。

【关键文件】
- `docs/dev/first-product-controlled-preview/STATUS.md`
- `docs/dev/first-product-controlled-preview/tasks/FP-P3-01.md`
- `artifacts/first-product-preview/FP-P3-01/required-release-sources.json`
- `artifacts/first-product-preview/FP-P2-07/source-license-manifest.json`
- `scripts/validate-first-product-release-candidate.mjs`
- `tests/unit/first-product-release-candidate.test.ts`
- `harness/specs/tasks/clean-release-baseline-reproducibility.md`

【未完成 / 待验证】
最终 tracked commit 之后不再修改 tracked 文件。fresh evidence 位于：

`%TEMP%\clawx-fp-p3-01-<full HEAD SHA>\`

应包含：
- `release-source-manifest.json`
- `release-gate-evidence.json`
- `acceptance-matrix.json`
- `evidence-index.json`
- `release-info.json`
- `fp-p3-01-release-candidate.json`
- `package-win.log`
- `packaged-smoke.log`
- `support-bundle-gate.log`

- [unverified until read from disk] 当前最终 HEAD、manifest/evidence/report 的 `commit/ref/version`、installer SHA-256、latest.yml/release-info、app.asar digest/fuses 和 scan 计数。下一会话必须先读这些文件再引用具体值。
- [unverified until read from disk] 最终 full release gates、Windows packaging 与 packaged smoke 的 exit code。缺文件、非零、旧 SHA 或工作树非 clean 均表示 FP-P3-01 不能继续宣称完成。

【下一步】
1. 运行 `git status --porcelain=v1 -uall`、`git rev-parse HEAD`、`git rev-list --left-right --count origin/main...HEAD`，确认 clean、仅本地未 push。
2. 用当前 full SHA 定位 `%TEMP%\clawx-fp-p3-01-<SHA>`，读取三份 JSON，确认 manifest/evidence/RC report 的 commit=`HEAD`、ref=`refs/heads/main`、version=`0.4.9-alpha.0`。
3. 核对 `acceptance-matrix.json` 全 passed、每个 release gate exit=0、installer/latest.yml/release-info/app.asar/fuses/source coverage/scans 全绿。
4. 若证据缺失或 mismatch：不要复用旧 evidence；修复后新提交，并从新 SHA 重新运行完整 release gates -> package:win -> packaged smoke/RC validator。
5. 若证据全绿：保持停点，不进入 P3-03/04 真人路径、P4、Task Forest proposal 或 UAS，等待新的明确授权。

【不要做】
- 不把 fixture/mock/自动化/开发机启动冒充真人或 clean VM 证据。
- 不把旧 `artifacts/system-maturity/P6-005`、旧 `release/` 或旧 app.asar 复用为当前 RC。
- 不把本机 gh auth、Token、Authorization、私有 URL、绝对用户路径或源码正文写入 artifact/log/support bundle/evidence。
- 不放宽 release/readiness/head/approval/secret scan 断言换绿灯。
- 不公开发布、不签名、不 push、不建 PR、不修改 Task Forest。

模式：`full`。隐私：`local`。来源：当前对话、AGENTS/Harness、First Product STATUS/任务书、Git 状态、只读 Task Forest exports、MergeBeacon GitHub commit/tree/codeload 验证、focused tests。限制：最终 post-commit evidence 不能写回其自身提交；因此本交接要求下一会话从外部 SHA-bound evidence 复核具体最终值。
