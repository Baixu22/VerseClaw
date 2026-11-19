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
   Project RAG 经验候选需要 active confirmation 与正文相关性，固定 canonical ID 和内容版本；UI exposure 与 DCS retained-context exposure 分别记录。只有后者可进入同 run observed operation 的采用链；引用、运行结果和独立任务评分各自保留，删除传播覆盖展示及运行收据。
   原生 memory 文件与 Role Memory 卡使用各自领域、namespace 和精确 ID；raw 读取只由选中 provider 的安全读取完成，禁用或 Runtime Memory 诊断 slot 不读取前一 owner。引用与 prompt 准备重验当前版本、作用域、敏感性、retention 和 session generation。
9. 只有离线、版本化、固定数据与预算的策略晋级可以改变在线排序。attach/dismiss 或单次成功不能自动写回或调权。
10. 索引重建/撤销/删除/崩溃/模型更换/平台缺包的恢复与回滚是实现合同的一部分。普通 Chat 在总期限内继续，不能把退化结果标成完整成功。
11. 新增测试进入 requiredTests；plannedTests 必须实际实现。完成状态来自 clean candidate 的磁盘证据，保留 partial、unknown、未运行和失败。所有模拟与验收标为 agent 驱动。
12. Task Forest 维护实际进度与工作树绑定，源码 program 只保存稳定工作包合同，不保存第二套运行进度。每叶开始重新核对绑定和 diffBase。
13. DCS 按知识候选的准入 ordinal 保序，以 chunk/冲突组为完整预算单元。RetainedEvidenceManifest/v1 绑定实际 retained bytes；model-only QA 发送 owner pins，由相同的 DCS 路径装配正文。
14. 可选知识读取有本地取消和等待上限，响应绑定完整查询、会话、workspace、scope、mode 与 profile。Auto-read 只接受当前 confirmed 来源的唯一精确命中及内容证据，或有效校准结果；Used Knowledge 读取同一运行的最终 DCS 收据。普通排队发送保留引用与附件。
15. 检索与带 SourceRef pin 的原文检查直接读取当前 owner 字节，重验权限、revision、digest 和原文范围。导入及派生 Markdown 刷新由既有未固定来源的 owner 操作执行。
16. 默认检索方案、回答策略和索引发布空间预算由 owner 的严格配置解析；scope/mode 不双存。暂停意图存入既有 SQLite state，同一 owner 的重复启用保持暂停，撤权继续生效；恢复或未暂停启动时，过期或取消的未完成作业在新 owner 观察后重新调度，暂停扫描保持原 intent。chunk/FTS staging 提交后仍不可检索，激活事务重验 owner、lease 和包含元数据提交预留的空间预算；状态分别回读当前代际、索引滞后、逻辑删除、旧代际清理与真实磁盘占用。
17. 代码关系只接受显式 relationship/research 请求或 context_impact；默认一跳、最多两跳、32 个文件落点和 128 条边。每跳共用 512 条候选解析预算，边读取使用剩余预算加一检测裁剪；任何裁剪都传播为 partial/truncated。显式未知路径返回缺口，不以同名符号或活动文件替代。相对模块按真实路径解析，调用按 TypeScript 绑定解析，源与目标文件在末次异步 owner 校验后同步重验当前字节、版本和链接状态。任务 hint 只读当前 session generation 的既有绑定、合同 revision 和证据引用；合同或身份改变时丢弃结果，缺 Ledger 时返回明确缺口。
18. 多轮 Research 只由显式请求启动。开始前冻结同一 owner scope、30 秒总期限、3 轮/8 query/2 次规划、证据及关系预算；规划模型使用既有 Provider Spend owner 预留 token、费用和物理发送数。没有可预留费率的远端来源路径降级到本地并保留缺口。取消释放本地等待并终止迟到的模型 acceptance；结果交付复验当前 owner。覆盖和冲突引用只使用实际 DCS 保留的原文，预算丢弃后重新计算覆盖并清除依赖丢弃证据的推断。
19. 上下文增强关闭时，DCS 内部 Context Ladder 也停止 BlockStore 读取；配置与环境变量的关闭入口使用同一装配约束。
20. 规划模型接受后，等待连接错误或超时须向当前内部 session/run 发出 owner 取消请求，再释放本地监听；迟到接受回执继续执行取消补偿，未确认完成的 run 不能随本地降级而失去取消通路。
