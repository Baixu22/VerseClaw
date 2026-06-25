/**
 * Self-hosted Monaco Editor loader.
 *
 * `@monaco-editor/react` defaults to fetching Monaco from a CDN, which is not
 * suitable for Verse Claw's offline Electron runtime. Keep this loader deliberately
 * lean: file preview needs fast viewing/editing more than IDE diagnostics, so
 * we use the editor API, basic tokenizers, and one lightweight editor worker.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/php/php.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import { loader } from '@monaco-editor/react';

interface MonacoEnvironment {
  getWorker(workerId: string, label: string): Worker;
}

(self as unknown as { MonacoEnvironment: MonacoEnvironment }).MonacoEnvironment = {
  getWorker(_workerId: string, _label: string): Worker {
    return new editorWorker();
  },
};

loader.config({ monaco });

export { monaco };
export { Editor, DiffEditor, loader } from '@monaco-editor/react';

const EXT_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'javascript',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'plaintext',
  '.xml': 'xml',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'java',
  '.swift': 'plaintext',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'shell',
  '.sql': 'sql',
  '.dart': 'plaintext',
  '.php': 'php',
  '.c': 'cpp',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.vue': 'html',
  '.dockerfile': 'dockerfile',
};

export function languageForExt(ext: string): string {
  if (!ext) return 'plaintext';
  const lower = ext.toLowerCase();
  return EXT_LANGUAGE_MAP[lower] ?? 'plaintext';
}

export function languageForPath(path: string): string {
  if (!path) return 'plaintext';
  const norm = path.replace(/\\/g, '/').toLowerCase();
  if (norm.endsWith('/dockerfile') || norm === 'dockerfile') return 'dockerfile';
  const dot = norm.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  return languageForExt(norm.slice(dot));
}
