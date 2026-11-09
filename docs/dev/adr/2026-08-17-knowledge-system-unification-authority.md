# ADR-2026-08-17：统一知识系统权威与契约冻结

| 字段 | 值 |
|---|---|
| 状态 | `accepted`（本工作树开发基准；产品锁仍为 false） |
| 实现状态 | `verified`（KS-00～KS-03 已通过独立验收；产品锁仍为 false） |
| 日期 | 2026-08-17 |
| 分支 | `codex/knowledge-system-unification-plan` |
| 基线 | `734ec877e75682861103660fbdea2bd55253ece0` |
| 范围 | Knowledge Hub、Role Memory、SEKB、DCS experience Block、Session delete cascade、GovernanceStore、Owner Adapters |
| 关联文档 | `docs/dev/knowledge-system-unification/README.md`、`docs/dev/knowledge-system-unification/WORK-PACKAGES.md`、`docs/dev/unified-agent-system/runtime-convergence/README.md`、`docs/dev/adr/2026-08-16-context-authority-boundaries.md` |

---

## 1. 背景

统一知识系统开发规划（KS-00..KS-09）要求在实现前消除文档、Task Forest、代码与 dirty WIP 的冲突。本文冻结权威矩阵、状态源和 schema，供 KS-01..KS-03 实施引用。

## 2. 决策

### 2.1 Canonical owner 矩阵

| 对象 | Canonical owner | 唯一写入入口 | 读取/投影入口 |
|---|---|---|---|
| WikiPage | memory-wiki | approved Wiki mutation adapter（本计划 KS-03 注册） | Wiki ContextSourceAdapter |
| GovernanceCandidate/Proposal | GovernanceStore（openclaw-state SQLite，KS-03） | candidate producer / reviewer | Knowledge Hub read model |
| MemoryCard | active memory slot = Role Memory | approved Memory mutation adapter | Memory ContextSourceAdapter |
| ExperiencePrinciple | SEKB `sekb_principles` | confirm effect only | SEKB ContextSourceAdapter |
| Task Context | Task Context Ledger | task/user/tool versioned update | Ledger ContextSourceAdapter |
| Context Block | DCS BlockStore | ProjectionAdapter | DCS tools/assembler |
| CompilationSnapshot/PromptPlan | DCS | compile transaction | receipt/debugger |
| RequestEnvelope | Provider Guard | sealed provider adapter | wire receipt |
| EffectReceipt | existing effect boundary | domain executor | audit/feedback |
| Session identity/transcript | OpenClaw session authority | session runtime | source refs/archive |

### 2.2 冻结 artifact schema

冻结七类 artifact：`ContextRef/v1`、`GovernanceProposal/v1`、`CompilationSnapshot`、`PromptPlan`、`RequestEnvelope`、`CapabilityGrant`、`EffectReceipt`。`ContextRef` 不保存正文；DCS 经 owner adapter materialize。

### 2.3 Governance JSON 迁移裁决

- KS-01 在 JSON governance 上补 atomic/CAS、单写队列、revision、operation journal。
- KS-03 将 Inbox/Draft/Proposal metadata 单事务迁入 `openclaw-state.sqlite` 的 `knowledge_*` 表；导入保留原 ID、captureKey、timestamps、source refs；旧 JSON 转为只读 compat，明确移除窗口为一个 release。
- 禁止长期 dual-write；禁止新增 DB/sidecar/provider authority。

### 2.4 runtime-convergence 状态裁决

`runtime-convergence/README.md` 的 `done`（user-accepted）作为历史 runtime-convergence program 的拟议状态裁决；`STATUS.md` 的当前 WIP 正在向 `done`、`human_verdict=accepted` 对齐。Task Forest 不应因此强制关闭全局父节点 `TF-0010`：统一知识系统仍是该全局目标下的新 follow-up milestone。拟议变更是在 `TF-0010` 下新增“统一知识系统生命周期”milestone、挂载 KS-00～KS-09，并让该 milestone `contributes_to TF-0038`；全部变更仍必须通过 proposal-save、用户确认和 proposal-apply，当前不得写成已应用。milestone 只分组任务，不成为运行时 authority。该裁决不解除 `live_ready=false`、`product_approved=false`、`default_on=false` 产品锁。

## 3. 当前实现边界

2026-11-09 的 [Project RAG 裁决](2026-11-09-project-rag-retrieval-plane.md) 选择在既有共享 SQLite 内增加可重建的 Wiki chunk/FTS 投影。正文、版本和读取政策仍归 owner，最终上下文仍归 DCS；该决策未实施新检索能力，也不改变本 ADR 的唯一写入入口。旧任务的 no-new-store 保留其历史验收含义。

- `routeContext` 仍未默认接入 SEKB；Runtime Lessons 只在显式 `sourcePolicy.runtimeLessons` 开启时参与候选，并保留结构化 provenance。
- SourceSet 语义通道仍为显式 opt-in；未配置真实 embedding provider 或调用失败时保留 lexical fallback。
- `wiki_apply` 对普通 agent 默认不注册，只有显式配置 `tools.allowAgentApply` 时才暴露。

## 4. 后果

- KS-01 错配/并发/孤儿状态为 0。
- KS-02 假成功/重复写/删除残留为 0。
- KS-03 JSON governance writer 为 0，active memory writer 仍为 1。
- ADR 的 `accepted` 只冻结开发边界；每个 KS 包仍需独立 Harness、测试和证据裁决。
