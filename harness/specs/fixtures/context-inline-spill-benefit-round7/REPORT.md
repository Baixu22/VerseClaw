---
driven_by: agent
actor: codex-g7-inline-spill-tf0749-01a1d34c
realHumanEvidence: false
---

# G7 Inline/Spill 第七轮收益复核（TF-0749）

判定为 **mechanism-only / NO_GO**。clean 实测候选 `89dff8ebd6d21fa279ab586c368d2132efa01940`，verifier 接受同候选并复算原始记录。

设计提交 `449192523851b3795ee6793751e78331831af047` 先于候选，设计摘要 `8dcbc516bf3ff8c6380ffd7ebc055b6022b36b19a7850b54c46ed829f7597405`。
四臂、六证据/两控制、每臂三次重复、900 输出 token、低推理、8 次请求、5500 字符页与 B1–B7 阈值固定。
三次重复沿用原协议，报告18个证据配对和6个控制配对。请求期限统一240000ms，无自动重试。

工具描述要求沿初始原归档分页；健康日志保留原字节和 user/assistant 回合节奏，作为第三个 exec 观测增加11405字符工具压力。
该来源修复的两组 deterministic 均为 stable 6/6、reference 6/6、off 0/6，控制均正确；没有 provider usage。
32次 clean deterministic、182个归档另经 verifier 接受，模式为 inconclusive/NO_GO。

## 真实模型结果

共96次运行、416次调用，状态分布 `{"completed": 416}`。

| 臂 | 证据正确 | 控制正确 | 平均 input / output / total token | 末次输入字符 | 每运行 p50 / p95 ms |
|---|---:|---:|---:|---:|---:|
| baseline-no-reference | 0/18 | 6/6 | 1929.21 / 242.33 / 2171.54 | 1493.96 | 5226.62 / 13034.51 |
| reference-visible | 3/18 | 6/6 | 21025.17 / 1233.04 / 22258.21 | 19520.96 | 19453.72 / 42002.09 |
| recall-stable | 1/18 | 6/6 | 16303.38 / 932.62 / 17236.00 | 19562.25 | 15357.19 / 27338.40 |
| retention-off | 0/18 | 6/6 | 17282.71 / 1047.00 / 18329.71 | 19668.12 | 14566.06 / 31733.57 |

各臂总体24次成功率的 Wilson 95% 区间、证据 pass^3 与失败分类见 `verification/live.json.stats`。
费用为 not-run：provider 未提供计费 rate/unit；全部 usage、缺 usage 和延迟保留。

| 门禁 | 结果 |
|---|---|
| B1 | 通过 |
| B2 | 失败 |
| B3 | 通过 |
| B4 | 失败 |
| B5 | 通过 |
| B6 | 通过 |
| B7 | 通过 |

B2 McNemar p=1。
保留证据配对正向1、反向0、双方通过0、neither17。
总 token 相对reference增长-22.5634%，上限25%；末次输入增量-105.88字符，上限16000。
stable选择原目标39、其他归档49，原工具content命中1。

## 证据与验证

live清单12项、归档811个、24对首轮请求、实际投影输出、最终答案与usage全部复算。
第五轮32份原始字节与dirty拒绝保留在第六轮封存包，mechanism-only/NO_GO及原B失败保持。
第六轮105项清单全部匹配，原NO_GO与B1/B2/B6失败保持。

当前候选60项测试、完整node/web/tests类型、契约和定向Harness通过。
首次候选的两个并发测试超时及一次串行测试超时均保留；将runtime加载移到冻结预检之后，保持60秒测试期限，4项预检与最终60项通过。
完整Harness CI退出1：59项前置测试通过，Agent Dev四份历史证据过期且历史deep-test性能超限；原报告和日志保留。

复算须在实测候选的clean隔离检出执行：

```powershell
$env:TEMP='D:/tmp'; $env:TMP='D:/tmp'
node scripts/context-inline-spill-benefit-round7-verify.mjs '<本目录>/live' 'D:/tmp/g7-round7-replay.json'
```

