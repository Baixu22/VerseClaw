/**
 * 分发可用性检查（`CC-DIST-01` 的包侧部分）。
 *
 * A08 的 fallback 规则说得很直白：**wasm 或 glue 缺失（报缺失文件名）、版本与宿主声明不匹配、
 * 运行时不支持 —— 三种情况都必须明确 unavailable，不得借用本机包、开发机绝对链接或另一个
 * workspace 的副本。** 这个模块就是那条规则的可执行版本：它只检查本包目录下声明过的文件，
 * 把「缺了什么、版本对不对、摘要对不对」如实报出来。
 *
 * ## 它为什么不在主入口里
 *
 * 主入口（`dist/index.*`）在**加载时**同步 import wasm glue；wasm 缺失时的表现是一个加载期异常，
 * 而不是结构化结果——要改成结构化就得把主入口改成惰性加载，那会动到旧消费面的行为。
 * 所以可用性检查放在这里：**宿主先用它做预检，再去 import/使用主入口或 worker**。
 * worker 入口本来就是惰性的，它也会用同一份检查。
 *
 * ## 三条纪律
 *
 * 1. **只查声明的路径**：`checkedPaths` 全部落在 `packageRoot` 之下，没有 `NODE_PATH`、
 *    没有全局 `node_modules`、没有相对当前工作目录的搜索。
 * 2. **不做回退**：结果是 `available: false` 时调用方必须把能力标成 unavailable，
 *    不要「找不到就换一个副本」。
 * 3. **摘要可选但推荐**：A08 要求消费方按锁定版本 + 摘要引用；给出 `wasmExpectedSha256`
 *    时会对实际 wasm 重算 SHA-256 比对。
 *
 * driven_by: agent。
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本包声明的最小 Node 主版本（与 package.json 的 engines 一致）。 */
export const MINIMUM_NODE_MAJOR = 18;

/** 运行时必须存在的文件，路径相对包根。 */
export const REQUIRED_DISTRIBUTION_FILES = [
  'package.json',
  'dist/index.mjs',
  'dist/index.cjs',
  'dist/index.d.ts',
  'pkg/verseconf_wasm.js',
  'pkg/verseconf_wasm_bg.wasm',
];

/** 默认包根：这个文件在 `<包根>/worker/` 下。 */
export const DEFAULT_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function nodeMajor(version) {
  const match = String(version).match(/^v?(\d+)\./);
  return match ? Number(match[1]) : null;
}

/**
 * 检查本包是否可用。
 *
 * @param {object} [options]
 * @param {string} [options.packageRoot] 覆盖包根（测试用）
 * @param {string} [options.nodeVersion] 覆盖运行时版本（默认 `process.version`；测试用）
 * @param {string} [options.expectedVersion] 宿主声明期望的包版本；不一致即 unavailable
 * @param {string} [options.wasmExpectedSha256] 宿主锁定的 wasm 摘要；不一致即 unavailable
 */
export function checkDistribution(options = {}) {
  const packageRoot = resolve(options.packageRoot ?? DEFAULT_PACKAGE_ROOT);
  const nodeVersion = options.nodeVersion ?? process.version;
  const expectedVersion = options.expectedVersion ?? null;
  const wasmExpectedSha256 = options.wasmExpectedSha256 ?? null;

  const checkedPaths = REQUIRED_DISTRIBUTION_FILES.map((relative) => join(packageRoot, relative));
  const result = {
    available: false,
    code: 'available',
    packageRoot,
    nodeVersion,
    expectedVersion,
    packageVersion: null,
    missing: [],
    present: [],
    checkedPaths,
    wasm: null,
    reasons: [],
    callerMust:
      '不可用时把本次能力标为 unavailable 并按原因处理；不要借用本机包、开发机链接或另一个 workspace 的副本。',
  };

  // 1) 运行时
  const major = nodeMajor(nodeVersion);
  if (major === null || major < MINIMUM_NODE_MAJOR) {
    result.code = 'unsupported_runtime';
    result.reasons.push(`运行时 ${nodeVersion} 低于要求（Node ≥ ${MINIMUM_NODE_MAJOR}）`);
    return result;
  }

  // 2) package.json
  const packageJsonPath = join(packageRoot, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    result.code = 'package_json_unreadable';
    result.reasons.push(`读不到或解析不了 ${packageJsonPath}：${error.message}`);
    return result;
  }
  result.packageVersion = packageJson.version ?? null;

  if (expectedVersion !== null && packageJson.version !== expectedVersion) {
    result.code = 'version_mismatch';
    result.reasons.push(
      `包版本 ${packageJson.version} 与宿主声明的 ${expectedVersion} 不一致：按 unavailable 处理，不要静默用别的版本`
    );
    return result;
  }

  // 3) 文件齐备
  for (const relative of REQUIRED_DISTRIBUTION_FILES) {
    const absolute = join(packageRoot, relative);
    try {
      const stat = statSync(absolute);
      if (stat.isFile() && stat.size > 0) {
        result.present.push(relative);
        continue;
      }
      result.missing.push(relative);
    } catch {
      result.missing.push(relative);
    }
  }
  if (result.missing.length > 0) {
    result.code = 'missing_files';
    result.reasons.push(`缺少分发文件：${result.missing.join('、')}`);
    return result;
  }

  // 4) wasm 摘要（可选）
  const wasmPath = join(packageRoot, 'pkg', 'verseconf_wasm_bg.wasm');
  const wasmBytes = readFileSync(wasmPath);
  const wasmSha256 = sha256(wasmBytes);
  result.wasm = { path: wasmPath, bytes: wasmBytes.length, sha256: wasmSha256 };
  if (wasmExpectedSha256 !== null && wasmSha256 !== wasmExpectedSha256) {
    result.code = 'wasm_digest_mismatch';
    result.reasons.push(
      `wasm 摘要 ${wasmSha256} 与宿主锁定的 ${wasmExpectedSha256} 不一致：按 unavailable 处理`
    );
    return result;
  }

  result.available = true;
  return result;
}
