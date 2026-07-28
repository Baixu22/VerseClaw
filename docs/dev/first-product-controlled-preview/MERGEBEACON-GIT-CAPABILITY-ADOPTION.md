# MergeBeacon Git 能力引入基线

> 状态：Research complete / core implementation planned in FP-P2
> 调研日期：2026-07-27
> 来源快照：`C:\Users\27933\Desktop\verseshell\MergeBeacon-main`
> 任务入口：`FP-P2-07` → `FP-P2-10` → `FP-P2-01/02/03`；多平台扩围为 `FP-P4-08`

## 1. 裁决

MergeBeacon 可提供的是**远端代码托管平台协作能力**，不是本地 Git 引擎。ClawX 继续保持：

- `electron/services/git-api.ts`：本地 status/diff/stage/commit/branch/stash/worktree/fetch/pull/push 唯一 Main owner；
- `clawx-git` MCP：Agent 受控调用本地 Git 与现有 GitHub PR 基础能力；
- Coding write journal：文件 mutation、undo 和恢复 authority；
- VerseShell：本地进程生命周期，不接管远端 PR/MR authority；
- 新增 Remote Forge 层：远端 PR/MR、review、readiness 和 merge policy。

因此不整仓移植 Tauri/Vue/Rust 实现，不在 Renderer 直连平台 API，也不把远端平台状态塞进 Context Orchestrator 作为第二 authority。

## 2. 已核验事实

### ClawX 当前基线

- `shared/host-api/contract.ts` 已暴露 `hostApi.git`；
- `electron/services/git-api.ts` 通过 argument-array `execFile` 调用 `git` / `gh`，并接入 workspace permission 与 approval audit；
- `electron/services/mcp-api.ts` 已有 27 个 `clawx-git` 工具；
- GitHub PR 当前只覆盖 list/view/create/open；
- `harness/specs/tasks/git-github-worktree-agent-tools.md` 明确排除 issues、checks、reviews 和 merge automation；
- Git、Code Review 和 runtime diff extension 目前存在不同 raw patch 上限与解析路径，尚无共享 patch schema。
- DCS `edit` diff 当前只有 Work panel 文本投影，尚未接 `code-diff` 富组件；全文件 `write` 只有差异预检，没有实际 diff artifact。

### MergeBeacon 可借鉴能力

| 能力 | 源码锚点 | 处置 |
|---|---|---|
| GitHub/GitLab/Gitee provider contract | `src-tauri/src/platform/mod.rs` | 借鉴 contract，TypeScript 重写 |
| 单一平台 capability matrix | `src-tauri/src/platform/mod.rs` | 引入，区分协议/权限/资源状态 |
| `PATCH_SCHEMA_VERSION=1` 与 hunk/line mapping | `src-tauri/src/patch.rs`、`models.rs` | 高优先级引入，统一 ClawX patch consumers |
| compare 分页、去重、`incomplete` 原因 | `src-tauri/src/platform/mod.rs` | 引入，禁止截断冒充完整 |
| 1 MiB 远端文件有界读取 | `src-tauri/src/file_content.rs` | 引入 contract，限额由 ClawX 重新裁定 |
| merge readiness 四态与原因码 | `src-tauri/src/models.rs` | 引入模型，不照搬 GitHub 近似结论 |
| `head_sha` / `expected_updated_at` 并发保护 | `src-tauri/src/commands/pr.rs` | 引入并绑定本地审批 |
| 部分成功结果 | `src-tauri/src/commands/pr.rs` | 引入，主效果与附属失败分离 |
| 稳定远端错误 envelope | `src-tauri/src/error.rs` | 纳入统一 Host contract |
| PR dependency DAG | `src-tauri/src/commands/pr.rs` | 后置，仅在 stacked PR 需求成立后启用 |

## 3. 必须修正后才能使用

1. MergeBeacon `pr_merge` 没有在命令内部强制调用 readiness。ClawX 的 Main policy 必须执行“读取 → 判定 → 审批绑定 → 立即复查 → merge”。
2. GitHub API 适配器不能可靠获得审批阈值；`approvals=ready` 不能单独允许 merge，未知状态必须 fail closed。
3. Gitee query-token transport 不进入 ClawX 通用日志；凭据只留在 Main/安全存储或已认证 CLI 边界。
4. 所有远端副作用都要绑定 `provider/repository/pr/headSha/action/payloadDigest`，不能复用宽泛 approval。
5. 平台返回的分页、文件、commit、check、review 数据必须携带完整性/截断状态。

## 4. 来源和许可证风险

- 本地目录是源码快照，无 `.git`，不能据此证明与上游 tag 完全一致；
- README 标记 `0.8.0`，`package.json` / `Cargo.toml` 标记 `0.10.0`，存在版本漂移；
- 许可证为 Apache-2.0，当前快照未见 `NOTICE`；
- 如复制代码，必须保留许可证和归属、标注修改并复核目标上游 commit；默认策略是重写 contract/adapter，移植测试语料和边界用例。

## 5. 任务闭环

```text
FP-P1-08 产品纵向链路收口
  -> FP-P2-07 来源冻结 + 结构化 Patch / Remote Error contract + DCS diff consumer 收口
  -> FP-P2-08 GitHub Remote Forge 只读面
  -> FP-P2-09 Review mutation 与并发保护
  -> FP-P2-10 Merge readiness 硬门禁实现
  -> FP-P2-01 DCS + Forge 统一 canary charter
  -> FP-P2-02 10 次真人 DCS coding + Forge 联合执行
  -> FP-P2-04/05/06 residual 收口
  -> FP-P2-03 DCS/read/review/merge 分面 continue-shrink-stop 裁决
  -> FP-P3 release/clean VM/credential-degradation/出闸
  -> FP-P4-08 GitLab/Gitee/PR DAG 扩围裁决
```

核心 GitHub 能力与 DCS 一起进入 FP-P2 开发和验收，但仍不得抢跑当前 FP-P1。`FP-P2-03` 负责把联合 canary 和分面裁决通过 Task Forest proposal 刷入 `TF-0009`；本文件不直接修改正式图。GitLab/Gitee/PR DAG 仅在 `FP-P3-04` 后由 `FP-P4-08` 裁决。

## 6. 全链硬锁

- 不替换或复制本地 `git-api` authority；
- 不在 Renderer 执行 shell、`git`、`gh` 或平台 HTTP；
- 不把 `unknown`、`truncated`、分页失败解释为 ready/complete；
- P2 真实 merge 仅允许 charter 指定 sandbox/disposable repository，默认 Agent merge 保持 OFF；
- 不以合成测试冒充真实远端权限、branch protection 或真人 merge 证据；
- 不自动关闭 Issue，不自动进入 Merge Queue/Train，不自动扩到 GitLab/Gitee。
