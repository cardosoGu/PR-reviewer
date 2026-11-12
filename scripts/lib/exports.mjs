import { stripComments } from './imports.mjs';

export const NAMED_CHECKABLE = /\.(d\.)?[mc]?[tj]sx?$/;

export function analyzeExports(source) {
  const src = stripComments(source);
  const names = new Set();
  const starFrom = [];
  let hasDefault = /\bexport\s+default\b/.test(src);
  const DECL =
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+enum|const|let|var|function\s*\*?|class|type|interface|enum|namespace|module)\s+([\w$]+)/g;
  for (const m of src.matchAll(DECL)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+import\s+([\w$]+)\s*=/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (let item of m[1].split(',')) {
      item = item.trim().replace(/^type\s+/, '');
      if (!item) continue;
      const parts = item.split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0]).trim();
      if (exported === 'default') hasDefault = true;
      else names.add(exported);
    }
  }
  for (const m of src.matchAll(/\bexport\s+\*\s+as\s+([\w$]+)\s+from/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+\*\s+from\s*['"]([^'"\n]+)['"]/g)) starFrom.push(m[1]);
  const ambiguous =
    /\bexport\s+(?:const|let|var)\s+[{[]/.test(src) || /\bmodule\.exports\b|\bexports\.[\w$]+\s*=/.test(src);
  return { names, hasDefault, starFrom, ambiguous };
}

// 'yes' | 'no' | 'unknown'. ctx.info(file) -> analyzeExports ou null; ctx.resolve(file, spec) -> caminho ou null.
export function checkName(file, name, ctx, depth = 0) {
  const info = ctx.info(file);
  if (!info) return 'unknown';
  if (name === 'default' ? info.hasDefault : info.names.has(name)) return 'yes';
  if (name !== 'default' && info.starFrom.length) {
    if (depth >= 2) return 'unknown';
    let sawUnknown = false;
    for (const spec of info.starFrom) {
      const target = ctx.resolve(file, spec);
      if (!target) {
        sawUnknown = true;
        continue;
      }
      const r = checkName(target, name, ctx, depth + 1);
      if (r === 'yes') return 'yes';
      if (r === 'unknown') sawUnknown = true;
    }
    if (sawUnknown) return 'unknown';
  }
  return info.ambiguous ? 'unknown' : 'no';
}
