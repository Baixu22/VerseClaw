U2 parent status 补丁候选已完成：**原源码聚焦回归 1 败，候选最终定向 23/23 通过。** 补丁未应用到仓库，尚未重跑真实 Electron。

driven_by: agent；actor: codex-u2-parent-status；requested model route: ccs-workbuddy/deepseek-v4.1-flash，实际模型未经工具确认。源工作树 D:/ClawX-work/session-task-unified-relay-20261109，起始 HEAD=0ed2befe7，交付观察 HEAD=3061befc753dd7ce1a5bce42a9309d81cf02789b；三个补丁目标文件在此期间未变，SHA256 见 manifest.json。

**根因及证据。**

- 已有 Electron 失败：u2-navigation-red-results 下 u2-background.json 显示父行连续 15 秒 running；provider 只回复 U2_PARENT_READY，successRequested/failureRequested 都为 0。失败发生在新增第三个 child、hover 监测之前，后续 AC4 断言尚未执行。
- [Sidebar.tsx:225](D:/ClawX-work/session-task-unified-relay-20261109/src/components/layout/Sidebar.tsx:225) 将 session.hasActiveRun=true/status=running 无条件排在最新 terminal 前。[chat.ts:2998](D:/ClawX-work/session-task-unified-relay-20261109/src/stores/chat.ts:2998) 把 sessions.list 的活动快照缓存进 sessions；[chat.ts:5224](D:/ClawX-work/session-task-unified-relay-20261109/src/stores/chat.ts:5224) 消费 run.ended 时更新 runtimeRuns 和当前 activeRunId/sending，却不清除 sessions 快照。故运行期间取得的旧 list 可持续盖过已完成回执，等待更久本身不能消除此状态。
- 相关优先级还包含两个具体问题：runHasWaitingApproval 未排除已结束运行；buildLatestRuntimeRunBySession 按最后事件时间选运行，使旧 run 的迟到 terminal 可能盖过已经开始的新 run。
- 原 Electron 产物未记录 renderer store 原值，不能据此认定当时究竟是 hasActiveRun、session.status 还是残留 activeRunId 单独命中。新增回归使用真实 handleRuntimeEvent 重现了“本地 activeRunId 已清、sessions.hasActiveRun 仍 true、DOM 仍 running”，原源码确实失败。

**最小改动。**

1. Sidebar 仅在 session.updatedAt 不晚于最新 terminal.endedAt 时忽略旧 session 活动投影；时间不明或较新的 backend running 仍保留。
2. 匹配同一已结束 runId 的残留当前标志不能复活该 run；不同 activeRunId、新的发送意图 lastUserMessageAt、尚未获 runId 的发送仍优先。旧 terminal 不会直接改写 store。
3. 只有仍为 running 的运行才参与 approval waiting；结束后的旧 approval 不继续显示等待。
4. 同会话两条运行都有可靠且不同的 startedAt 时，运行索引按启动先后选择；缺少此信息时保留原 activity 比较。迟到旧 terminal 不再抢占已知较新的后台 run。

写集只有两个生产文件和一条既有测试内新增用例：

- [src/components/layout/Sidebar.tsx](D:/tmp/unified-management-20261109/u2-parent-status/src/components/layout/Sidebar.tsx)
- [src/components/layout/session-buckets.ts](D:/tmp/unified-management-20261109/u2-parent-status/src/components/layout/session-buckets.ts)
- [tests/unit/sidebar-render-containment.test.tsx](D:/tmp/unified-management-20261109/u2-parent-status/tests/unit/sidebar-render-containment.test.tsx)
- [parent-status.patch](D:/tmp/unified-management-20261109/u2-parent-status/parent-status.patch)：建议集成此窄 diff，避免整文件覆盖后续并发工作。

没有修改 chat.ts，也没有触及主 agent 负责的 reading/sticky/Chat/index/SessionFolderTree 文件。

**验证读回。**

| 产物 | 实际结果 |
| --- | --- |
| baseline-final.tests.json | 新用例 1 败，22 项因 -t 未执行；expected completed、received running。 |
| candidate-final.tests.json | sidebar-render-containment + sidebar-session-buckets 两组共 23/23，通过，0 failed、0 pending。 |
| git apply --check | 对交付时源文件通过；仅检查，未应用。 |
| manifest.json | 三文件源/候选 SHA256 与语法检查；transpile 语法错误 0。 |

新用例连续验证：旧 running 投影→真实 run.ended→completed；迟到旧 list 不复活；较新 backend running 保持；pre-ack 新发送保持；run-2 已开始时 run-1 迟到 terminal 不夺位；切到后台后 run-2 仍优先；run-2 完成后旧 approval/同 run 残留标志不复活。

本次使用目录内 review.vitest.config.mts 的内存加载覆盖读取候选，源树未落补丁。首次配置启动因 __dirname 未定义失败，第二次因 runner 加载 CJS 的 require 未定义失败；日志 baseline.log、baseline2.log 保留，修正只在本输出目录。baseline3/candidate 是中间验证记录，最终以 baseline-final/candidate-final 为准。jsdom 有既有 canvas getContext 提示，未安装 canvas。未跑全量类型检查、Electron 或 build。

主 agent 集成后运行命令（当前已完成 source-read-only 的临时覆盖验证）：

~~~powershell
& 'D:/software/PowerShell/pwsh-7.6.6/pwsh.exe' -NoLogo -NoProfile -Command {
  Set-Location -LiteralPath 'D:/ClawX-work/session-task-unified-relay-20261109'
  $env:TEMP='D:/tmp'
  $env:TMP='D:/tmp'
  git apply --check 'D:/tmp/unified-management-20261109/u2-parent-status/parent-status.patch'
  # 经主 agent 集成补丁后：
  pnpm exec vitest run tests/unit/sidebar-render-containment.test.tsx tests/unit/sidebar-session-buckets.test.ts --maxWorkers=1 --no-file-parallelism
}
~~~

下一步复用原 session-task-reading-navigation.spec.ts 的 background 用例做 Electron 复验。父状态断言通过后才继续统计 child 新增/失败/完成与 hover 结果；此次 23 项单测不补记那些尚未执行的 Electron 断言。
