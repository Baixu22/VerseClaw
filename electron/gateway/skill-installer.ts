/**
 * Skill Installer
 * Downloads skills from GitHub repos and installs them to ~/.openclaw/skills/
 *
 * Install identity contract (issue #131): the bytes that end up on disk are the
 * only thing that is trusted. Every successful install records a sha256 digest
 * of the installed tree plus the ref/revision it came from, and the install
 * fails closed (directory removed) when the recorded digest cannot be verified
 * against disk. The built-in catalog `version` is recorded as declared source
 * metadata (`declaredCatalogVersion`) and is never presented as proof of what
 * was installed.
 */
import fs from "fs";
import path from "path";
import https from "https";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { ensureDir, getOpenClawSkillsDir } from "../utils/paths";
import type { SkillCatalogEntry } from "./skill-catalog";

const SAFE_GITHUB_PART = /^[a-zA-Z0-9_.-]+$/;
const SAFE_SKILL_SLUG = /^[a-zA-Z0-9_.-]+$/;
/** Git refs we are willing to pass to `git clone --branch` (no leading dash, no ranges). */
const SAFE_GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_REQUESTED_VERSION_LENGTH = 120;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

export type SkillInstallSource = "git-clone" | "zip-archive";
export type SkillRequestedVersionStatus = "not-requested" | "honored" | "unresolved";
export type SkillTrackedRefKind = "pinned" | "branch";

/** Verifiable record of one installed skill, written to `.clawhub/origin.json`. */
export type InstalledSkillIdentity = {
  slug: string;
  github: string;
  installedAt: string;
  /** Version read back from the installed bytes, when the repo declares one. */
  installedVersion?: string;
  installedVersionSource: "installed-package-json" | "unavailable";
  /**
   * Version declared by the built-in catalog. Source metadata only, never a
   * claim about the installed bytes; use `contentDigest` for byte identity.
   */
  declaredCatalogVersion: string;
  requestedVersion?: string;
  requestedVersionStatus: SkillRequestedVersionStatus;
  installSource: SkillInstallSource;
  trackedRef: string;
  trackedRefKind: SkillTrackedRefKind;
  resolvedRevision?: string;
  contentDigest: string;
  contentDigestAlgorithm: "sha256";
};

export type SkillIntegrityReason =
  | "verified"
  | "not-installed"
  | "identity-missing"
  | "identity-malformed"
  | "digest-mismatch";

export type SkillIntegrityCheck = {
  verified: boolean;
  reason: SkillIntegrityReason;
  expectedDigest?: string;
  actualDigest?: string;
};

function assertInsideRoot(rootPath: string, candidatePath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relativePath = path.relative(resolvedRoot, resolvedCandidate);
  if (relativePath === "" || (!relativePath.startsWith("..") && relativePath !== ".." && !path.isAbsolute(relativePath))) {
    return resolvedCandidate;
  }
  throw new Error(`Refusing to access path outside skills directory: ${candidatePath}`);
}

function removeInsideRoot(rootPath: string, candidatePath: string): void {
  const safePath = assertInsideRoot(rootPath, candidatePath);
  if (safePath === path.resolve(rootPath)) {
    throw new Error("Refusing to remove the skills root directory.");
  }
  if (fs.existsSync(safePath)) {
    fs.rmSync(safePath, { recursive: true, force: true });
  }
}

function httpGet(url: string): Promise<{ statusCode: number; data: Buffer }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Verse Claw-Skill-Installer/1.0" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirect = res.headers.location;
          if (redirect) {
            httpGet(redirect).then(resolve).catch(reject);
            return;
          }
        }
        if (res.statusCode !== 200) {
          res.resume();
          resolve({ statusCode: res.statusCode || 500, data: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ statusCode: 200, data: Buffer.concat(chunks) }));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function tryGitClone(repoUrl: string, targetDir: string, ref: string): void {
  const skillsRoot = getOpenClawSkillsDir();
  const safeTargetDir = assertInsideRoot(skillsRoot, targetDir);
  const tempDir = targetDir + ".tmp";
  const safeTempDir = assertInsideRoot(skillsRoot, tempDir);
  removeInsideRoot(skillsRoot, safeTempDir);
  try {
    execFileSync(
      "git",
      ["clone", "--depth", "1", "--branch", ref, "--single-branch", repoUrl, safeTempDir],
      { stdio: "pipe", timeout: 60_000 }
    );
    ensureDir(path.dirname(safeTargetDir));
    removeInsideRoot(skillsRoot, safeTargetDir);
    fs.renameSync(safeTempDir, safeTargetDir);
  } catch (err) {
    removeInsideRoot(skillsRoot, safeTempDir);
    throw err;
  }
}

