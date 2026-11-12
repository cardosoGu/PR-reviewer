import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidatePaths, findInTree, nearMiss, classify, matchAlias, parseJsonc, aliasFromChain, nearestConfig, extendsPath,
} from '../scripts/lib/resolve.mjs';

test('candidatePaths cobre extensões, index e convenção ESM', () => {
  const c = candidatePaths('src/a');
  assert.ok(c.includes('src/a') && c.includes('src/a.ts') && c.includes('src/a.d.ts') && c.includes('src/a/index.tsx'));
  assert.ok(candidatePaths('src/a.js').includes('src/a.ts'));
  assert.ok(candidatePaths('src/a.mjs').includes('src/a.mts'));
  assert.ok(candidatePaths('src/a.cjs').includes('src/a.d.cts'));
});

test('findInTree e nearMiss', () => {
  const tree = new Set(['src/a.ts', 'src/dir/index.ts', 'src/logo.svg', 'src/style.module.scss']);
  assert.equal(findInTree('src/a', tree), 'src/a.ts');
  assert.equal(findInTree('src/a.js', tree), 'src/a.ts');
  assert.equal(findInTree('src/dir', tree), 'src/dir/index.ts');
  assert.equal(findInTree('src/logo.svg', tree), 'src/logo.svg');
  assert.equal(findInTree('src/nope', tree), null);
  assert.equal(nearMiss('src/style', [...tree]), true);
  assert.equal(nearMiss('src/nope', [...tree]), false);
});

test('classify: relativo, alias, builtin, externo, alias desconhecido e fora da raiz', () => {
  const alias = { paths: { '@/*': ['src/*'], '~config': ['config/index.ts'] }, baseDir: '.', baseUrlDir: '.' };
  assert.deepEqual(classify('src/x/a.ts', '../b', null), { kind: 'path', bases: ['src/b'] });
  assert.deepEqual(classify('a.ts', './b', null), { kind: 'path', bases: ['b'] });
  assert.deepEqual(classify('src/a.ts', '@/lib/x', alias), { kind: 'path', bases: ['src/lib/x'] });
  assert.deepEqual(classify('src/a.ts', '~config', alias), { kind: 'path', bases: ['config/index.ts'] });
  assert.deepEqual(classify('src/a.ts', 'node:fs', null), { kind: 'builtin' });
  assert.deepEqual(classify('src/a.ts', 'path', null), { kind: 'builtin' });
  assert.deepEqual(classify('src/a.ts', '@scope/pkg/sub', null), { kind: 'external', pkg: '@scope/pkg' });
  assert.deepEqual(classify('src/a.ts', 'lodash/fp', null), { kind: 'external', pkg: 'lodash' });
  assert.deepEqual(classify('src/a.ts', '@/lib/x', null), { kind: 'unknownAlias' });
  assert.deepEqual(classify('src/a.ts', '#internal', null), { kind: 'unknownAlias' });
  assert.deepEqual(classify('a.ts', '../up', null), { kind: 'outside' });
});

test('matchAlias com baseDir de subpasta', () => {
  assert.deepEqual(matchAlias('@app/x', { paths: { '@app/*': ['./src/*'] }, baseDir: 'apps/web' }), ['apps/web/src/x']);
  assert.equal(matchAlias('other', { paths: { '@app/*': ['src/*'] }, baseDir: '' }), null);
});

test('parseJsonc aceita comentários e vírgula sobrando sem quebrar strings', () => {
  const j = parseJsonc('{\n // c\n "a": "http://x/*y*/", /* b */ "paths": {"@/*": ["src/*"],},\n}');
  assert.deepEqual(j, { a: 'http://x/*y*/', paths: { '@/*': ['src/*'] } });
});

test('aliasFromChain: filho tem precedência e paths sem baseUrl usa o dir do config', () => {
  const chain = [
    { dir: 'apps/web', json: { compilerOptions: { paths: { '@/*': ['src/*'] } } } },
    { dir: '', json: { compilerOptions: { baseUrl: '.', paths: { '@/*': ['lib/*'] } } } },
  ];
  assert.deepEqual(aliasFromChain(chain), { paths: { '@/*': ['src/*'] }, baseDir: '.', baseUrlDir: '.' });
  assert.deepEqual(aliasFromChain([{ dir: 'apps/web', json: { compilerOptions: { paths: { '@/*': ['src/*'] } } } }]),
    { paths: { '@/*': ['src/*'] }, baseDir: 'apps/web', baseUrlDir: null });
  assert.equal(aliasFromChain([{ dir: '', json: {} }]), null);
});

test('nearestConfig e extendsPath', () => {
  const tree = new Set(['tsconfig.json', 'apps/web/jsconfig.json']);
  assert.equal(nearestConfig('apps/web/src/a.ts', tree), 'apps/web/jsconfig.json');
  assert.equal(nearestConfig('lib/a.ts', tree), 'tsconfig.json');
  assert.equal(nearestConfig('a.ts', new Set()), null);
  assert.equal(extendsPath('apps/web/tsconfig.json', { extends: '../../tsconfig.base' }), 'tsconfig.base.json');
  assert.equal(extendsPath('tsconfig.json', { extends: '@tsconfig/node20' }), null);
});
