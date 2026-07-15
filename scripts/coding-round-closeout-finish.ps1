#Requires -Version 5.1
<#
.SYNOPSIS
  Finish CODING round closeout: FF onto main, stage C4-C7 delta only, commit.
.NOTES
  Run from ClawX-context-coding-wt with write access to the shared .git directory.
#>
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

Write-Host '== status =='
git status -sb

Write-Host '== fetch/merge main (FF if possible) =='
git merge --ff-only main
if ($LASTEXITCODE -ne 0) {
  Write-Host 'FF failed; attempting merge commit'
  git merge main -m 'merge: bring codex/context-coding onto main for C4-C7 closeout'
}

# Remove untracked files that duplicate main after merge (if still present as untracked)
$exclude = @(
  'openclaw_runtime/src/agents/tools/context-fact-tools.ts',
  'openclaw_runtime/src/agents/tools/context-fact-tools.test.ts',
  'openclaw_runtime/src/agents/team-orchestrate-request.ts'
)

$add = @(
  'openclaw_runtime/src/agents/worktree-service.ts',
  'openclaw_runtime/src/agents/worktree-service.test.ts',
  'openclaw_runtime/src/agents/isolation-mode-matrix.ts',
  'openclaw_runtime/src/agents/isolation-mode-matrix.test.ts',
  'openclaw_runtime/src/agents/patch-flow.ts',
  'openclaw_runtime/src/agents/tool-output-compress.ts',
  'openclaw_runtime/src/agents/verifier-discipline.ts',
  'openclaw_runtime/src/context-engine/block-lifecycle.ts',
  'openclaw_runtime/src/context-engine/block-lifecycle.test.ts',
  'openclaw_runtime/src/context-engine/coding-ab-fixtures.ts',
  'openclaw_runtime/src/context-engine/coding-ab-fixtures.test.ts',
  'openclaw_runtime/src/context-engine/coding-long-chat-curve.ts',
  'openclaw_runtime/src/context-engine/coding-long-chat-curve.test.ts',
  'openclaw_runtime/src/context-engine/coding-tool-navigation.ts',
  'openclaw_runtime/src/context-engine/coding-tool-navigation.test.ts',
  'openclaw_runtime/src/context-engine/coding-runtime-flags.ts',
  'openclaw_runtime/src/context-engine/coding-observability.ts',
  'openclaw_runtime/src/context-engine/factstore/symbol-lease.ts',
  'openclaw_runtime/src/context-engine/factstore/symbol-lease.test.ts',
  'openclaw_runtime/src/context-engine/token-pressure.ts',
  'openclaw_runtime/src/knowledge/routing-memo-shadow.ts',
  'openclaw_runtime/src/knowledge/routing-memo-shadow.test.ts',
  'openclaw_runtime/src/knowledge/sekb/experience-shadow-product.ts',
  'openclaw_runtime/src/knowledge/sekb/experience-shadow-product.test.ts',
  'openclaw_runtime/src/config/types.openclaw.ts',
  'openclaw_runtime/scripts/coding-remaining-acceptance.mts',
  'openclaw_runtime/CODING-OPTIMIZATION-STATUS.md',
  'openclaw_runtime/CODING-C4-COMPLETE.md',
  'openclaw_runtime/CODING-C5-COMPLETE.md',
  'openclaw_runtime/CODING-C6-COMPLETE.md',
  'openclaw_runtime/CODING-C7-COMPLETE.md',
  'reports/CODING-CLOSEOUT-PLAN.md',
  'reports/CODING-ROUND-CLOSEOUT.md',
  'reports/CODING-OPTIMIZATION-STATUS.md',
  'reports/CODING-FLAG-GRADUATION.md',
  'reports/CODING-C1-LIVE-AB.md',
  'reports/CODING-HARDENING-BACKLOG.md',
  'reports/CODING-C4-COMPLETE.md',
  'reports/CODING-C5-COMPLETE.md',
  'reports/CODING-C6-COMPLETE.md',
  'reports/CODING-C7-COMPLETE.md',
  'scripts/coding-round-closeout-finish.ps1',
  'artifacts/context-coding-closeout'
)

foreach ($p in $exclude) {
  if (Test-Path $p) {
    git rm -f --ignore-unmatch $p 2>$null
    Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
  }
}

git add -- $add
git status --short

Push-Location openclaw_runtime
node --import tsx scripts/coding-remaining-acceptance.mts
if ($LASTEXITCODE -ne 0) { throw 'remaining acceptance failed' }
Pop-Location

git commit -m @"
feat(coding): land C4-C7 residual closeout on main C0-C3 base

- Prefer main implementations for C0-C3 (no parallel fact-tool rewrite)
- Add worktree isolation, symbol lease, patch-flow, context ladder, shadow memory helpers
- Extend coding flags/observability with safe defaults only (no production flips)
- Document SoT status, flag graduation, live A/B block, hardening backlog
"@

Write-Host '== done =='
git log --oneline -3
git status -sb