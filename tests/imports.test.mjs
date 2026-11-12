import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNames, extractFromPatch, extractFromSource } from '../scripts/lib/imports.mjs';

test('parseNames devolve nomes originais e default', () => {
  assert.deepEqual(parseNames('{ A, B as C, type D }'), ['A', 'B', 'D']);
  assert.deepEqual(parseNames('Def, { A }'), ['A', 'default']);
  assert.deepEqual(parseNames('Def'), ['default']);
  assert.deepEqual(parseNames('* as ns'), []);
  assert.deepEqual(parseNames('Def, * as ns'), ['default']);
  assert.deepEqual(parseNames('{ default as X }'), ['default']);
});

test('extractFromPatch pega todas as formas de import nas linhas adicionadas', () => {
  const patch = [
    '@@ -1,2 +1,9 @@',
    '+import a, { b } from "./ab";',
    '+import type { T } from \'./types\';',
    '+import "./side.css?inline";',
    ' const keep = 1;',
    '+export { x as y } from "./re";',
    '+export * from "./all";',
    '+const r = require("./req");',
    '+const d = await import("./dyn");',
    '+// import nope from "./commented";',
  ].join('\n');
  const refs = extractFromPatch(patch);
  assert.deepEqual(refs.map((r) => [r.spec, r.kind, r.line]), [
    ['./ab', 'import', 1],
    ['./types', 'import', 2],
    ['./side.css', 'side', 3],
    ['./re', 'export', 5],
    ['./all', 'export', 6],
    ['./req', 'require', 7],
    ['./dyn', 'dynamic', 8],
  ]);
  assert.deepEqual(refs[0].names, [{ name: 'b', line: 1 }, { name: 'default', line: 1 }]);
  assert.deepEqual(refs[3].names, [{ name: 'x', line: 5 }]);
  assert.deepEqual(refs[4].names, []);
});

test('import multi-linha: cada nome com a própria linha', () => {
  const patch = '@@ -10,0 +10,4 @@\n+import {\n+  Alpha,\n+  Beta,\n+} from "./greek";';
  const [ref] = extractFromPatch(patch);
  assert.equal(ref.line, 10);
  assert.deepEqual(ref.names, [{ name: 'Alpha', line: 11 }, { name: 'Beta', line: 12 }]);
});

test('import multi-linha com nomes em linhas de contexto vira parcial', () => {
  const patch = '@@ -1,3 +1,3 @@\n import {\n   Alpha,\n-} from "./old";\n+} from "./new";';
  const refs = extractFromPatch(patch);
  assert.deepEqual(refs, [{ spec: './new', names: null, line: 3, kind: 'import', partial: true }]);
});

test('barreira entre hunks impede juntar linhas de lugares diferentes', () => {
  const patch = '@@ -1 +1 @@\n+import {\n@@ -50 +50 @@\n+} from "./far";';
  const refs = extractFromPatch(patch);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].partial, true);
});

test('extractFromSource numera o arquivo inteiro e ignora comentários', () => {
  const src = '/* import x from "./block" */\nimport { a } from "./a";\n// import y from "./line"\nconst u = "http://x"; const r = require("./r");\nimport b from "./b";\n';
  assert.deepEqual(extractFromSource(src).map((r) => [r.spec, r.line]), [['./a', 2], ['./r', 4], ['./b', 5]]);
});

test('import escrito dentro de string não conta', () => {
  const patch = [
    '@@ -1,0 +1,5 @@',
    "+  \"import { x } from './in-string';\",",
    "+  'export * from \"./in-string2\";',",
    '+const s = "require(\'./in-string3\')";',
    "+const t = `await import('./in-string4')`;",
    "+const real = require('./real');",
  ].join('\n');
  assert.deepEqual(extractFromPatch(patch).map((r) => r.spec), ['./real']);
});
