Write-Host "=== AppData top-level dirs ==="
$appdata = "C:\Users\27933\AppData"
Get-ChildItem $appdata -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_.FullName
    $size = (Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    [PSCustomObject]@{Path=('AppData\' + $_.Name); SizeGB=[math]::Round($size/1GB,2)}
} | Sort-Object SizeGB -Descending | Format-Table -AutoSize

Write-Host ""
Write-Host "=== AppData\Local top dirs ==="
$local = "C:\Users\27933\AppData\Local"
Get-ChildItem $local -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_.FullName
    $size = (Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    [PSCustomObject]@{Path=('Local\' + $_.Name); SizeGB=[math]::Round($size/1GB,2)}
} | Sort-Object SizeGB -Descending | Select-Object -First 25 | Format-Table -AutoSize

Write-Host ""
Write-Host "=== AppData\Roaming top dirs ==="
$roaming = "C:\Users\27933\AppData\Roaming"
Get-ChildItem $roaming -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_.FullName
    $size = (Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    [PSCustomObject]@{Path=('Roaming\' + $_.Name); SizeGB=[math]::Round($size/1GB,2)}
} | Sort-Object SizeGB -Descending | Select-Object -First 20 | Format-Table -AutoSize
