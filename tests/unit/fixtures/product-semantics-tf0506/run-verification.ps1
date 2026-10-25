$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$out = Join-Path $root 'tests/unit/fixtures/product-semantics-tf0506'
$env:TEMP = 'D:\tmp'; $env:TMP = 'D:\tmp'
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
  $status = if($code -eq 0){'pass'}else{'fail'}
  return [ordered]@{ id=$id; command=$display; exitCode=$code; status=$status; outputPath="tests/unit/fixtures/product-semantics-tf0506/$id.txt"; outputSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$pnpm=(Get-Command pnpm.cmd -ErrorAction Stop).Source
$node=(Get-Command node.exe -ErrorAction Stop).Source
$results += Gate '01-focused-tests' @($pnpm,'exec','vitest','run','tests/unit/component-authority-manifest.test.ts','tests/unit/component-disposition-catalog.test.ts','tests/unit/default-config-matrix.test.ts','tests/unit/first-product-claims.test.ts','tests/unit/capability-claims.test.ts','tests/unit/model-capability-profile.test.ts','--maxWorkers=1','--reporter=dot') 'six focused component/document/claim suites'
$results += Gate '02-typecheck' @($pnpm,'run','typecheck') 'pnpm run typecheck'
$results += Gate '03-i18n-lint' @($pnpm,'run','i18n:lint') 'pnpm run i18n:lint'
$results += Gate '04-lint' @($pnpm,'run','lint') 'pnpm run lint'
$results += Gate '05-contract-check' @($pnpm,'run','contract:check') 'pnpm run contract:check'
$results += Gate '06-catalogs-check' @($pnpm,'catalogs:check') 'pnpm catalogs:check'
$results += Gate '07-no-bom' @($node,'scripts/check-no-bom.mjs') 'node scripts/check-no-bom.mjs'
$results += Gate '08-claim-scan' @($node,'scripts/scan-first-product-claims.mjs') 'node scripts/scan-first-product-claims.mjs'
$results += Gate '09-diff-check' @('git','diff','--check') 'git diff --check'
$gateStatus = if (@($results | Where-Object { $_.status -ne 'pass' }).Count -eq 0) { 'pass' } else { 'fail' }
$verdict = if($gateStatus -eq 'pass'){'complete'}else{'blocked'}
$verification=[ordered]@{schemaVersion='ProductSemanticsVerification/v1';taskForestNodeId='TF-0506';generatedAt=(Get-Date).ToUniversalTime().ToString('o');driven_by='agent';actor='codex';status=$gateStatus;completionVerdict=$verdict;gates=$results}
[IO.File]::WriteAllText((Join-Path $out 'verification.json'),(($verification|ConvertTo-Json -Depth 12)+"`n"),$utf8)
$hashFiles=Get-ChildItem -LiteralPath $out -File | Where-Object { $_.Name -notin @('SHA256SUMS','sha256sums-check.txt') } | Sort-Object Name
$sums=foreach($file in $hashFiles){$relative='tests/unit/fixtures/product-semantics-tf0506/'+$file.Name;$hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant();"$hash  $relative"}
[IO.File]::WriteAllText((Join-Path $out 'SHA256SUMS'),(($sums -join "`n")+"`n"),$utf8)
$checks=foreach($line in Get-Content -LiteralPath (Join-Path $out 'SHA256SUMS')){$parts=$line -split '  ',2;$actual=(Get-FileHash -LiteralPath (Join-Path $root $parts[1]) -Algorithm SHA256).Hash.ToLowerInvariant();$sumStatusOne=if($actual -eq $parts[0]){'pass'}else{'fail'};[ordered]@{file=$parts[1];expected=$parts[0];actual=$actual;status=$sumStatusOne}}
$sumStatus=if(@($checks|Where-Object{$_.status -ne 'pass'}).Count -eq 0){'pass'}else{'fail'}
[IO.File]::WriteAllText((Join-Path $out 'sha256sums-check.txt'),(($checks|ConvertTo-Json -Depth 5)+"`nSHA256SUMS_STATUS=$sumStatus`n"),$utf8)
if($gateStatus -ne 'pass' -or $sumStatus -ne 'pass'){exit 1}
