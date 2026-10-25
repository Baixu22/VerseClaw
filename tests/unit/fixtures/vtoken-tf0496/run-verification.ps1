$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/vtoken-tf0496'
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
    outputPath = "tests/unit/fixtures/vtoken-tf0496/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-decision-consistency' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/vtoken-tf0496-decision.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'A/B decision consistency and retirement invariants'

$results += Invoke-CapturedGate -Id '02-retirement-unit' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run',
  'tests/unit/vtoken-bridge.test.ts',
  'tests/unit/vtoken-launch-default.test.ts',
  'tests/unit/vtoken-default-off-documentation.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'host bridge retirement suites'

$results += Invoke-CapturedGate -Id '03-runtime-injection' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/context-engine/chat-turn-vtoken-injection.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'runtime vtoken injection retirement suite'

$results += Invoke-CapturedGate -Id '04-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '05-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '06-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '07-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '08-diff-check' -Arguments @('git', 'diff', '--check') -DisplayCommand 'git diff --check'

# 09: static audit - retirement is real and the decision is recorded on disk.
$injection = Get-Content -LiteralPath (Join-Path $root 'openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts') -Raw
$bridge = Get-Content -LiteralPath (Join-Path $root 'electron/services/vtoken-bridge.ts') -Raw
$docPath = Join-Path $root 'docs/dev/vtoken-retirement-decision.md'
$runPath2 = Join-Path $outputDir 'ab-run.json'
$runJson = if (Test-Path $runPath2) { Get-Content -LiteralPath $runPath2 -Raw | ConvertFrom-Json } else { $null }
$retiredRuntime = if ($injection -match 'VTOKEN_RETIRED') { 1 } else { 0 }
$retiredHost = if ($bridge -match 'VTOKEN_BRIDGE_RETIRED') { 1 } else { 0 }
$envIgnored = if ($bridge -match 'return false;') { 1 } else { 0 }
$docPresent = if (Test-Path $docPath) { 1 } else { 0 }
$runDecision = if ($runJson) { [string]$runJson.decision.status } else { 'missing' }
$runPairs = if ($runJson) { [int]$runJson.summary.pairs } else { -1 }
$runErrors = if ($runJson) { [int]$runJson.summary.providerErrors } else { -1 }
$auditStatus = if ($retiredRuntime -eq 1 -and $retiredHost -eq 1 -and $envIgnored -eq 1 -and $docPresent -eq 1 -and $runDecision -eq 'retire-or-hold' -and $runPairs -eq 30 -and $runErrors -eq 0) { 'pass' } else { 'fail' }
$auditPath = Join-Path $outputDir '09-retirement-audit.txt'
$auditLines = @(
  "runtime_retired_flag=$retiredRuntime",
  "host_retired_flag=$retiredHost",
  "host_env_path_returns_false=$envIgnored",
  "retirement_doc_present=$docPresent",
  "run_decision=$runDecision",
  "run_pairs=$runPairs",
  "run_provider_errors=$runErrors"
)
[System.IO.File]::WriteAllText($auditPath, (($auditLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '09-retirement-audit'; command = 'static audit: retirement applied and decision recorded'
  exitCode = if ($auditStatus -eq 'pass') { 0 } else { 1 }; status = $auditStatus
  outputPath = 'tests/unit/fixtures/vtoken-tf0496/09-retirement-audit.txt'
  outputSha256 = (Get-FileHash -LiteralPath $auditPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 10: scope audit against the guard allowed paths.
$allowedPrefixes = @('packages/vtoken/', 'electron/services/vtoken-', 'openclaw_runtime/src/context-engine/', 'docs/dev/', 'tests/unit/')
# Include staged paths too, so a force-added doc under the ignored /docs/** still counts.
$changed = @(& git -C $root status --porcelain=v1) | ForEach-Object { ($_ -replace '^..\s+', '') -replace '"', '' } | Where-Object { $_ }
$changed += @(& git -C $root ls-files --others --exclude-standard)
$changed = @($changed | Sort-Object -Unique)
$outside = @($changed | Where-Object {
  $p = $_ -replace '\\', '/'
  -not (@($allowedPrefixes | Where-Object { $p.StartsWith($_) }).Count -gt 0)
})
$scopeStatus = if ($outside.Count -eq 0) { 'pass' } else { 'fail' }
$scopePath = Join-Path $outputDir '10-scope-audit.txt'
$scopeLines = @("changed_files=$($changed.Count)", "outside_allowed_paths=$($outside.Count)") + @($outside | ForEach-Object { "OUTSIDE: $_" })
[System.IO.File]::WriteAllText($scopePath, (($scopeLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '10-scope-audit'; command = 'git scope audit against node allowed paths'
  exitCode = if ($scopeStatus -eq 'pass') { 0 } else { 1 }; status = $scopeStatus
  outputPath = 'tests/unit/fixtures/vtoken-tf0496/10-scope-audit.txt'
  outputSha256 = (Get-FileHash -LiteralPath $scopePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 11: the evidence pack hashes must match the files on disk.
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
$sumPath = Join-Path $outputDir '11-sha256sums-check.txt'
[System.IO.File]::WriteAllText($sumPath, (($sumChecks | ConvertTo-Json -Depth 5) + [Environment]::NewLine + "SHA256SUMS_STATUS=$sumStatus" + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '11-sha256sums-check'; command = 'PowerShell SHA256 recompute'
  exitCode = if ($sumStatus -eq 'pass') { 0 } else { 1 }; status = $sumStatus
  outputPath = 'tests/unit/fixtures/vtoken-tf0496/11-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'VTokenRetirementVerification/v1'
  taskForestNodeId = 'TF-0496'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'; actor = 'codex'
  status = $status
  graduationStatus = if ($status -eq 'pass') { 'decided-and-applied' } else { 'not-decided' }
  decidingRun = 'ab-run.json (protocol VTokenROIABProtocol/v1)'
  decision = if ($runJson) { $runJson.decision.status } else { 'missing' }
  gates = $results
}
[System.IO.File]::WriteAllText((Join-Path $outputDir 'verification.json'), (($ledger | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
Write-Output ($ledger | ConvertTo-Json -Depth 10)
if ($status -ne 'pass') { exit 1 }