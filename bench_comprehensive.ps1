$ErrorActionPreference = 'SilentlyContinue'
$VS = 'C:\Users\27933\Desktop\verseshell\verseshell\target\release\ae.exe'

Write-Host "========== FILE LISTING (System32) =========="

# PS: file listing 10x
$sw = [Diagnostics.Stopwatch]::StartNew()
for ($i=0; $i -lt 10; $i++) { $null = Get-ChildItem C:\Windows\System32\ }
$sw.Stop(); Write-Host "PS   Get-ChildItem 10x: $($sw.ElapsedMilliseconds)ms"

# VS: file listing 10x
$sw.Restart()
for ($i=0; $i -lt 10; $i++) { $null = & $VS --json -c 'file.ls("C:/Windows/System32")' 2>$null }
$sw.Stop(); Write-Host "VS   file.ls 10x:      $($sw.ElapsedMilliseconds)ms"

Write-Host ""
Write-Host "========== PROCESS LISTING =========="

$sw.Restart()
for ($i=0; $i -lt 10; $i++) { $null = Get-Process }
$sw.Stop(); Write-Host "PS   Get-Process 10x:  $($sw.ElapsedMilliseconds)ms"

$sw.Restart()
for ($i=0; $i -lt 10; $i++) { $null = & $VS --json -c 'proc.list()' 2>$null }
$sw.Stop(); Write-Host "VS   proc.list 10x:     $($sw.ElapsedMilliseconds)ms"

Write-Host ""
Write-Host "========== FILE READ (hosts) =========="

$sw.Restart()
for ($i=0; $i -lt 20; $i++) { $null = Get-Content C:\Windows\System32\drivers\etc\hosts }
$sw.Stop(); Write-Host "PS   Get-Content 20x:   $($sw.ElapsedMilliseconds)ms"

$sw.Restart()
for ($i=0; $i -lt 20; $i++) { $null = & $VS --json -c 'file.read("C:/Windows/System32/drivers/etc/hosts")' 2>$null }
$sw.Stop(); Write-Host "VS   file.read 20x:     $($sw.ElapsedMilliseconds)ms"

Write-Host ""
Write-Host "========== TRIVIAL COMMAND (overhead) =========="

$sw.Restart()
for ($i=0; $i -lt 20; $i++) { $null = Get-Date }
$sw.Stop(); Write-Host "PS   Get-Date 20x:      $($sw.ElapsedMilliseconds)ms"

$sw.Restart()
for ($i=0; $i -lt 20; $i++) { $null = & $VS --json -c '1 + 1' 2>$null }
$sw.Stop(); Write-Host "VS   math 20x:          $($sw.ElapsedMilliseconds)ms"

Write-Host ""
Write-Host "========== NETWORK INFO =========="

$sw.Restart()
for ($i=0; $i -lt 5; $i++) { $null = Get-NetIPConfiguration }
$sw.Stop(); Write-Host "PS   Get-NetIPConf 5x:  $($sw.ElapsedMilliseconds)ms"

$sw.Restart()
for ($i=0; $i -lt 5; $i++) { $null = & $VS --json -c 'net.interfaces()' 2>$null }
$sw.Stop(); Write-Host "VS   net.interfaces 5x: $($sw.ElapsedMilliseconds)ms"

Write-Host ""
Write-Host "========== SYSTEM INFO =========="

$sw.Restart()
for ($i=0; $i -lt 10; $i++) { $null = Get-ComputerInfo -Property OsName,OsVersion,CsProcessors,CsTotalPhysicalMemory 2>$null }
$sw.Stop(); Write-Host "PS   Get-ComputerInfo 10x: $($sw.ElapsedMilliseconds)ms"

$sw.Restart()
for ($i=0; $i -lt 10; $i++) { $null = & $VS --json -c 'sys.info()' 2>$null }
$sw.Stop(); Write-Host "VS   sys.info 10x:         $($sw.ElapsedMilliseconds)ms"

