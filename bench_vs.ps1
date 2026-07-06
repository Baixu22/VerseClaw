$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$exe='C:\Users\27933\Desktop\verseshell\verseshell\target\release\ae.exe'
for ($i=0; $i -lt 20; $i++) {
    $arg = '-c'
    $code = 'file.ls("C:/Windows/System32")'
    $null = & $exe --json $arg $code
}
$stopwatch.Stop()
Write-Host "VS file-ls C:\Windows\System32 20x (one-shot): $($stopwatch.ElapsedMilliseconds)ms"
