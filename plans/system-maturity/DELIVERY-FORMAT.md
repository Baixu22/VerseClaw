# Agent Delivery Format

每个任务只提交以下字段：

TASK_ID: <id>
STATUS: todo | in_progress | blocked | done
OWNER: <role>
CHANGED: <files or none>
TESTS: <commands>
RESULTS: <exit code and concise result>
EVIDENCE: <paths, artifact ids, hashes>
ACCEPTANCE: <passed item ids>
BLOCKERS: <none or exact blocker>
NEXT: <next task or none>

规则：
- STATUS=done 时，TESTS、RESULTS、EVIDENCE、ACCEPTANCE 不得为空。
- 任一验收项失败，STATUS 只能为 in_progress 或 blocked。
- 不提交解释性长文；只提交上述字段。

## True-close constraints

- STATUS=done requires post-commit reproducible gates: harness (when present), evidence hashes, and declared TESTS.
- TESTS in delivery must match full-validation command list (no silent downgrade such as audit:report instead of audit).
- INDEX.md must stay synchronized with STATUS.json via `pnpm maturity:sync-index` before seal/close.
