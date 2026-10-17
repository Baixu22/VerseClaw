import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  SandboxDockerAvailability,
  SandboxProviderStatus,
} from '../types/sandbox.ts';

const execFileAsync = promisify(execFile);
const PROVIDER_DETECTION_TTL_MS = 15_000;

type SandboxProviderDetectionSnapshot = {
  docker: SandboxDockerAvailability;
  dockerVersion?: string;
  runscVersion?: string;
  sshVersion?: string;
  providers: SandboxProviderStatus[];
  detectedAt: number;
};

let cachedSnapshot: SandboxProviderDetectionSnapshot | null = null;
let pendingSnapshot: Promise<SandboxProviderDetectionSnapshot> | null = null;

async function commandVersion(command: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: 2500,
      windowsHide: true,
    });
    return String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || 'detected';
  } catch {
    return undefined;
  }
}

async function commandOk(command: string, args: string[], timeout = 2500): Promise<boolean> {
  try {
    await execFileAsync(command, args, {
      timeout,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function detectDockerAvailabilityRaw(): Promise<{
  docker: SandboxDockerAvailability;
  dockerVersion?: string;
  runscVersion?: string;
}> {
  const dockerVersion = await commandVersion('docker', ['--version']);
  const cli = Boolean(dockerVersion);
  const daemon = cli ? await commandOk('docker', ['info'], 3500) : false;
  const image = daemon ? await commandOk('docker', ['image', 'inspect', 'openclaw-sandbox:bookworm-slim'], 3500) : false;
  const runscVersion = await commandVersion('runsc', ['--version']);
  return {
    docker: { cli, daemon, image },
    dockerVersion,
    runscVersion,
  };
}

function buildProviders(input: {
  docker: SandboxDockerAvailability;
  dockerVersion?: string;
  runscVersion?: string;
  sshVersion?: string;
}): SandboxProviderStatus[] {
  const dockerStrongAvailable = input.docker.cli && input.docker.daemon && input.docker.image;
  const windowsLightAvailable = process.platform === 'win32';

  return [
    {
      id: 'policy-light',
      label: 'Policy-light',
      available: true,
      runtimeLevel: 'policy',
      reason: 'Default ClawX/Main permission, approval, and workspace-root control layer. Not a container sandbox.',
      capabilities: ['workspace-readonly', 'workspace-readwrite'],
    },
    {
      id: 'windows-light',
      label: 'Windows-light',
      available: windowsLightAvailable,
      runtimeLevel: windowsLightAvailable ? 'light' : 'unavailable',
      reason: windowsLightAvailable
        ? 'Uses ClawX/Main policy gates plus Windows-oriented lightweight process controls where available. Not equivalent to Docker or a VM.'
        : 'Only available on Windows.',
      capabilities: windowsLightAvailable
        ? ['workspace-readonly', 'workspace-readwrite', 'process-limits', 'restricted-token']
        : [],
    },
    {
      id: 'docker-strong',
      label: input.runscVersion ? 'Docker strong sandbox (runsc detected)' : 'Docker strong sandbox',
      available: dockerStrongAvailable,
      runtimeLevel: dockerStrongAvailable ? 'strong' : 'unavailable',
      reason: dockerStrongAvailable
        ? 'OpenClaw Docker sandbox image is available with the Docker daemon.'
        : 'Docker strong sandbox requires docker CLI, a running daemon, and openclaw-sandbox:bookworm-slim.',
      version: input.runscVersion ?? input.dockerVersion,
      capabilities: dockerStrongAvailable
        ? ['container-runtime', 'openclaw-sandbox', 'workspace-readonly', 'workspace-readwrite', 'network-none']
        : [],
    },
    {
      id: 'ssh-strong',
      label: 'SSH strong sandbox',
      available: false,
      runtimeLevel: 'unavailable',
      reason: input.sshVersion
        ? 'SSH client is installed, but no sandbox SSH target is configured in ClawX v1.'
        : 'SSH client is not installed and no sandbox SSH target is configured.',
      version: input.sshVersion,
      capabilities: [],
    },
  ];
}

async function detectProviderSnapshotRaw(): Promise<SandboxProviderDetectionSnapshot> {
  const [{ docker, dockerVersion, runscVersion }, sshVersion] = await Promise.all([
    detectDockerAvailabilityRaw(),
    commandVersion('ssh', ['-V']),
  ]);
  return {
    docker,
    dockerVersion,
    runscVersion,
    sshVersion,
    providers: buildProviders({ docker, dockerVersion, runscVersion, sshVersion }),
    detectedAt: Date.now(),
  };
}

function snapshotFresh(snapshot: SandboxProviderDetectionSnapshot, now = Date.now()): boolean {
  return now - snapshot.detectedAt <= PROVIDER_DETECTION_TTL_MS;
}

export async function detectSandboxProviderSnapshot(options?: {
  forceRefresh?: boolean;
}): Promise<SandboxProviderDetectionSnapshot> {
  if (!options?.forceRefresh && cachedSnapshot && snapshotFresh(cachedSnapshot)) {
    return cachedSnapshot;
  }
  if (!options?.forceRefresh && pendingSnapshot) {
    return pendingSnapshot;
  }
  pendingSnapshot = detectProviderSnapshotRaw()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      pendingSnapshot = null;
    });
  return pendingSnapshot;
}

export async function detectDockerAvailability(options?: {
  forceRefresh?: boolean;
}): Promise<SandboxDockerAvailability> {
  return (await detectSandboxProviderSnapshot(options)).docker;
}

export async function detectSandboxProviders(options?: {
  forceRefresh?: boolean;
}): Promise<SandboxProviderStatus[]> {
  return (await detectSandboxProviderSnapshot(options)).providers;
}

export function clearSandboxProviderDetectionCache(): void {
  cachedSnapshot = null;
  pendingSnapshot = null;
}
