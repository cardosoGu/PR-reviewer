import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancestors, touchedDirs, selectDocs, selectMirror } from '../scripts/lib/select.mjs';

const changed = [
  { path: 'src/api/a.ts', previous: null },
  { path: 'src/api/b.ts', previous: null },
  { path: 'src/util/c.ts', previous: 'lib/c.ts' },
];

test('ancestors e touchedDirs', () => {
  assert.deepEqual(ancestors('a/b'), ['a/b', 'a', '']);
  assert.deepEqual(ancestors(''), ['']);
  assert.deepEqual(touchedDirs(changed), ['src/api', 'lib', 'src/util']);
});

test('selectDocs pega docs da raiz, rules e CLAUDE.md dos diretórios tocados e ancestrais', () => {
  const tree = ['CLAUDE.md', 'CONTRIBUTING.md', '.cursor/rules/a.mdc', 'src/CLAUDE.md', 'src/api/AGENTS.md', 'other/CLAUDE.md'];
  assert.deepEqual(selectDocs(changed, tree), ['CLAUDE.md', 'CONTRIBUTING.md', '.cursor/rules/a.mdc', 'src/api/AGENTS.md', 'src/CLAUDE.md']);
  assert.equal(selectDocs(changed, tree, 2).length, 2);
});

test('selectMirror prioriza diretórios e arquivos alterados e respeita os tetos', () => {
  const entries = [
    { path: 'src/api/z.ts', size: 10 },
    { path: 'src/api/a.ts', size: 10 },
    { path: 'src/api/b.ts', size: 10 },
    { path: 'src/api/readme.md', size: 10 },
    { path: 'src/api/data.min.js', size: 10 },
    { path: 'src/util/c.ts', size: 10 },
    { path: 'src/util/d.ts', size: 1000 },
    { path: 'elsewhere/e.ts', size: 10 },
  ];
  assert.deepEqual(selectMirror(changed, entries), { files: ['src/api/a.ts', 'src/api/b.ts', 'src/api/z.ts', 'src/util/c.ts', 'src/util/d.ts'], skipped: 0 });
  assert.deepEqual(selectMirror(changed, entries, { maxFiles: 2 }), { files: ['src/api/a.ts', 'src/api/b.ts'], skipped: 3 });
  assert.deepEqual(selectMirror(changed, entries, { maxBytes: 100 }).skipped, 1);
});