原始目录：`D:/tmp/g7-closeout-pass-r7-01a1d34c/live/2026-11-13T09-05-58-153Z-live`。`artifact-provenance.json`记录原字节来源，`commands.json`保存实际argv、HEAD、退出码和日志摘要。
导航原型从当前可见function-call元数据恢复原归档与下一页建议，未复制payload值；九个已封存请求的确定性诊断见navigation-probe。

## 执行记录

| 命令回执 | 退出码 | 开跑HEAD |
|---|---:|---|
| advance-validation-checkout | 0 | d46cce0dc |
| candidate-git-log | 0 | d46cce0dc |
| candidate-git-status | 0 | d46cce0dc |
| commit-candidate-r7 | 0 | 449192523 |
| commit-design-r7 | 0 | 1a16bc17a |
| commit-preflight-r7 | 0 | d46cce0dc |
| completion-probe | 0 | 89dff8ebd |
| continuation-git-log | 0 | 1a16bc17a |
| continuation-git-status | 0 | 1a16bc17a |
| contract-r7-candidate | 0 | d46cce0dc |
| contract-r7-clean-final | 0 | 89dff8ebd |
| contract-r7-draft | 0 | 1a16bc17a |
| create-validation-checkout | 0 | d46cce0dc |
| deterministic-r7-clean-final | 0 | 89dff8ebd |
| deterministic-r7 | 0 | d46cce0dc |
| deterministic-tool-source | 0 | 1a16bc17a |
| deterministic-user-source | 0 | 1a16bc17a |
| final-candidate-git-log | 0 | 89dff8ebd |
| final-candidate-git-status | 0 | 89dff8ebd |
| final-validation-log | 0 | 89dff8ebd |
| final-validation-status | 0 | 89dff8ebd |
| freeze-final-r7 | 0 | 1a16bc17a |
| freeze-mechanism-r7 | 0 | 1a16bc17a |
| harness-ci-r7 | 1 | 89dff8ebd |
| harness-context-r7 | 0 | 1a16bc17a |
| harness-dry-run-r7-candidate | 0 | d46cce0dc |
| harness-dry-run-r7-clean-final | 0 | 89dff8ebd |
| harness-dry-run-r7-draft | 0 | 1a16bc17a |
| harness-validate-r7-candidate | 0 | d46cce0dc |
| harness-validate-r7-clean-final | 0 | 89dff8ebd |
| harness-validate-r7-draft | 0 | 1a16bc17a |
| historical-r2-integrity | 0 | 89dff8ebd |
| historical-r3-integrity | 0 | 89dff8ebd |
| historical-r4-integrity | 0 | 89dff8ebd |
| live | 0 | 89dff8ebd |
| navigation-mechanism-prototype | 0 | 89dff8ebd |
| strategy-tests | 0 | 1a16bc17a |
| typecheck-after-versebrowser | 0 | 1a16bc17a |
| typecheck-r7-candidate | 0 | d46cce0dc |
| typecheck-r7-clean-final | 0 | 89dff8ebd |
| typecheck-r7-draft | 0 | 1a16bc17a |
| unit-r7-candidate-serial | 1 | d46cce0dc |
| unit-r7-candidate | 1 | d46cce0dc |
| unit-r7-clean-final | 0 | 89dff8ebd |
| unit-r7-draft | 0 | 1a16bc17a |
| unit-r7-preflight-repair | 0 | d46cce0dc |
| validation-checkout-git-log | 0 | d46cce0dc |
| validation-checkout-git-status | 0 | d46cce0dc |
| verify-deterministic-r7-clean-final | 0 | 89dff8ebd |
| verify-deterministic-r7 | 0 | d46cce0dc |
| verify-live-r7 | 0 | 89dff8ebd |

## 节点状态

收益失败项：`b2_task_benefit, b4_non_inferiority`。Task Forest现有图位于D:/ClawX，TF-0749保持in_progress/80，收口须B1–B7全过且base_graph_hash匹配。
生产recall默认值、产品锁和发布状态保持原样。
