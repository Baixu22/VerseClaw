// Loads negative fixtures of schema ContractCheckFixture/v1 (the same shape as
// tests/fixtures/contract-check/*.json) and returns the mutated text of every
// targeted file, keyed by its realpath-based absolute path. Mutations are
// applied in memory only; callers hand the result to a loader hook or read it
// in place of the file, so `git status` never changes during a negative run.
//
// Each fixture: { id, mutations: [{ file, find, replace } | { file, append } | { file, prepend }] }.
// `find` must occur in the target file; a miss is an error, never a silent pass.
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export const FIXTURE_SCHEMA = 'ContractCheckFixture/v1';

export class RegistryFixtureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryFixtureError';
  }
}

export function applyMutations(file, text, mutations) {
  // Fixtures are written with \n; checkouts may be CRLF, so match on the
  // file's own line ending rather than the fixture author's.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const normalize = (value) => value.replace(/\r?\n/g, eol);
  let mutated = text;
  for (const mutation of mutations) {
    if (typeof mutation.find === 'string') {
      const find = normalize(mutation.find);
      if (!mutated.includes(find)) {
        throw new RegistryFixtureError(`fixture mutation target not found in ${file}: ${JSON.stringify(mutation.find)}`);
      }
      mutated = mutated.replace(find, () => normalize(mutation.replace ?? ''));
    }
    if (typeof mutation.append === 'string') mutated += normalize(mutation.append);
    if (typeof mutation.prepend === 'string') mutated = normalize(mutation.prepend) + mutated;
  }
  return mutated;
}

export async function readFixture(path, root) {
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
  }
  return { ...fixture, id: fixture.id ?? path, path };
}

export async function loadRegistryFixtures(paths, { root = process.cwd() } = {}) {
  const fixtures = [];
  const mutationsByFile = new Map();
  for (const path of paths) {
    const fixture = await readFixture(path, root);
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
    texts[absolutePath] = applyMutations(file, original, mutations);
    files[file] = absolutePath;
  }
  return { fixtures, texts, files };
}
