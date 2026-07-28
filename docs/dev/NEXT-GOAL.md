# NEXT-GOAL

当前没有可自动执行的 FP-P2 工程任务。`FP-P2-06` 已收口，下一入口是受真人输入阻塞的 `FP-P2-01`：先完成 FP-P1-07 的非实现人独立 G5 与 FP-P1-08 G5，再由具名真人角色签署 DCS + GitHub Forge canary charter。

工作目录：`C:\Users\27933\Desktop\clawx\ClawX`

```powershell
git status --short --branch
Get-Content -Raw docs/dev/handoffs/LATEST.md
Get-Content -Raw artifacts/first-product-preview/FP-P2-01/canary-charter.template.md
```

Charter 必须固定 clean SHA、构建 hash、Provider/Model、workspace、GitHub sandbox/disposable repository、最小凭据 scope、允许 action、merge 次数、预算、隐私、保留、停止和回滚策略，并由 owner + safetyReviewer 双签。禁止代填角色或凭据，禁止在 charter 完成前执行真实 review/metadata/merge。

保持 `liveReady=false`、`productApproved=false`、`defaultOn=false`。Task Forest 继续只读，直到 `FP-P2-03` 生成 proposal 并获得用户明确确认。
