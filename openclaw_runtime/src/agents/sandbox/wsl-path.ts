/**
 * Windows → WSL/Linux Docker daemon bind-path translation.
 *
 * Windows hosts often talk to a Docker daemon running inside WSL2 (or a remote
 * Linux daemon) via `DOCKER_HOST=tcp://...`. The daemon is Linux and cannot
 * resolve `C:\Users\...` bind sources, so Windows paths must be translated to
 * the WSL2 mount namespace (`C:\Users\...` → `/mnt/c/Users/...`) before they
 * are handed to `docker create/run -v`. Paths already in WSL namespace form
 * (`\\wsl$\<distro>\...`) lose their Windows prefix and become POSIX paths.
 */

/** Runtime facts used to decide whether bind sources need translation. */
export type DockerPathTranslationRuntime = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
};

export const DEFAULT_DOCKER_PATH_TRANSLATION_RUNTIME: DockerPathTranslationRuntime = {
  platform: process.platform,
  env: process.env,
};

const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/u;
const WSL_SHARE_RE = /^\/\/wsl\$\/([^\\/]+)[\\/](.+)$/u;

function normalizeDockerHost(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  // Docker CLI accepts both `npipe:////./pipe/docker_engine` and the bare
  // `//./pipe/docker_engine` local socket form for the Windows daemon.
  return trimmed.toLowerCase().replaceAll("\\", "/");
}

/**
 * True when the Docker client runs on Windows but the daemon is not the local
 * Windows named-pipe daemon. A TCP/tls/ssh DOCKER_HOST (the WSL2 or remote
 * Linux case) means bind sources must be expressed in the daemon's namespace.
 */
export function isLinuxDockerDaemonFromWindows(
  runtime: DockerPathTranslationRuntime = DEFAULT_DOCKER_PATH_TRANSLATION_RUNTIME,
): boolean {
  if (runtime.platform !== "win32") {
    return false;
  }
  const dockerHost = normalizeDockerHost(runtime.env.DOCKER_HOST);
  if (!dockerHost) {
    // No DOCKER_HOST override: the CLI talks to the local Windows daemon.
    return false;
  }
  return !dockerHost.includes("npipe://") && !dockerHost.includes("/pipe/");
}

/**
 * Translate a Windows absolute path into the WSL2 mount namespace understood
 * by a Linux Docker daemon. Returns the input unchanged when the path is not a
 * Windows drive/UNC path (POSIX input passes through).
 */
export function windowsPathToWslMountPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return raw;
  }
  const forwardSlashed = trimmed.replaceAll("\\", "/");
  const wslShare = WSL_SHARE_RE.exec(forwardSlashed);
  if (wslShare) {
    // `\\wsl$\Ubuntu-22.04\home\sandbox` → `/home/sandbox` (strip the distro
    // prefix; the daemon already runs inside that distro).
    const distroAndPath = `/${wslShare[2]}`;
    return distroAndPath.replace(/\/+$/u, "") || "/";
  }
  if (WINDOWS_DRIVE_RE.test(forwardSlashed)) {
    const drive = forwardSlashed.charAt(0).toLowerCase();
    const rest = forwardSlashed.slice(2).replace(/\/+$/u, "");
    return `/mnt/${drive}${rest || ""}`;
  }
  return trimmed;
}

/**
 * Resolve the host side of a Docker bind source for the current daemon.
 * On a Windows client talking to a Linux daemon, Windows paths are translated
 * to the WSL mount namespace; everywhere else the path is passed through.
 */
export function resolveDockerBindSourcePath(
  hostPath: string,
  runtime: DockerPathTranslationRuntime = DEFAULT_DOCKER_PATH_TRANSLATION_RUNTIME,
): string {
  if (!isLinuxDockerDaemonFromWindows(runtime)) {
    return hostPath;
  }
  return windowsPathToWslMountPath(hostPath);
}
