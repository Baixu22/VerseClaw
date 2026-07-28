export const CRLF_NO_NEWLINE_PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,2 +1,2 @@ configure',
  ' const enabled = true;',
  '-const mode = "old";',
  '\\ No newline at end of file',
  '+const mode = "new";',
  '\\ No newline at end of file',
].join('\r\n');

export const ADD_DELETE_PATCH = [
  'diff --git a/src/new.ts b/src/new.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/new.ts',
  '@@ -0,0 +1,2 @@',
  '+first',
  '+second',
  'diff --git a/src/old.ts b/src/old.ts',
  'deleted file mode 100644',
  '--- a/src/old.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-first',
  '-second',
].join('\n');

export const RENAME_COPY_METADATA_PATCH = [
  'diff --git a/src/old-name.ts b/src/new-name.ts',
  'similarity index 100%',
  'rename from src/old-name.ts',
  'rename to src/new-name.ts',
  'diff --git a/src/source.ts b/src/copied.ts',
  'similarity index 100%',
  'copy from src/source.ts',
  'copy to src/copied.ts',
].join('\n');

export const BINARY_AND_MODE_PATCH = [
  'diff --git a/assets/logo.png b/assets/logo.png',
  'index 1111111..2222222 100644',
  'Binary files a/assets/logo.png and b/assets/logo.png differ',
  'diff --git a/scripts/run.sh b/scripts/run.sh',
  'old mode 100644',
  'new mode 100755',
].join('\n');

export const GIT_BINARY_PATCH = [
  'diff --git a/assets/archive.bin b/assets/archive.bin',
  'index 1111111..2222222 100644',
  'GIT binary patch',
  'literal 3',
  'KcmZQzWC8#H2mk;8',
].join('\n');

export const HEADERED_UNIFIED_PATCH = [
  '--- a/docs/guide.md',
  '+++ b/docs/guide.md',
  '@@ -1 +1 @@',
  '-old guide',
  '+new guide',
].join('\n');

export const TRUNCATED_PATCH = [
  'diff --git a/src/truncated.ts b/src/truncated.ts',
  '--- a/src/truncated.ts',
  '+++ b/src/truncated.ts',
  '@@ -10,3 +10,3 @@',
  ' keep',
  '-old',
  '+new',
].join('\n');

export const MALFORMED_PATCH = [
  'diff --git a/src/broken.ts b/src/broken.ts',
  '--- a/src/broken.ts',
  '+++ b/src/broken.ts',
  '@@ -1,1 +1,1 @@',
  '+new',
].join('\n');

export const BARE_HUNK_PATCH = [
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');
