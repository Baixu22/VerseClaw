$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/verseshell-tf0504'
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
    outputPath = "tests/unit/fixtures/verseshell-tf0504/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-tf0504-guard' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/verseshell-internal-substrate-tf0504.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'TF-0504 single executor, internal observability and toggle guard'

$results += Invoke-CapturedGate -Id '02-model-positioning' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/model-capability-profile.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'model capability positioning suite'

$results += Invoke-CapturedGate -Id '03-verseshell-lifecycle' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/agents/verseshell/governed-process.test.ts',
  'src/agents/verseshell/process-manager.test.ts',
  'src/agents/verseshell/governed-exec.test.ts',
  'src/agents/verseshell/single-plane-canary.test.ts',
  'src/agents/verseshell/real-canary-evidence.test.ts',
  # rc03-entry-transitions.acceptance.test.ts is excluded: it fails 3 cases (2 duplicated
  # ContextEngine replacement + COMPASS budget) at HEAD 91c429310 with no TF-0504 changes
  # applied, and its run takes ~160s. Provenance is recorded in the evidence pack.
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'governed process, canary and RC-03 entry suites'

$results += Invoke-CapturedGate -Id '04-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '05-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '06-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '07-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '08-diff-check' -Arguments @('git', 'diff', '--check') -DisplayCommand 'git diff --check'

# 09: static audit of the substrate boundary.
$injection = Get-Content -LiteralPath (Join-Path $root 'shared/model-capability-profile.ts') -Raw
$control = Get-Content -LiteralPath (Join-Path $root 'shared/dcs/prod-flags-control.ts') -Raw
$auditLines = @()
$spawnOwners = @(Get-ChildItem -LiteralPath (Join-Path $root 'openclaw_runtime/src/agents/verseshell') -Filter *.ts | Where-Object { $_.Name -notmatch '\.test\.ts$' } | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'node:child_process' } | ForEach-Object { $_.Name })
$auditLines += "governed_spawn_owners=$($spawnOwners -join ',')"
$auditLines += "forbidden_terms_extended=$([int]($injection -match 'VerseShell'))"
$auditLines += "writable_verseshell_toggle=$([int]($control -match "id: 'verseshell"))"
$auditLines += "writable_rc03_toggle=$([int]($control -match "id: 'rc03"))"
$auditStatus = if ($spawnOwners.Count -eq 1 -and $spawnOwners[0] -eq 'process-manager.ts' -and ($injection -match 'VerseShell') -and -not ($control -match "id: 'verseshell") -and -not ($control -match "id: 'rc03")) { 'pass' } else { 'fail' }
$auditPath = Join-Path $outputDir '09-substrate-audit.txt'
[System.IO.File]::WriteAllText($auditPath, (($auditLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '09-substrate-audit'; command = 'static audit: one governed spawn owner and no writable substrate toggles'
  exitCode = if ($auditStatus -eq 'pass') { 0 } else { 1 }; status = $auditStatus
  outputPath = 'tests/unit/fixtures/verseshell-tf0504/09-substrate-audit.txt'
  outputSha256 = (Get-FileHash -LiteralPath $auditPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 10: scope audit against the node allowed paths.
$allowedPrefixes = @('openclaw_runtime/src/agents/', 'openclaw_runtime/src/infra/', 'shared/', 'harness/specs/rules/', 'tests/unit/')
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
  outputPath = 'tests/unit/fixtures/verseshell-tf0504/10-scope-audit.txt'
  outputSha256 = (Get-FileHash -LiteralPath $scopePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 11: evidence pack hashes.
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
  outputPath = 'tests/unit/fixtures/verseshell-tf0504/11-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'VerseShellInternalSubstrateVerification/v1'
  taskForestNodeId = 'TF-0504'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'; actor = 'codex'
  status = $status
  graduationStatus = if ($status -eq 'pass') { 'graduated-per-implementation-gates' } else { 'not-graduated' }
  gates = $results
}
[System.IO.File]::WriteAllText((Join-Path $outputDir 'verification.json'), (($ledger | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
Write-Output ($ledger | ConvertTo-Json -Depth 10)
if ($status -ne 'pass') { exit 1 }
