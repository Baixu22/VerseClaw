# Inline/Spill 第三轮输入修复与收益评测

driven_by: agent
actor: codex-inline-spill-benefit-r3

## 结论

decision.status = **mechanism-only**。第三轮输入边界已验证，但任务收益没有成立。recall-stable 证据任务 0/18，baseline 0/18，reference-visible 1/18，retention-off 0/18。原评分器 B3=true 仅来自一个控制任务配对（control-absent-2/2）；它不是证据还原收益，不能据此宣称 task-benefit-verified。

## 运行与范围

实测候选 491a957ad93e0c9f81d580e693de147d4e2cd49d，tree ef66954e73faacc5277186f54f0ea2cc0eee04ef，dirty=false。从 D:/tmp/inline-spill-benefit-r3/candidate 的干净副本运行；依赖复用现有 node_modules 和忽略的本地 runtime package dist，详见 provenance.json 与 checks/reused-package-builds.json。

deterministic=2026-11-04T09-10-06-349Z-deterministic，32条、80次脚本策略调用；live=2026-11-04T09-12-17-278Z-live，96条、360次实际 provider 调用，exit 0。live 为4臂×8任务×3次，六个证据任务和两个无证据控制，provider/model为原先的space-bunny端点。所有原始失败保留。

本轮只修评测：function_call_output 内容从当轮生产投影取得，正文不重复回读文本；两压力臂共享初始archive/session身份；mainContextChars按实际发送input JSON字符数计量，完整请求字符与UTF8字节另存。新增输入边界单测和规则。四臂开关、oracle/语料/压力、统计评分、B1–B7、900输出token预算及产品代码/默认值未改。

24对live首轮完整请求逐字节相同；564个协议输出与投影记录匹配，原始历史回退0、baseline oracle泄漏0、provider错误0。307次响应completed，53次incomplete全部注明max_output_tokens；已完成消息文本被适配器忽略的次数0。

## 冻结判据

| 判据 | 原评分结果 | 实际含义 |
|---|---|---|
| B1 | 通过 | recall-stable证据任务发起/成功回读均18/18 |
| B2 | 未通过 | 证据正确率差0个百分点，McNemar p=1 |
| B3 | true，需限定解释 | 正向配对1、反向0；唯一差异是无证据控制任务，证据任务两臂都0/18 |
| B4 | 未通过 | 0% < 5.56% − 5个百分点 |
| B5 | 未通过 | recall-stable控制5/6，另1次schema_invalid；不等同于出现了臆造私有值 |
| B6 | 未通过 | input字符差2492.167 <=16000；总token相对reference-visible增长59.6138% >25% |
| B7 | 通过 | 37/37文件哈希匹配，629个archive校验通过；请求/响应/输入计量与评分复算一致，凭证0命中 |

原始result/runs不重签、不回填。engineeringAcceptedByAgent/releaseApproved/liveReady/defaultOn仍false。

## 四臂指标

| 臂 | 证据成功 | 控制成功 | recall 发起 / 成功 | 平均 input / output / total token | 每运行 p50 / p95 ms | failureClasses |
|---|---:|---:|---:|---:|---:|---|
| baseline-no-reference | 0/6 | 2/2 | 0.00% / 0.00% | 0.000 / 0.000 / 0.000 | 0.004 / 0.008 | {"recall_not_attempted":6,"none":2} |
| reference-visible | 6/6 | 2/2 | 100.00% / 100.00% | 0.000 / 0.000 / 0.000 | 0.021 / 0.039 | {"none":8} |
| recall-stable | 6/6 | 2/2 | 100.00% / 100.00% | 0.000 / 0.000 / 0.000 | 0.024 / 0.040 | {"none":8} |
| retention-off | 2/6 | 2/2 | 100.00% / 100.00% | 0.000 / 0.000 / 0.000 | 0.032 / 0.043 | {"none":4,"recalled_text_evicted":4} |

deterministic的token=0为无provider usage，延迟为脚本策略计时，不证明模型自主性或真实成本；decision.status=inconclusive。

| 臂 | 证据成功 | 控制成功 | recall 发起 / 成功 | 平均 input / output / total token | 每运行 p50 / p95 ms | failureClasses |
|---|---:|---:|---:|---:|---:|---|
| baseline-no-reference | 0/18 | 5/6 | 100.00% / 0.00% | 3293.083 / 1134.292 / 4427.375 | 17331.325 / 26755.375 | {"answer_mismatch":15,"schema_invalid":4,"none":5} |
| reference-visible | 1/18 | 6/6 | 100.00% / 100.00% | 12136.667 / 1426.333 / 13563.000 | 22138.403 / 31033.832 | {"recalled_text_evicted":6,"schema_invalid":11,"none":7} |
| recall-stable | 0/18 | 5/6 | 100.00% / 100.00% | 19906.042 / 1742.375 / 21648.417 | 24056.561 / 36808.552 | {"schema_invalid":18,"recalled_text_evicted":1,"none":5} |
| retention-off | 0/18 | 4/6 | 100.00% / 100.00% | 18316.208 / 1587.917 / 19904.125 | 18658.105 / 32598.019 | {"schema_invalid":19,"recalled_text_evicted":1,"none":4} |

