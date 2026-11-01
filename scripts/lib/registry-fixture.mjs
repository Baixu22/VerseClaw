// Loads negative fixtures of schema ContractCheckFixture/v1 (the same shape as
// tests/fixtures/contract-check/*.json) and returns the mutated text of every
// targeted file, keyed by its realpath-based absolute path. Mutations are
// applied in memory only; callers hand the result to a loader hook or read it
// in place of the file, so `git status` never changes during a negative run.
//
// Each fixture: { id, mutations: [{ file, find, replace, anchor? } | { file, append } | { file, prepend }] }.
// `find` must occur in the target file; a miss is an error, never a silent pass.
//
// Anchor discipline (opt-in, `anchors: 'required'`): a `find` mutation must
// name the id literal of the entry it edits in `anchor`, `find` must contain
// that literal, and `find` must occur exactly once in the (progressively
// mutated) target text. A fixture that only matches by coincidence — the first
// of several identical lines, or a snippet that could belong to any entry — is
// rejected instead of silently editing whichever entry happens to come first.
// Gates whose fixtures predate the discipline keep the default (optional) mode.
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export const FIXTURE_SCHEMA = 'ContractCheckFixture/v1';
export const ANCHOR_MODES = Object.freeze(['optional', 'required']);

export class RegistryFixtureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryFixtureError';
  }
}

function countOccurrences(text, needle) {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function resolveAnchorMode(anchors) {
  const mode = anchors ?? 'optional';
  if (!ANCHOR_MODES.includes(mode)) throw new RegistryFixtureError(`unknown anchors mode ${JSON.stringify(anchors)}; expected one of ${ANCHOR_MODES.join(', ')}`);
  return mode;
}

export function applyMutations(file, text, mutations, { anchors } = {}) {
  const requireAnchors = resolveAnchorMode(anchors) === 'required';
  // Fixtures are written with \n; checkouts may be CRLF, so match on the
  // file's own line ending rather than the fixture author's.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const normalize = (value) => value.replace(/\r?\n/g, eol);
  let mutated = text;
  for (const mutation of mutations) {
    if (typeof mutation.find === 'string') {
      const find = normalize(mutation.find);
      if (requireAnchors) {
        if (typeof mutation.anchor !== 'string' || !mutation.anchor.trim()) {
          throw new RegistryFixtureError(`fixture mutation on ${file} declares no anchor; this gate requires the id literal of the mutated entry (anchor) in every find mutation`);
        }
        if (!find.includes(normalize(mutation.anchor))) {
          throw new RegistryFixtureError(`fixture mutation on ${file} has a find that does not contain its anchor ${JSON.stringify(mutation.anchor)}: ${JSON.stringify(mutation.find)}`);
        }
      }
      const occurrences = countOccurrences(mutated, find);
      if (occurrences === 0) {
        throw new RegistryFixtureError(`fixture mutation target not found in ${file}: ${JSON.stringify(mutation.find)}`);
      }
      if (requireAnchors && occurrences > 1) {
        throw new RegistryFixtureError(`fixture mutation target is ambiguous in ${file} (${occurrences} occurrences; anchor ${JSON.stringify(mutation.anchor)}): ${JSON.stringify(mutation.find)}`);
      }
      mutated = mutated.replace(find, () => normalize(mutation.replace ?? ''));
    }
    if (typeof mutation.append === 'string') mutated += normalize(mutation.append);
    if (typeof mutation.prepend === 'string') mutated = normalize(mutation.prepend) + mutated;
  }
  return mutated;
}

export async function readFixture(path, root, { anchors } = {}) {
  const requireAnchors = resolveAnchorMode(anchors) === 'required';
  let raw;
  try {
    raw = await readFile(isAbsolute(path) ? path : resolve(root, path), 'utf8');
  } catch (error) {
    throw new RegistryFixtureError(`fixture ${path} could not be read: ${error.message}`);
  }
  let fixture;
  try {
    fixture = JSON.parse(raw);
  } catch (error) {
    throw new RegistryFixtureError(`fixture ${path} is not valid JSON: ${error.message}`);
  }
  if (fixture.schema !== undefined && fixture.schema !== FIXTURE_SCHEMA) {
    throw new RegistryFixtureError(`fixture ${path} declares schema ${JSON.stringify(fixture.schema)}, expected ${FIXTURE_SCHEMA}`);
  }
  if (!Array.isArray(fixture.mutations) || fixture.mutations.length === 0) {
    throw new RegistryFixtureError(`fixture ${path} declares no mutations`);
  }
  for (const mutation of fixture.mutations) {
    if (typeof mutation.file !== 'string' || !mutation.file.trim()) {
      throw new RegistryFixtureError(`fixture ${path}: mutation without file`);
    }
    if (typeof mutation.find !== 'string' && typeof mutation.append !== 'string' && typeof mutation.prepend !== 'string') {
      throw new RegistryFixtureError(`fixture ${path}: mutation on ${mutation.file} has no find/append/prepend`);
    }
    if (requireAnchors && typeof mutation.find === 'string') {
      if (typeof mutation.anchor !== 'string' || !mutation.anchor.trim()) {
        throw new RegistryFixtureError(`fixture ${path}: find mutation on ${mutation.file} declares no anchor (the id literal of the mutated entry)`);
      }
      if (!mutation.find.includes(mutation.anchor)) {
        throw new RegistryFixtureError(`fixture ${path}: find mutation on ${mutation.file} does not contain its anchor ${JSON.stringify(mutation.anchor)}`);
      }
    }
  }
  return { ...fixture, id: fixture.id ?? path, path };
}

export async function loadRegistryFixtures(paths, { root = process.cwd(), anchors } = {}) {
  resolveAnchorMode(anchors);
  const fixtures = [];
  const mutationsByFile = new Map();
  for (const path of paths) {
    const fixture = await readFixture(path, root, { anchors });
    fixtures.push(fixture);
    for (const mutation of fixture.mutations) {
      if (!mutationsByFile.has(mutation.file)) mutationsByFile.set(mutation.file, []);
      mutationsByFile.get(mutation.file).push(mutation);
    }
  }
  const texts = {};
  const files = {};
  for (const [file, mutations] of mutationsByFile) {
    let original;
    try {
      original = await readFile(resolve(root, file), 'utf8');
    } catch (error) {
      throw new RegistryFixtureError(`fixture target file could not be read: ${file} (${error.message})`);
    }
    const absolutePath = await realpath(resolve(root, file));
    texts[absolutePath] = applyMutations(file, original, mutations, { anchors });
    files[file] = absolutePath;
  }
  return { fixtures, texts, files };
}
