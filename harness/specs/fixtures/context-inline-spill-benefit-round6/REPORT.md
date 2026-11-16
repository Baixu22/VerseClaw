# G7 Inline/Spill 第六轮收益复核（TF-0749）

判定：**no-benefit / NO_GO**。clean 实测候选为 `eb93671ab02bbae44b4e8981b3d68aeb3c98e438`，verifier 接受该候选并复算全部原始记录。TF-0749 未收口。

记录时间：2026-11-13 15:03:02 +08:00。`driven_by: agent`、`actor: codex-g7-inline-spill-tf0749-01a1d34c`、`realHumanEvidence: false`。

## 冻结设计与候选

设计提交 `ab8605136618bd021c1cf8772c18aac92dd83411` 先于候选提交；设计 SHA256 为 `74fa9962f10ad1af65a79569dc6c51f6c49757fb45835c2cc9f3c7174a853e6d`。
四臂、6 个证据任务、2 个控制任务、每臂每任务 3 次重复、900 输出 token、低推理、8 轮、5500 字符页与原 B1–B7 阈值已在开跑前固定。
三次重复沿用第五轮样本规模，用于逐任务复算 pass^k 与运行波动。
B2/B3 使用 18 个证据 fixture/repetition 配对，6 个控制配对单独报告。recall 策略、工具定义、原语料、投影、压力消息和生产默认值保持原样。
incomplete 保留全部 usage 并判该次运行失败；transport error 留在分母且不重试；8 轮耗尽仍有工具调用时记 loop_budget_exceeded。
原目标按 URI/checksum 与可选 byte_length 匹配，页覆盖和 content 中的原工具 oracle 命中单独统计，不代替最终精确 value 判分。

## 真实模型结果

共 `96` 次运行、`399` 次 provider 调用。响应状态为 `{"completed": 394, "transport-error": 5}`。

| 臂 | 证据正确 | 控制正确 | 平均总 token | 平均最终输入字符 |
|---|---:|---:|---:|---:|
| baseline-no-reference | 0/18 | 6/6 | 3221.38 | 1894.62 |
| reference-visible | 2/18 | 6/6 | 15705.88 | 18739.33 |
| recall-stable | 3/18 | 6/6 | 29492.92 | 56232.75 |
| retention-off | 0/18 | 6/6 | 30974.46 | 58627.71 |

| 门禁 | 结果 |
|---|---|
| B1 | 失败 |
| B2 | 失败 |
| B3 | 通过 |
| B4 | 通过 |
| B5 | 通过 |
| B6 | 失败 |
| B7 | 通过 |

B1 成功回读率为 17/18（94.44%），低于冻结的 95%；tenant-id 第一次重复在首个 provider 请求时发生 transport error，该失败保留。

B2 精确 McNemar p=`0.25`。
保留证据配对：正向 `3`、反向 `0`、双方通过 `0`、neither `15`。
稳定臂总 token 相对 reference-visible 增长 `87.78%`，冻结上限 `25%`；最终输入字符增量 `-2394.96`，上限 `16000`。
稳定臂归档选择：原目标 `52`、其他归档 `29`、原目标元数据不符 `0`、缺引用 `0`；原工具 content oracle 命中 `5`。
费用为 `not-run`：provider 未提供 billing rate/unit；原始 token usage 和缺 usage 调用分别保留。

## 字节与复算

verifier 校验 `12` 项 live 清单、`555` 个归档、全部请求/响应、模型工具调用、实际投影、最终答案、usage 及开跑/结束源码身份。
第五轮 `32` 份原始文件在 `round5-originals.jsonl.gz` 中按字节保留，原判定 mechanism-only/NO_GO、dirty=true 与 B7CleanCandidate=false 均保留。
开跑前第一次 deterministic 预检因 Git 换行过滤误拒，实际 provider 请求为 0；拒绝回执在 `prior-attempts/`。候选后续改为无过滤的实际 Git blob 字节校验，12 个冻结源码文件与已提交 blob 均一致。

