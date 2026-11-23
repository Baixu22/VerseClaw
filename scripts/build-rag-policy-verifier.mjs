import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Ship compiler-backed grading only in the explicitly invoked offline verifier. */
export async function buildRagPolicyVerifier(output = join(root, 'openclaw_runtime', 'dist')) {
  const require = createRequire(join(root, 'openclaw_runtime', 'package.json'));
  const { build } = require('esbuild');
  const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const inputs = new Map();
  mkdirSync(output, { recursive: true });
  const entry = join(output, 'project-rag-policy-verifier.mjs');
  const result = await build({ entryPoints: [join(root, 'scripts', 'knowledge-rag-policy-verifier.mjs')],
    outfile: entry, bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true,
    external: ['yaml'], banner: { js: "import { createRequire as __cr } from 'node:module';import { fileURLToPath as __url } from 'node:url';import { dirname as __dir } from 'node:path';const require=__cr(import.meta.url),__filename=__url(import.meta.url),__dirname=__dir(__filename);" },
    plugins: [{ name: 'verifier-input-pins', setup(builder) { builder.onLoad({ filter: /\.[cm]?[jt]sx?$|\.json$/ }, args => {
      const contents = readFileSync(args.path);
      const extension = extname(args.path);
      const loader = extension === '.json' ? 'json' : extension === '.tsx' ? 'tsx' : /\.[cm]?ts$/.test(extension) ? 'ts' : 'js';
      inputs.set(args.path, hash(contents));
      return { contents, loader, resolveDir: dirname(args.path) };
    }); } }], logLevel: 'silent' });
  const provenance = { schema: 'ProjectRagPolicyVerifier/v1',
    candidate,
    cleanSource: candidate === execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
      && !execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
      && [...inputs].every(([file, digest]) => hash(readFileSync(file)) === digest),
    sha256: hash(readFileSync(entry)),
    inputs: Object.keys(result.metafile.inputs).map(file => ({ path: relative(root, resolve(file)).replaceAll('\\', '/'),
      sha256: inputs.get(resolve(file)) })), actor: 'codex/project-rag-verifier-build', driven_by: 'agent' };
  writeFileSync(join(output, 'project-rag-policy-verifier.json'), JSON.stringify(provenance, null, 2) + '\n');
  return provenance;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildRagPolicyVerifier(process.argv[2] && resolve(process.argv[2]));
  console.log(JSON.stringify({ status: 'built', candidate: result.candidate, sha256: result.sha256 }));
}
