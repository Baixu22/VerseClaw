# Context Control Plane Stage 交付路线（批量提示词索引）

| 批次 | 提示词文件 | 入口条件 | 主要交付 | 解锁下一批条件 |
|---|---|---|---|---|
| 0 | `STAGE0-DEV-PROMPT.zh-CN.md` | 已完成 | 五平面、六 artifact、authority 契约、黄金路径契约 | owner 接受 Stage 0 + baseline 修复切片确认 |
| 1 | `STAGE1-DEV-PROMPT.zh-CN.md` | Stage 0 accepted | Provider Guard 观测 + 一个真实工具调用 + EffectReceipt | 黄金路径 envelope 覆盖、真实 effect receipt、未登记 egress=0 |
| 2 | `STAGE2-DEV-PROMPT.zh-CN.md` | Stage 1 accepted | ContextRef -> CompilationSnapshot -> DCS -> PromptPlan | 稳定 PromptPlan、黄金路径 direct mutation=0 |
| 3 | `STAGE3-DEV-PROMPT.zh-CN.md` | Stage 2 accepted | Task Ledger proposal/accept/reject + 物化投影 | 任务账本事件可重放、合并语义确定 |
| 4 | `STAGE4-DEV-PROMPT.zh-CN.md` | Stage 3 accepted | 完整 CapabilityGrant + Tool Guard + 子 agent 衰减授权 | 子 agent 扩权=0、grant 可撤销可恢复 |
| 5 | `STAGE5-DEV-PROMPT.zh-CN.md` | Stage 4 accepted | Memory 收敛 + unit-aware packer + 真人任务对照 | parallelMemoryWriters=0、critical 保留率/P95 达标 |
| 6 | `STAGE6-DEV-PROMPT.zh-CN.md` | Stage 5 accepted | Context diff / why-included / policy simulation / replay debugger | 用户可解释一次 coding turn 的上下文与效果 |

## 批次交付规则

1. 一次只交付一个 Stage；上一 Stage 未 accepted，不启动下一 Stage。
2. 每个 Stage 先创建正式 harness spec，`context` + `validate` 通过后才写生产代码。
3. 每批开发日志必须追加到 `docs/dev/context-control-plane/DEVLOG.zh-CN.md`。
4. 产品锁 `defaultOn=false`、`liveReady=false`、`productApproved=false` 全程不变。
5. 不 commit、不 push、不建 PR，除非 owner 显式授权。

## 当前待办

- Stage 0 / Stage 1 / Stage 2 均已 `accept`（Stage 2 含密钥残留修复切片）。
- Stage 3 生产实现与独立验收修复切片均已完成；Stage 4 已启动并落盘生产代码/测试。
- Stage 4 已交付：统一 `CapabilityGrant/v1` 纯派生/衰减/撤销/重启失效语义、`Stage4GrantAuditTrail`、`stage4-tool-guard` 执行点接线、子 agent 扩权反例全失败。
- Stage 4 独立验收曾给出 `blocked`（L1：未校验 `approvalRow.state === execution_started`，且非法 identity/scope/policy/toolCallId 仍可产出 schema-invalid grant）；owner 授权修复切片已完成：补上 execution_started 闸门与 schema 约束校验，并把 parent-chain 校验扩展为完整祖先链（root 撤销后 grandchild 也 fail-closed）。相关测试与门禁已复跑。
- 修复后新会话独立 verifier 复检曾再次给出 `blocked`（L6：委托链非直接子节点的 issue/revoke 审计 actorChain 缺 root，非 root-first 全链）；owner 授权修复切片已完成：`deriveStage4CapabilityGrant` 的 actorChain 构建改为沿 resolver 上溯 root-first 全链，issue/revoke 审计与 verify/deny 路径一致，并新增深链审计测试；全部门禁 PASS。
- 2026-08-18 新会话独立 verifier 复跑 Stage 4 全部门禁与深链审计探针，L1–L9 全 PASS，**Stage 4 已 `accept`**。
- Stage 5–6 串行开发提示词已就绪：`STAGE5-6-SERIAL-DEV-PROMPT.zh-CN.md`（Stage 5 → Stage 6 一次交付、串行推进，内置防返工清单与开发端自验收流程）。
- Stage 5 串行开发切片已执行：`context-control-plane-stage5.md` 已存在并通过 harness context/validate；Memory Facade 与 unit-aware packer 已补 fail-closed schema 边界（非法工具名/namespace/candidate enum/evidence digest/unit kind/priority/id/sourceRef/重复 id/分数 token）。开发端自验收 L1–L6、L8 全 PASS。
- Stage 5 L7 key 切片已执行：owner 一次性 key 注入单个 golden-run 子进程；Stage 3 与 Stage 5 真实 DeepSeek golden-run 均 3 tests PASS；新增 `stage5-golden-run.ts/test.ts`（默认 off、runIf）与 `artifacts/context-control-plane/stage5-real-run-evidence.json`（仅 digest/ref）。
- Stage 5 L7 已按 owner 决策解除：本环境无真人验收通道，agent 执行的真实 provider golden run 作为 E4 来源；数值阈值延后到 Stage 6 后 soak/探索。Stage 5 开发端 L1–L8 全 PASS。
- Stage 6 已完成 spec-driven 开发、开发端自验收与独立 verifier 新会话验收（`accept`），并记录 2 项非阻断备注。
- 2026-08-18 owner 已将 2 项备注升格为阻断并要求处理：修复切片已完成（replay 投影改为 `snapshotId` + `planDigest`，移除误导性 `snapshotDigest`；reason/decision 枚举码全部接入四语 i18n 映射），等待复验通过后 Stage 6 正式关闭。
- Stage 6 修复后复验提示词已就绪：`STAGE6-REACCEPTANCE-PROMPT.zh-CN.md`（新会话/新 actor 只读复验，重点核对 2 项修复与 L1–L8 不回退）。
- Stage 5 L7 soak 收口提示词已就绪：`STAGE5-L7-SOAK-DEV-PROMPT.zh-CN.md`（启用条件：Stage 6 复验 accept + owner 提供 S1–S6；缺输入只建 spec `blockedBy` 并停止）。
- Stage 6 修复后复验已 `accept`。owner 已要求整体性判断本轮 DCS 优化计划是否具备真正 GA 条件；全量验收基准提示词已就绪：`DCS-GA-FULL-ACCEPTANCE-PROMPT.zh-CN.md`（Stage 0–6 全部门禁并集 + Stage 5 L7 soak + GA-wide 回归 + G0–G12 判定表；最终只产 `ga-ready/blocked`，真正 GA 仍需 owner 产品锁/发布决策）。
- 2026-08-19 Stage 5 L7 soak 已完成并通过：owner baseline S1–S6 冻结在 `context-control-plane-stage5-l7-soak.md`；真实 DeepSeek 10 组配对（20 个真实 provider turns）全部有效；critical/constraint/evidence 保留率 100%，P95 编译延迟 69ms（阈值 100ms），P95 单轮 663 tokens（阈值 4000）。证据：`artifacts/context-control-plane/stage5-l7-soak-evidence.json`。Stage 5 L7 正式由 deferred 转 PASS。
- Stage 7 及以后：范围未定义，owner 未授权时不创建 Stage 7 spec/提示词。
- 未 commit、未 push、未建 PR。
