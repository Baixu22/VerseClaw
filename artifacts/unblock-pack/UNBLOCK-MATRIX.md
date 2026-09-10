# Task Forest blocked 节点 — 真实数据对照包

目的：不再做实验，把每个 blocked/卡真人数据的节点「缺什么 / 已有什么 / 谁才能翻状态」钉死。
生成：2026-09-09。不修改任何 blocked 节点的 status。

## 总表

| 节点 | 现状 | 本包补上的数据 | 仍缺（必须真人/环境/代码，agent 不能代） | 可否本轮 done |
|---|---|---|---|---|
| TF-0009 | review_needed | `artifacts/agent-surrogate-ledger/manifest.json` 钉死 AC0/AC1=10/10/10、human=0/10 | AC2/AC3 具名真人产品路径 ×10 + owner continue/shrink/stop | 否 |
| TF-0020 | blocked | H-01 manifest+plan+executor NO-GO 收据 | 隔离 VerseShell patch byte-size；绿的 verifier-report.json / final-report.json | 否 |
| TF-0042 | blocked | 六场景空表 + verdict 模板（verdict=blocked） | RC-09 绿 + 真实 provider/channel + 用户亲笔 accepted | 否 |
| TF-0047 | blocked | Dockerfile digest/python3/ripgrep/USER sandbox + 契约测试绿 + bash -n | 本机 Docker daemon + `sandbox-setup.sh` 构建成功 | 否 |
| TF-0127 | review_needed | HealthMonitor 四维代码定位；生产调用=无；检出率 0% 仍成立 | 生产输入源接线；掏空摘要被检出的真实样本 | 否 |
| TF-0129 | blocked | T-C0 三问+六字段+五类可观测性；语料指针 57c00668（42 轮/2 次压缩）与 6f47f667c12b（41 轮/1 次） | 非 compaction 类的真实会话证据；limitHistoryTurns/archived 记录点 | 否 |
| TF-0130 | blocked | 依赖 TF-0129 字段清单，本包不发明再注入数据 | 单测+kill switch；真实 goal_token_decay 样本 | 否 |
| TF-0140 | in_progress | `approvals/TF-0140.DRAFT.md` + day-0 模板 + 执行器坐标 | 真人签字改名为 `TF-0140.md` 之后才允许改默认值；14 天真人 log | 否 |
| TF-0141 | blocked | 无。A/B 报告需要 T-C3 后再写 | 命令、原始输出、三项指标、样本、局限性 | 否 |
| TF-0144 | blocked | 明确本轮不验收；前置=T-C0 绿 + T-CORPUS + 字段清单（后两项本包已指针化） | 用户开第二轮预算 | 否（按 AC） |
| TF-0151 | blocked | `approvals/TF-0151.DRAFT.md` 四项坐标；#2 #4 无执行器；四项真实数据量=0 | 签字、真实数据量、masking 召回面、已验证回滚 | 否 |
| TF-0006 | blocked | 遵守 shadow：未改 liveReady/default-on | 非 synthetic liveReady 路径 | 否 |
| TF-0013 | blocked | 未动。属静态扫描+组合测试，不是真人 soak | 生产扫描单一 assembly authority 等 | 否 |

## 本包文件

```
artifacts/unblock-pack/UNBLOCK-MATRIX.md          本对照
artifacts/unblock-pack/tf0020-h01-nogo.md         RC-00 真实 NO-GO
artifacts/unblock-pack/tf0042-h-scenarios.md      RC-10 空表
artifacts/unblock-pack/tf0047-docker-sandbox.md   Docker 静态 PASS / daemon FAIL
artifacts/unblock-pack/tf0127-tf0129-tcorpus.md   语料指针与字段清单
artifacts/agent-surrogate-ledger/manifest.json    TF-0009 账本（human=0）
docs/dev/context-moat/approvals/TF-0140.DRAFT.md  未签字
docs/dev/context-moat/approvals/TF-0151.DRAFT.md  未签字
artifacts/tf0140-surface/day-0.template.jsonl     14 天 log 模板
```

## 明确不做的事

- 不把 DRAFT 改名为有效 approve
- 不写 `human-verdict.yaml` 的 `accepted`
- 不把 humanQualifyingRuns 从 0 改成 10
- 不改任何旗标默认值
- 不把 TF-0047 在无 Docker 的机器上标 done
- 不把隔离 VerseShell mismatch 说成「当前工作树文件坏了」（工作树 1645/sha 已对齐）

## 下一刀（按解锁杠杆排序，仍等你点头才改代码/环境）

1. 装 Docker 跑 `sandbox-setup.sh` → 可能单独解开 TF-0047
2. 修隔离 checkout 的 patch EOL → 才能继续 TF-0020 的 18 个被 blocked 的 gate
3. 你本人把 `TF-0140.DRAFT.md` 改名签字 → 才允许那一项白名单默认值翻转
4. 真人 H-01..H-06 只能在 RC-09 绿之后开始；现在开跑会把收据绑到错误 candidate
