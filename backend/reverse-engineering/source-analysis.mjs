import { redactSensitiveText } from './redaction.mjs';
import { readSafeZipEntries } from './zip.mjs';

const SOURCE_FILE_PATTERN = /\.(?:c|cc|cpp|cxx|cs|css|go|h|hpp|html|java|js|jsx|kt|kts|mjs|php|py|rb|rs|sh|swift|toml|ts|tsx|vue|xml|ya?ml|json|md)$/i;
const CONFIG_FILENAMES = new Set(['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'requirements.txt', 'pyproject.toml', 'cargo.toml', 'go.mod', 'pom.xml']);

function unique(values, maximum = 120) {
  return [...new Set(values.filter(Boolean))].slice(0, maximum);
}

function extension(path = '') {
  return path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
}

function lineNumber(text, index) {
  return text.slice(0, Math.max(0, index)).split('\n').length;
}

function collectMatches(text, pattern, mapper, maximum = 120) {
  const matches = [];
  for (const match of text.matchAll(pattern)) {
    matches.push(mapper(match));
    if (matches.length >= maximum) break;
  }
  return matches;
}

export function analyzeSourceText(rawText, path = 'uploaded-source.txt') {
  const text = String(rawText || '').slice(0, 512 * 1024);
  const imports = [];
  const definitions = [];
  const routes = [];
  const ext = extension(path);

  imports.push(...collectMatches(text, /\bimport\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g, match => match[1]));
  imports.push(...collectMatches(text, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, match => match[1]));
  imports.push(...collectMatches(text, /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+/gm, match => match[1]));
  imports.push(...collectMatches(text, /^\s*import\s+([A-Za-z_][\w.]*)/gm, match => match[1]));
  imports.push(...collectMatches(text, /^\s*#include\s*[<"]([^>"]+)[>"]/gm, match => match[1]));
  imports.push(...collectMatches(text, /^\s*import\s+([\w.*]+)\s*;/gm, match => match[1]));

  const definitionPatterns = [
    /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /^\s*def\s+([A-Za-z_][\w]*)\s*\(/gm,
    /^\s*(?:public|private|protected|static|final|async|\s)*\s*(?:class|interface|enum)\s+([A-Za-z_]\w*)/gm,
  ];
  for (const pattern of definitionPatterns) {
    definitions.push(...collectMatches(text, pattern, match => ({ name: match[1], line: lineNumber(text, match.index ?? 0) }), 100));
  }
  routes.push(...collectMatches(text, /\b(?:app|router)\.(get|post|put|patch|delete|use)\s*\(\s*['"]([^'"]+)['"]/g, match => ({ method: match[1].toUpperCase(), path: match[2], line: lineNumber(text, match.index ?? 0) }), 80));

  const indicators = {
    react: /\b(?:react|react-dom|useState|useEffect)\b/i.test(text),
    express: /\b(?:express\s*\(|from\s+['"]express|require\(['"]express)/i.test(text),
    node: /\b(?:process\.env|node:|require\s*\()/i.test(text),
    python: ext === 'py' || /^\s*(?:def|import|from)\s+/m.test(text),
  };

  return {
    path,
    extension: ext || null,
    bytes: Buffer.byteLength(text),
    imports: unique(imports.map(item => redactSensitiveText(item, 240))),
    definitions: unique(definitions.map(item => `${item.name}:${item.line}`), 160).map(item => {
      const [name, line] = item.split(':');
      return { name, line: Number(line) || 1 };
    }),
    routes,
    indicators,
    truncated: Buffer.byteLength(rawText || '') > Buffer.byteLength(text),
  };
}

function packageDependencies(text) {
  try {
    const parsed = JSON.parse(text);
    return unique([
      ...Object.keys(parsed?.dependencies || {}),
      ...Object.keys(parsed?.devDependencies || {}),
    ], 160);
  } catch {
    return [];
  }
}

export function analyzeSourceArtifact(buffer, originalFilename = '') {
  const looksLikeArchive = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (!looksLikeArchive) {
    const file = analyzeSourceText(buffer.toString('utf8'), originalFilename || 'uploaded-source.txt');
    return {
      kind: 'single-file',
      filesScanned: 1,
      sourceFiles: [file],
      imports: file.imports,
      definitions: file.definitions.map(item => ({ ...item, file: file.path })),
      routes: file.routes.map(item => ({ ...item, file: file.path })),
      dependencies: [],
      limitations: ['A single uploaded file cannot prove repository-wide module relationships.'],
    };
  }

  const archive = readSafeZipEntries(buffer, {
    include: path => SOURCE_FILE_PATTERN.test(path) || CONFIG_FILENAMES.has(path.toLowerCase().split('/').pop()),
  });
  if (!archive.valid) {
    return {
      kind: 'archive', filesScanned: 0, sourceFiles: [], imports: [], definitions: [], routes: [], dependencies: [],
      limitations: [archive.limitation || 'The source archive could not be safely parsed.'],
      archive,
    };
  }
  const sourceFiles = archive.files
    .filter(file => SOURCE_FILE_PATTERN.test(file.path))
    .map(file => analyzeSourceText(file.data.toString('utf8'), file.path));
  const packageJson = archive.files.find(file => file.path.toLowerCase().endsWith('/package.json') || file.path.toLowerCase() === 'package.json');
  const dependencies = packageJson ? packageDependencies(packageJson.data.toString('utf8')) : [];
  return {
    kind: 'safe-archive',
    filesScanned: sourceFiles.length,
    sourceFiles,
    imports: unique(sourceFiles.flatMap(file => file.imports), 220),
    definitions: sourceFiles.flatMap(file => file.definitions.map(definition => ({ ...definition, file: file.path }))).slice(0, 220),
    routes: sourceFiles.flatMap(file => file.routes.map(route => ({ ...route, file: file.path }))).slice(0, 160),
    dependencies,
    limitations: [
      'Only bounded, safe source files were read in memory; archive contents were not written to disk.',
      ...(archive.truncated ? ['Archive entry list exceeded the bounded parser limit.'] : []),
      ...(archive.skipped.length ? [`${archive.skipped.length} archive entries were skipped by safety policy.`] : []),
    ],
    archive: {
      entryCount: archive.entryCount,
      parsedEntryCount: archive.parsedEntryCount,
      extractedBytes: archive.extractedBytes,
      skipped: archive.skipped.slice(0, 30),
    },
  };
}
