$ErrorActionPreference = 'Continue'
$tmpRoot = 'D:\tmp'
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
$env:TEMP = $tmpRoot
$env:TMP = $tmpRoot
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/memory-authority/acceptance/TF-0497'

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
    outputPath = "tests/unit/fixtures/memory-authority/acceptance/TF-0497/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-contract-tests' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run',
  'tests/unit/memory-authority-contract.test.ts',
  'tests/unit/dcs-prod-flags-catalog.test.ts',
  'tests/unit/r3-2-memory-settings-switches.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'pnpm exec vitest run <TF-0497 authority/contract suites>'

$results += Invoke-CapturedGate -Id '02-memory-regression' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run',
  'tests/unit/rc07-memory-context-slot-convergence.test.ts',
  'tests/unit/r3-1-runtime-memory-legal-surface.test.ts',
  'tests/unit/role-memory-v2.test.ts',
  'tests/unit/runtime-memory-store.test.ts',
  'tests/unit/runtime-memory-context-contracts.test.ts',
  'tests/unit/runtime-memory-persistence.test.ts',
  'tests/unit/runtime-memory-proposal-shadow.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'pnpm exec vitest run <TF-0497 memory regression suites>'

$results += Invoke-CapturedGate -Id '03-runtime-memory-tests' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/memory/memory-policy.test.ts',
  'src/memory/root-memory-files.test.ts',
  'src/runtime-core/memory-runtime-config.test.ts',
  'src/runtime-core/memory-hybrid-retrieval.cjk.test.ts',
  'src/runtime-core/memory-pre-reply-injection.top5-lines.test.ts',
  'src/runtime-core/memory-effect-receipt.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'openclaw_runtime focused memory suites'

$results += Invoke-CapturedGate -Id '04-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '05-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '06-catalogs-check' -Arguments @($pnpm, 'run', 'catalogs:check') -DisplayCommand 'pnpm run catalogs:check'
$results += Invoke-CapturedGate -Id '07-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '08-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '09-diff-check' -Arguments @('git', 'diff', '--check', '--', 'openclaw_runtime/src/memory/memory-authority.ts', 'shared/dcs/prod-flags-catalog.ts', 'tests/unit/memory-authority-contract.test.ts', 'tests/unit/fixtures/memory-authority/acceptance/TF-0497/README.md', 'tests/unit/fixtures/memory-authority/acceptance/TF-0497/generate-acceptance.mts', 'tests/unit/fixtures/memory-authority/acceptance/TF-0497/run-verification.ps1') -DisplayCommand 'git diff --check -- <TF-0497 source and verifier paths>'
$results += Invoke-CapturedGate -Id '10-build-vite' -Arguments @($pnpm, 'run', 'build:vite') -DisplayCommand 'pnpm run build:vite'
$results += Invoke-CapturedGate -Id '11-component-graduation-gate' -Arguments @(
  $tsx, 'scripts/component-graduation-report.mts',
  '--report', 'tests/unit/fixtures/memory-authority/acceptance/TF-0497/component-graduation-report.json',
  '--root', '.', '--current-default-mode', 'opt-in', '--require-graduation'
) -DisplayCommand 'component-graduation-report.mts --report <TF-0497 report> --root . --current-default-mode opt-in --require-graduation'

$sumLines = Get-Content -LiteralPath (Join-Path $outputDir 'SHA256SUMS') -Encoding UTF8
$sumChecks = foreach ($line in $sumLines) {
  if (-not $line.Trim()) { continue }
  $parts = $line -split '  ', 2
  $expected = $parts[0]
  $fileName = $parts[1]
  $actual = (Get-FileHash -LiteralPath (Join-Path $root $fileName) -Algorithm SHA256).Hash.ToLowerInvariant()
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
  outputPath = 'tests/unit/fixtures/memory-authority/acceptance/TF-0497/12-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }

$ledger = [ordered]@{
  schemaVersion = 'MemoryAuthorityVerification/v1'
  taskForestNodeId = 'TF-0497'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'
  actor = 'codex-long-session-r2'
  status = $status
  gates = $results
  sha256sums = $sumChecks
}
$ledgerPath = Join-Path $outputDir 'verification.json'
[System.IO.File]::WriteAllText($ledgerPath, (($ledger | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
Write-Output ($ledger | ConvertTo-Json -Depth 10)
if ($status -ne 'pass') { exit 1 }
