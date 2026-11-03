$ErrorActionPreference='Continue'
cd D:\ClawX
$env:TEMP='D:\tmp'
$env:TMP='D:\tmp'
$ev='D:\tmp\ClawX-a6-final-20261103-ev'
$env:CLAWX_E2E_RUN_ROOT=Join-Path $ev 'e2e-root'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME="$ev\e2e-report.json"
New-Item -ItemType Directory -Force -Path $env:CLAWX_E2E_RUN_ROOT | Out-Null
$sw=[System.Diagnostics.Stopwatch]::StartNew()
pnpm run test:e2e:run --reporter=list --reporter=json *> "$ev\gate-e2e.log"
$code=$LASTEXITCODE
$sw.Stop()
"$code|$([math]::Round($sw.Elapsed.TotalSeconds,1))" | Set-Content "$ev\gate-e2e.exit.txt"

