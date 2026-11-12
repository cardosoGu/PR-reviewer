import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLink, assertAllowed, runGh, RAW } from '../scripts/lib/gh.mjs';

const LINK = 'https://github.com/own/repo/pull/7';
const SHA = 'a'.repeat(40);

test('parseLink aceita link de PR, com sufixo e query', () => {
  assert.deepEqual(parseLink(LINK), { owner: 'own', repo: 'repo', number: 7, url: LINK });
  assert.equal(parseLink(`${LINK}/files?w=1`).number, 7);
  assert.equal(parseLink(`  ${LINK}#discussion  `).url, LINK);
});

test('parseLink recusa outros formatos', () => {
  for (const bad of [undefined, '', 'own/repo#7', 'https://gitlab.com/o/r/pull/1', 'https://github.com/o/r/issues/1']) {
    assert.throws(() => parseLink(bad), /Link inválido/);
  }
});

test('allowlist aceita só os comandos de leitura previstos', () => {
  assertAllowed(['pr', 'view', LINK, '--json', 'title,state']);
  assertAllowed(['pr', 'diff', LINK]);
  assertAllowed(['api', 'repos/own/repo/pulls/7/files?per_page=100', '--paginate', '--slurp']);
  assertAllowed(['api', `repos/own/repo/git/trees/${SHA}?recursive=1`]);
  assertAllowed(['api', `repos/own/repo/contents/src/a%20b.ts?ref=${SHA}`, '-H', RAW]);
});

test('allowlist bloqueia qualquer ação na PR ou no GitHub', () => {
  const denied = [
    ['pr', 'comment', LINK, '--body', 'x'],
    ['pr', 'review', LINK, '--approve'],
    ['pr', 'merge', LINK],
    ['pr', 'edit', LINK, '--title', 'x'],
    ['pr', 'close', LINK],
    ['pr', 'ready', LINK],
    ['pr', 'checkout', LINK],
    ['pr', 'checks', LINK],
    ['issue', 'list'],
    ['workflow', 'run', 'ci.yml'],
    ['pr', 'view', LINK, '--json', 'title', '--web'],
    ['pr', 'diff', LINK, '--patch'],
    ['api', 'repos/own/repo/pulls/7/reviews'],
    ['api', 'repos/own/repo/issues/7/comments'],
    ['api', `repos/own/repo/contents/a.ts?ref=main`],
    ['api', `repos/own/repo/git/trees/${SHA}?recursive=1`, '-X', 'POST'],
    ['api', `repos/own/repo/git/trees/${SHA}?recursive=1`, '--method', 'GET'],
    ['api', `repos/own/repo/git/trees/${SHA}?recursive=1`, '-f', 'body=x'],
    ['api', `repos/own/repo/git/trees/${SHA}?recursive=1`, '-F', 'body=x'],
    ['api', `repos/own/repo/git/trees/${SHA}?recursive=1`, '--field', 'a=b'],
    ['api', `repos/own/repo/git/trees/${SHA}?recursive=1`, '--raw-field', 'a=b'],
    ['api', `repos/own/repo/git/trees/${SHA}?recursive=1`, '--input', 'f.json'],
    ['api', `repos/own/repo/git/trees/${SHA}?recursive=1`, '-H', 'X-Other: 1'],
  ];
  for (const args of denied) assert.throws(() => assertAllowed(args), /bloqueado|Link inválido/, args.join(' '));
});

test('runGh nunca chama o exec para comando bloqueado', async () => {
  let called = false;
  await assert.rejects(runGh(['pr', 'comment', LINK], async () => { called = true; }), /bloqueado/);
  assert.equal(called, false);
  assert.equal(await runGh(['pr', 'diff', LINK], async (a) => a.join(' ')), `pr diff ${LINK}`);
});
