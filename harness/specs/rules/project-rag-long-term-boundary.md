---
id: project-rag-long-term-boundary
title: Project RAG long-term owner, projection and evidence boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - project-rag-long-term-program
pathPatterns:
  - openclaw_runtime/src/knowledge/retrieval/**
  - openclaw_runtime/extensions/memory-wiki/**
  - electron/services/knowledge*.ts
  - shared/knowledge/**
requiredTests:
  - tests/unit/knowledge-source-set-answer.test.ts
  - tests/unit/knowledge-evidence-qa.test.ts
---

# Project RAG 长期合同

长期目标以 docs/dev/project-rag/program.v2.json 与 ADR v2 为实现合同。RAG-01 至 RAG-19 都是必交付，完成 FTS 或单个 profile 不能关闭长期目标。

1. 原文、版本、scope、权限和生命周期归 source owner；正式知识修改经过既有治理链。所有索引都是可重建 projection。
2. SourceRef 保留 namespace、source revision/digest、policy epoch 和 raw locator。读取 context 从可信 session/workspace 身份派生，renderer score/scope 不能授权。
3. SQLite 管理状态与 FTS/portable vector；经本 ADR 登记的 LanceDB ANN 只加速派生向量。依赖归 owner-side adapter，core 使用公开 seam；不启动 memory-lancedb 的 memory writer/autoRecall/autoCapture。
4. snippet、embedding、rerank、prompt 前都执行必要的 owner/effect egress 检查。本轮拒绝在 fallback 中仍然拒绝，旧索引/高分不能恢复权限。
5. source/chunk/projection digest 和 actual retained bytes 分开。DCS 保留最终准入、次序、原子装配和预算；没有 Main/renderer 私自拼接证据正文的旁路。
6. mode、profile、scope 独立；初始 none/suggest 与产品锁保持。新的用户可见功能必须可以通过正常 UI/Host API 启用并有 Electron E2E。
7. embedding space 绑定模型、维度、tokenizer、输入格式、normalization；cross-encoder score 与校准相关性、引用、语义支持不是同一个指标。
8. SEKB candidate 不进入 active retrieval；observed adoption 继续由既有同 run 事务验证。Memory、Code Graph、Task Ledger 保留独立 owner，Task Ledger 不写入长期 chunk store。
9. 只有离线、版本化、固定数据与预算的策略晋级可以改变在线排序。attach/dismiss 或单次成功不能自动写回或调权。
10. 索引重建/撤销/删除/崩溃/模型更换/平台缺包的恢复与回滚是实现合同的一部分。普通 Chat 在总期限内继续，不能把退化结果标成完整成功。
11. 新增测试进入 requiredTests；plannedTests 必须实际实现。完成状态来自 clean candidate 的磁盘证据，保留 partial、unknown、未运行和失败。所有模拟与验收标为 agent 驱动。
12. Task Forest 维护实际进度与工作树绑定，源码 program 只保存稳定工作包合同，不保存第二套运行进度。每叶开始重新核对绑定和 diffBase。
13. DCS 按知识候选的准入 ordinal 保序，以 chunk/冲突组为完整预算单元。RetainedEvidenceManifest/v1 绑定实际 retained bytes；model-only QA 发送 owner pins，由相同的 DCS 路径装配正文。
14. 可选知识读取有本地取消和等待上限，响应绑定完整查询、会话、workspace、scope、mode 与 profile。Auto-read 只接受当前 confirmed 来源的唯一精确命中及内容证据，或有效校准结果；Used Knowledge 读取同一运行的最终 DCS 收据。普通排队发送保留引用与附件。
