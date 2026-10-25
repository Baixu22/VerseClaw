$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/knowledge-tf0499'
$env:TEMP = 'D:\tmp'; $env:TMP = 'D:\tmp'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$results = @()

function Invoke-CapturedGate {
  param([string]$Id, [string[]]$Arguments, [string]$DisplayCommand)
  $outputPath = Join-Path $outputDir "$Id.txt"
  $output = & $Arguments[0] @($Arguments[1..($Arguments.Count - 1)]) 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  [System.IO.File]::WriteAllText($outputPath, $output, $utf8NoBom)
  return [ordered]@{
    id = $Id; command = $DisplayCommand; exitCode = $exitCode
    status = if ($exitCode -eq 0) { 'pass' } else { 'fail' }
    outputPath = "tests/unit/fixtures/knowledge-tf0499/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-lifecycle-unit' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/knowledge-lifecycle-tf0499.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'knowledge lifecycle contract suite'

$results += Invoke-CapturedGate -Id '02-sekb-identity' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/knowledge/sekb/sekb.test.ts', 'src/knowledge/sekb/golden-path.test.ts',
  'src/knowledge/sekb/experience-closed-loop.test.ts', 'src/knowledge/sekb/experience-block-bridge.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'SEKB identity and golden-path suites'

$results += Invoke-CapturedGate -Id '03-knowledge-runtime' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/knowledge/governance-lifecycle.test.ts', 'src/knowledge/governance-adapters.test.ts',
  'src/knowledge/governance-store.test.ts', 'src/knowledge/ks09-surface-report.test.ts',
  'src/knowledge/routing-memo-shadow.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'knowledge governance suites'

$results += Invoke-CapturedGate -Id '04-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '05-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '06-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '07-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '08-diff-check' -Arguments @('git', 'diff', '--check') -DisplayCommand 'git diff --check'

# 09: static surface count. Knowledge owns exactly one review surface and one nav entry;
# no second SEKB queue/route may exist.
$surfaceReport = @()
$surfaceStatus = 'fail'
$navHits = @(Select-String -Path (Join-Path $root 'src/components/layout/Sidebar.tsx') -Pattern "to: '/knowledge'" -AllMatches)
$queueHits = @(Select-String -Path (Join-Path $root 'src/pages/Knowledge/index.tsx') -Pattern 'KnowledgeReviewQueue' -AllMatches)
$sekbRouteHits = @(Get-ChildItem -Path (Join-Path $root 'src') -Recurse -Include *.tsx,*.ts |
  Select-String -Pattern 'path=\"/sekb|to: ''/sekb|''/sekb''' -ErrorAction SilentlyContinue)
$surfaceReport = @(
  "knowledge_nav_entries=$($navHits.Count)",
  "review_queue_mounts=$($queueHits.Count)",
  "sekb_routes=$($sekbRouteHits.Count)"
)
$surfaceStatus = if ($navHits.Count -eq 1 -and $queueHits.Count -ge 1 -and $sekbRouteHits.Count -eq 0) { 'pass' } else { 'fail' }
$surfacePath = Join-Path $outputDir '09-single-surface.txt'
[System.IO.File]::WriteAllText($surfacePath, (($surfaceReport -join "`n") + "`n"), $utf8NoBom)
$results += [ordered]@{
  id = '09-single-surface'; command = 'static audit: one Knowledge review surface, no SEKB route'
  exitCode = if ($surfaceStatus -eq 'pass') { 0 } else { 1 }; status = $surfaceStatus
  outputPath = 'tests/unit/fixtures/knowledge-tf0499/09-single-surface.txt'
  outputSha256 = (Get-FileHash -LiteralPath $surfacePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 10: no unconfirmed SEKB writeback and no agent-to-human attribution.
$writebackPath = Join-Path $outputDir '10-no-unconfirmed-writeback.txt'
$toolSrc = Get-Content -LiteralPath (Join-Path $root 'openclaw_runtime/src/knowledge/sekb/distillation-tool.ts') -Raw
$goldenSrc = Get-Content -LiteralPath (Join-Path $root 'openclaw_runtime/src/knowledge/sekb/golden-path.ts') -Raw
$hardcodedHuman = ([regex]::Matches($toolSrc, 'created_by:\s*"human"')).Count
$autoWriteback = if ($goldenSrc -match 'autoWriteback:\s*false') { 0 } else { 1 }
$drivenByAgent = if ($goldenSrc -match 'drivenBy:\s*"agent"') { 1 } else { 0 }
$writebackStatus = if ($hardcodedHuman -eq 0 -and $autoWriteback -eq 0 -and $drivenByAgent -eq 1) { 'pass' } else { 'fail' }
[System.IO.File]::WriteAllText($writebackPath, (@(
  "hardcoded_created_by_human=$hardcodedHuman",
  "auto_writeback_off=$($autoWriteback -eq 0)",
  "agent_driven_confirm=$($drivenByAgent -eq 1)"
) -join "`n") + "`n", $utf8NoBom)
$results += [ordered]@{
  id = '10-no-unconfirmed-writeback'; command = 'static audit: no hardcoded human author, no auto writeback'
  exitCode = if ($writebackStatus -eq 'pass') { 0 } else { 1 }; status = $writebackStatus
  outputPath = 'tests/unit/fixtures/knowledge-tf0499/10-no-unconfirmed-writeback.txt'
  outputSha256 = (Get-FileHash -LiteralPath $writebackPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'KnowledgeSekbMergeVerification/v1'
  taskForestNodeId = 'TF-0499'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'; actor = 'codex'
  status = $status; graduationStatus = if ($status -eq 'pass') { 'graduated-per-implementation-gates' } else { 'not-graduated' }
  gates = $results
}
[System.IO.File]::WriteAllText((Join-Path $outputDir 'verification.json'), (($ledger | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
Write-Output ($ledger | ConvertTo-Json -Depth 10)
if ($status -ne 'pass') { exit 1 }