# Inline/Spill 第五轮真实任务收益对照

driven_by: agent  
actor: codex/windows-inline-closeout  
realHumanEvidence: false

## 结果

本轮执行 `96` 次真实模型运行，产生 `438` 次 provider 调用；`436` 次 completed，`0` 次 incomplete，保留 `2` 次 transport error。源码为 `6eee064950273b393240a647702d6ee5652bae35`，复算工具为 `811bdab408bef0dacd894a1e1b5cc6421523fef2`。

判定为 **mechanism-only / NO_GO**：B1、B5 通过，B2、B3、B4、B6 失败。`TF-0749` 的真实任务收益未成立。

| 臂 | 证据成功率 | 控制成功率 | 每任务平均 total tokens | p95 运行延迟 |
|---|---:|---:|---:|---:|
| baseline-no-reference | 0/18 | 5/6 | 3,128.21 | 34.411 s |
| reference-visible | 3/18 | 6/6 | 19,329.79 | 66.796 s |
| recall-stable | 0/18 | 6/6 | 37,669.21 | 46.539 s |
| retention-off | 1/18 | 6/6 | 34,750.04 | 55.127 s |

稳定臂总 token 相对参考臂增长 `94.88%`，超出 B6 的 `25%` 上限。证据保留配对为正向 `0`、反向 `1`；B3 没有通过。控制任务在稳定臂全部返回 `null`，满足 B5。

## 设计与实际行为

- 保留第四轮的 8 个任务、四臂、每任务三次、相同压力、输入投影、900 输出 token 上限和 B1–B7 阈值。
- 实际请求显式固定 `reasoning: {effort: "low", summary: "auto"}`。probe 已完成有效 JSON，输出 9 token，其中 reasoning 为 0。
- 全部 `24` 对 stable/off 初始请求字节一致。生产投影、工具参数、原始结果和逐调用响应均保留在 `live/runs.json`。
- 稳定臂 98 次模型回读中，48 次选择原始目标归档、50 次选择其他归档。原始工具结果命中 oracle 的次数为 0，因此 18 个证据样本均没有正确最终答案。
- 1 次页调用超过既定 6000 字符投影预算，结果长度为 6072；缺失/无效页参数为 5 次，均保留 `invalid_arguments` 诊断。
- 缺费率或计费单位，成本状态为 `not-run`；实际 usage 与延迟见 `result.json`、`outcome.json`。

## deterministic 与证据完整性

32 次 deterministic 自测中 baseline 证据 `0/6`、stable `6/6`、reference-visible `6/6`、retention-off `2/6`，控制全过。该脚本策略仅验证工具与投影，不是模型自主性证据。

`live/archives.jsonl.gz` 保留 `667` 个原始归档，`deterministic/archives.jsonl.gz` 保留 `104` 个。每份归档的原始字节、sha256、handle checksum 与 byteLength 可由复验器读取。`credential-scan.json` 和全包扫描要求零命中。

运行期间提交了已经完成的评测源码，同时另一主线的 spec 处于修改状态，因此 `result.json` 如实保留 `dirty: true`。这是本轮候选身份限制，未改写为 false。原始记录可复算，复算工具返回 B1–B7 与上述一致；原第四轮 verifier 的 clean-candidate 断言拒绝该标记，失败也保留，不能据此声称 B7 全项通过。

## 复跑与复核

```powershell
$env:TEMP='D:/tmp';$env:TMP='D:/tmp'
node openclaw_runtime/node_modules/tsx/dist/cli.mjs scripts/context-inline-spill-benefit-loop-eval.mts --mode deterministic --out D:/tmp/context-inline-spill-r5-replay --repeats 1 --max-turns 8
# live 需要进程环境注入已授权 provider 凭据，不写入此目录。
node openclaw_runtime/node_modules/tsx/dist/cli.mjs scripts/context-inline-spill-benefit-loop-eval.mts --mode live --out D:/tmp/context-inline-spill-r5-live-replay --repeats 3 --max-turns 8
node scripts/context-inline-spill-benefit-round5-verify.mjs <run-directory> D:/tmp/context-inline-spill-r5-verify.json
```

`verify-run.mjs` 与 `recompute-stats.mjs` 的副本随本包保存。首次复算因模块路径缺失失败，修正后拒绝 dirty 标记；两次失败属于工具与身份验证，不改变 live 原始判定。

本轮没有变更生产 recall 默认值、产品锁、发布状态或 GA 结论。第四轮及更早的证据保持原样。
