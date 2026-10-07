param([Parameter(Mandatory = $true)][string]$Executable)

# A successful query returns 0 plus an explicit marker. A generic PowerShell
# startup failure (exit 1) must never be confused with confirmed absence.
try {
  $name = [IO.Path]::GetFileNameWithoutExtension($Executable)
  $processes = [Diagnostics.Process]::GetProcessesByName($name)
  $running = $processes.Length -gt 0
  foreach ($process in $processes) { $process.Dispose() }
  if ($running) { [Console]::Write('running') } else { [Console]::Write('absent') }
  exit 0
} catch {
  Write-Output ('Process enumeration failed: ' + $_.Exception.Message)
  exit 2
}
