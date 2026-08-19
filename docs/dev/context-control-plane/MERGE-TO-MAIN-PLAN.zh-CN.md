# DCS 工作树提交 main 调研与准备方案

> 状态：commits 与 rebase 已完成；push / PR 尚未执行，等待 owner 授权。
> 日期：2026-08-19
> 工作树：`D:\verse_claw_worktree`
> 分支：`codex/context-control-plane-stage0`

## 0. 当前 Git 现状

| 项 | 值 |
|---|---|
| 当前分支 | `codex/context-control-plane-stage0` |
| 当前 HEAD | `f55201b22630d5c904f3105b2a9c8876ea5e889b` |
| 本地 `main` | `c673f0f29`（`chore(cleanup): remove root-level junk and rename net use/ design docs`） |
| `origin/main` | `734ec877e`（`chore(boot): deprecate BOOT.md writes and close out docs/i18n`） |
| 本地 main 与 origin/main | 本地 main **ahead 1**（`c673f0f29` 未推送） |
| 当前分支与 origin/main | HEAD 落后 origin/main **4 个提交**，且 HEAD 是两者 merge-base |
| 工作树状态 | 86 行 dirty（25 tracked modified + 61 untracked paths），另 84 个 untracked 文件 |
| 远程 | `https://github.com/Baixu22/VerseClaw.git`，可达 |
| 上游 tracking | 当前分支无 upstream |


## 0.1 实际执行状态（2026-08-19）

- 已按 §3 策略在当前分支完成 9 个 stage 提交，并成功 rebase 到 `origin/main`。
- 当前 HEAD：`f3d9881fe`；相对 `origin/main`：**ahead 9，behind 0**。
- 工作树：clean，0 未提交改动。
- 提交序列：
  1. `985d83de1` Stage 0
  2. `326c2fba8` Stage 1
  3. `d2ae03c4c` Stage 2
  4. `676a30601` Stage 3
  5. `109c1c557` Stage 4
  6. `c65523d02` Stage 5
  7. `9a26e7835` Stage 6
  8. `f9214b8b6` Stage 5 L7 soak
  9. `f3d9881fe` docs
- rebase 全程无冲突；baseline 修复切片已按推荐策略排除。
- rebase 后 DCS 聚焦矩阵全过；`pnpm run lint:check` 的 3 个 errors 均位于 origin/main 既有文件（`electron/utils/verseshell-runtime-bundle.ts`、`openclaw_runtime/src/plugin-sdk/provider-stream-shared.test.ts`、`openclaw_runtime/test/helpers/agents/happy-path-prompt-snapshots.ts`），本分支未触碰，留给 main 后续处理。
- 下一步仅剩：push 分支 + 创建 PR（待 owner 明确授权）。


`f552..origin/main` 的 4 个提交：

1. `1eab23c99` fix(prompt): round-1 prompt quality bugfixes and offline budget gate
2. `f3183a741` feat(intensity): linked-v1 core with provider matrix and PCS governance
3. `301fbb66e` feat(chat): per-send effort plumbing and CLI harness parity
4. `734ec877e` chore(boot): deprecate BOOT.md writes and close out docs/i18n

## 1. 冲突预演结论（已完成，不修改当前工作树）

方法：在临时 worktree 检出 `origin/main`，应用当前 tracked patch（`git apply --3way`），再复制全部 untracked 文件。

结果：

- tracked patch 25 个文件：**24 个 clean，1 个冲突**。
- 唯一冲突：`openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts`。
- `openclaw_runtime/src/plugins/activation-planner.ts` 与上游改动完全一致，**自动 clean**。
- 其余 DCS 生产文件全部 clean apply。
- untracked 文件复制后无路径冲突。

冲突内容与解决：

- 上游 origin/main 已经用 `structuredClone(fact) as RuntimeMemoryQueryableFact[]` 修复了 baseline 只读数组类型问题。
- 当前工作树用的是 `cloneQueryableFact`（并为此导出了 `memory-pre-reply-injection.ts` 的私有函数）。
- **推荐解决：完全采用上游实现**：
  - `extensions.ts` 采用 origin/main 版本；
  - 撤回 `memory-pre-reply-injection.ts` 的 export 改动；
  - 撤回当前工作树 `extensions.ts` 的 baseline 修复改动。
- 这样 baseline 修复切片不进入 DCS 分支，DCS 变更保持纯 Stage 0–6 + soak。

## 2. 必须纳入提交但被 .gitignore 忽略的证据

`artifacts/*` 被 `.gitignore` 忽略，但 DEVELOPMENT-CONSTRAINTS 允许提交受控 `artifacts/context-control-plane/` 证据。以下文件需 `git add -f`：

