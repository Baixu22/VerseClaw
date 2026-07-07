Write-Host "=== Desktop top-level items (by size) ==="
$desktop = "C:\Users\27933\Desktop"
Get-ChildItem $desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_.FullName
    $size = (Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    [PSCustomObject]@{Path=$_.Name; SizeGB=[math]::Round($size/1GB,2)}
} | Sort-Object SizeGB -Descending | Select-Object -First 25 | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Desktop files > 100MB ==="
Get-ChildItem $desktop -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 100MB } | Sort-Object Length -Descending | ForEach-Object {
    [PSCustomObject]@{Name=$_.Name; SizeGB=[math]::Round($_.Length/1GB,2)}
} | Format-Table -AutoSize
