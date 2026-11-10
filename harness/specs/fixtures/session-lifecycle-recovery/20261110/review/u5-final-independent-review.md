driven_by: agent  
actor: u5-final-independent-review  
requested_route: ccs-workbuddy/deepseek-v4.1-flash  
backend_identity: not_verified  
date: 2026-11-10  
source: D:/ClawX-work/session-task-unified-relay-20261109  
base: c308b60e1e8dc6849628c524ff8d8e1f0ce0a522  
reviewed_head: aff9e651a12c5bd90acc30712df8e86ec246a143

**发现 1 处 U5/AC8 阻断：UI 清理原生 detached worktree 时漏掉原 Git owner 的提交保留检查。** R1–R4、generation fence/CAS 和最新项目菜单接线的所查调用链没有发现其他确定阻断。新 commit2、StorageUI 本轮不作完成判断。

**P1 · 无产品 owner 的 clean detached worktree 可绕过独有提交保护。**

精确入口是 [task-system-service.ts:46](/D:/ClawX-work/session-task-unified-relay-20261109/electron/services/task-system-service.ts:46)：managed registry、writer、Workspace/VG/Task authority 都不占有目标且 Task DB 不存在时，直接 `return { blocked:false, identity }`。该 identity 由 Git admin backlink、common-dir 和目录实例生成，不含 HEAD 的持久引用保留事实。

两条产品删除路由都使用此放行结果：

- [git-api.ts:819](/D:/ClawX-work/session-task-unified-relay-20261109/electron/services/git-api.ts:819) 审批前后调用 inspector，随后 [worktreeRemove:1858](/D:/ClawX-work/session-task-unified-relay-20261109/electron/services/git-api.ts:1858) 执行 `git worktree remove -- target`。调用者是 WorkspaceGitPanel 的移除按钮。
- [session-storage-api.ts:172](/D:/ClawX-work/session-task-unified-relay-20261109/electron/services/session-storage-api.ts:172) 审批前后再次检查 inspector/inventory，最后 [185 行](/D:/ClawX-work/session-task-unified-relay-20261109/electron/services/session-storage-api.ts:185) 同样直接 remove。StorageSection 对 clean、未关联 worktree 不禁用此入口。

触发条件：原生 linked worktree 未登记为 managed、没有 Task/Workspace/writer 引用；在该检出上 detach 并提交一笔仅由它的 HEAD 可达的新 commit，工作区 clean，`git for-each-ref --contains=<HEAD> refs/` 为空。当前 inspector 放行；`--force` 缺省只保留 Git 的 dirty/submodule 等拒绝，不能代替提交引用检查。本机 Git 文档 `C:/Program Files/Git/mingw64/share/doc/git-doc/git-worktree.html:599` 的 remove 条件也是 clean worktree。移除后失去该独有 commit 的 worktree HEAD/本地 reflog，并未由本流程建立持久恢复 ref；对象未必立即消失，但不满足 AC8 的“保留或明确阻止回收”。

原保护已存在于 [worktree-service.ts:342](/D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/worktree-service.ts:342) 的 `assertCleanupCommitRetained`，并在 managed cleanup:793 调用。它使用原 Git `for-each-ref --contains`，排除 worktree-local refs。UI 原生删除分支没有调用它。现有 `checkout-writer-ownership.test.ts` 覆盖的是 managed detached；`ui-worktree-cleanup-conservative.test.ts:78` 的允许删除样例是具名分支，不能覆盖本分支。

最小候选补丁已暂存：[native-worktree-commit-retention.patch](/D:/tmp/unified-management-20261109/u5-final-independent-review-suggestion/native-worktree-commit-retention.patch)。仅三处：

1. 导出既有 `assertCleanupCommitRetained`，入参收窄为 `{backend,root,baseRoot}`，算法保持原样。
2. `inspectUiWorktreeRemoval` 在无 Task DB 的最终放行前复用此检查，失败返回现有 UI_CLEANUP 保护通道。两个入口已有审批前后复查，因此均覆盖，不改审批或默认值。
3. 在原 conservative unit 中对 git/storage 各加一例：clean detached 独有 commit 拒绝，文件保留；通过原 Git 建立 shared branch 后允许删除，并从该 branch 回读原文件。该候选未运行。

