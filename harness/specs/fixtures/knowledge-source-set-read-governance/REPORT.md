# 知识库来源准入收口（2026-11-05）

driven_by: agent · actor: codex-knowledge-convergence · realHumanEvidence: false

源码候选：509eb6f3bfd3b8c987e21e64ec701a8aaf1161e0。本轮交付 TF-0796，父目标 TF-0792；七项评测缺口已经按三个阶段整理，后六项尚未完成。

词法、可选语义与 Studio 共用现有 SourceSet 来源准入。保留来源状态、revision、摘要、ACL、敏感性、workspace scope、读取范围与已提供的结构化冲突；拒绝的来源不再回填，不进入 embedding 或草稿。当前响应为 partial 摘录，不给固定正确率；置信度行从知识助手中移除。Studio 只保存已准入引用和 evidence，不能用客户端 metadata 升级状态。

验证：186 项测试全部通过（知识库 96、SourceSet 引擎 19、Host facade/invoke 63、Host client 8）；一个 Electron 场景通过、0 skip、0 retry、0 遗留进程、源码未被 E2E 修改。完整 node/web/test 类型、契约、构建、通讯回放/比较及 Harness 校验通过。Harness dry-run 只证明配置选择，未执行全仓 fast suite。

基线四项反例均先复现失败；最终结果见 evidence.json 与原始报告。Electron 早期启动 EPERM 属完整性级别不匹配：小配置目录采用 Windows 已有 LocalLow，所有大产物仍在 D 盘。同一源码最终通过，早期失败 trace 和日志保留在本轮 D 盘运行目录。

仍未验证：模型综合与追问、无结构文本语义矛盾、目录同步、中文长文、Steward 质量、外部持续连接、长期收益。仍沿用首次 80 行读取与最多 20 来源报告；没有扩张为整套知识库验收或发布结论。

下一可执行任务：TF-0797，修目录事件丢失及文件增删改/重启补扫。Task Forest 状态、提案与交接留在本地；规范、源码和本精选结果同分支保存。

额外全仓归档检查 exit 1：八个基线已跟踪的 RSI 日志同时匹配 ignore 规则，路径和原始输出保存在 repository-retention.txt。该残差不来自知识库改动，未删除或改写其证据。

Studio 草稿固定记录 driven_by=agent、actor=knowledge-source-set；客户端伪造真人归属的反例通过。该最后一项修复后重新执行 96 专项、完整类型、构建、通讯和同一 Electron 场景，最终源码候选已绑定。
