$ErrorActionPreference = 'Stop'
$VS = 'C:\Users\27933\Desktop\verseshell\verseshell\target\release\ae.exe'

# Start ae --serve with compact format (matching ClawX bridge default)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $VS
$psi.Arguments = '--serve --format compact'
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)

$stderrReader = $proc.StandardError
$readyLine = $stderrReader.ReadLine()
Write-Host "Server: $readyLine"

$stdin = $proc.StandardInput
$stdout = $proc.StandardOutput

function Send-VS {
    param($Cmd)
    $req = @{ id = "bench"; agent = "test"; cmd = $Cmd; timeout_ms = 30000 } | ConvertTo-Json -Compress
    $stdin.WriteLine($req)
    $stdin.Flush()
    $line = $stdout.ReadLine()
    return $line
}

# Warmup
$null = Send-VS '1 + 1'

Write-Host ""
Write-Host "========== FILE LISTING (System32) - lazy =========="
$sw = [Diagnostics.Stopwatch]::StartNew()
for ($i=0; $i -lt 10; $i++) { $null = Send-VS 'file.ls("C:/Windows/System32")' }
$sw.Stop(); Write-Host "VS-compact file.ls 10x:      $($sw.ElapsedMilliseconds)ms"

Write-Host ""
Write-Host "========== FILE STAT (single) =========="
$sw.Restart()
for ($i=0; $i -lt 20; $i++) { $null = Send-VS 'file.stat("C:/Windows/System32/ntdll.dll")' }
$sw.Stop(); Write-Host "VS-compact file.stat 20x:    $($sw.ElapsedMilliseconds)ms"

Write-Host ""
Write-Host "========== PROCESS LISTING =========="
$sw.Restart()
for ($i=0; $i -lt 10; $i++) { $null = Send-VS 'proc.list()' }
$sw.Stop(); Write-Host "VS-compact proc.list 10x:     $($sw.ElapsedMilliseconds)ms"

Write-Host ""
Write-Host "========== FILE READ =========="
$sw.Restart()
for ($i=0; $i -lt 20; $i++) { $null = Send-VS 'file.read("C:/Windows/System32/drivers/etc/hosts")' }
$sw.Stop(); Write-Host "VS-compact file.read 20x:     $($sw.ElapsedMilliseconds)ms"

Write-Host ""
Write-Host "========== TRIVIAL (per-op overhead) =========="
$sw.Restart()
for ($i=0; $i -lt 50; $i++) { $null = Send-VS '1 + 1' }
$sw.Stop(); Write-Host "VS-compact math 50x:           $($sw.ElapsedMilliseconds)ms  (avg $([math]::Round($sw.ElapsedMilliseconds/50,3))ms/op)"

Write-Host ""
Write-Host "========== PIPELINE MAP+FILTER FUSION =========="
$sw.Restart()
for ($i=0; $i -lt 10; $i++) { $null = Send-VS 'arr.range(0, 1000) | map(x => x * 2) | filter(x => x % 4 == 0)' }
$sw.Stop(); Write-Host "VS-compact map+filter 10x:    $($sw.ElapsedMilliseconds)ms"

# Send SHUTDOWN and wait
$stdin.WriteLine('SHUTDOWN')
$stdin.Flush()
$stderrRemainder = $stderrReader.ReadToEnd()
Write-Host "Server stop: $stderrRemainder"
$proc.WaitForExit(5000)
