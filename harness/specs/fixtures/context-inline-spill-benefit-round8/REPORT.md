---
driven_by: agent
actor: codex-g7-inline-spill-tf0749-01a1d34c
realHumanEvidence: false
---

# G7 Inline/Spill 第八轮收益复核（TF-0749）

判定为 no-benefit / NO_GO。clean候选 f8d41ddb2355ee366fe23058d8c40f61ee6f4d86 的96次/349次调用全部completed；verifier接受同候选，659个归档核验通过。
stable证据14/18、reference16/18、控制6/6。B2/B3/B5/B7通过，B1/B4/B6失败，TF-0749保持in_progress/80。
设计 3e875f462ce16ca8b6ed4feb412397fe0f391311 先于候选。模型、四臂、语料、三次重复、900输出token、低推理、8次请求、5500页、16000工具聚合预算、240000ms期限和全部B阈值固定；无自动provider重试。

| 臂 | 证据正确 | 控制正确 | recall_ok | 平均请求数 | 平均总token | 末次输入字符 |
|---|---:|---:|---:|---:|---:|---:|
| baseline-no-reference | 0/18 | 6/6 | 0.000000% | 2.9167 | 3416.958333 | 2292.916667 |
| reference-visible | 16/18 | 6/6 | 100.000000% | 3.4583 | 10936.458333 | 17490.541667 |
| recall-stable | 14/18 | 6/6 | 94.444444% | 3.7083 | 13673.583333 | 19466.833333 |
| retention-off | 0/18 | 6/6 | 94.444444% | 4.4583 | 17019.041667 | 19867.500000 |

B1为17/18=94.444444%，低于95%；B4为14/18 < 16/18-5%。
B6增幅为 25.027526431% ，高于固定25%；不把25.027526%四舍五入成通过。
输入增量 -400.666667 字符，上限16000。B2/B3的配对、Wilson区间、pass^3、失败分类和延迟见verification/live.json；费用not-run，provider未给rate/unit。

首次确定性导航2/6失败：字段接在日志字母后，词边界要求漏识别。修复后reference/stable各6/6、off0/6、控制全过，首次失败完整保留。
同候选65项测试、node/web/tests完整类型、契约、定向Harness和32次clean deterministic通过。来源标签在live前重新冻结，首次设计和候选证据保留。
模型曾把URI文件名16位摘要扩写成64位checksum，missing后继续沿用错误URI。可见书签原型只复制最初可见URI/checksum到既有agent问题；恢复建议不改写模型参数。bookmark-probe是确定性诊断，未验收live收益。
第五轮32份原字节和dirty拒绝、第六轮105项、第七轮237项清单保留。
完整Harness CI退出1：59项前置测试通过，历史Agent Dev证据过期且历史性能超限。全部实际argv、退出码、HEAD及日志摘要见commands.json。
生产recall默认值、产品锁和发布状态保持原样。

在实测候选的clean隔离检出复算：
node openclaw_runtime/node_modules/tsx/dist/cli.mjs scripts/context-inline-spill-benefit-round8-verify.mts <本目录>/live D:/tmp/g7-round8-replay.json
原始目录 D:/tmp/g7-closeout-pass-r8-01a1d34c/live/2026-11-13T10-54-31-031Z-live 。导航全部从实际input复算，24对首轮请求相同，基线oracle泄漏和历史旁路均为0。
