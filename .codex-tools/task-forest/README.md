# Task Forest landing-check repair

The active tool is `%USERPROFILE%/.codex/skills/task-forest/scripts/task_forest.py`.
`landing-fix.patch` records the repair to that installed skill; it is not a second
Task Forest implementation or a replacement task graph. The patch also updates
the skill's obsolete timestamp-based landing guidance.

The repair selects the complete remote default ref, reads machine-readable refs
instead of `git branch` display markers, deduplicates abbreviated commit IDs, and
fails on incomplete Git queries. It retains repository-wide unmerged-branch
findings. It does not merge, delete, archive, or hide historical branches.

On another machine with the original skill version, apply only after the dry
check passes (PowerShell, from the ClawX root):

```powershell
$skillDir = Join-Path $env:USERPROFILE '.codex/skills/task-forest'
$patchPath = (Resolve-Path '.codex-tools/task-forest/landing-fix.patch').Path
git -C $skillDir apply --check $patchPath
# Run this only if the preceding command exits 0.
git -C $skillDir apply $patchPath
$env:PYTHONPATH = Join-Path $skillDir 'scripts'
$env:PYTHONUTF8 = '1'
python .codex-tools/task-forest/test_landing.py -v
```

An already patched or different skill version must not be overwritten blindly.
The tested before/after hashes and findings are recorded in
`artifacts/task-forest-landing-20260930/verification.json`.

Before a repository-wide check, refresh the refs with `git fetch origin`, then
run `python <skillDir>/scripts/task_forest.py check-landing --json`. A current-task
push and an all-branches landing check are different facts; report both readings.
