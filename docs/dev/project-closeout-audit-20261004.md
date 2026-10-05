# 2026-10-04 项目收尾审计

本轮由 `codex-closeout-audit` 执行，`driven_by: agent`。基线为 `cafe03a5939beac5c3e4e47ef78e8d5f88f86386` 加启动时已有未提交改动；没有发布、修改产品锁或声称真人验收。

结论：发现并修复了可复现的假阳性门禁、生产类型错误和两项结构化文档问题，**仍不能判定全项目无问题或发布就绪**。Task Forest 历史 done、过去的安装包、绿色局部测试都不能替代当前候选验收。

## 已修复

| 问题 | 复现与修复 | 证据 |
| --- | --- | --- |
| 类型门禁假阳性 | 测试中实际制造 TS2322，旧 `pnpm run typecheck` 仍 exit 0；现在 node/web/tests 任一失败均使总门禁失败，并扩大缓存输入到测试及 runtime 依赖。 | `tests/unit/typecheck-gate.test.ts`；本地 `typecheck-gate-red.log` / `typecheck-gate-green.log` |
| runtime 生产编译错误 | 非增量 core 类型检查原有 6 条诊断，修复事件契约重复定义、工具调用联合类型未收窄、readonly evidence 修改及多余字段。修复后 exit 0。 | `runtime-core-types.log` / `runtime-core-types-fixed-result.json` |
| junction 越界 | 正式 SDK 读入口能经工作区内 junction 读取外部哨兵文件。复用既有 symlink guard，拒绝读、覆盖、创建和回滚中的重定向；允许可信工作区根目录为 junction。 | `functional-probes.json`；`structured-artifacts.seam.test.ts` |
| PPTX 静默丢记录 | 4 条记录只生成 3 页，第四条内容不在输出中。保留三页模板，超过容量时明确拒绝；Markdown 完整保留记录。 | `functional-probes.json`；`render.test.ts` |

所有路径边界测试均使用 agent 自建临时目录与哨兵数据，不读取用户的工作区外文件。现有回归验证固定链接和写入前复查，不构成恶意并发替换文件系统对象的完整竞态证明。

## 仍存在的问题

1. **runtime 测试类型检查仍失败。** 修复生产错误后 `test/tsconfig/tsconfig.core.test.json` 仍有 60 条诊断，分布在 28 个测试文件。包括失配的测试替身、过期字段/枚举、未收窄的联合类型。独立补跑 `tsconfig.extensions.test.json` 另有 18 条诊断，主要是测试使用的 JS 模块缺少声明；两门含重叠位置，不将 60+18 当成去重错误数。生产 core 和 extensions 类型检查均通过。原 `check:test-types` 会在 core test 失败后跳过 extensions test，不能称其全量通过。
2. **runtime 默认测试入口不完整。** `scripts/run-vitest.mjs` 的默认路由引用不存在的 `scripts/test-projects.mjs`，执行 exit 1。指定既有分片能执行专项，但必须使用该分片的相对路径并核对实际文件数；一次 unit 分片只执行了 source-set 的 17 项，不能算请求的 4 文件全部通过。
3. **CVK 的执行阻断尚未接通。** `verifyCvkToolCallSelectors` 在当前生产调用点只向 `toolGateDiagnostics` 提供 diagnostics；`engine.ts` 组装 `systemPromptAddition`，没有把 `denied` 送入工具执行拒绝路径。与 `plans/system-maturity/phase2-authorization-isolation/tasks/P2-005.md` 的 Partial / blocked 一致。
4. **长 PPTX 功能仍有限。** 大于三条记录现在安全拒绝，不代表实现了任意页数；长文本视觉排版、完整字段保真尚未验收。PPTX 的 `validationStatus` 仍为 `not-run`，不会伪装成视觉检查通过。
5. **发布证据仍不完整。** 本轮未执行全量 Electron、交互安装及新 NSIS 发布包验证；旧安装包不能覆盖本轮源码。P6-005 仍为 in_progress。两个依赖模型凭据的 golden-run 专项跳过，不能算真实模型链路验证。
6. **lint 已无余量。** 本轮 `lint:check` exit 0，但 ESLint 为 0 errors / 120 warnings，刚好到现有 120 上限；保留阈值，没有扩大忽略或提高上限。

## 证据位置与验证边界

本轮全量 `pnpm test` exit 0：六段合计 **8035 passed / 50 skipped / 0 failed**，耗时 681561 ms。runtime 构建、Gateway 启动冒烟、Vite/Electron 构建通过。Agent Dev 完整 deep-test 的 11 门通过，其中单元 87/87、Electron 4/4；严格 audit 为 96 分，只代表 Agent Dev 范围。

专项：类型门禁反例先失败后通过；SourceSet 17/17；三个 agents 文件 7 passed / 2 skipped；VerseConf 5 文件 14/14；回滚前路径复查追加后 commit-owner 3/3；Artifact Panel Electron 5/5。两个跳过项是需模型凭据的 golden-run。

Harness task 规范的必填字段已补齐。最终 diff-aware 校验仍因原有 VerseConf/vendor/打包等范围外工作区改动 exit 1；没有使用 `--no-diff`、通配 residual 或提高阈值掩盖失败。这个工作区尚不是隔离且干净的验收候选。

刷新 origin 后，Task Forest `check-landing` exit 1，列出 47 项历史分支/落库对账问题。它们是仓库级待复核记录，不能直接当作 47 个当前功能缺陷；本轮没有合并或删除这些分支。

本轮原始命令、退出码、JSON 测试收据和反例均在 `.local/closeout-audit-20261004/`。启动改动保存在 `initial-status.txt` / `initial.patch`；被重新生成的原有 Agent Dev 证据保存在 `before-generated/`。

最终命令矩阵、实际测试数量和源码摘要见 `artifacts/project-closeout-20261004/report.json`。其 `gates` 只记录本轮执行，不引用旧次数充当当前通过。缺失报告、非零退出和跳过均单独保留。

本轮功能修复沿用当前权限、写日志与模板，没有修改默认值、产品锁或既有历史验收 verdict。README 四语已同步根类型门禁含义；完整验收前不应将此报告表述为全系统 GA。

已应用本地提案 `TFP-project-closeout-audit-20261004`，新增 **TF-0253：修复 runtime 测试类型错误与缺失的测试入口**，状态 ready。Task Forest validate 通过并已重新导出；该提案记录了剩余缺口，没有关闭尚未通过的验收。代码尚未提交。
