Write-Host "=== C:\Users subdirectories ==="
Get-ChildItem "C:\Users" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_.FullName
    Write-Host "Scanning $d ..."
    $size = (Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    [PSCustomObject]@{Path=$_.Name; SizeGB=[math]::Round($size/1GB,2)}
} | Sort-Object SizeGB -Descending | Format-Table -AutoSize

Write-Host ""
Write-Host "=== User AppData (top folders) ==="
$appdata = "C:\Users\27933\AppData"
Get-ChildItem $appdata -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_.FullName
    $size = (Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    [PSCustomObject]@{Path=$_.Name; SizeGB=[math]::Round($size/1GB,2)}
} | Sort-Object SizeGB -Descending | Format-Table -AutoSize