/** Resolves the commit a shallow install points at; undefined when `.git` is absent. */
function readGitRevision(skillDir: string): string | undefined {
  try {
    const output = execFileSync("git", ["-C", skillDir, "rev-parse", "HEAD"], {
      stdio: "pipe",
      timeout: 15_000,
    })
      .toString("utf8")
      .trim();
    return GIT_SHA.test(output) ? output : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a version that is declared by the installed bytes themselves. */
function readInstalledVersionFromBytes(skillDir: string): string | undefined {
  for (const filename of ["package.json", "manifest.json"]) {
    const manifestPath = path.join(skillDir, filename);
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // Ignore malformed version manifests; version stays unverified.
    }
  }
  return undefined;
}

/**
 * sha256 over the installed skill tree: sorted relative paths plus file bytes.
 * Installer metadata (`.clawhub`) and VCS internals (`.git`) are excluded so the
 * digest describes source content rather than download mechanics.
 */
export function computeSkillContentDigest(skillDir: string): string {
  const hash = crypto.createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (entry.name === ".clawhub" || entry.name === ".git") continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
        continue;
      }
      hash.update(`entry\0${relative}\0`);
      if (entry.isSymbolicLink()) {
        hash.update(`link\0${fs.readlinkSync(absolute)}`);
      } else if (entry.isFile()) {
        hash.update(fs.readFileSync(absolute));
      }
      hash.update("\0");
    }
  };
  walk(skillDir, "");
  return hash.digest("hex");
}

/**
 * Re-derives the byte identity of an installed skill and compares it with the
 * digest recorded at install time. Callers gate enablement on `verified`.
 */
export function verifyInstalledSkillIntegrity(skillDir: string): SkillIntegrityCheck {
  if (!fs.existsSync(skillDir)) {
    return { verified: false, reason: "not-installed" };
  }
  const originPath = path.join(skillDir, ".clawhub", "origin.json");
  if (!fs.existsSync(originPath)) {
    return { verified: false, reason: "identity-missing" };
  }
  let parsed: { contentDigest?: unknown; contentDigestAlgorithm?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(originPath, "utf8")) as typeof parsed;
  } catch {
    return { verified: false, reason: "identity-malformed" };
  }
  if (parsed.contentDigestAlgorithm !== undefined && parsed.contentDigestAlgorithm !== "sha256") {
    return { verified: false, reason: "identity-malformed" };
  }
  const expectedDigest =
    typeof parsed.contentDigest === "string" ? parsed.contentDigest.trim().toLowerCase() : "";
  if (!SHA256_HEX.test(expectedDigest)) {
    return { verified: false, reason: "identity-missing" };
  }
  const actualDigest = computeSkillContentDigest(skillDir);
  if (actualDigest !== expectedDigest) {
    return { verified: false, reason: "digest-mismatch", expectedDigest, actualDigest };
  }
  return { verified: true, reason: "verified", expectedDigest, actualDigest };
}

/**
 * Turns a requested version into candidate git refs. Catalog versions are
 * semver strings, so both `1.2.0` and the common `v1.2.0` tag are attempted.
 * Anything that is not a safe git ref is ignored rather than passed to git.
 */
function requestedRefCandidates(requestedVersion?: string): string[] {
  const raw = requestedVersion?.trim();
  if (!raw || raw.length > MAX_REQUESTED_VERSION_LENGTH) return [];
  if (!SAFE_GIT_REF.test(raw) || raw.includes("..") || raw.endsWith("/") || raw.endsWith(".lock")) {
    return [];
  }
  const candidates = [raw];
  if (/^\d/.test(raw) && !raw.startsWith("v")) {
    candidates.push(`v${raw}`);
  }
  return candidates;
}

function attemptFallbackBranch(branch: string): string | null {
  if (branch === "main") return "master";
  if (branch === "master") return "main";
  return null;
}

