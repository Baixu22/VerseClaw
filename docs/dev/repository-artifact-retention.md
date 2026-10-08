# 源码保留与本地产物

## 新检出应该包含什么

保留产品实现、回归测试、固定 fixtures、构建与合规输入、有效 Harness 契约、
架构与默认值决定、当前 runbook，以及支持产品声明的精选最终验收结果。
文档入口见 [开发文档](../README.md)。不以“文件无人链接”作为删除依据：
测试 glob、动态加载、哈希 manifest 和门禁配置同样构成真实依赖。

开发者的任务图、逐轮规划、审计草稿、一次性脚本、原始跑次日志、截图试拍、
重复打包的展示目录不属于源码。保留本地副本，但不随默认 clone 出现。
不要用清理改动改写旧 verdict、候选 SHA、哈希或产品默认值。

## 默认本地化，显式保留

唯一机器清单是 `scripts/repository-artifacts.json`：

- `reviewedDirectories` 覆盖 docs、artifacts、reports、plans、team。
- `retainedFiles` 逐文件列出已审查的源码、固定输入和最终证据；目录存在不代表新文件自动获准入库。
- `localOnlyDirectories/localOnlyFiles` 禁止任务图、交接、审计工作区、设计暂存和已退休探针重新入库。
- `requiredInputs` 对关键输入另设不可遗漏检查；测试退休名单独立管理。

`.gitignore` 的 reviewed 区块由该清单生成。新增持久文档或精选证据时，先说明其
读者/消费者、来源和必要性，再将精确文件名加入清单，执行：

```sh
pnpm repo:artifacts:check --write-ignore
pnpm repo:artifacts:check
```

门禁检查强制加入索引的清单外文件、丢失的保留输入、ignore 漂移和已退休测试。
PR 的 Check and Build 在安装依赖前直接执行它。不能用 `git add -f` 绕过边界。

新跑次复用 `artifacts/runs/<run-id>/` 等被忽略的输出目录，不另建需要跟踪的过程目录。
旧工具仍可在原输出路径本地运行，不为统一名字重构所有驱动。
可复用驱动放 scripts/tests；一次性分析器放本地 .audit 或仓库外。

## 为什么仍保留一些看起来像产物的文件

- `plans/system-maturity/` 是执行门禁与安全/隐私/发布配置；其任务、delivery 和哈希证据被 validator 动态读取。
- `artifacts/system-maturity/` 的保留文件支持当前配置的验收与可追溯检查；旧 PR-FULL、RESEAL、P0/P1 全量跑次不再跟踪。
- RC 的 canonical manifest、final report、正式 acceptance 包和 RC-01 baseline 是验证输入；dev-check/operator-dev 等过程复本不是。
- Agent Dev 证据、DCS 语料、ground truth、当前验收报告与 credential scan 支持复现或产品声明。
- 展示 journey 原件仍在 `artifacts/live-model-cdp/`；`node scripts/build-showcase-package.mjs` 可重建被忽略的展示包，无需在源码中保存第二份。
- team 仅保留当前 DCS 1.6 规范及 1.6.1 补充、仍被运行时引用的角色记忆设计。
- Harness 规则、场景和任务契约继续保留；历史任务的 docs 输入改指持久文档，不再要求开发日志。

保留清单不是旧审计通过状态的再认证，也不表示所有历史证据对应当前 HEAD。
源码清理不改变任何产品锁或默认值，不声称真人验收。

## 归档与恢复

取消跟踪前，必须在仓库外保存完整 Git 基线、精确路径清单、工作字节与 SHA-256；
若有暂存修改或冲突，另存索引各 stage。取消跟踪使用精确清单，不重建整个索引。
本地副本不删除，原始工作区的无关修改不混入清理提交。

历史文档和临时产物也可以从其最后保留的 Git 提交读取：

```sh
git log --all -- path/to/archived-file
git show <last-retained-commit>:path/to/archived-file
```

普通取消跟踪不抹掉历史、其他分支、tag 或远端对象。不为缩小历史下载体积执行
force push、历史重写或批量删分支。外部归档和本次审计明细不再提交回仓库。

验证必须在仅含保留源码的独立检出运行；可以明确复用依赖，但不能读取忽略区的旧产物蒙混通过。
