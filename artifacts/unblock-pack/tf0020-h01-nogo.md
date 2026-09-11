# TF-0020 / RC-00 H-01 真实 NO-GO 收据

生成于 2026-09-09。这是工程验收 Bootstrap 的真实失败，不是「还没跑」。

## 已生成且可复验的产物

| 文件 | 作用 |
|---|---|
| `artifacts/agent-engineering-acceptance/H-01/manifest.json` | plan 产物。`manifestDigest=344ce692bf652fafcad1166604a1df013b38538f2f3fb383b1ef97f4b6f36a5c` |
| `artifacts/agent-engineering-acceptance/H-01/plan.json` | 20 个 gate 的 full 计划 |
| `artifacts/agent-engineering-acceptance/H-01/executor-report.json` | executor 结果 `NO-GO` |
| `artifacts/agent-engineering-acceptance/H-01/logs/provision-verseshell-resources.stderr.log` | 首失败门日志 |

## 命令（可复现）

```bash
pnpm run acceptance:agent:plan -- --spec harness/specs/tasks/rc00-agent-engineering-acceptance-bootstrap.md --since HEAD~1 --output-dir artifacts/agent-engineering-acceptance/H-01
# worktree 必须 git status 空
pnpm run acceptance:agent:run -- --manifest artifacts/agent-engineering-acceptance/H-01/manifest.json --actor agent-surrogate-rc00-h01 --output-dir artifacts/agent-engineering-acceptance/H-01
```

## 实测失败链

1. worktree dirty → `source worktree is dirty`（已通过移走 `ClawX/` 镜像目录解除）。
2. 干净后 executor 启动，20 gate 里 **2 pass / 1 fail / 17 blocked**。
3. 首失败：`provision-verseshell-resources`
   - 错误：`clean VerseShell reconstruction failed: [verseshell-bundle] Patch resources/verseshell/patches/p0-runtime-startup.patch byte size mismatch.`
   - 该 gate 在 **隔离 worktree** 上跑 `node scripts/verseshell-bundle.mjs rebuild --mode package`，不是当前工作树。
4. 当前工作树实测：`p0-runtime-startup.patch` `stat.size=1645` 且 sha256 与 `source-inputs.json` 完全一致。所以 mismatch 发生在 **隔离 checkout 的 EOL/过滤**，不是工作树文件坏了。
5. 后续 17 个 gate 被 fail-closed 级联 blocked（含 harness-validate / lint / typecheck / unit / contract / i18n / integration / vite / runtime / required-tests）。这是正确 fail-closed，不是漏跑。

## 相对 AC 的诚实状态

| AC | 状态 |
|---|---|
| clean fixture 生成稳定 manifest | **部分满足**：manifest+digest 已生成，但 `eligibility.cleanAtPlan=false`（plan 当时工作树脏） |
| 隔离 Executor / 独立 Verifier fail closed | **满足（负面）**：Executor 已 fail closed；Verifier 未跑，因为 executor NO-GO |
| invalid `--since` 不得回退 HEAD | 本轮未测该负例（单测 `tests/unit/agent-engineering-acceptance.test.ts` 覆盖，未在 H-01 复跑） |
| 身份 / reportDigest NO-GO | 本轮未测该负例 |
| 显式 output-dir 生成四件套 | **缺 verifier-report.json 与 final-report.json**（被 verseshell 重建挡住） |
| 真实隔离 fixture 绿色 verifier+final | **未达到** |

## 解锁 TF-0020 的最小下一步

修隔离 checkout 里 patch 的 byte-size（疑 CRLF 或 `core.autocrlf` 把 1645 字节的 LF patch 膨胀）。修完后同一 `--output-dir` 重跑 run → verify，才能谈 H-01 绿。**不要跳过 provision 门去跑后面的 gate。**
