# 剩余待办处置状态（2026-10-14）

范围：离线审计、轻量 live 配对、证据刷新和卫生项决策。没有改 Task Forest，没有提交或推送。

## 最终门禁

```
python tools/claim_gate.py
=> 29/31 gated claims pass, exit 1
=> FAIL: C14, C16
```

C12、C24、C34、C35 均已转为 PASS。C14/C16 按既定决策保持红；轻量 8 任务上的数值只作为 subset diagnostic，不冒充原全任务轨迹门槛。

Python 全量回归：

```
python -m pytest tests -q
=> 506 passed, 5 skipped in 156.74s
```

## 轻量 live 配对（C12/C35）

采集目录：`bench/aci/results/light-c12-c35-fmt-20261014/`

- 模型：`sn-glm-5-3-flash`
- 任务：manifest 前缀 8 个（Rust 3、Python 3、TypeScript 2）
- 条件：`raw_shell`、`raw_shell_coached`、`verseshell_aci`
- seed：42
- 两臂：with/without read_files
- 规模：`8 × 3 × 1 × 2 = 48` cells
- 结果：with/without 各 24 行，`api_error_rows=0`，全部 `analysable`；两次宿主中断各留下 1 个 `recovery_uncertain`，已用同 identity recovery shard 只补 2 格

canonical 已发布到：

- `bench/aci/results/latest_live.json`
- `bench/aci/results/live_ab_without_read_files.json`

旧 canonical 备份在 `audit-r12-scratch/canonical-before-light-fmt-20261014/`。

## 已修复的证据链问题

- `tools/live_uncertainty.py`：没有 discordant pair 时 McNemar exact p 明确为 `1.0`，不再写 `null`；补回归测试。
- `tools/task_design_audit.py`：新增显式 `--allow-subset`。只有声明 subset 时，8 任务 baseline 才可生成审计，并记录 `baseline_scope.full_coverage=false` 和缺失任务；composition/large 配额仍来自完整冻结任务与 admission。
- `tools/claim_gate.py`：`replay_source_binding` 允许 **预声明 prefix subset**，且 collection id 必须为 `light-*`；任意非前缀子集仍失败。
- `tools/claim_gate.py`：without-read-files 臂纳入 `EVIDENCE_ARTIFACTS`，C12/C25/C35 不再把它当未验证外部输入。
- `tools/claim_gate.py`：C14/C16 显式拒绝 lightweight prefix collection，保持原全轨迹声明为红。
- `tools/task_admissibility.py`、`tools/three_arm_report.py`：evidence fingerprint 统一为与 claim gate 相同的全局路径排序，消除“工具自身生成后仍被 C12 判 stale”的序列化缺陷。

## 关键数值

- C12：PASS，存储证据与当前源码指纹一致。
- C24：PASS，35/35 GOLDEN-bearing 任务均为 `pristine=false`、`golden=true`。
- C34：PASS，`0.7325`，`line_wrapper + counts` 从 931 降到 168 字符；轻量 prefix subset 已声明 `full_trajectory_claim=false`，该声明不用于 C14/C16。
- C35：PASS，canonical 两臂 8 任务、seed 42、各 24 行、同 revision/task set、`api_error=0`。
- C14：FAIL，轻量 subset 的 `0.2368` 仅记录为 diagnostic；`lightweight_subset=true`，不可声称原全轨迹门槛通过。
- C16：FAIL，轻量 subset 的 `0.1950` 仅记录为 diagnostic；`lightweight_subset=true`，不可声称原全轨迹门槛通过。

## Task Forest

已从 `D:\VerseShellLive\tf-backup-20261012\task-forest` 恢复到当前工作区，并通过 repo-local CLI 验证：

- 141 节点
- 138 done
- 3 deprecated：TF-0114、TF-0115、TF-0123
- open = 0
- `validate` 通过
- `exports/task-forest.html` 已重新导出

历史规划页 `docs/task-forest-node-plan-2026-10-12.md` 已标记为 2026-10-14 applied。
## large 占比

生成器机制已在 `9461cb1` 落地并有原始探针：

- large TypeScript：`node --test --test-reporter=tap check.mjs`，18 个用例逐个注册；
- large Rust：`cargo test --no-fail-fast`，库测试失败不再遮住 integration test；
- 同一批被拒候选的 A8 大小通过数：**0/5 -> 5/5**（1961–3537 proxy tokens）。

当前正式任务集仍是 **7/35 = 20%** large；机制修复不等于已生成、准入并冻结足够的新 large 任务。下一步仍需新的预注册生成/准入批次。

## 卫生项决策

- `tests/ic_verseshell_benchmark.rs` 的 `#[ignore]` 保留：它是基准探针，不是普通单元测试；C7 计 1 ignored。
- removed-module stub builtins 暂不批量删除：当前源码扫描到 147 个 `not available (module removed)` 函数体，多数仍在 dispatch 表中并返回显式错误。删除会改变内置命令表面，应先做调用方/兼容性审计和回归测试。
- `cargo fmt --all` 已执行，`cargo fmt --all -- --check` 通过；格式化后的源码重新冻结了 `light-c12-c35-fmt-20261014`，避免留下失效指纹。

## 本次工作区改动

- 轻量 live 与备份：`bench/aci/results/light-c12-c35-fmt-20261014/`、`audit-r12-scratch/canonical-before-light-fmt-20261014/`
- 证据：`eval/evidence.json`、`eval/evidence.claims.md`、live/read/replay/audit 等 `eval/*.json`
- 代码：`tools/claim_gate.py`、`tools/live_uncertainty.py`、`tools/read_path_breakdown.py`、`tools/task_design_audit.py`、`tools/task_admissibility.py`、`tools/three_arm_report.py`、`tools/tf45_envelope_replay.py`、`tools/refresh_live_artifacts.py`
- 测试：`tests/test_claim_sources.py`、`tests/test_task_design_audit.py`、`tests/test_live_uncertainty_degenerate.py`

补充边界：`eval/task_admissibility.json` 的候选 verdicts 和 input hashes 没有重跑或改写；在统一 fingerprint 序列化后，只按当前文件重算了它的 `evidence.fingerprint`。这是 hash 串行化迁移，不是候选准入结果的重测。
- 墙钟：with `17:33:42–17:47:39`（约 14 分钟），without `17:47:40–18:03:02`（约 15.5 分钟），另加两格 recovery，合计约 31 分钟。




