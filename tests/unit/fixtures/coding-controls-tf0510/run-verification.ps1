$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/coding-controls-tf0510'
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
    outputPath = "tests/unit/fixtures/coding-controls-tf0510/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-tf0510-acceptance' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/coding-controls-tf0510.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'TF-0510 disposition ledger guard'

$results += Invoke-CapturedGate -Id '02-patch-flow' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/agents/patch-flow-graduation.test.ts', 'src/agents/patch-flow.test.ts',
  'src/agents/orchestration-patch-flow.test.ts', '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'patch-flow gate, serial apply and orchestration suites'

# patch-flow product trigger: config default OR explicit opt-in, gated on the advisory.
$results += Invoke-CapturedGate -Id '02b-patchflow-trigger' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/coding-controls-tf0510-patchflow-trigger.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'patch-flow product trigger suite'

$results += Invoke-CapturedGate -Id '03-stale-and-lease' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/agents/tools/stale-write-guard.test.ts',
  'src/agents/symbol-lease-guard.test.ts',
  'src/context-engine/factstore/symbol-lease.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'stale-write-guard and symbol-lease/WAL suites'

# False-block corpus: measures the stale guard false-block rate instead of asserting it.
$results += Invoke-CapturedGate -Id '03b-stale-false-block' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/agents/stale-write-guard.false-block.test.ts', '--maxWorkers=1', '--reporter=default'
) -DisplayCommand 'labelled stale-write false-block corpus'

# Real multi-process (multi-writer) benchmark for symbol-lease WAL mode.
$results += Invoke-CapturedGate -Id '03c-lease-multiprocess' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/coding-controls-tf0510-symbol-lease-benchmark.test.ts',
  '--maxWorkers=1', '--reporter=default'
) -DisplayCommand '4-process symbol-lease contention benchmark'

