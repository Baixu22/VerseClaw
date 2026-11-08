# Execution Registry 实现正确性 Review（修复后复核）

## 判定

本轮指出的 P1 和 P2 已在当前工作树中修复，并有对应回归覆盖。当前没有需要继续阻断候选固定的正确性 finding。

本报告只复核上一轮提出的问题及其修复。cleaning 不可执行、unknown merge 禁止 cleanup/重放、重复或畸形 registry 记录拒绝、UNC 归一均按已修复处理，不重新扩展审计。

## 确证修复

### P1：merge/freeze/cleanup 已使用 checkout generation 作为代次围栏

修复已在以下路径贯通：

- `OrchestrationWorktreeMergeWorker` 新增必填 `worktreeGeneration`。
- `subagent-registry.ts` 从 worker orchestration 元数据透传 generation；缺失值在 merge 入口被拒绝。
- `listChangedFiles` 接受并校验 expected generation。
- `enqueueMerge` 在锁内校验当前 record 与 generation，并把 generation 持久写入 queue item。
- `processMergeQueue` 再次比较持久 item 的 generation 与当前 record，旧代次转为冲突，不复制新实例内容。
- `freezeOrchestrationWorktreeCandidate` 比较原 worker generation，并调用相同 generation 的 isolation inspection。
- `subagent-registry-lifecycle.ts` 的 cleanup 传入 generation；`cleanupOwned` 也按原 record generation 执行 cleanup。

回归 `orchestration-worktree-merge.test.ts` 明确覆盖同 id 清理后重建，并断言旧 merge、freeze 和 cleanup 均被 `stale_generation` 拒绝，新实例文件保持存在。该修复关闭上一轮 P1。

### P2：registered 恢复门与 Git/common-dir 身份

`observeWorktree` 对已经记录 `rootIdentity` 和 `nativeIdentity` 的记录会比较目录实例与 native binding；`worktreeNativeIdentity` 已纳入：

- `.git` 文件/Git private dir 身份；
- private dir 的 `gitdir` back-pointer；
- private dir 的 `commondir` 指针。

新增回归 `rejects a changed Git binding before promoting registered to ready` 在 registered 阶段替换 `.git` 指向另一 worktree，重启重试被拒绝，状态保持 `registered`，没有升级为 ready。该修复关闭上一轮 P2 的恢复门缺口。

### P2：注册只提供路由，不授予写资格

`execution-domain-registry.md` 已明确：

- 本叶只暴露 authority resolution；
- 现有 task execution 不自动切换数据库；
- joint admission 与 environment migration 必须在联合消费任务凭据和 checkout incarnation 后才启用跨 clone execution；
- enrollment 不授予 execution。

因此 `taskAuthority=registered` 只表示任务域路由结果，writer 资格仍需后续联合准入。该合同已在 guide 中登记，关闭上一轮的资格语义提示。

## 后续合同提示

以下不是本叶 finding，也不是固定候选的阻断项：

- 后续 admission 叶仍应把 task claim、session generation、checkout incarnation 和资源容量一起验证。
- host 或 migration 接入时，不得把 `registered` 直接映射成可写状态。
- 联合验收应保留“旧 writer 请求针对同 id 新 checkout 被拒绝”的跨层场景。

## 已关闭的先前事项

- cleaning 状态不可执行；
- unknown merge 禁止 cleanup 与自动重放；
- 重复或畸形 registry record 拒绝；
- UNC 路径归一；
- 28 核心 + 24 owner 回归，以及 node/web/test typecheck、contract、comms、lint 已通过。

## 结论

上一轮 P1/P2 均已由代码路径和定向回归确证修复。未发现新的同范围 P1/P2；可以固定当前候选并继续后续联合准入，不需要新增本轮审查范围。
