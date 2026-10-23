$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/memory-tf0500'
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
    outputPath = "tests/unit/fixtures/memory-tf0500/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-tf0500-acceptance' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/memory-tf0500-retirement.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'TF-0500 acceptance: dreams gating, single authority, retired injection'

$results += Invoke-CapturedGate -Id '02-surface-and-locks' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run',
  'tests/unit/compass-experience-validation.test.ts',
  'tests/unit/default-config-matrix.test.ts',
  'tests/unit/vtoken-bridge.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'superseded compass benefits, config matrix and vtoken locks'

$results += Invoke-CapturedGate -Id '03-runtime-memory-sweep' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/runtime-core/memory-pre-reply-injection.top5-lines.test.ts',
  'src/runtime-core/memory-runtime-config.test.ts',
  'src/runtime-core/memory-effect-receipt.test.ts',
  'src/runtime-core/memory-hybrid-retrieval.cjk.test.ts',
  'src/context-engine/context-orchestrator.test.ts',
  'src/context-engine/memory-context-provider.test.ts',
  'src/context-engine/handlers/compass-handler.test.ts',
  'src/context-engine/memory-injection-receipt.read.test.ts',
  'src/context-engine/chat-turn-vtoken-injection.test.ts',
  'src/context-engine/chat-turn-memory-injection.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'runtime-core and context-engine memory suites'

$results += Invoke-CapturedGate -Id '04-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '05-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '06-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '07-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '08-diff-check' -Arguments @('git', 'diff', '--check') -DisplayCommand 'git diff --check'

# 09: static audit - dreams gated, parallel injection retired, legacy flags retired.
$app = Get-Content -LiteralPath (Join-Path $root 'src/App.tsx') -Raw
$sidebar = Get-Content -LiteralPath (Join-Path $root 'src/components/layout/Sidebar.tsx') -Raw
$injection = Get-Content -LiteralPath (Join-Path $root 'openclaw_runtime/src/runtime-core/memory-pre-reply-injection.ts') -Raw
$config = Get-Content -LiteralPath (Join-Path $root 'openclaw_runtime/src/runtime-core/memory-runtime-config.ts') -Raw
$context = Get-Content -LiteralPath (Join-Path $root 'openclaw_runtime/src/runtime-core/memory-context.ts') -Raw
$dreamsRoute = if ($app -match 'path="/dreams"' -and $app -match 'devModeUnlocked') { 1 } else { 0 }
$dreamsEntry = if ($sidebar -match 'sidebar-more-dreams' -and $sidebar -match '\{devModeUnlocked && \(') { 1 } else { 0 }
$injectionRetired = if ($injection -match 'COMPASS_PRE_REPLY_INJECTION_RETIRED') { 1 } else { 0 }
$compassFlagsRetired = if ($config -match 'RETIRED_MEMORY_INJECTION_FLAGS') { 1 } else { 0 }
$legacyFlagsRetired = if ($context -match 'RETIRED_RUNTIME_MEMORY_FLAGS') { 1 } else { 0 }
$auditStatus = if ($dreamsRoute -eq 1 -and $dreamsEntry -eq 1 -and $injectionRetired -eq 1 -and $compassFlagsRetired -eq 1 -and $legacyFlagsRetired -eq 1) { 'pass' } else { 'fail' }
$auditPath = Join-Path $outputDir '09-retirement-audit.txt'
$auditLines = @(
  "dreams_route_dev_gated=$dreamsRoute",
  "dreams_sidebar_entry_dev_gated=$dreamsEntry",
  "pre_reply_injection_retired=$injectionRetired",
  "compass_injection_flags_retired=$compassFlagsRetired",
  "legacy_runtime_memory_flags_retired=$legacyFlagsRetired"
)
[System.IO.File]::WriteAllText($auditPath, (($auditLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '09-retirement-audit'; command = 'static audit: dreams gated and parallel memory paths retired'
  exitCode = if ($auditStatus -eq 'pass') { 0 } else { 1 }; status = $auditStatus
  outputPath = 'tests/unit/fixtures/memory-tf0500/09-retirement-audit.txt'
  outputSha256 = (Get-FileHash -LiteralPath $auditPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 10: scope audit (includes staged paths, so a force-added doc still counts).
$allowedPrefixes = @('src/App.tsx', 'src/pages/Dreams/', 'src/components/layout/Sidebar.tsx', 'openclaw_runtime/src/memory/', 'openclaw_runtime/src/runtime-core/memory-', 'tests/unit/', 'tests/e2e/', 'openclaw_runtime/src/context-engine/')
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
  outputPath = 'tests/unit/fixtures/memory-tf0500/10-scope-audit.txt'
  outputSha256 = (Get-FileHash -LiteralPath $scopePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 11: evidence pack hashes must match disk.
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
  outputPath = 'tests/unit/fixtures/memory-tf0500/11-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'MemoryDreamsRetirementVerification/v1'
  taskForestNodeId = 'TF-0500'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'; actor = 'codex'
  status = $status
  graduationStatus = if ($status -eq 'pass') { 'graduated-per-implementation-gates' } else { 'not-graduated' }
  gates = $results
}
[System.IO.File]::WriteAllText((Join-Path $outputDir 'verification.json'), (($ledger | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
Write-Output ($ledger | ConvertTo-Json -Depth 10)
if ($status -ne 'pass') { exit 1 }