$results += Invoke-CapturedGate -Id '04-worktree-isolation' -Arguments @(
  $pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run',
  'src/agents/worktree-service.test.ts', 'src/agents/isolation-mode-matrix.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'worktree backend and isolation request suites'

$results += Invoke-CapturedGate -Id '05-root-worktree-wal' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run', 'tests/unit/orchestration-worktree-merge.test.ts',
  'tests/unit/resource-sqlite-wal.test.ts', 'tests/unit/tf0018-cross-workspace-session-isolation.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'worktree merge, sqlite WAL and session isolation suites'

# Retirement invariants: no entry point, no toggle, implementation preserved.
$retireAudit = Join-Path $outputDir '05b-retirement-invariants.txt'
$flagsSrc = Get-Content -LiteralPath (Join-Path $root 'openclaw_runtime/src/context-engine/coding-runtime-flags.ts') -Raw
$ctlSrc = Get-Content -LiteralPath (Join-Path $root 'shared/dcs/prod-flags-control.ts') -Raw
$toolSrc = Get-Content -LiteralPath (Join-Path $root 'openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts') -Raw
$catSrc = Get-Content -LiteralPath (Join-Path $root 'shared/dcs/component-disposition-catalog.ts') -Raw
$implKept = @(
  'openclaw_runtime/src/context-engine/factstore/symbol-lease.ts',
  'openclaw_runtime/src/agents/symbol-lease-guard.ts',
  'openclaw_runtime/src/agents/patch-flow.ts',
  'openclaw_runtime/src/agents/patch-flow-graduation.ts'
) | ForEach-Object { if (Test-Path (Join-Path $root $_)) { 1 } else { 0 } }
$retireLines = @(
  'symbol_lease_retired_flag=' + [int]($flagsSrc -match 'SYMBOL_LEASE_RETIRED = true'),
  'patch_flow_retired_flag=' + [int]($flagsSrc -match 'PATCH_FLOW_RETIRED = true'),
  'symbol_lease_writable_spec_removed=' + [int](-not ($ctlSrc -match "id: 'symbol-lease'")),
  'patchflow_tool_param_removed=' + [int](-not ($toolSrc -match 'patchFlowExecution: Type.Optional')),
  'catalog_symbol_lease_retired=' + [int]($catSrc -match "id: 'feature.symbol-lease'[^\n]*disposition: 'retired'"),
  'catalog_patch_flow_retired=' + [int]($catSrc -match "id: 'feature.patch-flow'[^\n]*disposition: 'retired'"),
  'implementations_preserved=' + ($implKept -join '')
)
[System.IO.File]::WriteAllText($retireAudit, (($retireLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8NoBom)
$retireText = ($retireLines -join [Environment]::NewLine)
$retireOk = ($retireText -match 'symbol_lease_retired_flag=1') -and ($retireText -match 'patch_flow_retired_flag=1') -and ($retireText -match 'symbol_lease_writable_spec_removed=1') -and ($retireText -match 'patchflow_tool_param_removed=1') -and ($retireText -match 'catalog_symbol_lease_retired=1') -and ($retireText -match 'catalog_patch_flow_retired=1') -and ($retireText -match 'implementations_preserved=1111')
$results += [ordered]@{
  id = '05b-retirement-invariants'; command = 'static audit: retired reachability removed, implementation preserved'
  exitCode = if ($retireOk) { 0 } else { 1 }; status = if ($retireOk) { 'pass' } else { 'fail' }
  outputPath = 'tests/unit/fixtures/coding-controls-tf0510/05b-retirement-invariants.txt'
  outputSha256 = (Get-FileHash -LiteralPath $retireAudit -Algorithm SHA256).Hash.ToLowerInvariant()
}

$results += Invoke-CapturedGate -Id '06-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '07-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '08-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '09-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '10-diff-check' -Arguments @('git', 'diff', '--check') -DisplayCommand 'git diff --check'

# 11: recompute the acceptance generator and read the verdict back from disk.
# tsx lives in the runtime workspace, not the repo root.
$tsx = Join-Path $root 'openclaw_runtime/node_modules/.bin/tsx.CMD'
$genLog = & $tsx 'tests/unit/fixtures/coding-controls-tf0510/generate-acceptance.mts' 2>&1 | Out-String
$genExit = $LASTEXITCODE
$genPath = Join-Path $outputDir '11-regenerate-evidence.txt'
[System.IO.File]::WriteAllText($genPath, $genLog, $utf8NoBom)
$generated = if (Test-Path (Join-Path $outputDir 'raw-evidence.json')) { Get-Content -LiteralPath (Join-Path $outputDir 'raw-evidence.json') -Raw | ConvertFrom-Json } else { $null }
$verdict = if ($generated) { [string]$generated.completionVerdict } else { 'missing' }
$everyArtifact = if ($generated) { [bool]$generated.summary.everyArtifactResolves } else { $false }
$regenStatus = if ($genExit -eq 0 -and $everyArtifact -and $verdict -ne 'missing') { 'pass' } else { 'fail' }
$results += [ordered]@{
  id = '11-regenerate-evidence'; command = 'recompute acceptance ledger from disk'
  exitCode = if ($regenStatus -eq 'pass') { 0 } else { 1 }; status = $regenStatus
  outputPath = 'tests/unit/fixtures/coding-controls-tf0510/11-regenerate-evidence.txt'
  outputSha256 = (Get-FileHash -LiteralPath $genPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 12: scope audit.
# Owner authorised the retirement decision on 2026-10-23, which includes the DCS records
# (shared/) and the coding flag resolvers (context-engine/) that own the retired entries.
$allowedPrefixes = @('openclaw_runtime/src/agents/', 'openclaw_runtime/src/context-engine/', 'shared/', 'tests/unit/', 'tests/e2e/')
$changed = @(& git -C $root status --porcelain=v1) | ForEach-Object { ($_ -replace '^..\s+', '') -replace '"', '' } | Where-Object { $_ }
$changed += @(& git -C $root ls-files --others --exclude-standard)
$changed = @($changed | Sort-Object -Unique)
$outside = @($changed | Where-Object { $p = $_ -replace '\\', '/'; -not (@($allowedPrefixes | Where-Object { $p.StartsWith($_) }).Count -gt 0) })
$scopeStatus = if ($outside.Count -eq 0) { 'pass' } else { 'fail' }
$scopePath = Join-Path $outputDir '12-scope-audit.txt'
$scopeLines = @("changed_files=$($changed.Count)", "outside_allowed_paths=$($outside.Count)") + @($outside | ForEach-Object { "OUTSIDE: $_" })
[System.IO.File]::WriteAllText($scopePath, (($scopeLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '12-scope-audit'; command = 'git scope audit against node allowed paths'
  exitCode = if ($scopeStatus -eq 'pass') { 0 } else { 1 }; status = $scopeStatus
  outputPath = 'tests/unit/fixtures/coding-controls-tf0510/12-scope-audit.txt'
  outputSha256 = (Get-FileHash -LiteralPath $scopePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 13: evidence pack hashes.
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
$sumPath = Join-Path $outputDir '13-sha256sums-check.txt'
[System.IO.File]::WriteAllText($sumPath, (($sumChecks | ConvertTo-Json -Depth 5) + [Environment]::NewLine + "SHA256SUMS_STATUS=$sumStatus" + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '13-sha256sums-check'; command = 'PowerShell SHA256 recompute'
  exitCode = if ($sumStatus -eq 'pass') { 0 } else { 1 }; status = $sumStatus
  outputPath = 'tests/unit/fixtures/coding-controls-tf0510/13-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$gatesPass = @($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0
$status = if ($gatesPass) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'CodingControlsDispositionVerification/v1'
  taskForestNodeId = 'TF-0510'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'; actor = 'codex'
  status = $status
  gatesStatus = $status
  completionVerdict = $verdict
  everyArtifactResolves = $everyArtifact
  componentsWithGaps = if ($generated) { @($generated.summary.componentsWithGaps) } else { @() }
  graduationStatus = if ($status -eq 'pass' -and $verdict -eq 'complete') { 'graduated' } else { 'not-graduated' }
  gates = $results
}
[System.IO.File]::WriteAllText((Join-Path $outputDir 'verification.json'), (($ledger | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
Write-Output ($ledger | ConvertTo-Json -Depth 10)
if ($status -ne 'pass') { exit 1 }
