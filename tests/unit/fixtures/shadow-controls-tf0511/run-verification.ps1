$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$out = Join-Path $root 'tests/unit/fixtures/shadow-controls-tf0511'
$env:TEMP = 'D:\tmp'; $env:TMP = 'D:\tmp'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$utf8 = New-Object System.Text.UTF8Encoding($false)
$results = @()

function Gate([string]$id, [string[]]$argv, [string]$display) {
  $path = Join-Path $out "$id.txt"
  $output = & $argv[0] @($argv[1..($argv.Count - 1)]) 2>&1 | Out-String
  $code = $LASTEXITCODE
  [IO.File]::WriteAllText($path, $output, $utf8)
  return [ordered]@{
    id = $id; command = $display; exitCode = $code
    status = if ($code -eq 0) { 'pass' } else { 'fail' }
    outputPath = "tests/unit/fixtures/shadow-controls-tf0511/$id.txt"
    outputSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$results += Gate '01-manifest-tests' @($pnpm, 'exec', 'vitest', 'run', 'tests/unit/component-disposition-catalog.test.ts', 'tests/unit/shadow-controls-tf0511-scope-conflict.test.ts', 'tests/unit/feature-leaf-consumers.test.ts', 'tests/unit/routing-memo.test.ts', '--maxWorkers=1', '--reporter=dot') 'component disposition, TF-0511 guard, feature leaf consumer and Routing Memo suites'
$results += Gate '02-compass' @($pnpm, '--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run', 'src/context-engine/context-orchestrator.compass.test.ts', 'src/context-engine/assembler.test.ts', 'src/config/runtime-context-block-compass.test.ts', '--maxWorkers=1', '--reporter=dot') 'COMPASS retired pre-reply, DCS candidate and config suites'
$results += Gate '03-typecheck' @($pnpm, 'run', 'typecheck') 'pnpm run typecheck'
$results += Gate '04-lint-check' @($pnpm, 'run', 'lint:check') 'pnpm run lint:check'
$results += Gate '05-contract-check' @($pnpm, 'run', 'contract:check') 'pnpm run contract:check'
$results += Gate '06-no-bom' @($node, 'scripts/check-no-bom.mjs') 'node scripts/check-no-bom.mjs'
$results += Gate '07-diff-check' @('git', 'diff', '--check') 'git diff --check'
$results += Gate '08-feature-leaf-consumer' @($node, 'scripts/check-feature-leaf-consumers.mjs', '--json') 'feature leaf consumer guard'

$scopeOutput = & $node '.agent-workbench/component-graduation/check-scope.mjs' '--require-node' 'TF-0511' '--json' 2>&1 | Out-String
$scopeCode = $LASTEXITCODE
$scopePath = Join-Path $out '09-scope-guard.txt'
[IO.File]::WriteAllText($scopePath, $scopeOutput, $utf8)
$results += [ordered]@{
  id = '09-scope-guard'; command = 'TF-0511 guard with expanded catalog/checker authority'
  exitCode = $scopeCode; status = if ($scopeCode -eq 0) { 'pass' } else { 'fail' }
  outputPath = 'tests/unit/fixtures/shadow-controls-tf0511/09-scope-guard.txt'
  outputSha256 = (Get-FileHash -LiteralPath $scopePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$commit = (& git -C $root rev-parse HEAD).Trim()
$tree = (& git -C $root rev-parse 'HEAD^{tree}').Trim()
$env:TF0511_BINDING_COMMIT = $commit
$env:TF0511_BINDING_TREE = $tree
$tsx = Join-Path $root 'openclaw_runtime/node_modules/.bin/tsx.CMD'
$genOutput = & $tsx 'tests/unit/fixtures/shadow-controls-tf0511/generate-acceptance.mts' 2>&1 | Out-String
$genCode = $LASTEXITCODE
$genPath = Join-Path $out '10-regenerate-acceptance.txt'
[IO.File]::WriteAllText($genPath, $genOutput, $utf8)
$readback = if (Test-Path (Join-Path $out 'catalog-readback.json')) { Get-Content -LiteralPath (Join-Path $out 'catalog-readback.json') -Raw | ConvertFrom-Json } else { $null }
$acceptance = if (Test-Path (Join-Path $out 'acceptance.json')) { Get-Content -LiteralPath (Join-Path $out 'acceptance.json') -Raw | ConvertFrom-Json } else { $null }
$genPass = $genCode -eq 0 -and $readback -and $acceptance -and $readback.completionVerdict -eq 'complete' -and $acceptance.completionVerdict -eq 'complete'
$results += [ordered]@{
  id = '10-regenerate-acceptance'; command = 'recompute catalog readback and TF-0511 acceptance from the single-source catalog'
  exitCode = if ($genPass) { 0 } else { 1 }; status = if ($genPass) { 'pass' } else { 'fail' }
  outputPath = 'tests/unit/fixtures/shadow-controls-tf0511/10-regenerate-acceptance.txt'
  outputSha256 = (Get-FileHash -LiteralPath $genPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$gateStatus = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$verification = [ordered]@{
  schemaVersion = 'ShadowControlDispositionVerification/v1'
  taskForestNodeId = 'TF-0511'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'; actor = 'codex'
  baseCommit = $commit; baseTree = $tree
  status = $gateStatus
  completionVerdict = if ($readback) { [string]$readback.completionVerdict } else { 'missing' }
  everyArtifactResolves = if ($readback) { [bool]$readback.summary.everyArtifactResolves } else { $false }
  openExperiments = if ($readback) { $readback.summary.openExperiments } else { $null }
  componentsWithGaps = if ($readback) { $readback.summary.componentsWithGaps } else { $null }
  gates = $results
}
[IO.File]::WriteAllText((Join-Path $out 'verification.json'), (($verification | ConvertTo-Json -Depth 12) + "`n"), $utf8)

$hashFiles = Get-ChildItem -LiteralPath $out -File | Where-Object { $_.Name -notin @('SHA256SUMS','sha256sums-check.txt') } | Sort-Object Name
$sums = foreach ($file in $hashFiles) {
  $relative = 'tests/unit/fixtures/shadow-controls-tf0511/' + $file.Name
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