- `artifacts/context-control-plane/stage1-real-run-evidence.json`
- `artifacts/context-control-plane/stage2-real-run-evidence.json`
- `artifacts/context-control-plane/stage3-real-run-evidence.json`
- `artifacts/context-control-plane/stage5-real-run-evidence.json`
- `artifacts/context-control-plane/stage5-l7-soak-evidence.json`

证据均为 digest/ref/metrics-only，无 key/prompt/工具参数/输出。

## 3. 建议提交拆分

按 DEVELOPMENT-CONSTRAINTS 一个 stage 一个 commit：

1. `docs(dcs): stage0 contracts + authority baseline`
   - `docs/dev/context-control-plane/stage0/**`
   - `shared/types/context-control-plane/artifacts.ts`、`index.ts`
   - `tests/unit/context-control-plane-stage0-contracts.test.ts`
   - `harness/specs/tasks/context-control-plane-stage0.md`
2. `feat(dcs): stage1 provider guard + minimal grant + tool guard + effect receipt`
   - Stage1 spec、`stage1-*` 生产/测试、`provider-transport-fetch.ts`、`shadow-census.ts`、`receipt-store.ts`、`effect-receipt.ts`、`agent-tools.ts`、state db/schema 变更、3 个 memory 测试。
3. `feat(dcs): stage2 ContextRef -> snapshot -> DCS -> PromptPlan`
4. `feat(dcs): stage3 task ledger working context`
5. `feat(dcs): stage4 unified capability grant + tool guard`
6. `feat(dcs): stage5 memory facade + unit-aware packer + golden run`
7. `feat(dcs): stage6 read-only explanation projection + settings panel`
8. `feat(dcs): stage5 L7 soak baseline + evidence`
   - `harness/specs/tasks/context-control-plane-stage5-l7-soak.md`
   - `stage5-l7-soak.ts` / `.test.ts`
   - `stage2-golden-run.ts` 的 `collectTimings`、`stage5-golden-run.ts` timings 透传
   - `git add -f artifacts/context-control-plane/stage5-l7-soak-evidence.json`
9. `docs(dcs): DEVLOG + roadmap + merge plan`
   - `docs/dev/context-control-plane/DEVLOG.zh-CN.md`
   - `STAGE-ROADMAP.zh-CN.md`
   - 本文件
10. 单独决策：`docs/dev/adr/2026-08-16-context-authority-boundaries.md`、`docs/dev/context-capability-blueprint.md`、`electron/utils/verseshell-runtime-bundle.ts` 是否随 DCS 分支提交。
    - 推荐：前两个设计输入随 Stage0 文档提交；`verseshell-runtime-bundle.ts` baseline 修复留在主树处理，不随 DCS 分支提交。

## 4. 推荐执行流程（待 owner 授权后再执行）

```bash
# 1) 先做完整快照备份
git status --short > /tmp/dcs-pre-commit-status.txt
git diff --binary HEAD > /tmp/dcs-pre-commit.patch
git ls-files -co --exclude-standard -z > /tmp/dcs-pre-commit-files.txt

# 2) 按 §3 分阶段 git add / git commit（当前工作树内）
#    - 证据文件使用 git add -f
#    - 每个 stage 一个 commit
#    - 不要 commit /tmp 快照

# 3) 同步 origin/main
git fetch origin

# 4) rebase 到 origin/main（或先解决本地 main c673 归属）
git rebase origin/main

# 5) 冲突解决（预期只有一个）
#    - extensions.ts 采用 origin/main 版本
#    - 撤回 memory-pre-reply-injection.ts 的 export
#    - activation-planner.ts 保持上游结果

# 6) rebase 后复跑 DCS 聚焦矩阵 + 全局门禁
pnpm harness context/validate --spec harness/specs/tasks/context-control-plane-stage5-l7-soak.md
pnpm run typecheck
pnpm run lint:check
pnpm contract:check
pnpm run test:e2e tests/e2e/context-control-plane-stage6.spec.ts

# 7) 推送并创建 PR
git push -u origin codex/context-control-plane-stage0
# 在 GitHub 上向 main 创建 PR
```

## 5. 需要 owner 拍板的 4 件事

1. **本地 main 的 `c673f0f29` 怎么处理**：先推这个 cleanup commit，还是目标直接用 `origin/main`？
2. **提交粒度**：按 §3 的 stage 拆分，还是接受更少的合并提交？
3. **baseline 修复切片**：是否随 DCS 分支提交，还是全部留给主树（推荐留给主树）。
4. **合并方式**：PR review merge，还是授权本地直接 merge 到 main 后推送？
