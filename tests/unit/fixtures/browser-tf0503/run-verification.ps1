$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$outputDir = Join-Path $root 'tests/unit/fixtures/browser-tf0503'
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
    outputPath = "tests/unit/fixtures/browser-tf0503/$Id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Invoke-CapturedGate -Id '01-guard-unit' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run',
  'tests/unit/browser-private-network-tf0503.test.ts',
  'tests/unit/browser-navigation-guard-tf0503.test.ts',
  'tests/unit/browser-session-reap-tf0503.test.ts',
  'tests/unit/browser-supervised-capability-tf0503.test.ts',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'browser guard, reaper and supervised capability suites'

$results += Invoke-CapturedGate -Id '02-browser-regression' -Arguments @(
  $pnpm, 'exec', 'vitest', 'run',
  'tests/unit/agent-browser-tool.test.ts',
  'tests/unit/agent-browser-gateway-bridge.test.ts',
  'tests/unit/versebrowser-model-action-capabilities.test.ts',
  'tests/unit/versebrowser-capability-gating.test.ts',
  'tests/unit/versebrowser-task-session-conservation.test.ts',
  'tests/unit/browser-workbench.test.tsx',
  '--maxWorkers=1', '--reporter=dot'
) -DisplayCommand 'existing browser and versebrowser suites'

# 02b: real Electron path (unmocked host:invoke) for the supervised task capability.
# Deliberately excludes tests/e2e/browser-security-recovery.spec.ts: that TF-0005 spec
# rewrites the tracked artifacts/browser-security-recovery/evidence.json, which lives
# outside this node's allowed paths.
$results += Invoke-CapturedGate -Id '02b-electron-real' -Arguments @(
  $pnpm, 'exec', 'playwright', 'test',
  'tests/e2e/browser-supervised-task-tf0503.spec.ts',
  '--reporter=line'
) -DisplayCommand 'real Electron supervised browser path'

$results += Invoke-CapturedGate -Id '03-typecheck' -Arguments @($pnpm, 'run', 'typecheck') -DisplayCommand 'pnpm run typecheck'
$results += Invoke-CapturedGate -Id '04-lint-check' -Arguments @($pnpm, 'run', 'lint:check') -DisplayCommand 'pnpm run lint:check'
$results += Invoke-CapturedGate -Id '05-contract-check' -Arguments @($pnpm, 'run', 'contract:check') -DisplayCommand 'pnpm run contract:check'
$results += Invoke-CapturedGate -Id '06-no-bom' -Arguments @('node', 'scripts/check-no-bom.mjs') -DisplayCommand 'node scripts/check-no-bom.mjs'
$results += Invoke-CapturedGate -Id '07-diff-check' -Arguments @('git', 'diff', '--check') -DisplayCommand 'git diff --check'

# 08: the guard must be wired into the live host path, not just exported.
$apiFile = Join-Path $root 'electron/services/agent-browser-api.ts'
$api = Get-Content -LiteralPath $apiFile -Raw
$policyFile = Join-Path $root 'shared/agent-browser/private-network-policy.ts'
$policy = Get-Content -LiteralPath $policyFile -Raw
$enforced = if ($api -match 'assertBrowserNavigationAllowed\(prop, args\[0\]\)') { 1 } else { 0 }
$imported = if ($api -match 'private-network-policy') { 1 } else { 0 }
$reaped = if ($api -match 'closeAllAgentBrowserSessions') { 1 } else { 0 }
$defaultDeny = if ($policy -match 'private-network-default-deny') { 1 } else { 0 }
$wired = if ($api -match 'registerAgentBrowserShutdownReaper\(\);') { 1 } else { 0 }
$gateStatus = if ($enforced -eq 1 -and $imported -eq 1 -and $reaped -eq 1 -and $defaultDeny -eq 1 -and $wired -eq 1) { 'pass' } else { 'fail' }
$gatePath = Join-Path $outputDir '08-navigation-guard-wired.txt'
$gateLines = @(
  "guard_wired_in_host_path=$enforced",
  "policy_imported=$imported",
  "session_reaper_present=$reaped",
  "default_deny_literal=$defaultDeny",
  "reaper_invoked_during_adapter_build=$wired"
)
[System.IO.File]::WriteAllText($gatePath, (($gateLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '08-navigation-guard-wired'; command = 'static audit: guard and reaper actually wired'
  exitCode = if ($gateStatus -eq 'pass') { 0 } else { 1 }; status = $gateStatus
  outputPath = 'tests/unit/fixtures/browser-tf0503/08-navigation-guard-wired.txt'
  outputSha256 = (Get-FileHash -LiteralPath $gatePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 09: scope audit against the guard allowed paths.
$allowedPrefixes = @(
  'electron/services/agent-browser-',
  'src/pages/Browser/',
  'src/components/agent-browser/',
  'shared/agent-browser/',
  'tests/unit/',
  'tests/e2e/'
)
$changed = @(& git -C $root diff --name-only) + @(& git -C $root ls-files --others --exclude-standard)
$outside = @($changed | Where-Object {
  $p = $_ -replace '\\', '/'
  -not (@($allowedPrefixes | Where-Object { $p.StartsWith($_) }).Count -gt 0)
})
$scopeStatus = if ($outside.Count -eq 0) { 'pass' } else { 'fail' }
$scopePath = Join-Path $outputDir '09-scope-audit.txt'
$scopeLines = @(
  "changed_files=$($changed.Count)",
  "outside_allowed_paths=$($outside.Count)"
) + @($outside | ForEach-Object { "OUTSIDE: $_" })
[System.IO.File]::WriteAllText($scopePath, (($scopeLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '09-scope-audit'; command = 'git scope audit against node allowed paths'
  exitCode = if ($scopeStatus -eq 'pass') { 0 } else { 1 }; status = $scopeStatus
  outputPath = 'tests/unit/fixtures/browser-tf0503/09-scope-audit.txt'
  outputSha256 = (Get-FileHash -LiteralPath $scopePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# 10: the evidence pack hashes must match the files on disk.
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
$sumPath = Join-Path $outputDir '10-sha256sums-check.txt'
[System.IO.File]::WriteAllText($sumPath, (($sumChecks | ConvertTo-Json -Depth 5) + [Environment]::NewLine + "SHA256SUMS_STATUS=$sumStatus" + [Environment]::NewLine), $utf8NoBom)
$results += [ordered]@{
  id = '10-sha256sums-check'; command = 'PowerShell SHA256 recompute'
  exitCode = if ($sumStatus -eq 'pass') { 0 } else { 1 }; status = $sumStatus
  outputPath = 'tests/unit/fixtures/browser-tf0503/10-sha256sums-check.txt'
  outputSha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$status = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$ledger = [ordered]@{
  schemaVersion = 'BrowserSupervisedTaskVerification/v1'
  taskForestNodeId = 'TF-0503'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'; actor = 'codex'
  status = $status
  graduationStatus = if ($status -eq 'pass') { 'graduated-per-implementation-gates' } else { 'not-graduated' }
  gates = $results
}
[System.IO.File]::WriteAllText((Join-Path $outputDir 'verification.json'), (($ledger | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
Write-Output ($ledger | ConvertTo-Json -Depth 10)
if ($status -ne 'pass') { exit 1 }