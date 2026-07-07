$drive = Get-PSDrive C
$totalGB = [math]::Round(($drive.Used + $drive.Free) / 1GB, 1)
$usedGB = [math]::Round($drive.Used / 1GB, 1)
$freeGB = [math]::Round($drive.Free / 1GB, 1)
Write-Host "C: Total=${totalGB}GB Used=${usedGB}GB Free=${freeGB}GB"
Write-Host ""

$dirs = @(
    "C:\Windows",
    "C:\Users",
    "C:\Program Files",
    "C:\Program Files (x86)",
    "C:\ProgramData",
    "C:\Games",
    "C:\GOG Games",
    "C:\Riot Games",
    "C:\temp",
    "C:\tmp",
    "C:\back",
    "C:\db",
    "C:\123pan",
    "C:\FLiNGTrainers",
    "C:\KDubaSoftDownloads",
    "C:\MStoreDownload",
    "C:\yidongyunpan",
    "C:\KavPDF",
    "C:\TestSet",
    "C:\inetpub",
    "C:\opt",
    "C:\proc",
    "C:\usr",
    "C:\KingsoftData",
    "C:\XmpCache",
    "C:\silicon_temp",
    "C:\Wallpaper_Download",
    "C:\Downloaded Web Sites",
    "C:\My Web Sites",
    "C:\OneDriveTemp",
    "C:\codex_docx_smoke"
)

$results = @()
foreach ($d in $dirs) {
    if (Test-Path $d) {
        Write-Host "Scanning $d ..."
        $size = (Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        $results += [PSCustomObject]@{Path=$d; SizeGB=[math]::Round($size/1GB,2)}
    }
}
Write-Host ""
Write-Host "=== RESULTS (sorted by size) ==="
$results | Sort-Object SizeGB -Descending | Format-Table -AutoSize