补丁 SHA-256：`0c548fa0e4d8dfb3fb50fc31443a47379188eea9cedb635f7564bb070ae8959e`。语法及 aff9e651a 暂存基线/当前源树 `git apply --check --whitespace=error` 均通过，见 [validation.json](/D:/tmp/unified-management-20261109/u5-final-independent-review-suggestion/validation.json)。主 agent 合入后可串行执行：

```powershell
$env:TEMP = 'D:/tmp'
$env:TMP = 'D:/tmp'
git -C D:/ClawX-work/session-task-unified-relay-20261109 apply --check D:/tmp/unified-management-20261109/u5-final-independent-review-suggestion/native-worktree-commit-retention.patch
# 导入候选后：
node node_modules/vitest/vitest.mjs run tests/unit/ui-worktree-cleanup-conservative.test.ts tests/unit/checkout-writer-ownership.test.ts --maxWorkers=1
```

本次定向复核的其余结果：

| 对象 | 当前实现/测试核对 |
| --- | --- |
| R1 晚到回包 | delete/archive 在 store 内捕获 generation/visit，变化后只刷新；restore/permanentDelete 按原 archivedAt + transcriptPath 移除目标记录。原 scope unit 覆盖恢复新代次与后来 archive 记录。 |
| R2 Main 尾部 | 三动作沿原 gate ID、per-session 锁执行 Runtime receipt→coordinator/resource tail→clear；failed/unknown 留 gate。完成位与部分资源回执持久化；null 不进入普通 delete 去重。原 tail unit 覆盖重试、progress/clear 失败、missing scope、晚到 port；browser adapter 源码已严格匹配 workspace。 |
| R3 / R4 | `stopConfirmed` 为清缓存前置；切走后的 false 保留源缓存。归档读取在发起与落地核对 agent，pending/archived 渲染过滤 agent，finally 按当前 scope 刷新。scope unit 有对应反例。 |
| generation | 可选 expectedSessionId 从 Host 到 schema/handler 保留；range pin、compaction 外层 CAS、内层 snapshot.sessionId CAS、global agentId 透传与 restore journal UUID 校验仍在。fork/store/fence 路径未见同 store queue 重入或重复申请同代次 admission。 |
| 保守清理范围 | managed checkout、writer、Task authority、Workspace/migration 引用、VG owner 均转原 owner；原生检出审批绑定 native identity，路径复用/审批后状态变化重新拒绝。具体缺口仅为上述原生 commit retention。 |
| Welcome/Header 项目菜单 | [WelcomeProjectPicker:118](/D:/ClawX-work/session-task-unified-relay-20261109/src/components/chat/WelcomeProjectPicker.tsx:118)、[ProjectSessionHeader:544](/D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/index.tsx:544) 均在父菜单打开后挂载同一 picker；共用原 `handleSwitchWorktreeWorkspace` 保存草稿和 workspace 切换。 |
| ComposerPopover inline | inline 跳过锚点绝对定位，使用父菜单内 relative 布局及滚动；closed 阶段仍 inert。父 WorkspacePickerMenu/Welcome menu 有 overflow-y:auto，未发现嵌入后必然不可达的源码路径。StorageUI 新运行结果另行验收。 |

验证状态：本次已从磁盘回读最新 `u5-context-owner2.tests.json` 43/43、`u5-storage-owner.tests.json` 85/85、`u5-lifecycle-tail.tests.json` 41/41、`u5-lifecycle-scope-final.tests.json` 25/25、`u5-task-transaction.tests.json` 7/7、`u5-host-forward.tests.json` 48/48 均 success:true。context 首轮 `u5-context-owner.tests.json` 的 7 passed/36 failed 保留为历史失败；不替代 owner2，也不重标为通过。上述文件均位于 `D:/tmp/unified-management-20261109/lifecycle-validation/`。

context-ui8 manual/range、checkpoint 专项、Stop/coordinator、archive 同 ID 与四语通过，沿用主 agent 已回读记录；本轮没有重复运行。真实 commit2 和新 StorageUI 在本次交接中仍为运行中，未纳入全绿结论。两个原上下文 RPC 未注册仍归相邻 owner，U4 继续由专责会话处理。

本 sidecar 只写报告和暂存候选，产品源码/main/TF 未改；动态 unit、Electron、build、install 均未执行。
