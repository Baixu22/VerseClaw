$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$out = Join-Path $root 'tests/unit/fixtures/surface-cleanup-tf0505'
$env:TEMP = 'D:\tmp'; $env:TMP = 'D:\tmp'; $env:PLAYWRIGHT_BROWSERS_PATH = 'D:\tmp\playwright-browsers'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$results = @()
function Gate([string]$id, [string[]]$argv, [string]$display) {
  $path = Join-Path $out "$id.txt"
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $argv[0] @($argv[1..($argv.Count - 1)]) 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  $clean = (($output -replace "`r`n", "`n") -split "`n" | ForEach-Object { $_.TrimEnd() }) -join "`n"
  [IO.File]::WriteAllText($path, $clean, $utf8)
  return [ordered]@{ id=$id; command=$display; exitCode=$code; status=$(if($code -eq 0){'pass'}else{'fail'}); outputPath="tests/unit/fixtures/surface-cleanup-tf0505/$id.txt"; outputSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$pnpm=(Get-Command pnpm.cmd -ErrorAction Stop).Source
$node=(Get-Command node.exe -ErrorAction Stop).Source
$results += Gate '01-unit' @($pnpm,'exec','vitest','run','tests/unit/surface-access-tf0505.test.ts','tests/unit/memory-tf0500-retirement.test.ts','tests/unit/component-disposition-catalog.test.ts','tests/unit/model-capability-profile.test.ts','tests/unit/context-assembly-authority-tf0493.test.ts','tests/unit/context-control-plane-stage6-contracts.test.ts','tests/unit/settings-page-remote-control.test.tsx','tests/unit/vtoken-tf0496-decision.test.ts','--maxWorkers=1','--reporter=dot') 'focused TF-0505, catalog, Settings, Context Orchestrator and VToken retirement suites'
$results += Gate '02-typecheck' @($pnpm,'run','typecheck') 'pnpm run typecheck'
$results += Gate '03-i18n-lint' @($pnpm,'run','i18n:lint') 'pnpm run i18n:lint'
$results += Gate '04-lint-check' @($pnpm,'run','lint:check') 'pnpm run lint:check'
$results += Gate '05-contract-check' @($pnpm,'run','contract:check') 'pnpm run contract:check'
$results += Gate '06-no-bom' @($node,'scripts/check-no-bom.mjs') 'node scripts/check-no-bom.mjs'
$results += Gate '07-diff-check' @('git','diff','--check') 'git diff --check'
$results += Gate '08-scope-guard' @($node,'.agent-workbench/component-graduation/check-scope.mjs','--require-node','TF-0505','--json') 'TF-0505 scope guard'
$results += Gate '09-build-vite' @($pnpm,'run','build:vite') 'pnpm run build:vite'
$results += Gate '10-e2e' @($pnpm,'exec','playwright','test','tests/e2e/developer-mode.spec.ts','tests/e2e/image-generation-settings.spec.ts','tests/e2e/vtoken-bridge-settings.spec.ts','--workers=1','--reporter=line') 'Electron E2E for developer, image-generation and VToken surfaces'
& (Join-Path $out 'generate-acceptance.ps1') | Out-Null
$gateStatus = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$verification=[ordered]@{schemaVersion='SurfaceCleanupVerification/v1';taskForestNodeId='TF-0505';generatedAt=(Get-Date).ToUniversalTime().ToString('o');driven_by='agent';actor='codex';status=$gateStatus;completionVerdict=$(if($gateStatus -eq 'pass'){'complete'}else{'blocked'});gates=$results}
[IO.File]::WriteAllText((Join-Path $out 'verification.json'),(($verification|ConvertTo-Json -Depth 12)+"`n"),$utf8)
$hashFiles=Get-ChildItem -LiteralPath $out -File | Where-Object { $_.Name -notin @('SHA256SUMS','sha256sums-check.txt') } | Sort-Object Name
$sums=foreach($file in $hashFiles){$relative='tests/unit/fixtures/surface-cleanup-tf0505/'+$file.Name;$hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant();"$hash  $relative"}
[IO.File]::WriteAllText((Join-Path $out 'SHA256SUMS'),(($sums -join "`n")+"`n"),$utf8)
$checks=foreach($line in Get-Content -LiteralPath (Join-Path $out 'SHA256SUMS')){$parts=$line -split '  ',2;$actual=(Get-FileHash -LiteralPath (Join-Path $root $parts[1]) -Algorithm SHA256).Hash.ToLowerInvariant();[ordered]@{file=$parts[1];expected=$parts[0];actual=$actual;status=$(if($actual -eq $parts[0]){'pass'}else{'fail'})}}
$sumStatus=if(@($checks|Where-Object{$_.status -ne 'pass'}).Count -eq 0){'pass'}else{'fail'}
[IO.File]::WriteAllText((Join-Path $out 'sha256sums-check.txt'),(($checks|ConvertTo-Json -Depth 5)+"`nSHA256SUMS_STATUS=$sumStatus`n"),$utf8)
if($gateStatus -ne 'pass' -or $sumStatus -ne 'pass'){exit 1}