$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/workspace-context/acceptance/TF-0494'
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$tsx = Join-Path $root 'openclaw_runtime\node_modules\.bin\tsx.CMD'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$results = @()

function Invoke-CapturedGate {
  param([string]$Id, [string[]]$Arguments, [string]$DisplayCommand)
  $outputPath = Join-Path $outputDir "$Id.txt"
  $output = & $Arguments[0] @($Arguments[1..($Arguments.Count - 1)]) 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  [System.IO.File]::WriteAllText($outputPath, $output, $utf8NoBom)
  return [ordered]@{
    id = $Id
    command = $DisplayCommand
    exitCode = $exitCode
    status = if ($exitCode -eq 0) { 'pass' } else { 'fail' }
    outputPath = "tests/unit/fixtures/workspace-context/acceptance/TF-0494/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-unit-workspace-context' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run',
  'tests/unit/workspace-context-profile.test.ts',
  'tests/unit/dcs-prod-flags-control.test.ts',
  'tests/unit/dcs-preview-switch.test.ts',
  'tests/unit/default-config-matrix.test.ts',
  'tests/unit/p0-production-acceptance.test.ts',
  'tests/unit/component-disposition-catalog.test.ts',
  '--maxWorkers=1', '--reporter=verbose'
) -DisplayCommand 'pnpm exec vitest run <TF-0494 unit/matrix/profile suites>'

$results += Invoke-CapturedGate -Id '02-runtime-context' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/context-engine/assembler.test.ts',
  'src/context-engine/assembler.kill-switch.test.ts',
  'src/context-engine/runtime-flag-ack.test.ts',
  'src/context-engine/turn-injection-budget.test.ts',
  'src/context-engine/context-candidate.test.ts',
  'src/agents/embedded-agent-runner/extensions.working-memory.test.ts',
  'src/agents/embedded-agent-runner/extensions.knowledge.test.ts',
  'src/agents/embedded-agent-runner/extensions.task-state.test.ts',
  'src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'openclaw_runtime focused Workspace Context suites'

$results += Invoke-CapturedGate -Id '03-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '04-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '05-catalogs-check' -Arguments @($pnpm, 'run', 'catalogs:check') -DisplayCommand 'pnpm run catalogs:check'
$results += Invoke-CapturedGate -Id '06-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '07-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '08-diff-check' -Arguments @('git', 'diff', '--check') -DisplayCommand 'git diff --check'
$results += Invoke-CapturedGate -Id '09-build-vite' -Arguments @($pnpm, 'run', 'build:vite') -DisplayCommand 'pnpm run build:vite'

$e2eCases = @(
  @{ file = 'tests/e2e/workspace-context-settings.spec.ts'; grep = 'exposes one default-on profile' },
  @{ file = 'tests/e2e/dcs-prod-p0-settings.spec.ts'; grep = 'shows opt-in DCS production flags panel' },
  @{ file = 'tests/e2e/dcs-prod-p0-settings.spec.ts'; grep = 'renders the DCS control surface in Japanese and Russian' },
  @{ file = 'tests/e2e/dcs-prod-p0-settings.spec.ts'; grep = 'toggles writable flags, persists store, and restores baseline' },
  @{ file = 'tests/e2e/dcs-prod-p0-settings.spec.ts'; grep = 'shows discoverability banner for hidden view tools' },
  @{ file = 'tests/e2e/vtoken-bridge-settings.spec.ts'; grep = 'does not expose a VT bridge switch' }
)
$e2eOutput = ''
$e2eExit = 0
foreach ($case in $e2eCases) {
  $caseOutput = & $pnpm 'exec' 'playwright' 'test' $case.file '--workers=1' '--reporter=line' '--grep' $case.grep 2>&1 | Out-String
  $caseExit = $LASTEXITCODE
  $line = 'CASE=' + $case.grep + ' EXIT=' + $caseExit
  $e2eOutput += $line + [Environment]::NewLine + $caseOutput + [Environment]::NewLine
  if ($caseExit -ne 0) { $e2eExit = 1 }
}
$e2ePath = Join-Path $outputDir '10-settings-e2e.txt'
[System.IO.File]::WriteAllText($e2ePath, $e2eOutput, $utf8NoBom)
$results += [ordered]@{
  id = '10-settings-e2e'
  command = 'playwright: Workspace Context, DCS diagnostics and VToken boundary scenarios in fresh workers'
  exitCode = $e2eExit
  status = if ($e2eExit -eq 0) { 'pass' } else { 'fail' }
  outputPath = 'tests/unit/fixtures/workspace-context/acceptance/TF-0494/10-settings-e2e.txt'
  outputSha256 = (Get-FileHash -LiteralPath $e2ePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$results += Invoke-CapturedGate -Id '11-component-graduation-gate' -Arguments @(
  $tsx, 'scripts/component-graduation-report.mts',
  '--report', 'tests/unit/fixtures/workspace-context/acceptance/TF-0494/component-graduation-report.json',
  '--root', '.', '--current-default-mode', 'baseline', '--require-graduation'
) -DisplayCommand 'component-graduation-report.mts --report <TF-0494 report> --root . --current-default-mode baseline --require-graduation'

$sumLines = Get-Content -LiteralPath (Join-Path $outputDir 'SHA256SUMS') -Encoding UTF8
$sumChecks = foreach ($line in $sumLines) {
  if (-not $line.Trim()) { continue }
  $parts = $line -split '  ', 2
  $expected = $parts[0]
  $fileName = $parts[1]
  $target = Join-Path $root $fileName
  $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  [ordered]@{ file = $fileName; expected = $expected; actual = $actual; status = if ($actual -eq $expected) { 'pass' } else { 'fail' } }
}
$sumStatus = if ($sumChecks.Count -gt 0 -and @($sumChecks | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$sumOutput = ($sumChecks | ConvertTo-Json -Depth 5) + [Environment]::NewLine + 'SHA256SUMS_STATUS=' + $sumStatus + [Environment]::NewLine
$sumPath = Join-Path $outputDir '12-sha256sums-check.txt'
[System.IO.File]::WriteAllText($sumPath, $sumOutput, $utf8NoBom)
$results += [ordered]@{
  id = '12-sha256sums-check'
  command = 'PowerShell SHA256 recompute against SHA256SUMS'
  exitCode = if ($sumStatus -eq 'pass') { 0 } else { 1 }
  status = $sumStatus
  outputPath = 'tests/unit/fixtures/workspace-context/acceptance/TF-0494/12-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'WorkspaceContextVerification/v1'
  taskForestNodeId = 'TF-0494'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'
  actor = 'codex'
  status = $status
  gates = $results
  sha256sums = $sumChecks
}
$ledgerPath = Join-Path $outputDir 'verification.json'
[System.IO.File]::WriteAllText($ledgerPath, (($ledger | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
Write-Output ($ledger | ConvertTo-Json -Depth 10)
if ($status -ne 'pass') { exit 1 }
