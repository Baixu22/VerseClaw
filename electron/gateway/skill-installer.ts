/**
 * Skill Installer
 * Downloads skills from GitHub repos and installs them to ~/.openclaw/skills/
 */
import fs from "fs";
import path from "path";
import https from "https";
import { execFileSync } from "child_process";
import { ensureDir, getOpenClawSkillsDir } from "../utils/paths";
import type { SkillCatalogEntry } from "./skill-catalog";

const SAFE_GITHUB_PART = /^[a-zA-Z0-9_.-]+$/;
const SAFE_SKILL_SLUG = /^[a-zA-Z0-9_.-]+$/;

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
      .get(url, { headers: { "User-Agent": "ClawX-Skill-Installer/1.0" } }, (res) => {
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

function tryGitClone(repoUrl: string, targetDir: string, branch: string): void {
  const skillsRoot = getOpenClawSkillsDir();
  const safeTargetDir = assertInsideRoot(skillsRoot, targetDir);
  const tempDir = targetDir + ".tmp";
  const safeTempDir = assertInsideRoot(skillsRoot, tempDir);
  removeInsideRoot(skillsRoot, safeTempDir);
  try {
    execFileSync(
      "git",
      ["clone", "--depth", "1", "--branch", branch, "--single-branch", repoUrl, safeTempDir],
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

async function downloadZip(
  owner: string,
  repo: string,
  branch: string,
  targetDir: string
): Promise<void> {
  const skillsRoot = getOpenClawSkillsDir();
  const safeTargetDir = assertInsideRoot(skillsRoot, targetDir);
  const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
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

function attemptFallbackBranch(branch: string): string | null {
  if (branch === "main") return "master";
  if (branch === "master") return "main";
  return null;
}

function buildGitHubUrl(github: string, _branch: string): string {
  return `https://github.com/${github}.git`;
}

function parseGitHubRepo(github: string): { owner: string; repo: string } {
  const parts = github.split("/");
  const [owner, repo] = parts;
  if (!owner || !repo || parts.length !== 2 || !SAFE_GITHUB_PART.test(owner) || !SAFE_GITHUB_PART.test(repo)) {
    throw new Error(`Invalid GitHub repo: ${github}`);
  }
  return { owner, repo };
}

export async function installSkillFromCatalog(
  skill: SkillCatalogEntry,
  _version?: string
): Promise<void> {
  const { owner, repo } = parseGitHubRepo(skill.github);
  if (!SAFE_SKILL_SLUG.test(skill.slug)) {
    throw new Error(`Invalid skill slug: ${skill.slug}`);
  }
  console.log(
    `[SkillInstaller] Installing skill: ${skill.slug} from github.com/${skill.github}`
  );

  const skillsRoot = getOpenClawSkillsDir();
  const skillDir = assertInsideRoot(skillsRoot, path.join(skillsRoot, skill.slug));

  if (fs.existsSync(skillDir)) {
    throw new Error(
      `Skill "${skill.slug}" is already installed. Uninstall it first before reinstalling.`
    );
  }

  const repoUrl = buildGitHubUrl(skill.github, "main");
  let branch = "main";
  let installed = false;

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
      } catch { /* fallback failed */ }
    }
  }

  if (!installed) {
    try {
      await downloadZip(owner, repo, branch, skillDir);
      installed = true;
    } catch (zipErr) {
      const fallback = attemptFallbackBranch(branch);
      if (fallback) {
        await downloadZip(owner, repo, fallback, skillDir);
        installed = true;
      } else {
        throw zipErr;
      }
    }
  }

  ensureDir(path.join(skillDir, ".clawhub"));
  const originData = {
    slug: skill.slug,
    installedVersion: skill.version,
    github: skill.github,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(skillDir, ".clawhub", "origin.json"),
    JSON.stringify(originData, null, 2)
  );

  console.log(`[SkillInstaller] Installed ${skill.slug} to ${skillDir}`);
}
