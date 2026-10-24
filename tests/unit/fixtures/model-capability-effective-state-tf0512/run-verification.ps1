$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$out = Join-Path $root 'tests/unit/fixtures/model-capability-effective-state-tf0512'
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$results = @()

function Gate([string]$id, [string[]]$argv, [string]$display) {
  $path = Join-Path $out "$id.txt"
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $argv[0] @($argv[1..($argv.Count - 1)]) 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  $clean = (($output -replace "`r`n", "`n") -split "`n" | ForEach-Object { $_.TrimEnd() }) -join "`n"
  [IO.File]::WriteAllText($path, $clean, $utf8)
  return [ordered]@{
    id = $id
    command = $display
    exitCode = $code
    status = if ($code -eq 0) { 'pass' } else { 'fail' }
    outputPath = "tests/unit/fixtures/model-capability-effective-state-tf0512/$id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source

$results += Gate '01-focused-and-adjacent-tests' @($pnpm, 'exec', 'vitest', 'run', 'tests/unit/model-capability-effective-state-tf0512.test.ts', 'tests/unit/model-capability-profile.test.ts', 'tests/unit/context-shadow-adapter.test.ts', 'tests/unit/context-runtime-kit-active-engine.test.ts', 'tests/unit/context-engine-registry-default-on.test.ts', 'tests/unit/permission-contract-tf0509.test.ts', '--maxWorkers=1', '--reporter=dot') 'TF-0512 plus model profile, context-engine and permission-contract suites'
$results += Gate '02-typecheck' @($pnpm, 'run', 'typecheck') 'pnpm run typecheck'
$results += Gate '03-lint-check' @($pnpm, 'run', 'lint:check') 'pnpm run lint:check'
$results += Gate '04-contract-check' @($pnpm, 'run', 'contract:check') 'pnpm run contract:check'
$results += Gate '05-no-bom' @($node, 'scripts/check-no-bom.mjs') 'node scripts/check-no-bom.mjs'
$results += Gate '06-diff-check' @('git', 'diff', '--check') 'git diff --check'
$results += Gate '07-scope-guard' @($node, '.agent-workbench/component-graduation/check-scope.mjs', '--require-node', 'TF-0512', '--json') 'TF-0512 scope guard'
$results += Gate '08-regenerate-acceptance' @($pnpm, 'exec', 'vitest', 'run', 'tests/unit/model-capability-effective-state-tf0512.test.ts', '-t', 'regenerates the acceptance pack from current disk facts', '--maxWorkers=1', '--reporter=dot') 'regenerate acceptance from current disk facts'

$gateStatus = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$verification = [ordered]@{
  schemaVersion = 'ModelCapabilityEffectiveStateVerification/v1'
  taskForestNodeId = 'TF-0512'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'
  actor = 'codex'
  status = $gateStatus
  completionVerdict = if ($gateStatus -eq 'pass') { 'complete' } else { 'blocked' }
  gates = $results
}
[IO.File]::WriteAllText((Join-Path $out 'verification.json'), (($verification | ConvertTo-Json -Depth 12) + "`n"), $utf8)

$hashFiles = Get-ChildItem -LiteralPath $out -File | Where-Object { $_.Name -notin @('SHA256SUMS','sha256sums-check.txt') } | Sort-Object Name
$sums = foreach ($file in $hashFiles) {
  $relative = 'tests/unit/fixtures/model-capability-effective-state-tf0512/' + $file.Name
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $relative"
}
[IO.File]::WriteAllText((Join-Path $out 'SHA256SUMS'), (($sums -join "`n") + "`n"), $utf8)
$checks = foreach ($line in Get-Content -LiteralPath (Join-Path $out 'SHA256SUMS')) {
  $parts = $line -split '  ', 2
  $actual = (Get-FileHash -LiteralPath (Join-Path $root $parts[1]) -Algorithm SHA256).Hash.ToLowerInvariant()
  [ordered]@{ file = $parts[1]; expected = $parts[0]; actual = $actual; status = if ($actual -eq $parts[0]) { 'pass' } else { 'fail' } }
}
$sumStatus = if (@($checks | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
[IO.File]::WriteAllText((Join-Path $out 'sha256sums-check.txt'), (($checks | ConvertTo-Json -Depth 5) + "`nSHA256SUMS_STATUS=$sumStatus`n"), $utf8)
if ($gateStatus -ne 'pass' -or $sumStatus -ne 'pass') { exit 1 }
