$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495'
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
    outputPath = "tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-surface-unit' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/context-view-tool-surface.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'pnpm exec vitest run tests/unit/context-view-tool-surface.test.ts'

$results += Invoke-CapturedGate -Id '02-runtime-context-tools' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/agents/tools/context-agent-tools.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'openclaw_runtime focused context-agent-tools suite'

$results += Invoke-CapturedGate -Id '03-catalog-parity' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/config-schema-parity.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'pnpm exec vitest run tests/unit/config-schema-parity.test.ts'

$results += Invoke-CapturedGate -Id '04-settings-e2e' -Arguments @(
  $pnpm, 'exec', 'playwright', 'test', 'tests/e2e/context-view-tool-surface.spec.ts',
  '--workers=1', '--reporter=line'
) -DisplayCommand 'pnpm exec playwright test tests/e2e/context-view-tool-surface.spec.ts'

$results += Invoke-CapturedGate -Id '05-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '06-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '07-catalogs-check' -Arguments @($pnpm, 'run', 'catalogs:check') -DisplayCommand 'pnpm run catalogs:check'
$results += Invoke-CapturedGate -Id '08-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '09-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '10-diff-check' -Arguments @('git', 'diff', '--check') -DisplayCommand 'git diff --check'
$results += Invoke-CapturedGate -Id '11-canary-verdict-recompute' -Arguments @(
  $tsx, 'tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495/recheck-canary.mts'
) -DisplayCommand 'tsx recheck-canary.mts (retained protocol + run, no network)'
$results += Invoke-CapturedGate -Id '12-build-vite' -Arguments @($pnpm, 'run', 'build:vite') -DisplayCommand 'pnpm run build:vite'
$results += Invoke-CapturedGate -Id '13-component-graduation-gate' -Arguments @(
  $tsx, 'scripts/component-graduation-report.mts',
  '--report', 'tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495/component-graduation-report.json',
  '--root', '.', '--current-default-mode', 'opt-in', '--require-graduation'
) -DisplayCommand 'component-graduation-report.mts --report <TF-0495 report> --require-graduation'

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
$sumPath = Join-Path $outputDir '14-sha256sums-check.txt'
[System.IO.File]::WriteAllText($sumPath, $sumOutput, $utf8NoBom)
$results += [ordered]@{
  id = '14-sha256sums-check'
  command = 'PowerShell SHA256 recompute against SHA256SUMS'
  exitCode = if ($sumStatus -eq 'pass') { 0 } else { 1 }
  status = $sumStatus
  outputPath = 'tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495/14-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'ContextViewToolSurfaceVerification/v1'
  taskForestNodeId = 'TF-0495'
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
