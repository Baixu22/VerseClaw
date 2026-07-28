# Definition of Done（五门禁）

本 program 内任何任务只有**五门禁全绿**才能标 `done`。缺一门 → `in_progress` 或 `blocked`，不允许 `done-with-residuals`。

## G1 — DEV：实现存在且默认安全

- [ ] 代码落地，anchors 在任务文档中逐一列出（`path:line`）
- [ ] 新能力**默认 off**（或与 `docs/dev/default-config-matrix.md` 声明一致）
- [ ] 有 kill/回滚路径，且 kill 优先级高于任何启用来源
- [ ] `pnpm contract:check` 通过
- [ ] `git diff --check` 干净（无 trailing whitespace）

## G2 — TEST：自动化证明

- [ ] 单测覆盖 happy path + 失败路径 + kill 路径
- [ ] 涉及启动层/UI 的改动有 Electron E2E
- [ ] 失败路径可解释（错误里能读出原因，不是静默降级）
- [ ] 命令与结果原样贴在任务文档 `## Test / evidence`（含 pass/fail 计数）
- [ ] 没有为通过测试而放宽断言或跳过用例；skip 必须写理由

## G3 — RUNTIME：真进程生效

- [ ] 改动在**真 Electron + 真 gateway child** 里生效，不只在 vitest 进程
- [ ] 控制面返回 runtime acknowledgement（不是「写入成功即 applied」）
- [ ] flag off 的 baseline parity 通过（关掉后行为回到基线）
- [ ] 观测能看到本次改动的 counter / lineage

## G4 — HUMAN：真人任务证据

仅对标注 `humanEvidence: required` 的任务适用；其余任务此门记 `n/a` 并写明理由。

- [ ] 真人（非合成、非 agent 自证）在产品 UI 内完成任务，`notHumanProductChat=false`
- [ ] 每次记录：request/session/workspace lineage、flags、token/latency、tool hit/drop/truncation、error、outcome、是否 rollback
- [ ] 未授权写入 = 0；secret 泄漏 = 0
- [ ] 证据文件落在 `artifacts/first-product-preview/<taskId>/`

## G5 — ACCEPT：独立验收与账目一致

- [ ] 验收人 ≠ 实现人（或明确写「self-accept + 理由 + 残留」）
- [ ] 任务文档 Acceptance criteria 全部勾选，每项后附证据指针
- [ ] STATUS 表、tasks/README、task-forest（如同步）三处状态一致
- [ ] 若任务在 `tasks/README.md` 有统一 Agent 后继映射，`DEVELOPMENT-LOG.zh-CN.md` 已追加证据、裁决、residual 和消费节点
- [ ] 残留项显式列入 `## Residuals` 并转成新任务 ID，不许口头带过
- [ ] 结论用词受限：只能写 `done` / `blocked` / `deferred`，禁止 `liveReady` / `productApproved` / `GA` 除非对应门禁任务已 done

---

## 状态语义

| status | 含义 |
|--------|------|
| `backlog` | 依赖未满足，未排期 |
| `ready` | 依赖满足，可开工 |
| `in_progress` | 已开工；至少一门禁未绿 |
| `blocked` | 被外部（真人/审批/硬件）挡住，写明 `blockedBy` |
| `done` | **G1–G5 全绿** |
| `deferred` | 明确后置，写明触发条件 |
| `cancelled` | 下架/作废，写明去向 |

## 禁止的「假 done」模式

1. 用 synthetic canary 冒充 live A/B。
2. 用 `restart() resolved` 冒充 runtime effective。
3. 用 dry-run 脚本冒充 live kill/rollback。
4. 用 agent 自己跑的会话冒充真人产品任务。
5. 用「测试全绿」推断「产品可用」。
6. 把未完成项从 Acceptance criteria 里删掉而不是转成残留任务。
