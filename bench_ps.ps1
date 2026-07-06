$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
for ($i=0; $i -lt 20; $i++) {
    $null = Get-ChildItem C:\Windows\System32\ -ErrorAction SilentlyContinue
}
$stopwatch.Stop()
Write-Host "PS Get-ChildItem 20x: $($stopwatch.ElapsedMilliseconds)ms"

$stopwatch2 = [System.Diagnostics.Stopwatch]::StartNew()
for ($i=0; $i -lt 20; $i++) {
    $null = Get-Process
}
$stopwatch2.Stop()
Write-Host "PS Get-Process 20x: $($stopwatch2.ElapsedMilliseconds)ms"

$stopwatch3 = [System.Diagnostics.Stopwatch]::StartNew()
for ($i=0; $i -lt 20; $i++) {
    $null = Get-Content C:\Windows\System32\drivers\etc\hosts
}
$stopwatch3.Stop()
Write-Host "PS Get-Content 20x: $($stopwatch3.ElapsedMilliseconds)ms"

$stopwatch4 = [System.Diagnostics.Stopwatch]::StartNew()
for ($i=0; $i -lt 20; $i++) {
    $null = Get-NetIPConfiguration
}
$stopwatch4.Stop()
Write-Host "PS Get-NetIPConfiguration 20x: $($stopwatch4.ElapsedMilliseconds)ms"
