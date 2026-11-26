# A1：统一跨会话身份和活动读取合同

TF-0919 的四项验收已通过。实现候选 `4dc12b110521ed89a74150ead1332151e1f3bde9`，实施前 diffBase 为 `cfa2ac31794d9014645d250811a523e06a619143`。

`hostApi.sessionActivity.read` 携带显式 workspace/project/sessionKey/generation，并可固定 Workspace binding revision 与执行域引用。Runtime 从原 SessionStore、运行 registry、执行域和 TaskSystem 回读；Main 核对 Workspace owner。每个来源区分 ready、empty、not_read、unavailable、stale、unknown。读取保持 Task claim、会话、配置及资源 owner 状态，reset 丢弃旧关联。

133 项定向回归通过，其中 A1 新增 20 项；Main/Web/Test 无缓存类型、contract、comms replay/compare、定向 lint、仓库留存和 A1 Harness validate/dry-run 通过。Harness 的真实 diff 包含 15 个变更文件。通信回放覆盖六份固定数据集，比较结果 PASS。

正向场景使用原 SQLite SessionStore/TaskSystem、原运行 registry 和原生 Git；Main Workspace 与 Gateway 传输由 fixture adapter 驱动。全部证据标 `driven_by: agent`。三个会话分别返回原范围和 ScopedRun；子代理保持原任务的只读引用。`owner-readbacks.json` 的读前读后 owner 内容及数据库哈希相同；拒绝、未知与 reset 回执一并保留。

全量 `harness:ci` 的前置 59 项测试通过，随后在既有重复截图检查中止。两张截图自实施前基线即为相同 Git blob，路径与哈希见 `report.json.baselineCi`。初次依赖启动失败、fixture 初始化失败及这次 CI 失败均保留在 `D:/tmp/session-collaboration-A1-20261124`，恢复索引见 `raw-index.json`。

`python harness/specs/fixtures/session-collaboration-center/A1/verify.py` 回读候选源码、四项验收、检查结果、原 owner 状态和全部精选产物哈希。Task Forest 的提案与完整历史导出保持在 `D:/ClawX/.agent-workbench/task-forest`。

A2 承接 TF-0920，先从 guide 建立窄规格并固定新的 diffBase，再扩展既有 sessions_list 与只读 session_status，提供有界发现、字段选择和详情入口。
