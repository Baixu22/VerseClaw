U2/TF-0658 AC9 容量原因窄补丁已收束。候选定向单测 **15 通过、0 失败、19 项因筛选未执行**；原实现的原因透传回归 1 败。补丁在当前 **44ece6fafab9bf46ef61a1fb76092a6c78fc408f** 上通过 git apply --check，尚未应用。

driven_by: agent；actor: codex-u2-capacity；requested model route: ccs-workbuddy/deepseek-v4.1-flash。实际模型未经工具确认。仅写本暂存目录，未改源/main/TF，未运行 Electron/build/install。

**集成产物**

- [capacity-reasons.patch](D:/tmp/unified-management-20261109/u2-capacity-proof/capacity-reasons.patch)：以局部 diff 集成，包含下列 14 个路径。
- [manifest.json](D:/tmp/unified-management-20261109/u2-capacity-proof/manifest.json)：原基线、当前可应用 HEAD、源/候选/证据文件 SHA256 和验证范围。
- [Electron 容量候选](D:/tmp/unified-management-20261109/u2-capacity-proof/tests/e2e/session-delegation-capacity.spec.ts)：1 条场景，121 行。

| 路径 | 改动 |
| --- | --- |
| openclaw_runtime/src/agents/orchestrator-run-observed.ts | 仅将 result.executionWaves 类型保留为 ScheduledOrchestrationWave[]，避免类型层抹去既有原因字段。 |
| openclaw_runtime/src/agents/long-session-delegation-receipt.ts | 原样透传 reason，复制 deferredReasons；不新增调度逻辑。shared receipt 类型已支持这些字段，无需改动。 |
| src/components/chat/SessionDelegationStatus.tsx | 同 workspace/session/generation 的 receipt 展示“派发时的安排与原因”；当前队列仅取同 scope/generation 且 availability 有效的 snapshot，worker 等待仅取明确 yielded 状态。 |
| src/components/file-preview/WorkspaceAgentsPanel.tsx、WorkspaceSubagentPanel.tsx | 通过 onOpenResources 回调导航现有 Storage route，不用 DOM 查找或全局事件。 |
| shared/i18n/locales/{en,zh,ja,ru}/chat.json | 仅新增 delegationStages.capacity，保留现有 projectEntry.unbound 及其他字段。 |
| tests/unit/long-session-delegation-admission.test.ts、session-delegation-status.test.tsx | scheduler→receipt 透传及数组隔离、旧计划不冒充实时队列、scope/generation 拒绝、当前 queue/worker、查看回调。 |
| tests/unit/workspace-agents-panel-failure.test.tsx、session-chain-panels.test.tsx | 为消费者新增 useNavigate 提供 MemoryRouter；原有业务断言保留。 |
| tests/e2e/session-delegation-capacity.spec.ts | 真实 scheduler/receipt builder 生成容量安排，通过明确标记的 Host fixture 投递，验证 UI 原因、当前 queue=0 和 Storage 查看动作。 |

**能力与证据**

- receipt 中的 concurrency-cap 是派发时的安排原因；不使用 receipt.metrics.queued 断言当前等待，也不从计划推断 worker 正在排队。
- 当前 workspaces panel union 没有 resource 类型，复用 /settings/storage?workspaceId=…&sessionKey=…。Storage 目前是总览，不消费这些参数自动筛选；按钮提供查看会话/资源占用入口，不直接释放资源或恢复任务。
- SubagentPanel 没有持久 admission receipt 输入，本补丁在那里展示现有 owner 的当前等待和查看动作，不虚构历史计划。
- Electron 候选使用两个只读任务节点和 cap=1 调用生产 scheduler，再用生产 receipt builder 包装 fixture spawn outcomes。它证明原因投影与导航；没有启动真实 worker、耗尽 OS 容量或证明实时 scheduler 恢复。产物明确记录 transport=Host fixture、liveCapacityExhaustion=false。
- 任务 acceptance 仍 unavailable，未实施 U4 验收。

[baseline.tests.json](D:/tmp/unified-management-20261109/u2-capacity-proof/baseline.tests.json) 保留 1 项失败；[candidate.tests.json](D:/tmp/unified-management-20261109/u2-capacity-proof/candidate.tests.json) 为 15/0/19。候选转译语法错误为 0，四语 14 个新增叶子键和插值参数一致。完整类型检查及真实 Electron 尚未运行。此前组合命令的退出码 1 来自 git diff --no-index 检测到差异；单独执行 git apply --check 返回 0，没有 patch 格式失败。

**主 agent 集成与运行**

只应用 patch；暂存的整文件用于审阅，不要覆盖源文件。以下命令留给主 agent 在当前 family/视觉回归结束后执行，本轮未执行：

~~~powershell
& 'D:/software/PowerShell/pwsh-7.6.6/pwsh.exe' -NoLogo -NoProfile -Command {
  Set-Location -LiteralPath 'D:/ClawX-work/session-task-unified-relay-20261109'
  $env:TEMP='D:/tmp'
  $env:TMP='D:/tmp'
  git apply --check 'D:/tmp/unified-management-20261109/u2-capacity-proof/capacity-reasons.patch'
  if ($LASTEXITCODE -ne 0) { throw 'Capacity patch context changed' }
  git apply 'D:/tmp/unified-management-20261109/u2-capacity-proof/capacity-reasons.patch'
}
~~~

完整类型/相关单元验证由主 agent 随集成执行。构建包含本补丁后，单独运行该 Electron 候选：

~~~powershell
& 'D:/software/PowerShell/pwsh-7.6.6/pwsh.exe' -NoLogo -NoProfile -Command {
  Set-Location -LiteralPath 'D:/ClawX-work/session-task-unified-relay-20261109'
  $env:TEMP='D:/tmp'
  $env:TMP='D:/tmp'
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME='D:/tmp/unified-management-20261109/u2-capacity-proof/e2e-results/tests.json'
  pnpm exec playwright test tests/e2e/session-delegation-capacity.spec.ts --workers=1 --retries=0 --reporter=list,json --output=D:/tmp/unified-management-20261109/u2-capacity-proof/e2e-results
}
~~~

运行后回读 u2-capacity.json、capacity-receipt-plan.png、route 和测试结果；当前没有生成这些 Electron 成功证据。用户告知 U2 五核心 E2E 已通过、family 规模/视觉回归正在执行，此状态保持原来源，不合并计入本容量候选结果。
