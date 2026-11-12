import { addedLines } from './diff.mjs';

export const JS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

// import/export só contam no início da linha (texto dentro de string não é import).
const PATTERNS = [
  { kind: 'import', re: /^[ \t]*import\s+(type\s+)?([^;'"]*?)\s*\bfrom\s*['"]([^'"\n]+)['"]/gm, clause: 2, spec: 3 },
  { kind: 'export', re: /^[ \t]*export\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^;'"]*?\})\s*from\s*['"]([^'"\n]+)['"]/gm, clause: 2, spec: 3 },
  { kind: 'side', re: /^[ \t]*import\s*['"]([^'"\n]+)['"]/gm, clause: 0, spec: 1 },
  { kind: 'require', re: /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g, clause: 0, spec: 1, checkString: true },
  { kind: 'dynamic', re: /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g, clause: 0, spec: 1, checkString: true },
];

// A posição idx está dentro de uma string aberta na mesma linha?
function inString(text, idx) {
  let q = null;
  for (let i = text.lastIndexOf('\n', idx - 1) + 1; i < idx; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '\\') i++;
      else if (ch === q) q = null;
    } else if (ch === '"' || ch === "'" || ch === '`') q = ch;
  }
  return q !== null;
}

// Nomes importados de uma cláusula: originais de `{ A as B }`, e "default" para import padrão.
export function parseNames(clause) {
  const c = String(clause ?? '').trim();
  const names = [];
  const brace = /\{([^}]*)\}/.exec(c);
  if (brace) {
    for (let item of brace[1].split(',')) {
      item = item.trim().replace(/^type\s+/, '');
      if (!item) continue;
      const orig = item.split(/\s+as\s+/)[0].trim();
      if (orig) names.push(orig);
    }
  }
  const head = c.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
  if (head && !head.startsWith('*') && /^[\w$]+/.test(head)) names.push('default');
  return names;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function makeLineAt(starts, lines) {
  return (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= off) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return lines[ans] ?? 1;
  };
}

// Referências de import num texto. names: [{name, line}] ou null (multi-linha parcial).
export function extractRefs(text, lineAt) {
  const refs = [];
  const covered = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      if (p.checkString && inString(text, m.index)) continue;
      covered.push([m.index, m.index + m[0].length]);
      const names = p.clause
        ? parseNames(m[p.clause]).map((name) => {
            if (name === 'default') return { name, line: lineAt(m.index) };
            const hit = new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`).exec(m[0]);
            return { name, line: lineAt(m.index + (hit ? hit.index : 0)) };
          })
        : [];
      refs.push({ spec: m[p.spec].replace(/[?#].*$/, ''), names, line: lineAt(m.index), kind: p.kind, partial: false });
    }
  }
  const orphan = /^[ \t]*\}\s*from\s*['"]([^'"\n]+)['"]/gm;
  let m;
  while ((m = orphan.exec(text))) {
    const at = m.index;
    if (covered.some(([s, e]) => at >= s && at < e)) continue;
    refs.push({ spec: m[1].replace(/[?#].*$/, ''), names: null, line: lineAt(at), kind: 'import', partial: true });
  }
  return refs.sort((a, b) => a.line - b.line);
}

const isCommentLine = (t) => /^\s*(\/\/|\/\*|\*)/.test(t);

export function extractFromPatch(patch) {
  let text = '';
  const starts = [];
  const lines = [];
  let prev = null;
  for (const a of addedLines(patch)) {
    if (prev && (a.hunk !== prev.hunk || a.line !== prev.line + 1)) text += ';\n';
    starts.push(text.length);
    lines.push(a.line);
    text += `${isCommentLine(a.text) ? '' : a.text}\n`;
    prev = a;
  }
  return extractRefs(text, makeLineAt(starts, lines));
}

export function stripComments(source) {
  return String(source ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

export function extractFromSource(source) {
  const text = stripComments(source);
  const starts = [0];
  const lines = [1];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1);
      lines.push(lines.length + 1);
    }
  }
  return extractRefs(text, makeLineAt(starts, lines));
}
