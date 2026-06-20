import type {
  CapabilityAuditFinding,
  CapabilityAuditFindingSeverity,
  CapabilityAuditResult,
  CapabilityAuditStatus,
  McpServerCreatePayload,
} from '@shared/host-api/contract';
import type { Skill } from '@/types/skill';

type FindingInput = Omit<CapabilityAuditFinding, 'severity'> & {
  severity: CapabilityAuditFindingSeverity;
};

const SECRET_KEY_PATTERN = /(?:token|secret|key|password|credential|auth|api[_-]?key)/i;
const INSTALL_SCRIPT_PATTERN = /(?:preinstall|postinstall|\binstall-script\b|\blifecycle\b)/i;
const REMOTE_DOWNLOADER_PATTERN = /(?:\bcurl\b|\bwget\b|invoke-webrequest|\biwr\b|\birm\b|downloadstring|frombase64string)/i;
const SHELL_ESCALATION_PATTERN = /(?:\bpowershell\b|\bpwsh\b|\bbash\b|\bsh\b|\bcmd(?:\.exe)?\b)/i;
const DESTRUCTIVE_PATTERN = /(?:rm\s+-rf|del\s+\/[fsq]|remove-item\s+-recurse|rmdir\s+\/s|format\s+[a-z]:)/i;
const EXECUTABLE_EXTENSION_PATTERN = /\.(?:exe|dll|ps1|bat|cmd|sh|js|mjs|cjs|py|jar|msi)(?:$|[?#\s])/i;
const REMOTE_URL_PATTERN = /https?:\/\/[^\s"']+/i;
const LOCAL_HOST_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i;
const PACKAGE_MANAGER_COMMANDS = new Set(['npx', 'npm', 'pnpm', 'yarn', 'bunx', 'uvx', 'pip', 'pipx']);
const INTERPRETER_COMMANDS = new Set(['python', 'python3', 'node', 'deno', 'bun']);

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeCommand(value?: string): string {
  if (!value) return '';
  const normalized = value.trim().replace(/^["']|["']$/g, '');
  const parts = normalized.split(/[\\/]/);
  return (parts.at(-1) ?? normalized).replace(/\.(?:exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

function compactCommand(server: McpServerCreatePayload): string {
  return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ');
}

function statusFromFindings(findings: CapabilityAuditFinding[]): CapabilityAuditStatus {
  if (findings.some((finding) => finding.severity === 'blocked')) return 'blocked';
  if (findings.some((finding) => finding.severity === 'warning')) return 'warning';
  return 'passed';
}

function makeResult(
  findings: CapabilityAuditFinding[],
  source: CapabilityAuditResult['source'],
  passedSummary: string,
): CapabilityAuditResult {
  const status = statusFromFindings(findings);
  const summary = status === 'passed'
    ? passedSummary
    : status === 'blocked'
      ? 'Audit blocked this capability change until the risky configuration is changed.'
      : 'Audit found items that need review before continuing.';
  return {
    status,
    summary,
    findings,
    auditedAt: nowIso(),
    source,
  };
}

function addFinding(findings: CapabilityAuditFinding[], finding: FindingInput): void {
  findings.push(finding);
}

function hasExplicitVersion(packageName: string): boolean {
  if (!packageName || packageName.startsWith('-')) return true;
  if (packageName.startsWith('@')) {
    const versionIndex = packageName.indexOf('@', 1);
    return versionIndex > 1 && versionIndex < packageName.length - 1;
  }
  return /@[^/]+$/.test(packageName);
}

function firstPackageArg(args: string[]): string | undefined {
  return args.find((arg) => arg.trim() && !arg.trim().startsWith('-'));
}

function isLocalUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return LOCAL_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isExternalUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    return !LOCAL_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function auditSkillForAction(skill: Skill): CapabilityAuditResult {
  const findings: CapabilityAuditFinding[] = [];
  const searchable = [
    skill.id,
    skill.slug,
    skill.name,
    skill.description,
    skill.source,
    skill.baseDir,
    skill.filePath,
    ...(skill.dependencies ?? []),
  ].filter(Boolean).join(' ');

  if (REMOTE_DOWNLOADER_PATTERN.test(searchable) || DESTRUCTIVE_PATTERN.test(searchable)) {
    addFinding(findings, {
      id: 'skill.dangerous-command-pattern',
      severity: 'blocked',
      title: 'Dangerous command pattern detected',
      detail: 'Skill metadata references command patterns commonly used for remote execution or destructive file changes.',
      recommendation: 'Review the skill source manually and remove downloader or destructive commands before enabling it.',
    });
  }

  if (INSTALL_SCRIPT_PATTERN.test(searchable)) {
    addFinding(findings, {
      id: 'skill.lifecycle-script-reference',
      severity: 'blocked',
      title: 'Lifecycle install script reference',
      detail: 'The skill metadata references install lifecycle hooks.',
      recommendation: 'Enable only after reviewing the script contents and pinning the source.',
    });
  }

  if (EXECUTABLE_EXTENSION_PATTERN.test(` ${searchable} `)) {
    addFinding(findings, {
      id: 'skill.executable-reference',
      severity: 'warning',
      title: 'Executable or script reference',
      detail: 'The skill metadata points at executable or script-like files.',
      recommendation: 'Preview SKILL.md and related scripts before enabling.',
    });
  }

  if (REMOTE_URL_PATTERN.test(searchable) && !skill.isCore && !skill.isBundled) {
    addFinding(findings, {
      id: 'skill.remote-reference',
      severity: 'warning',
      title: 'Remote reference in skill metadata',
      detail: 'The skill metadata contains an external URL.',
      recommendation: 'Confirm the source is trusted and local files are already present.',
    });
  }

  const configKeys = Object.keys(skill.config ?? {});
  if (configKeys.some((key) => SECRET_KEY_PATTERN.test(key))) {
    addFinding(findings, {
      id: 'skill.secret-config',
      severity: 'warning',
      title: 'Sensitive configuration key',
      detail: 'The skill declares configuration that appears to contain credentials or tokens.',
      recommendation: 'Use least-privilege credentials and avoid pasting secrets into untrusted skills.',
    });
  }

  return makeResult(findings, skill.isBundled || skill.isCore ? 'local' : 'local', 'No high-risk skill metadata was detected.');
}

export function auditMcpServerForAction(server: McpServerCreatePayload): CapabilityAuditResult {
  const findings: CapabilityAuditFinding[] = [];
  const transport = server.transport ?? (server.url ? 'http' : 'stdio');
  const commandName = normalizeCommand(server.command);
  const args = server.args ?? [];
  const commandText = compactCommand(server);

  if (transport === 'stdio') {
    if (!server.command) {
      addFinding(findings, {
        id: 'mcp.stdio-command-missing',
        severity: 'blocked',
        title: 'Missing stdio command',
        detail: 'A stdio MCP server must declare the command that will be started.',
        recommendation: 'Add a concrete local command or use a URL transport.',
      });
    }

    if (PACKAGE_MANAGER_COMMANDS.has(commandName)) {
      addFinding(findings, {
        id: 'mcp.package-manager-launch',
        severity: 'warning',
        title: 'Package manager launch',
        detail: `${commandName} can download or execute packages at runtime.`,
        recommendation: 'Prefer a locally installed binary with a pinned version and reviewed lockfile.',
      });
      const packageArg = firstPackageArg(args);
      if (packageArg && (!hasExplicitVersion(packageArg) || /@latest$/i.test(packageArg))) {
        addFinding(findings, {
          id: 'mcp.unpinned-package',
          severity: 'warning',
          title: 'Unpinned remote package',
          detail: `Package argument "${packageArg}" is not pinned to an immutable version.`,
          recommendation: 'Pin an exact package version before allowing automated installation.',
        });
      }
    }

    if (INTERPRETER_COMMANDS.has(commandName)) {
      addFinding(findings, {
        id: 'mcp.interpreter-launch',
        severity: 'warning',
        title: 'Interpreter launch',
        detail: `${commandName} will execute local script code for this MCP server.`,
        recommendation: 'Confirm the script path is local, reviewed, and pinned.',
      });
    }
  } else if (!server.url) {
    addFinding(findings, {
      id: 'mcp.url-missing',
      severity: 'blocked',
      title: 'Missing MCP URL',
      detail: 'Non-stdio MCP transports require a URL.',
      recommendation: 'Provide a local URL or switch to stdio with an explicit command.',
    });
  }

  if (server.url && server.networkPolicy === 'localOnly' && isExternalUrl(server.url)) {
    addFinding(findings, {
      id: 'mcp.local-only-external-url',
      severity: 'blocked',
      title: 'External URL conflicts with local-only policy',
      detail: `The configured URL is external: ${server.url}`,
      recommendation: 'Use a localhost URL or change policy only after manual review.',
    });
  }

  if (server.networkPolicy === 'enabled' || (server.url && !isLocalUrl(server.url))) {
    addFinding(findings, {
      id: 'mcp.network-enabled',
      severity: 'warning',
      title: 'Network access enabled',
      detail: server.url ? `MCP URL: ${server.url}` : 'The MCP configuration allows network access.',
      recommendation: 'Use localOnly where possible and limit exposed tools.',
    });
  }

  if (INSTALL_SCRIPT_PATTERN.test(commandText)) {
    addFinding(findings, {
      id: 'mcp.lifecycle-script',
      severity: 'blocked',
      title: 'Lifecycle script reference',
      detail: 'The MCP command references install lifecycle scripts.',
      recommendation: 'Do not register commands that trigger package lifecycle hooks from chat.',
    });
  }

  if (REMOTE_DOWNLOADER_PATTERN.test(commandText) && REMOTE_URL_PATTERN.test(commandText)) {
    addFinding(findings, {
      id: 'mcp.remote-downloader',
      severity: 'blocked',
      title: 'Remote downloader command',
      detail: 'The MCP command appears to download remote content as part of startup.',
      recommendation: 'Download and audit the package separately, then register a local pinned command.',
    });
  }

  if (SHELL_ESCALATION_PATTERN.test(commandText) && REMOTE_URL_PATTERN.test(commandText)) {
    addFinding(findings, {
      id: 'mcp.shell-remote-execution',
      severity: 'blocked',
      title: 'Shell command with remote URL',
      detail: 'Shell execution combined with a remote URL is a common malicious package pattern.',
      recommendation: 'Replace this with a reviewed local executable.',
    });
  }

  if (DESTRUCTIVE_PATTERN.test(commandText)) {
    addFinding(findings, {
      id: 'mcp.destructive-command',
      severity: 'blocked',
      title: 'Destructive command pattern',
      detail: 'The MCP command contains a destructive file operation pattern.',
      recommendation: 'Remove destructive operations from the startup command.',
    });
  }

  const envKeys = Object.keys(server.env ?? {});
  if (envKeys.some((key) => SECRET_KEY_PATTERN.test(key))) {
    addFinding(findings, {
      id: 'mcp.secret-env',
      severity: 'warning',
      title: 'Sensitive environment variable',
      detail: 'The MCP server receives environment variables that look like credentials.',
      recommendation: 'Use scoped credentials and confirm the server source before registering.',
    });
  }

  if (!server.toolAllowlist?.length) {
    addFinding(findings, {
      id: 'mcp.missing-tool-allowlist',
      severity: 'warning',
      title: 'No tool allowlist',
      detail: 'All tools exposed by this MCP server may become available after registration.',
      recommendation: 'Add a toolAllowlist for least-privilege access once the tools are known.',
    });
  }

  return makeResult(findings, 'mcp-json', 'No high-risk MCP configuration was detected.');
}

export function isCapabilityAuditBlocked(result?: CapabilityAuditResult): boolean {
  return result?.status === 'blocked';
}

export function riskFromAudit(result?: CapabilityAuditResult): 'low' | 'medium' | 'high' {
  if (result?.status === 'blocked') return 'high';
  if (result?.status === 'warning' || result?.status === 'unknown') return 'medium';
  return 'low';
}
