import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeExports, checkName, NAMED_CHECKABLE } from '../scripts/lib/exports.mjs';

test('analyzeExports reconhece declarações, listas, re-exports e default', () => {
  const src = [
    'export const a = 1;',
    'export async function b() {}',
    'export function* gen() {}',
    'export abstract class C {}',
    'export declare const enum E {}',
    'export type T = string;',
    'export interface I {}',
    'export { x, y as z, type W };',
    'export {',
    '  multi,',
    '  other as renamed,',
    '} from "./m";',
    'export * as ns from "./ns";',
    'export * from "./star";',
    'export import Q = R.Q;',
    'export { q as default };',
    '// export const commented = 1;',
  ].join('\n');
  const info = analyzeExports(src);
  assert.deepEqual([...info.names].sort(), ['C', 'E', 'I', 'Q', 'T', 'W', 'a', 'b', 'gen', 'multi', 'ns', 'renamed', 'x', 'z'].sort());
  assert.equal(info.hasDefault, true);
  assert.deepEqual(info.starFrom, ['./star']);
  assert.equal(info.ambiguous, false);
});

test('analyzeExports marca CommonJS e destructuring como ambíguos', () => {
  assert.equal(analyzeExports('module.exports = { a };').ambiguous, true);
  assert.equal(analyzeExports('exports.a = 1;').ambiguous, true);
  assert.equal(analyzeExports('export const { a, b } = obj;').ambiguous, true);
  assert.equal(analyzeExports('export default function () {}').hasDefault, true);
});

test('checkName segue export * até 2 níveis', () => {
  const files = {
    'barrel.ts': analyzeExports('export * from "./mid";'),
    'mid.ts': analyzeExports('export * from "./leaf";\nexport * from "./missing";'),
    'leaf.ts': analyzeExports('export const deep = 1;'),
    'cjs.ts': analyzeExports('module.exports = {};'),
    'plain.ts': analyzeExports('export const a = 1;'),
  };
  const ctx = {
    info: (f) => files[f] ?? null,
    resolve: (from, spec) => ({ './mid': 'mid.ts', './leaf': 'leaf.ts' })[spec] ?? null,
  };
  assert.equal(checkName('barrel.ts', 'deep', ctx), 'yes');
  assert.equal(checkName('barrel.ts', 'ghost', ctx), 'unknown');
  assert.equal(checkName('plain.ts', 'a', ctx), 'yes');
  assert.equal(checkName('plain.ts', 'ghost', ctx), 'no');
  assert.equal(checkName('plain.ts', 'default', ctx), 'no');
  assert.equal(checkName('cjs.ts', 'ghost', ctx), 'unknown');
  assert.equal(checkName('not-fetched.ts', 'a', ctx), 'unknown');
});

test('NAMED_CHECKABLE só aceita arquivos JS/TS', () => {
  for (const f of ['a.ts', 'a.tsx', 'a.d.ts', 'a.mjs', 'a.cts', 'a.js']) assert.ok(NAMED_CHECKABLE.test(f), f);
  for (const f of ['a.json', 'a.vue', 'a.css']) assert.ok(!NAMED_CHECKABLE.test(f), f);
});