| 臂 | 总体通过 / Wilson95% | pass^3 证据任务 | 平均实际 input JSON 字符 |
|---|---:|---:|---:|
| baseline-no-reference | 5/24 / 9.24% – 40.47% | 0.00% | 2163.958 |
| reference-visible | 7/24 / 14.91% – 49.17% | 0.00% | 18386.750 |
| recall-stable | 5/24 / 9.24% – 40.47% | 0.00% | 48122.458 |
| retention-off | 4/24 / 6.68% – 35.85% | 0.00% | 45630.292 |

Wilson区间针对每臂24次总体通过率，包含控制任务；pass^3指六个证据任务中三次都通过的比例。延迟沿用冻结统计的每运行provider延迟之和；逐调用计时保留在runs.json。费用not-run，未提供费率/计费单位；不把token当作货币。

## 失败证据与下一步

schema_invalid=52、recalled_text_evicted=8、answer_mismatch=15。53个incomplete响应均因900输出token上限。三个有引用臂的120次回读原始结果超过本评测6000字符单条预算；recall-stable原始结果14次含oracle，下一请求中14次均已从投影消失。参数分布和逐次请求详见live/diagnostics.json与live/runs.json。

生产recall默认max_chars=12000，本评测单条投影预算6000，而自测显式请求5500。该差异和模型主动请求更大页是后续应处理的预算/工具说明适配问题。本轮保留这些默认值、压力和900预算，不为提高通过率改它们。

第二轮的47文件和旧机制105文件保持原样；第三轮修复后不能把第二轮带有原始历史旁路的成功率作严格因果比较，主上下文计量来源也已不同。结论只覆盖这套合成语料、该模型与该评测外循环；不覆盖Electron/Gateway完整回合、system prompt/bootstrap/审批或产品GA，不声称real-human。

## 命令与门禁

| 命令 | exit | 证据 |
|---|---:|---|
| 输入/评分单测 | 0 | 2文件，9 passed |
| retention/provider单测 | 0 | 2文件，39 passed |
| pnpm run typecheck | 0 | 未缓存node/web/tests，errorCount=0 |
| pnpm run contract:check | 0 | Contract check passed |
| 原工作树pnpm harness validate --spec round3 | 1 | 四个并行文件不属于本spec，原样保留，未扩宽ownership |
| 干净候选同一Harness CLI真实diffvalidate | 0 | 未使用--no-diff；harness-validate-candidate.stdout.txt |
| 干净候选deterministic --repeats 1 --max-turns 8 | 0 | 32条，四臂0/6、6/6、6/6、2/6，控制全过 |
| 干净候选live --repeats 3 --max-turns 8 | 0 | 96条/360次provider，子进程退出码记录 |
| verify-run（两个模式） | 0 | 输入计量、协议来源、raw usage、初始配对与统计全部复算 |

启动环境曾因忽略的normalization-core/dist缺失失败，补充本地现有package构建产物后重新执行。该环境失败不计为模型或代码验收证据。凭据通过关闭回显的启动终端输入，最终只进入子进程环境变量，不写文件/日志/快照。

## 原始产物与复算

每个模式的result.json/runs.json保留原始运行数据；providerCalls含实际request、SHA256、input/request字符与UTF8字节、投影输出、raw_response与usage。archives.jsonl.gz保留精确archive内容；live共525个、deterministic共104个。provenance绑定干净候选源码，SHA256SUMS覆盖全部保留文件，.gitattributes禁用换行转换。

```powershell
$env:TEMP='D:\tmp'; $env:TMP='D:\tmp'
$pack='C:/Users/27933/.codex/worktrees/context-inline-spill/ClawX/harness/specs/fixtures/context-inline-spill-benefit-round3'
node "$pack/verify-run.mjs" "$pack/deterministic" D:/tmp/inline-spill-r3-det-verify.json
node "$pack/verify-run.mjs" "$pack/live" D:/tmp/inline-spill-r3-live-verify.json
node "$pack/verify-evidence.mjs" "$pack"
```

TF-0755的收口以输入修复、完整实测和证据复验为准；TF-0749的任务收益验收保持未完成。Task Forest与会话交接只保留本地，不提交其历史数据；未push、未发布。
