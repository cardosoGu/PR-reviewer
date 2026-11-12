import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../scripts/fetch-pr.mjs';

const LINK = 'https://github.com/own/repo/pull/7';
const SHA = 'a'.repeat(40);
const FILES = [
  { filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1,2 +1,3 @@\n ctx\n-old\n+new1\n+new2' },
  { filename: 'package-lock.json', status: 'modified', additions: 100, deletions: 50, patch: '@@ -1 +1 @@\n-a\n+b' },
  { filename: 'src/big.ts', status: 'added', additions: 3, deletions: 0 },
  { filename: 'src/old.ts', status: 'removed', additions: 0, deletions: 2, patch: '@@ -1,2 +0,0 @@\n-a\n-b' },
  { filename: 'src/new-name.ts', status: 'renamed', previous_filename: 'src/old-name.ts', additions: 0, deletions: 0 },
];
const BIG_DIFF = 'diff --git a/src/big.ts b/src/big.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/big.ts\n@@ -0,0 +1,3 @@\n+1\n+2\n+3\n';

function fake({ view = {}, files = FILES } = {}) {
  const calls = [];
  const exec = async (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({
        title: 'Feat X', body: 'Adiciona X\n\nDetalhe importante', state: 'OPEN', isDraft: false, baseRefName: 'main',
        headRefOid: SHA, headRepository: { name: 'repo' }, headRepositoryOwner: { login: 'own' },
        commits: [{ messageHeadline: 'feat: x' }], url: LINK, number: 7, ...view,
      });
    }
    if (args[0] === 'api' && args[1].includes('/pulls/7/files')) return JSON.stringify([files]);
    if (args[0] === 'api' && args[1].includes('/git/trees/')) {
      return JSON.stringify({ truncated: false, tree: [{ path: 'src/a.ts', type: 'blob', size: 10 }, { path: 'src', type: 'tree' }] });
    }
    if (args[0] === 'pr' && args[1] === 'diff') return BIG_DIFF;
    throw new Error(`inesperado: ${args.join(' ')}`);
  };
  return { exec, calls };
}

function setup() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-test-'));
  const out = [];
  return { tmpRoot, out, log: (l) => out.push(l) };
}

test('coleta PR aberta: diffs por arquivo, tree, meta e resumo', async () => {
  const { tmpRoot, out, log } = setup();
  const { exec, calls } = fake();
  assert.equal(await run([LINK], { exec, tmpRoot, log }), 0);
  const dir = path.join(tmpRoot, 'diffs-reviewer', 'own__repo__pr-7');
  assert.equal(fs.readFileSync(path.join(dir, 'diffs', 'src', 'a.ts.diff'), 'utf8'), '@@ -1,2 +1,3 @@\n ctx\n-old\n+new1\n+new2\n');
  assert.match(fs.readFileSync(path.join(dir, 'diffs', 'src', 'big.ts.diff'), 'utf8'), /^@@ -0,0 \+1,3 @@\n\+1/);
  assert.equal(fs.existsSync(path.join(dir, 'diffs', 'package-lock.json.diff')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'tree.txt'), 'utf8'), 'src/a.ts\t10\n');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.headSha, SHA);
  assert.deepEqual(meta.files.find((f) => f.path === 'src/new-name.ts'), {
    path: 'src/new-name.ts', status: 'R', previous: 'src/old-name.ts', additions: 0, deletions: 0, ignored: null, diff: false,
  });
  const text = out.join('\n');
  assert.match(text, /^PR #7 Feat X — OPEN — base main ← head aaaaaaa/);
  assert.match(text, /Intent:\n  Adiciona X\n  Detalhe importante/);
  assert.match(text, /Arquivos \(4 analisados, 1 ignorados, 8 linhas, escopo Medium\):/);
  assert.match(text, /  D src\/old\.ts\n/);
  assert.match(text, /  R src\/new-name\.ts ← src\/old-name\.ts \+0 -0/);
  assert.match(text, /Ignorados: lockfile 1/);
  assert.match(text, /Não alcançados: nenhum/);
  assert.match(text, /Dir: .*own__repo__pr-7$/);
  assert.equal(calls.filter((c) => c[1] === 'diff').length, 1);
});

test('PR fechada, mergeada ou draft para com código 2 sem gravar nada', async () => {
  for (const view of [{ state: 'CLOSED' }, { state: 'MERGED' }, { isDraft: true }]) {
    const { tmpRoot, out, log } = setup();
    assert.equal(await run([LINK], { exec: fake({ view }).exec, tmpRoot, log }), 2);
    assert.match(out.join('\n'), /Aviso: a PR #7 está (CLOSED|MERGED|DRAFT)\. Nada foi coletado\./);
    assert.equal(fs.existsSync(path.join(tmpRoot, 'diffs-reviewer')), false);
  }
});

test('--force continua com PR mergeada', async () => {
  const { tmpRoot, out, log } = setup();
  assert.equal(await run([LINK, '--force'], { exec: fake({ view: { state: 'MERGED' } }).exec, tmpRoot, log }), 0);
  assert.match(out[0], /— MERGED —/);
});

test('sem arquivos relevantes sai com código 3', async () => {
  const { tmpRoot, out, log } = setup();
  const files = [{ filename: 'README.md', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+x' }];
  assert.equal(await run([LINK], { exec: fake({ files }).exec, tmpRoot, log }), 3);
  assert.deepEqual(out, ['Nenhum arquivo relevante na PR.']);
});

test('link inválido sai com código 1 sem chamar o gh', async () => {
  const { tmpRoot, out, log } = setup();
  const { exec, calls } = fake();
  assert.equal(await run(['own/repo#7'], { exec, tmpRoot, log }), 1);
  assert.match(out[0], /Link inválido/);
  assert.equal(calls.length, 0);
});

test('falha do gh vira mensagem curta com código 1', async () => {
  const { tmpRoot, out, log } = setup();
  const exec = async () => { const e = new Error('x'); e.stderr = 'HTTP 404: Not Found\nmore'; throw e; };
  assert.equal(await run([LINK], { exec, tmpRoot, log }), 1);
  assert.match(out[0], /^Falha no gh: HTTP 404: Not Found\./);
});
