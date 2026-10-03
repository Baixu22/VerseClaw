# 源码保留与本地归档

## 保留边界

Task Forest、会话交接、研究逐轮记录、生成截图和一次性探针是本地开发历史，不是应用源码。取消跟踪不会删除本机副本，也不会抹掉 Git 历史、其他分支或远端对象。

精确边界见 `scripts/repository-artifacts.json`。用 `node scripts/check-repository-artifacts.mjs` 检查本地文件是否仍被跟踪、必要输入是否缺失或被忽略，以及退休测试是否仍被默认发现或显式门禁调用。不要对 `artifacts/`、`docs/dev/`、`plans/`、`tests/`、`scripts/` 整目录取消跟踪。

继续保留：

- 产品实现、行为/安全/完整性回归、fixtures、构建和合规输入。
- `plans/system-maturity/` 的门禁、安全、隐私和发布配置，以及当前 `P6-005` 结果。
- RC-01 baseline、RC-09 ownership 与 canonical manifest/final report、能力声明表和当前最终验收证据。
- Agent Dev 的必需证据、DCS 固定语料与 ground truth、展示中实际被驱动读取的 workload。
- 正式架构、默认值矩阵、冻结决定、runbook 与有效 Harness 规则。
- `team/dcs/` 的当前规范及仍有外部调度引用的 wiring 脚本、完成标记。文件归档不等于停用调度，本次没有修改外部自动化。
- `.mcp.json` 使用环境变量注入的可移植服务声明；没有本机绝对路径或内嵌凭据，不能仅因审计候选标签就删除。

## 已核实的本地化范围

- `.agent-workbench/task-forest/` 全部管理状态、提案和历史。
- `runtime-research/` 与 `docs/dev/handoffs/`。当前运行时边界提炼到 `runtime-research-boundaries.md`；产品 worker handoff 实现及测试不是开发交接，不在此范围。
- `artifacts/runtime-utf8-recovery/`、两份 `P6-005.prev-*` / `P6-005.stale-*` 旧副本、Task Forest landing/remaining-node 审计输出、`e2e-monitor/` 续跑输出。
- `reports/visual-tune/`、`reports/ui-review/`、`reports/assets/`、`.design-staging/verse-hero/`。保留生成这些输出的 E2E 源码，正式产品展示图仍在原资源目录。
- 独立 `prototypes/`、`hello-world/` 实验、`.parity-audit/`、本机 Task Forest 补丁副本与 `WORKTREE.md`。
- 审计明确列出的 16 个一次性脚本/输入，逐项列于保留清单。不要为了验证归档而运行旧封存/压缩/重建脚本。

`docs/dev/context-moat/`、`docs/superpowers/`、`team/dcs/` 和混合用途的其他 evidence 仍保留。候选清单不是删除白名单；尚未迁移有效依赖的内容继续跟踪。

## 稳定测试与驱动

RC-10 的 `driver.mjs`、`operator-driver.mjs`、`irc-server.mjs` 和声明文件移到 `scripts/rc10/`。当前 package 命令、单元、集成和 Electron 测试只引用新路径；原验收证据的候选身份和哈希不变。

四份只校验历史 Markdown/提示词的测试离开 `tests/unit/`，保存在私有归档的 `retired-tests/`：

- `runtime-ast-edit-plan-narrow-evaluation-decision-gate.test.ts`
- `runtime-ast-patch-planner-route-correction.test.ts`
- `runtime-controlled-runtime-use-acceptance-decision.test.ts`
- `runtime-controlled-runtime-use-pilot-readiness.test.ts`

相关显式 `requiredTests` 改为保留的行为回归。混合测试只拆出对本地历史状态/措辞的依赖，不移除 AgentMap opt-in、fail-closed、泄漏、执行权威、证据 hash 或生命周期校验。历史 RC 映射使用带来源身份的小 fixture，而不是开发者当前任务图。

UAS-00 冻结命令是显式历史回放工具，必须指定历史根和独立输出；普通检出不生成任务图来满足旧断言。UAS-06 的来源输入使用跟踪的稳定规范，不读取本地 LATEST。旧 manifest/verdict 不被重签为本次清理的通过证据。

## 2026-10-03 归档与恢复

本次从正在合并的工作区保存了全部 20,967 个索引路径对应的工作字节与所有索引版本；包括 57 个冲突的 base/ours/theirs。外部归档目录为仓库同级的 `repository-artifact-cleanup-20261003/`，不纳入 Git。

归档内容：

- `backup-manifest.json`：每个文件 SHA-256、Git stage/blob、原始 HEAD/MERGE_HEAD、索引与状态哈希。
- `worktree-before.zip`：清理前工作树原字节，包括冲突标记。
- `index-blobs-before.zip` 与 `index-stage.before.z`：所有暂存版本及冲突各方，不只记录 OID。
- `index.before` 和 merge 元数据：供专业恢复用；不要在后续已有工作时直接覆盖现有索引。
- `task-forest-branches/`：两条原始提交的独立 Task Forest/交接归档与恢复目录。
- `untracking-manifest.json`：实际取消跟踪的精确清单和恢复身份。
- `recover.py`：只解压到尚不存在的仓库外目录，不覆盖当前工作树或 Git 索引。

例如，在原工作区运行下列命令，将 ours 的 config 恢复到一个新的外部目录：

```sh
python ../repository-artifact-cleanup-20261003/recover.py \
  --destination ../recovered-task-forest-config \
  --path .agent-workbench/task-forest/config.json --version ours
```

`--version worktree` 恢复清理前工作字节；`base`、`ours`、`theirs` 恢复冲突阶段，`stage0` 恢复普通暂存内容。`--prefix` 可选择整组历史。备份必须在恢复前通过其 SHA-256 与 Git blob 校验；不要自动执行恢复的历史脚本。

若私有归档不在本机，也可从原始提交恢复已提交历史：HEAD 为 `d5541fd179f5cc9bf48727dd7fa3226be722e491`，MERGE_HEAD 为 `6fbaaf374737228a7927f5c8d42ddd7d2cd8c556`。提交不含未提交工作字节，不能替代完整外部备份。

### Task Forest 不是已完成的语义合并

两侧 `TF-0070..TF-0080` 共 11 个编号用于不同任务，`TFE-0128..TFE-0149` 共 22 个边编号也碰撞；`TF-0010`、`TF-0026`、`TF-0038` 有不同历史变更。较新图不是较旧知识系统历史的可靠替代。

所以原冲突工作文件保持本地，两侧按各自来源单独保存。没有盲选一侧、重编号、改状态或宣称旧节点重新验收通过。取消跟踪只解除源码对管理数据的依赖，不代表任务历史语义已合并。恢复副本是归档，不是另一个活跃任务真源。

## 验证口径

清理要在仅含保留源码和本次修改的隔离目录中验证，不复制本机忽略的任务图、研究目录或旧截图。允许复用已安装依赖，但必须说明这不是全新安装验证。

原工作区尚有产品、翻译、基线和 README 合并冲突。任何由这些冲突造成的构建或测试失败必须保留并报告；不得删除测试、扩大忽略规则、用旧候选 verdict 或局部测试绿色替代整体验收。本次不提交合并、不推送、不删除远端分支、不改写历史，不改变任何产品默认值或发布范围。
