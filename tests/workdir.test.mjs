import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { workDir, assertWorkDir, safeJoin, diffPath, mapLimit } from '../scripts/lib/workdir.mjs';

const TMP = path.resolve('/tmp-root');

test('workDir separa por repo e PR', () => {
  assert.equal(workDir(TMP, { owner: 'o', repo: 'r', number: 3 }), path.join(TMP, 'diffs-reviewer', 'o__r__pr-3'));
});

test('assertWorkDir só aceita diretórios dentro da área da skill', () => {
  const ok = path.join(TMP, 'diffs-reviewer', 'o__r__pr-3');
  assert.equal(assertWorkDir(TMP, ok), ok);
  assert.throws(() => assertWorkDir(TMP, path.join(TMP, 'outro')), /fora da área/);
  assert.throws(() => assertWorkDir(TMP, path.join(TMP, 'diffs-reviewer', '..', 'x')), /fora da área/);
  assert.throws(() => assertWorkDir(TMP, undefined), /fora da área/);
});

test('safeJoin recusa caminhos que escapam da base', () => {
  assert.equal(safeJoin(TMP, 'a/b.ts'), path.join(TMP, 'a', 'b.ts'));
  assert.throws(() => safeJoin(TMP, '../x'), /Caminho inválido/);
  assert.equal(diffPath(TMP, 'src/a.ts'), path.join(TMP, 'diffs', 'src', 'a.ts') + '.diff');
});

test('mapLimit respeita o limite e preserva a ordem', async () => {
  let active = 0, peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
});
