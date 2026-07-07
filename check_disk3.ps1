Write-Host "=== C:\Users\27933 top-level subdirs ==="
$user = "C:\Users\27933"
Get-ChildItem $user -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_.FullName
    $size = (Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    [PSCustomObject]@{Path=$_.Name; SizeGB=[math]::Round($size/1GB,2)}
} | Sort-Object SizeGB -Descending | Format-Table -AutoSize
