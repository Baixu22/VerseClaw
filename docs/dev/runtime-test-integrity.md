# Runtime 测试入口与类型门修复（TF-0253）

本轮以 `codex-tf0253` 执行，`driven_by: agent`。修复对象是当前工作树的测试契约与测试入口，不改变产品锁、默认值或发布状态。

## 改动

- 测试夹具使用当前的消息、上下文引擎、Mission、流结果及生命周期契约；从类型所有者导入类型，补齐必填字段，先收窄联合类型再读取属性。异常输入用独立对象注入，保持错误拒绝断言。
- extensions 测试项目与 core 测试项目一样启用 `allowJs`，让导入的 JS 辅助模块参与类型推导。没有删除 include、增加 exclude、引入 `any` 或添加错误抑制。
- 补齐 `scripts/test-projects.mjs`，复用现有 Vitest 项目矩阵与 run-vitest 的进程清理、调度和看门狗。默认执行单次 run，显式 watch 仍保持 watch。
- 显式目标转为真实绝对路径，配置读取时转回仓库相对路径。这样各项目的 `test.dir` 不再把仓库根路径过滤掉，Windows junction 下也使用同一个真实路径。
- 收尾审查补齐：保留调用者的显式配置，频道契约脚本使用原生项目选择；执行前在隔离子进程中核对实际项目选择，混合漏跑请求直接失败。预检使用锁定版本 Vitest 的参数归一化，保留测试进程环境、依赖定位、自定义 reporter 与 watch 行为。
- 实际回归发现知识适配器的两处私有 memory-wiki 导入；改经插件 `runtime-api.ts` 导出同一实现，保留导入边界断言。Wiki 生命周期回归从这个公开入口读取页面与解析配置。

## 验证方式

在仓库根执行四个非增量类型门：

```powershell
pnpm --dir openclaw_runtime exec tsgo --noEmit -p test/tsconfig/tsconfig.core.test.json --incremental false
pnpm --dir openclaw_runtime exec tsgo --noEmit -p test/tsconfig/tsconfig.extensions.test.json --incremental false
pnpm --dir openclaw_runtime exec tsgo --noEmit -p tsconfig.core.json --incremental false
pnpm --dir openclaw_runtime exec tsgo --noEmit -p tsconfig.extensions.json --incremental false
```

在 `openclaw_runtime` 执行跨项目测试；长回归同时使用进度与 JSON reporter，保留既有无输出看门狗：

```powershell
node scripts/run-vitest.mjs run src/context-engine/source-set.test.ts extensions/memory-core/src/memory/manager-reindex-state.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=../.local/tf0253/example.json
```

以 JSON 的 `testResults[].name` 和 `assertionResults` 核对请求文件集合和用例数，不能仅凭 exit 0 判定目标全部运行。首次路径复现确实出现“请求两文件、只执行一文件”；该失败证据保留。只开 JSON reporter 的 34 文件首轮因 120 秒无输出被看门狗终止，未把缺失 JSON 当作通过，也未修改超时阈值。

本轮命令退出码、实际测试文件数、类型检查、运行时构建和局限以 `artifacts/runtime-test-integrity/report.json` 为准；原始日志与收据保存在 `.local/tf0253/`。历史收尾审计中的失败数字保持历史记录。

开发阶段复验曾为 35 文件、208 passed；2026-10-05 收尾在干净候选上重新执行为 **35 文件、210 passed / 0 failed / 0 skipped**。四个非增量类型门、runtime 构建与 Gateway 启动冒烟、comms replay/compare、差异感知 Harness validate/dry-run 均 exit 0。缺失文件、零选择及部分漏跑反例均 exit 1；显式配置、分片相对路径、目录/契约项目选择和混合行号过滤验证通过。最终 autoreview 无剩余发现。早先失败证据保留。

R4 的干净候选条件已补齐：继承基线单独提交，TF-0253 改动独立提交，源码候选为 `b1a67d01d8eb07764ee9fa4a1c3842395a4e3e22`，验证前后工作树均干净。候选与最终证据保存在本地验收分支，主工作树原有未提交工作保持不动，不代表这些继承依赖已经合并到主线或发布。

全仓 `harness:ci` 已执行，但最终 Agent Dev audit 因继承的 Workbench/quality/deep-test 证据早于相关源码而 exit 1。该残余单独保留，不通过改时间戳、忽略项或阈值隐藏；TF-0253 的三个验收条款均有本轮候选证据，收口不等于全仓 CI 或发布验收通过。

已复核 README 中、英、日版本：根 `pnpm test` 仍不代表全部 runtime 测试；根 typecheck 与 runtime 独立测试类型门仍明确区分，无需改变现有说明。未运行全量 Electron、安装器或付费模型验收。

## 主线整合补记（2026-10-05）

以上为原干净候选的验收记录。主线 `377267294` 已整合修复；在 `55a33921e` 上重新比对原报告的 40 个源码 SHA-256，全部一致。整合时遗漏了三份最终证据的 Git 跟踪，本次将原验收提交 `d4bac9bbb` 中的 `report.json`、`credential-scan.json` 和 `SHA256SUMS` 原字节纳入主线，并为保留检查添加明确输入。没有改写其候选身份、时间或历史 verdict。

当前环境的重新验收又发现 5 条生产声明类型诊断，已通过显式 Mock 签名、私有 rollback symbol 类型及 secrets 配置适配器返回类型修复。三个模块的转译 JavaScript 前后逐字节一致；没有关闭 declaration、排除源码或暴露内部 rollback symbol。另修复了 RC-03 网络替身和 KS-05 正向轨迹夹具的契约漂移，保留生产传输及来源校验。新一轮整体结果单独记录，不将原候选的局部通过升级为当前全系统验收。