deterministic 为 32 次脚本对照、104 个归档，stable 证据 6/6、retention-off 2/6；模式为 deterministic，判定 inconclusive/NO_GO。

复算需在实测候选的 clean 隔离检出执行：

```powershell
$env:TEMP='D:/tmp'
$env:TMP='D:/tmp'
node scripts/context-inline-spill-benefit-round6-verify.mjs '<live-evidence-directory>' 'D:/tmp/g7-replay-live.json'
```

实际 raw 目录为 `D:/tmp/g7-inline-spill-tf0749-20261113-01a1d34c/live/2026-11-13T06-18-10-544Z-live`；curated 副本在本报告旁的 `live/`。
`verification/verification-live.json` 为完整判定，`commands.json` 给出完整 argv、时间、源码身份、退出码及日志摘要；`artifact-provenance.json` 标记每份复制产物的 agent 来源和原始字节。

## 执行记录

| 命令回执 | 退出码 | 开跑 HEAD |
|---|---:|---|
| completion-probe | `0` | `eb93671ab` |
| context-round6 | `0` | `未在该预备回执记录` |
| contract-candidate | `0` | `eb93671ab` |
| contract | `0` | `1ad696a8f` |
| deterministic-raw-blobs | `0` | `eb93671ab` |
| deterministic | `1` | `1ad696a8f` |
| harness-ci | `1` | `eb93671ab` |
| harness-dry-run-candidate | `0` | `eb93671ab` |
| harness-dry-run | `0` | `1ad696a8f` |
| harness-validate-candidate | `0` | `eb93671ab` |
| harness-validate | `0` | `1ad696a8f` |
| live | `0` | `eb93671ab` |
| typecheck-candidate | `1` | `eb93671ab` |
| typecheck | `1` | `未在该预备回执记录` |
| unit-candidate | `0` | `eb93671ab` |
| unit-clean | `0` | `1ad696a8f` |
| unit | `0` | `未在该预备回执记录` |
| verify-deterministic | `0` | `eb93671ab` |
| verify-live | `0` | `eb93671ab` |

同候选定向测试 54/54、契约与定向 Harness 通过。完整 typecheck 因 `@verse-claw/versebrowser` 类型入口缺失而退出 1：node=2、web=0、tests=2，tests 记录 48 个错误。
完整 Harness CI 为 58/59，退出 1；`audit-wiring-quick-fixes.md`、`audit-wiring-remainder.md`、`committed-branch-integration-20261109.md` 缺少 lifecycleStatus。失败日志完整保留。

## Task Forest

本组检出没有历史任务图，base_graph_hash 未核对；未创建或应用收口提案。TF-0749 输入状态为 in_progress/80。
本轮收益门禁失败项为 `b1_mechanism_and_autonomy, b2_task_benefit, b6_budget`。生产 recall 默认值、产品锁与发布状态保持原样。

## 已提交变更

- `.gitattributes`
- `docs/context-family/goal-progress.md`
- `docs/modules/context-and-memory.md`
- `harness/specs/fixtures/context-inline-spill-benefit-round6/design.freeze.json`
- `harness/specs/fixtures/context-inline-spill-benefit-round6/round5-originals.jsonl.gz`
- `harness/specs/fixtures/context-inline-spill-benefit-round6/round5-preservation.json`
- `harness/specs/rules/inline-spill-eval-projected-input.md`
- `harness/specs/scenarios/context-family.md`
- `harness/specs/tasks/inline-spill-real-benefit-eval-round6.md`
- `scripts/context-inline-spill-benefit-loop-eval.mts`
- `scripts/context-inline-spill-benefit-round5-recompute.mjs`
- `scripts/context-inline-spill-benefit-round5-verify.mjs`
- `scripts/context-inline-spill-benefit-round6-verify.mjs`
- `tests/unit/context-inline-spill-benefit-clean-candidate.test.ts`
