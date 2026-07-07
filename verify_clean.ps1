$drive = Get-PSDrive C
Write-Host ("C: Free = " + [math]::Round($drive.Free/1GB,1) + " GB")
