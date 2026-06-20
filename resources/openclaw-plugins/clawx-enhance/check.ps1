node --check index.js
if ($?) { Write-Host "INDEX_OK" }
node --check compression-judge.js
if ($?) { Write-Host "JUDGE_OK" }
node --check smoke-test.js
if ($?) { Write-Host "SMOKE_OK" }
