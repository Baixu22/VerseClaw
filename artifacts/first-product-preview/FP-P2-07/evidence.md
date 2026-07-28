# FP-P2-07 slice 1 evidence - source/license intake and Harness spec

| item | value |
|---|---|
| 收账日期 | 2026-07-28 |
| slice | 1 - 来源/许可证 manifest + Remote Forge Harness task spec |
| source inventory | 262 files / 4,428,869 bytes / root SHA-256 `4e8255d3e9d4580e8bf5dd4d726f5d2d78b6be6c7dd97f91c62be098826152a4` |
| license | Apache-2.0；LICENSE SHA-256 `f6ca6d410b1858cdec5d3f502c7ad7f01646b9947d0a6504a0422fbb2d659835`；snapshot 无 NOTICE |
| provenance | upstream/ref/tag 已记录；本地树对应 PR 54 单提交的父树内容，但 exact parent SHA 尚未解析 |
| adoption | `directSourceCopyAllowed=false`；只允许 clean-room contract/adapter 设计与边界语料重建 |
| Harness | context 通过；结构 validate 通过；隔离 clean-diff canonical validate 通过 |
| baseline gates | contract / i18n 通过；lint 被两个无关既有 BOM 拦截 |
| deliverability | `artifacts/*` 当前忽略本目录全部三个文件，且均未被 Git 跟踪；正式 change set 前必须显式处理 |
| task state | `FP-P2-07 in_progress`；只完成 slice 1，未进入 contract 实现 |

## Source and license result

机器真源为 [`source-license-manifest.json`](./source-license-manifest.json)。它记录：

- 上游 `https://github.com/tisrop/mergebeacon.git` 与 `main`、`release/0.10.0`、`v0.10.0`、PR 54 refs；
- 本地快照无 `.git`，README 声明 0.8.0，而 package/Cargo 声明 0.10.0；
- Apache-2.0 的复制、修改声明和归属保留义务；
- 全量快照 hash，不采用仅覆盖 31 个文件的内嵌 `.merkle-snapshot.json` 冒充全量；
- exact parent SHA 未解析，因此任何实现文本复制均 fail closed。

网络审计中，`git ls-remote`、codeload commit archives 和 PR 54 patch 可用；匿名 GitHub REST 达到速率上限，三次 filtered/shallow clone 被网络路径重置。临时 ZIP、展开目录与 detached validation worktree 均已删除，不留在工作区。

## Harness result

唯一共享 task spec 为 `harness/specs/tasks/remote-forge-controlled-preview.md`。它覆盖 P2-07 至 P2-10，并固定：

- Main-owned Remote Forge 与 typed host-api boundary；
- 本地 Git 继续归 `electron/services/git-api.ts`；
- 文件 mutation/undo 继续归 Coding write journal；
- patch/error contract、完整性、分页、OCC、action-bound approval、partial success、readiness hard veto；
- Agent merge 默认关闭，真实远端副作用全部推迟到 charter 指定 sandbox 的真人阶段。

主工作树的 canonical validate 诚实失败，因为 Harness 会把整个 dirty worktree 当作本 task diff。未使用扩大 touchedAreas 的方式伪造通过。随后在 detached clean worktree 中只暴露该 spec 给 Git diff，并从主工作区依赖环境运行同一 canonical command，结果通过。完整摘要见 [`slice-1-gates.log`](./slice-1-gates.log)。

## Gate interpretation

- G1 dev：**partial**。source/Harness 治理已落地；contract/parser/consumer 尚未实现。
- G2 test：manifest parse、Harness isolated validate、contract、i18n 通过；全仓 lint 的既有 BOM blocker 已具名。
- G3 runtime：n/a for slice 1；没有运行时行为变化。
- G4 human：n/a；pre-canary engineering，不是 controlled canary。
- G5 accept：未满足；FP-P2-07 仍有 slices 2-6。

## Residuals

- 通过可复现上游历史源补齐 PR 54 exact parent SHA，并再次检查该 commit 的 NOTICE 状态；在此之前禁止源码复制。
- `GitPatchArtifact/v1`、`RemoteForgeError/v1`、parser/adapter、consumer 和 DCS rich diff 仍归后续 slices。
- 全仓 lint 的两个无关 BOM 不在本任务授权范围；不得为本切片绿灯修改它们。
- 本目录当前被 `.gitignore` 的 `artifacts/*` 命中且未被跟踪；当前会话不改 ignore policy、不 stage，正式交付前必须显式纳入并验证三个证据文件均可交付。
