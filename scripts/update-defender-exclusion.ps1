param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('add', 'remove')]
  [string]$Action,
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Output 'skipped-not-elevated'
  exit 0
}

try {
  if ($Action -eq 'add') {
    Add-MpPreference -ExclusionPath $InstallDir -ErrorAction Stop
  } else {
    Remove-MpPreference -ExclusionPath $InstallDir -ErrorAction Stop
  }
  Write-Output 'updated'
} catch {
  Write-Output ('Optional Defender integration failed: ' + $_.Exception.Message)
  exit 1
}