function buildGitHubUrl(github: string, _branch: string): string {
  return `https://github.com/${github}.git`;
}

function buildCodeloadZipUrl(owner: string, repo: string, refSegment: string): string {
  return `https://codeload.github.com/${owner}/${repo}/zip/${refSegment}`;
}

function parseGitHubRepo(github: string): { owner: string; repo: string } {
  const parts = github.split("/");
  const [owner, repo] = parts;
  if (!owner || !repo || parts.length !== 2 || !SAFE_GITHUB_PART.test(owner) || !SAFE_GITHUB_PART.test(repo)) {
    throw new Error(`Invalid GitHub repo: ${github}`);
  }
  return { owner, repo };
}

async function downloadZip(
  owner: string,
  repo: string,
  refSegment: string,
  targetDir: string
): Promise<void> {
  const skillsRoot = getOpenClawSkillsDir();
  const safeTargetDir = assertInsideRoot(skillsRoot, targetDir);
  const zipUrl = buildCodeloadZipUrl(owner, repo, refSegment);
  const { statusCode, data } = await httpGet(zipUrl);

  if (statusCode !== 200) {
    throw new Error(`Failed to download from GitHub: HTTP ${statusCode}`);
  }

  const tempZipPath = assertInsideRoot(skillsRoot, safeTargetDir + ".zip");
  const tempExtractDir = assertInsideRoot(skillsRoot, safeTargetDir + ".extracted");

  try {
    fs.writeFileSync(tempZipPath, data);
    ensureDir(tempExtractDir);

    if (process.platform === "win32") {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
          tempZipPath,
          tempExtractDir,
        ],
        { stdio: "pipe", timeout: 30_000 }
      );
    } else {
      execFileSync("unzip", ["-o", tempZipPath, "-d", tempExtractDir], {
        stdio: "pipe",
        timeout: 30_000,
      });
    }

    const extractedDirs = fs.readdirSync(tempExtractDir);
    const repoDir = extractedDirs.find((d) => d.startsWith(repo));
    if (!repoDir) {
      throw new Error("Could not find repo directory in extracted zip");
    }

    const sourceDir = assertInsideRoot(skillsRoot, path.join(tempExtractDir, repoDir));
    if (!fs.existsSync(sourceDir)) {
      throw new Error("Repo directory not found in extracted zip");
    }

    ensureDir(path.dirname(safeTargetDir));
    removeInsideRoot(skillsRoot, safeTargetDir);
    fs.renameSync(sourceDir, safeTargetDir);
  } finally {
    if (fs.existsSync(tempZipPath)) fs.rmSync(tempZipPath, { force: true });
    removeInsideRoot(skillsRoot, tempExtractDir);
  }
}

/** Resolves the on-disk directory for a managed skill slug (never outside the skills root). */
export function resolveInstalledSkillDir(slug: string): string {
  if (!SAFE_SKILL_SLUG.test(slug)) {
    throw new Error(`Invalid skill slug: ${slug}`);
  }
  const skillsRoot = getOpenClawSkillsDir();
  return assertInsideRoot(skillsRoot, path.join(skillsRoot, slug));
}

