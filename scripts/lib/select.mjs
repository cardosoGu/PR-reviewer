import { ignoreReason } from './filter.mjs';
import { dirOf } from './resolve.mjs';

const ROOT_DOCS = [
  'CLAUDE.md', 'AGENTS.md', '.cursorrules', '.github/copilot-instructions.md', 'CONTRIBUTING.md',
  'docs/CONTRIBUTING.md', 'CODING_STANDARDS.md', 'docs/coding-standards.md', 'STYLEGUIDE.md',
];
const DIR_DOCS = ['CLAUDE.md', 'AGENTS.md'];
export const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|py|go|rb|java|kt|cs|php|rs)$/;

// 'a/b' -> ['a/b', 'a', '']
export function ancestors(dir) {
  const out = [];
  let d = dir;
  for (;;) {
    out.push(d);
    if (!d) return out;
    d = dirOf(d);
  }
}

// Diretórios tocados pela PR, do que tem mais arquivos alterados para o que tem menos.
export function touchedDirs(changed) {
  const count = new Map();
  for (const f of changed) {
    for (const p of [f.path, f.previous].filter(Boolean)) {
      const d = dirOf(p);
      count.set(d, (count.get(d) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
}

export function selectDocs(changed, treeList, max = 15) {
  const tree = new Set(treeList);
  const picks = [];
  const push = (p) => {
    if (tree.has(p) && !picks.includes(p)) picks.push(p);
  };
  ROOT_DOCS.forEach(push);
  treeList.filter((p) => p.startsWith('.cursor/rules/')).slice(0, 5).forEach(push);
  for (const d of touchedDirs(changed)) {
    for (const a of ancestors(d)) for (const n of DIR_DOCS) push(a ? `${a}/${n}` : n);
  }
  return picks.slice(0, max);
}

// Arquivos de código dos diretórios tocados, até maxFiles / maxBytes.
export function selectMirror(changed, treeEntries, { maxFiles = 60, maxBytes = 2_000_000 } = {}) {
  const changedSet = new Set(changed.map((f) => f.path));
  const byDir = new Map();
  for (const e of treeEntries) {
    if (!CODE_EXT.test(e.path) || ignoreReason(e.path)) continue;
    const d = dirOf(e.path);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(e);
  }
  const files = [];
  let bytes = 0;
  let skipped = 0;
  for (const d of touchedDirs(changed)) {
    const entries = (byDir.get(d) ?? []).sort(
      (a, b) => Number(changedSet.has(b.path)) - Number(changedSet.has(a.path)) || a.path.localeCompare(b.path),
    );
    for (const e of entries) {
      if (files.includes(e.path)) continue;
      if (files.length >= maxFiles || bytes + e.size > maxBytes) {
        skipped++;
        continue;
      }
      files.push(e.path);
      bytes += e.size;
    }
  }
  return { files, skipped };
}
