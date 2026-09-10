# TF-0042 RC-10 真人场景收据模板（禁止代填 verdict）

来源：`docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md`。

## 前置（本轮全部未满足）

- RC-09 engineering-accepted 且 STATUS.md = `human_acceptance_pending`：**未确认**
- 最终 manifest + `final-report.json` 互绑且绿：**无**（TF-0020 H-01 还停在 executor NO-GO）
- `liveReady` / `productApproved` / `defaultOn` 保持 false：遵守，本轮未改
- 用户已选真实 provider、真实 channel、一次性 workspace、回滚窗口：**未记录**。无真实 channel 则 RC-10 必须保持 blocked

## 六场景空表（只许真人填）

| ID | 操作 | run ID | receipt IDs | result | recovery 观察 | 用户短注 |
|---|---|---|---|---|---|---|
| H-01 | 发送一次正常桌面任务 | | | | | |
| H-02 | 触发受控 Cron，Inbox 一个决策，批准产生一个 effect + receipt | | | | | |
| H-03 | 经一个真实 channel 重复 H-02 | | | | | |
| H-04 | 批准 pending 时重启 | | | | | |
| H-05 | effect 完成后重启 | | | | | |
| H-06 | deny / cancel / fork / handoff | | | | | |

## verdict 文件（禁止 agent 写 accepted）

路径：`artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/human-verdict.yaml`

```yaml
schema: runtime-authority-convergence-human-verdict/v1
candidate_sha: ""
manifest_sha256: ""
engineering_report_sha256: ""
verdict: blocked
accepted_scenarios: []
failed_scenarios: []
notes: "模板。agent 不得填写 accepted。TF-0020 未绿之前 RC-10 保持 blocked。"
decided_at: ""
```

`accepted` 仅当：candidate 匹配、六场景恰好 `[H-01..H-06]`、`failed_scenarios` 为空、独立 Verifier 绿。本轮这些条件都不成立。
