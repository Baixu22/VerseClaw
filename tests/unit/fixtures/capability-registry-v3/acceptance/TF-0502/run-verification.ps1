$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502'
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
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
    id = $Id
    command = $DisplayCommand
    exitCode = $exitCode
    status = if ($exitCode -eq 0) { 'pass' } else { 'fail' }
    outputPath = "tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-catalog-unit' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/agents/tool-search-capability-catalog.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'openclaw_runtime capability catalog adapter suite'

$results += Invoke-CapturedGate -Id '02-v3-bridge' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/agents/tool-search-capability-v3.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'openclaw_runtime V3 bridge suite'

$results += Invoke-CapturedGate -Id '03-profile' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/model-capability-profile.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'pnpm exec vitest run tests/unit/model-capability-profile.test.ts'

$results += Invoke-CapturedGate -Id '04-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '05-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '06-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '07-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '08-diff-check' -Arguments @('git', 'diff', '--check') -DisplayCommand 'git diff --check'

$abPath = Join-Path $outputDir 'ab-run-v2.json'
$ab = Get-Content -LiteralPath $abPath -Raw | ConvertFrom-Json
$abStatus = if ($ab.decision.status -eq 'pass') { 'pass' } else { 'fail' }
$results += [ordered]@{
  id = '09-ab-readback'
  command = 'read ab-run-v2.json decision (deciding run)'
  exitCode = if ($abStatus -eq 'pass') { 0 } else { 1 }
  status = $abStatus
  outputPath = 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502/ab-run-v2.json'
  outputSha256 = (Get-FileHash -LiteralPath $abPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$sumPath = Join-Path $outputDir '10-sha256sums-check.txt'
$sumsPath = Join-Path $outputDir 'SHA256SUMS'
$sumChecks = @()
$sumStatus = 'fail'
if (Test-Path $sumsPath) {
  $sumChecks = foreach ($line in Get-Content -LiteralPath $sumsPath -Encoding UTF8) {
    if (-not $line.Trim()) { continue }
    $parts = $line -split '  ', 2
    $actual = (Get-FileHash -LiteralPath (Join-Path $root $parts[1]) -Algorithm SHA256).Hash.ToLowerInvariant()
    [ordered]@{ file = $parts[1]; expected = $parts[0]; actual = $actual; status = if ($actual -eq $parts[0]) { 'pass' } else { 'fail' } }
  }
  if ($sumChecks.Count -gt 0 -and @($sumChecks | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { $sumStatus = 'pass' }
}
$sumText = ($sumChecks | ConvertTo-Json -Depth 5) + [Environment]::NewLine + 'SHA256SUMS_STATUS=' + $sumStatus + [Environment]::NewLine
[System.IO.File]::WriteAllText($sumPath, $sumText, $utf8NoBom)
$results += [ordered]@{
  id = '10-sha256sums-check'
  command = 'PowerShell SHA256 recompute'
  exitCode = if ($sumStatus -eq 'pass') { 0 } else { 1 }
  status = $sumStatus
  outputPath = 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502/10-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$v1Path = Join-Path $outputDir 'ab-run-v1.json'
$v1 = Get-Content -LiteralPath $v1Path -Raw | ConvertFrom-Json
$v2ProtocolSha = (Get-FileHash -LiteralPath (Join-Path $outputDir 'ab-protocol-v2.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$v2Run = Get-Content -LiteralPath (Join-Path $outputDir 'ab-run-v2.json') -Raw | ConvertFrom-Json
$v1Preserved = ($v1.schemaVersion -eq 'CapabilityCatalogABRun/v1') -and ($v1.decision.status -eq 'fail')
$v2Bound = ($v2Run.protocolSha256 -eq $v2ProtocolSha) -and ($v2Run.decision.status -eq 'pass')
$preserveStatus = if ($v1Preserved -and $v2Bound) { 'pass' } else { 'fail' }
$preservePath = Join-Path $outputDir '11-historical-preservation.txt'
[System.IO.File]::WriteAllText($preservePath, ("v1_schema=" + $v1.schemaVersion + [Environment]::NewLine + "v1_decision=" + $v1.decision.status + [Environment]::NewLine + "v2_schema=" + $v2Run.schemaVersion + [Environment]::NewLine + "v2_decision=" + $v2Run.decision.status + [Environment]::NewLine + "v2_protocol_sha_matches=" + ($v2Run.protocolSha256 -eq $v2ProtocolSha) + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '11-historical-preservation'
  command = 'assert v1 verdict preserved and v2 bound to frozen protocol'
  exitCode = if ($preserveStatus -eq 'pass') { 0 } else { 1 }
  status = $preserveStatus
  outputPath = 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502/11-historical-preservation.txt'
  outputSha256 = (Get-FileHash -LiteralPath $preservePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'CapabilityCatalogImplementationVerification/v1'
  taskForestNodeId = 'TF-0502'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'
  actor = 'codex'
  status = $status
  graduationStatus = if ($status -eq 'pass') { 'graduated-per-implementation-gates' } else { 'not-graduated' }
  decidingRun = 'ab-run-v2.json (protocol v2.1)'
  historicalRun = 'ab-run-v1.json (verdict fail, preserved)'
  credentialHandling = 'TF0502_API_KEY supplied out-of-band by the repository owner for one run; not written to any file'
  gates = $results
  sha256sums = $sumChecks
}
[System.IO.File]::WriteAllText((Join-Path $outputDir 'verification.json'), (($ledger | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
Write-Output ($ledger | ConvertTo-Json -Depth 10)
if ($status -ne 'pass') { exit 1 }
