import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const ownerOnlyAcl = Buffer.from(`
$ErrorActionPreference = 'Stop'
$path = [Environment]::GetEnvironmentVariable('CLAWX_PRIVATE_FILE_PATH', 'Process')
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', 'Allow')
$acl.AddAccessRule($rule)
$stream = New-Object System.IO.FileStream($path, [System.IO.FileMode]::CreateNew, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::WriteThrough, $acl)
try {
  [Console]::OpenStandardInput().CopyTo($stream)
  $stream.Flush($true)
} finally {
  $stream.Dispose()
}
`, 'utf16le').toString('base64');

/** Create an app-owned file with private permissions before writing its contents. */
export async function writeOwnerOnlyFile(filePath: string, content: string): Promise<void> {
  if (process.platform !== 'win32') {
    await writeFile(filePath, content, { flag: 'wx', mode: 0o600, encoding: 'utf8' });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = execFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ownerOnlyAcl], {
        windowsHide: true,
        timeout: 10_000,
        env: { ...process.env, CLAWX_PRIVATE_FILE_PATH: filePath },
      }, (error) => error ? reject(error) : resolve());
    child.stdin?.once('error', reject);
    child.stdin?.end(content, 'utf8');
  });
}
