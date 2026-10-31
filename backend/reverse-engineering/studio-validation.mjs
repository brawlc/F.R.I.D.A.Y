import { Script } from 'node:vm';
import { ReverseEngineeringError } from './schemas.mjs';

export function validateStudioFiles(files) {
  const invalid = message => new ReverseEngineeringError(message, { code: 'invalid_generated_files' });
  const result = {};
  for (const name of ['index.html', 'styles.css', 'app.js']) {
    if (typeof files?.[name] !== 'string' || !files[name].trim() || Buffer.byteLength(files[name]) > 500000) throw invalid(`Builder returned an invalid ${name}.`);
    result[name] = files[name];
  }
  if (!/<html\b/i.test(result['index.html']) || !/<link\b[^>]*href\s*=\s*["'](?:\.\/)?styles\.css["']/i.test(result['index.html']) || !/<script\b[^>]*src\s*=\s*["'](?:\.\/)?app\.js["']/i.test(result['index.html'])) throw invalid('Builder must return a complete HTML document linked to styles.css and app.js.');
  try { new Script(result['app.js']); } catch { throw invalid('Builder returned JavaScript with syntax errors.'); }
  return result;
}
