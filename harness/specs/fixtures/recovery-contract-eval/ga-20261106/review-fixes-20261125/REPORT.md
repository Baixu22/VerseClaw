# G3 恢复缺陷修复验证

源码提交 4b90116de89a5df6e8730340ddb124be81f407c9，基线 24f0606de91fc2560284860e169a219ef3df9c33。全部验证由 agent 执行。

- G3-REV-01：子代理续跑继承持久恢复次数。间隔超过两分钟的连续恢复从 1,1,1,1 改为 1,2 后拒绝第 3 次；压缩保留次数，普通会话换代重新计数。
- G3-REV-02：global 续跑及失败通知携带存储所属 agent；实际生命周期入口接受对应的持久 admission。
- G3-REV-03：按存储路径、会话键、物理代次去重。两个 agent 的 global 首轮由恢复 1 个改为恢复 2 个，同代次重试跳过，新代次可恢复。

9 文件 135 项相关恢复测试通过；最终两个修改文件再跑 59 项通过（计入前述 135 项）。
完整 Node/Web/Test 无缓存类型通过，33.585 秒；Runtime 修改文件及其依赖类型通过。
5 文件严格静态检查零告警，通信回放及比较通过。目标 Harness 以本次基线检查真实差异通过，residual 为既有 AGENTS.md 修改。

真实子进程/Session SQLite 验证通过：消费 2 次准入，效果 1 次，重复准入 0；并发竞争只准入 1 个，退出后存活自有子进程 0。

全仓 harness:ci 的 5 文件 59 项基础测试及前段规则检查通过，随后在 agent-dev:audit 返回 1：旧 Workbench/deep-test/quality 证据超过 24 小时窗口，且历史 deep-test 有 unit/typecheck/contract 超限。原始结果完整保留。

本轮完成三处 bug 修复。新候选的生产构建、Electron 恢复矩阵、live-provider 对照及完整源码/打包验收待执行；G3 整体 GA 仍为 NO_GO。

report.json 记录源码 SHA256、对照结果和检查状态；evidence.json.gz 保存 46 份原始证据及逐文件 SHA256/base64。解压后核对每个文件 SHA256，并核对 sourceFiles 与源码提交即可复核。复用此工作树已安装依赖。

复现与测试命令：

~~~powershell
node scripts/run-vitest.mjs src/agents/main-session-restart-recovery.flow.test.ts src/agents/subagent-orphan-recovery.admission.test.ts --maxWorkers=1 --no-file-parallelism
node scripts/typecheck-agent-dev.mjs --no-cache
$env:TSX_TSCONFIG_PATH = '<repo>/openclaw_runtime/tsconfig.json'
node scripts/recovery-owner-process-proof.mjs --out '<fresh-proof-output>'
pnpm run comms:replay
pnpm run comms:compare
pnpm harness validate --spec harness/specs/tasks/recovery-authority-gated.md --since 24f0606de91fc2560284860e169a219ef3df9c33
~~~

第一条在 openclaw_runtime 目录执行，其余在仓库根目录执行。临时目录使用 D:/tmp。
