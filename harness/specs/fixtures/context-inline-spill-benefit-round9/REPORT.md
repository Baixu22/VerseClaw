---
driven_by: agent
actor: codex-g7-inline-spill-tf0749-01a1d34c
realHumanEvidence: false
---

# G7 Inline/Spill 第九轮收益验收（TF-0749）

判定为 task-benefit-verified / GO，B1–B7全部满足。clean实测候选 27c1a91dd228369ca1427d2b30f39dd6222cee37，verifier接受同候选。
模型space-bunny，本次96个运行、324份原始provider响应全部completed，原始请求、工具参数、工具结果、usage、归档及最终value可回读。

## 冻结设计

设计提交 69884a18a614886ad1712331b860465cb9a644a7 先于候选，SHA256 72a5e7d4d8c6bc74b1d35340b01c0aca5508c39b3bf3448cc33ba42014436241。
六证据/两控制、每任务每臂三次重复、900输出token、低推理、温度0、8次请求、5500页、
6000单工具/16000聚合工具预算、240000ms期限及B1–B7阈值保持原值，无自动provider重试。
书签只复制最初实际可见URI/checksum到既有agent问题，最多512字符，实际最大241字符。
四臂共用工具定义，无引用基线不增加书签；当前导航优先于错误模型参数，payload和字段值不入书签，模型原始参数不静默改写。

## 实测结果

| 臂 | 证据正确 | 控制正确 | recall_ok | 平均请求数 | 平均 input / output / total token | 末次输入字符 | 运行p50 / p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline-no-reference | 0/18 | 6/6 | 0.000000% | 2.2083 | 2358.708333 / 346.708333 / 2705.416667 | 2059.458333 | 8505.491 / 12987.208 |
| reference-visible | 13/18 | 6/6 | 100.000000% | 3.6667 | 12571.500000 / 562.708333 / 13134.208333 | 19171.458333 | 10317.383 / 17297.526 |
| recall-stable | 17/18 | 6/6 | 100.000000% | 3.3333 | 11922.416667 / 463.875000 / 12386.291667 | 19417.750000 | 8495.777 / 12921.587 |
| retention-off | 0/18 | 6/6 | 100.000000% | 4.2917 | 16101.791667 / 626.375000 / 16728.166667 | 19947.875000 | 11959.335 / 16973.834 |

B1：稳定臂18/18发起回读并成功，阈值分别80%/95%。B2：17/18相对baseline0/18，McNemar p=1.52587890625e-05。
B3：正向17、反向0、neither1；控制双方通过6对。
B4：17/18 >= 13/18-5%。B5：控制6/6为有效null。B6：总token相对reference变化-5.694417567%，末次输入相对retention-off变化-530.125000字符，满足25%及16000上限。
B7：13个live清单项、609个归档、24对首轮请求、324个导航提示、全部原始响应/usage/最终答案与同候选源码可复算，凭证零命中。
稳定臂56次调用都选择原目标，其他归档0，原工具content命中18次；一次最终答案带private_evidence=前缀而按原评分判失败，17/18不改写为18/18。
各臂总体24次成功率Wilson区间、证据pass^3、失败分类与完整延迟见verification/live-recovered.json。费用not-run，provider未提供rate/unit。

## 汇总恢复来源

桌面工具host重载后，原汇总进程不存在，原退出码未观测，original-live目录保留原貌，缺失的original postflight未伪造。
96个运行和324份响应已全部在磁盘；源码仍为同一clean候选。恢复脚本逐字节验证源码和原始文件，
使用冻结候选的原语料及汇总代码生成独立live目录，恢复postflight记录恢复时的实际Git/源码观察。
原进程退出码保持未知；恢复汇总及未改动的同候选verifier退出0。恢复未新增任何provider调用、未修改模型输出。
恢复源码片段摘要、原文件摘要、原始日志、恢复过程与失败的首次copy尝试完整保留于recovery和checks。

## 机制与历史证据

正常和首次URI扩写故障的32次deterministic对照均为reference/stable6/6、off0/6、控制全正确；
脚本模式inconclusive/NO_GO，token未测。68项同候选测试、node/web/tests完整类型、契约与定向Harness通过。
第五轮32份原字节与dirty拒绝，第六轮105项、第七轮237项、第八轮212项清单和原NO_GO保留。
第八轮25.027526%的预算失败保持原值，不修改固定25%阈值。
完整Harness CI退出1：59项前置测试通过后，在历史证据重复文件检查发现6组未登记重复而停止；后续审计未执行。失败日志保留于checks/harness-ci-r9.stderr.txt，本节点声明门禁见commands.json。
生产recall默认值、产品锁、发布状态保持原样；结果覆盖本冻结语料、模型和书签导航策略。

## 复算

在实测clean候选隔离检出执行：
node openclaw_runtime/node_modules/tsx/dist/cli.mjs scripts/context-inline-spill-benefit-round9-verify.mts <本目录>/live D:/tmp/g7-round9-replay.json
临时目录使用D:/tmp。首次运行原始目录 D:/tmp/g7-closeout-pass-r9-01a1d34c/live/2026-11-13T11-48-49-224Z-live ，恢复目录 D:/tmp/g7-closeout-pass-r9-01a1d34c/recovered/2026-11-13T11-48-49-224Z-live-2026-11-13T12-46-29-966Z 。
Task Forest提案`TFP-g7-inline-spill-r9-close-20261113-01a1d34c`已按匹配的base_graph_hash应用，TF-0749磁盘回读done/100，validate与HTML export均退出0；HTML当前节点和历史末帧均为done/100，七个子节点状态一致。
应用命令在工具会话超时后退出码未观测，原回执保持running；已应用提案和独立节点回读验证实际变更。
七个子节点25条、父节点5条及严格收益条件见acceptance-readback.json；Task Forest完整历史、提案、快照与导出保留在本地。
收尾两次原清单核验失败及脚本均保留；第五轮原版按32文件无损包回读，当前目录13份派生版本差异单独记录。
归集回放在同候选独立Git检出执行，复用已安装node_modules。
