$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/memory-authority/acceptance/TF-0498'
$tmpRoot = 'D:\tmp'
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
$env:TEMP = $tmpRoot
$env:TMP = $tmpRoot
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
    outputPath = "tests/unit/fixtures/memory-authority/acceptance/TF-0498/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-memory-surface-contract' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run',
  'tests/unit/memory-surface-contract.test.ts',
  'tests/unit/roles-orchestration-panel.test.tsx',
  'tests/unit/propose-facts-confirm-queue.test.tsx',
  'tests/unit/role-memory-v2.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'pnpm exec vitest run <TF-0498 memory surface + candidate isolation suites>'

$results += Invoke-CapturedGate -Id '02-gateway-close-semantics' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run',
  'tests/unit/role-orchestration-methods.test.ts',
  'tests/unit/role-memory-context-provider.test.ts',
  'tests/unit/memory-gateway-handlers.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'pnpm exec vitest run <TF-0498 close/retrieval consumer suites>'

$results += Invoke-CapturedGate -Id '03-memory-surface-e2e' -Arguments @(
  $pnpm, 'exec', 'playwright', 'test',
  'tests/e2e/memory-surface.spec.ts',
  'tests/e2e/role-memory-panel.spec.ts',
  'tests/e2e/agents-propose-facts-confirm.spec.ts',
  '--reporter=line'
) -DisplayCommand 'pnpm exec playwright test <TF-0498 Memory panel + candidate queue E2E>'

$results += Invoke-CapturedGate -Id '04-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '05-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '06-catalogs-check' -Arguments @($pnpm, 'run', 'catalogs:check') -DisplayCommand 'pnpm run catalogs:check'
$results += Invoke-CapturedGate -Id '07-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '08-i18n-lint' -Arguments @('node', 'scripts/i18n-lint.mjs') -DisplayCommand 'node scripts/i18n-lint.mjs'
$results += Invoke-CapturedGate -Id '09-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '10-diff-check' -Arguments @('git', 'diff', '--check', '--', 'src/components/agents/memory-surface.ts', 'src/components/agents/RolesOrchestrationPanel.tsx', 'src/pages/Agents/index.tsx', 'shared/i18n/locales', 'tests/unit/memory-surface-contract.test.ts', 'tests/unit/roles-orchestration-panel.test.tsx', 'tests/e2e/memory-surface.spec.ts', 'tests/e2e/role-memory-panel.spec.ts', 'tests/e2e/agents-propose-facts-confirm.spec.ts', 'tests/unit/fixtures/memory-authority/acceptance/TF-0498/generate-acceptance.mts', 'tests/unit/fixtures/memory-authority/acceptance/TF-0498/run-verification.ps1') -DisplayCommand 'git diff --check -- <TF-0498 source, tests, verifier paths>'
$results += Invoke-CapturedGate -Id '11-build-vite' -Arguments @($pnpm, 'run', 'build:vite') -DisplayCommand 'pnpm run build:vite'
& $tsx 'tests/unit/fixtures/memory-authority/acceptance/TF-0498/generate-acceptance.mts' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'TF-0498 evidence generation failed' }
$results += Invoke-CapturedGate -Id '12-component-graduation-gate' -Arguments @(
  $tsx, 'scripts/component-graduation-report.mts',
  '--report', 'tests/unit/fixtures/memory-authority/acceptance/TF-0498/component-graduation-report.json',
  '--root', '.', '--current-default-mode', 'opt-in', '--require-graduation'
) -DisplayCommand 'component-graduation-report.mts --report <TF-0498 report> --root . --current-default-mode opt-in --require-graduation'

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
$sumPath = Join-Path $outputDir '13-sha256sums-check.txt'
[System.IO.File]::WriteAllText($sumPath, $sumOutput, $utf8NoBom)
$results += [ordered]@{
  id = '13-sha256sums-check'
  command = 'PowerShell SHA256 recompute against SHA256SUMS'
  exitCode = if ($sumStatus -eq 'pass') { 0 } else { 1 }
  status = $sumStatus
  outputPath = 'tests/unit/fixtures/memory-authority/acceptance/TF-0498/13-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'MemoryProductSurfaceVerification/v1'
  taskForestNodeId = 'TF-0498'
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