export async function installSkillFromCatalog(
  skill: SkillCatalogEntry,
  version?: string
): Promise<InstalledSkillIdentity> {
  const { owner, repo } = parseGitHubRepo(skill.github);
  if (!SAFE_SKILL_SLUG.test(skill.slug)) {
    throw new Error(`Invalid skill slug: ${skill.slug}`);
  }
  const requestedVersion = version?.trim() || undefined;
  const requestedRefs = requestedRefCandidates(requestedVersion);

  const skillsRoot = getOpenClawSkillsDir();
  const skillDir = resolveInstalledSkillDir(skill.slug);

  if (fs.existsSync(skillDir)) {
    throw new Error(
      `Skill "${skill.slug}" is already installed. Uninstall it first before reinstalling.`
    );
  }

  console.log(
    `[SkillInstaller] Installing skill: ${skill.slug} from github.com/${skill.github}` +
      (requestedVersion ? ` (requested version: ${requestedVersion})` : "")
  );

  const repoUrl = buildGitHubUrl(skill.github, "main");
  let installSource: SkillInstallSource = "git-clone";
  let trackedRef = "main";
  let trackedRefKind: SkillTrackedRefKind = "branch";
  let requestedVersionStatus: SkillRequestedVersionStatus = requestedVersion
    ? "unresolved"
    : "not-requested";
  let installed = false;

  // 1) Honor an explicitly requested version when it resolves to a real git ref.
  for (const ref of requestedRefs) {
    try {
      tryGitClone(repoUrl, skillDir, ref);
      installed = true;
      trackedRef = ref;
      trackedRefKind = "pinned";
      requestedVersionStatus = "honored";
      break;
    } catch {
      /* try the next candidate ref */
    }
  }

  // 2) Otherwise track the repository default branch, recording which one worked.
  if (!installed) {
    let branch = "main";
    try {
      tryGitClone(repoUrl, skillDir, branch);
      installed = true;
    } catch {
      const fallback = attemptFallbackBranch(branch);
      if (fallback) {
        try {
          tryGitClone(repoUrl, skillDir, fallback);
          installed = true;
          branch = fallback;
        } catch {
          /* fallback failed */
        }
      }
    }
    if (installed) {
      trackedRef = branch;
      trackedRefKind = "branch";
    }
  }

  // 3) Zip archive fallback when git is unavailable.
  if (!installed) {
    installSource = "zip-archive";
    const zipRefSegments = [
      ...requestedRefs.flatMap((ref) => [`refs/tags/${ref}`, `refs/heads/${ref}`, ref]),
      "refs/heads/main",
      "refs/heads/master",
    ];
    let lastError: unknown;
    for (const refSegment of zipRefSegments) {
      try {
        await downloadZip(owner, repo, refSegment, skillDir);
        installed = true;
        trackedRef = refSegment;
        trackedRefKind = refSegment.startsWith("refs/heads/") ? "branch" : "pinned";
        const honoredRequestedRef = requestedRefs.some(
          (ref) =>
            refSegment === ref || refSegment === `refs/tags/${ref}` || refSegment === `refs/heads/${ref}`
        );
        if (honoredRequestedRef) requestedVersionStatus = "honored";
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!installed) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`Failed to install skill "${skill.slug}" from github.com/${skill.github}`);
    }
  }

  ensureDir(path.join(skillDir, ".clawhub"));
  const installedVersion = readInstalledVersionFromBytes(skillDir);
  const resolvedRevision = installSource === "git-clone" ? readGitRevision(skillDir) : undefined;
  const contentDigest = computeSkillContentDigest(skillDir);

  const identity: InstalledSkillIdentity = {
    slug: skill.slug,
    github: skill.github,
    installedAt: new Date().toISOString(),
    ...(installedVersion ? { installedVersion } : {}),
    installedVersionSource: installedVersion ? "installed-package-json" : "unavailable",
    declaredCatalogVersion: skill.version,
    ...(requestedVersion ? { requestedVersion } : {}),
    requestedVersionStatus,
    installSource,
    trackedRef,
    trackedRefKind,
    ...(resolvedRevision ? { resolvedRevision } : {}),
    contentDigest,
    contentDigestAlgorithm: "sha256",
  };
  fs.writeFileSync(
    path.join(skillDir, ".clawhub", "origin.json"),
    JSON.stringify(identity, null, 2)
  );

  // Fail closed: never report success for bytes whose recorded identity does not
  // match disk, and never leave such an install behind for the runtime to load.
  const integrity = verifyInstalledSkillIntegrity(skillDir);
  if (!integrity.verified) {
    removeInsideRoot(skillsRoot, skillDir);
    throw new Error(
      `Skill "${skill.slug}" failed install integrity verification (${integrity.reason}).`
    );
  }

  if (requestedVersion && requestedVersionStatus === "unresolved") {
    console.warn(
      `[SkillInstaller] Requested version "${requestedVersion}" for ${skill.slug} is not a resolvable git ref; ` +
        `installed tracked ref "${trackedRef}" instead and recorded that in origin.json.`
    );
  }

  console.log(
    `[SkillInstaller] Installed ${skill.slug} to ${skillDir} ` +
      `(ref=${trackedRef}, digest=sha256:${contentDigest.slice(0, 12)}…)`
  );
  return identity;
}
