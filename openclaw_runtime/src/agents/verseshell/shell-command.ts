function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function cmdCdPath(value: string): string {
  const slashPath = value.replace(/\\/g, "/");
  if (/^[A-Za-z]:\/[^\s&|<>^"]+$/.test(slashPath)) {
    return slashPath;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/** Preserve the exec tool's shell-string contract while sending typed argv to VerseShell. */
export function resolveVerseShellCommandArgv(
  command: string,
  cwd?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const requested = (env.VERSESHELL_OS_SHELL || "").toLowerCase();
  const windowsCmd = env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
  if (requested === "git-bash" || requested === "bash") {
    const prefix = cwd ? `cd ${quotePosix(cwd.replace(/\\/g, "/"))} && ` : "";
    return ["C:\\Program Files\\Git\\bin\\bash.exe", "-lc", `${prefix}${command}`];
  }
  if (requested === "powershell" || requested === "pwsh") {
    const prefix = cwd ? `Set-Location -LiteralPath ${quotePowerShellLiteral(cwd)}; ` : "";
    return [requested, "-NoProfile", "-Command", `${prefix}${command}`];
  }
  if (platform === "win32" || requested === "cmd") {
    const prefix = cwd ? `cd /d ${cmdCdPath(cwd)} && ` : "";
    return [windowsCmd, "/D", "/C", `${prefix}${command}`];
  }
  const prefix = cwd ? `cd ${quotePosix(cwd)} && ` : "";
  return ["sh", "-lc", `${prefix}${command}`];
}

