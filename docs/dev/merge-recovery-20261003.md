# 2026-10-03 合并冲突恢复

driven_by: agent
actor: codex/root

本次处理 `d5541fd179f5cc9bf48727dd7fa3226be722e491` 与
`6fbaaf374737228a7927f5c8d42ddd7d2cd8c556` 已开始合并的 36 个冲突文件。
恢复备份位于仓库外 `../merge-recovery-20261003/`，包含本轮前索引、206 个工作文件、
所有冲突阶段字节与逐文件摘要；上轮产物清理备份也继续保留。

## 合并决定

- 知识治理 SQLite 表与 flow 索引同时保留；从 SQL 源重新生成 schema 模块并验证。
- 保留类型化知识引用、统一候选仲裁、总预算、工具循环终止观察器与 Stage 1/4 Tool Guard。
- 知识库保持 Library / Review Queue 主入口；生命周期操作可从 More 菜单打开。
  选择精确绑定 draftId、proposalId 和对应 ReviewBundle；缺 bundle 时不能应用。
  晚返回的准备提案或 steward 请求不能替换当前选中草稿。
- 保留 governed adapter 注册及显式 invoker 注入；普通生产构造重新绑定当前 gateway。
- 日志读取继续使用 logger 枚举出的精确文件允许列表，不扩大成任意目录内文件读取。
- 四语种翻译按共同基线逐键合并，保留 lifecycle、reviewQueue、knowledgeDenial、
  processPanel、runtimeApprovals 等两侧新增命名空间。
- RC-01 baseline 保留 stage 3 完整记录（两侧仅时间与 acceptedBaseSha 不同）；
  SEKB golden-path 保留 stage 2 完整记录，保持 deterministic principle ID / persisted
  投影结果一致。双方原始记录已外部归档，没有混拼轨迹 ID、时间戳或重签历史 verdict。
- Runtime STATUS 指向实际落盘的历史 verdict；其中 human 阶段记录明确为 agent 驱动。
  该记录不代表本次合并已验收，也不覆盖知识系统独立的工程历史。

## 失败修复与边界

- `verifyTf0009ClosureEvidence` 核验封存报告对应的 Git 对象、tree 和全部文件 hash；
  不再把当前分支祖先关系当作阅读另一个分支历史证据的条件。
  `canCloseTf0009` 仍检查祖先关系、当前源码一致性与完整证据，新增不相关 Git 根反例。
- UAS-06 单元测试改用跟踪的空观察模板 `tests/fixtures/uas-06-live-observations.json`。
  实际 evidence CLI 仍要求显式存在的实际输入，不把空测试模板当作 live 数据。
- 修复生命周期 E2E 的 Electron evaluate 参数位置、过期 proposal-only mock、
  token-usage mock 签名以及空返回值检查。
- 删除 `eventLog` 类型中无实现、且严格 schema 从未接受的误置 candidateGeneration 字段；
  实际 `memory.candidateGeneration` 字段保留。没有修改运行时默认值。
- VerseShell 二进制是构建依赖，不从源码测试中删去 hash 校验，也不把本机旧二进制
  复制为新验收证据。隔离检出使用固定工具链和对应源码重建。

验证日志、候选身份与最终结果写入外部恢复目录。全仓历史合并 diff 和本次冲突修复
diff 分别记录；不扩大 task ownedPaths 来掩盖无关改动。此次未发布或推送任何内容。
