import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../scripts/fetch-context.mjs';

const SHA = 'b'.repeat(40);
const APP_PATCH = [
  '@@ -1,0 +1,8 @@',
  "+import { calc, missing } from './math';",
  "+import def from './nope';",
  "+import { thing } from '@/lib/thing';",
  "+import lodash from 'lodash';",
  "+import leftpad from 'left-pad';",
  "+import fs from 'node:fs';",
  "+import { star } from './barrel';",
  "+import { gone } from './old';",
].join('\n');
const CONTENTS = {
  'src/app.ts': APP_PATCH.split('\n').slice(1).map((l) => l.slice(1)).join('\n'),
  'src/math.ts': 'export const calc = 1;\n',
  'src/lib/thing.ts': 'export function thing() {}\n',
  'src/barrel.ts': "export * from './inner';\n",
  'src/inner.ts': 'export const star = 1;\n',
  'src/user.ts': "import { a } from './old';\n",
  'tsconfig.json': '{\n  // comentário\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } },\n}\n',
  'package.json': '{ "dependencies": { "lodash": "^4" } }',
  'CLAUDE.md': '# regras\n',
};

function setup() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-ctx-'));
  const dir = path.join(tmpRoot, 'diffs-reviewer', 'own__repo__pr-7');
  fs.mkdirSync(path.join(dir, 'diffs', 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'diffs', 'src', 'app.ts.diff'), `${APP_PATCH}\n`);
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({
      owner: 'own', repo: 'repo', number: 7, headSha: SHA, headOwner: 'own', headRepo: 'repo', treeTruncated: false,
      files: [
        { path: 'src/app.ts', status: 'M', previous: null, additions: 8, deletions: 0, ignored: null, diff: true },
        { path: 'src/old.ts', status: 'D', previous: null, additions: 0, deletions: 3, ignored: null, diff: true },
      ],
    }),
  );
  fs.writeFileSync(path.join(dir, 'tree.txt'), Object.entries(CONTENTS).map(([p, c]) => `${p}\t${c.length}`).join('\n') + '\n');
  const calls = [];
  const exec = async (args) => {
    calls.push(args);
    const m = /contents\/(.+)\?ref=/.exec(args[1]);
    const p = m && m[1].split('/').map(decodeURIComponent).join('/');
    if (p in CONTENTS) return CONTENTS[p];
    throw new Error(`404 ${args[1]}`);
  };
  const out = [];
  return { tmpRoot, dir, exec, calls, out, log: (l) => out.push(l) };
}

test('IMPORT-CHECK encontra imports quebrados e ignora os válidos', async () => {
  const s = setup();
  assert.equal(await run([s.dir], s), 0);
  const text = s.out.join('\n');
  assert.match(text, /IMPORT-CHECK: 8 imports em 1 arquivos — 4 bloqueantes, 1 ressalvas, 0 incertos/);
  const lines = s.out.filter((l) => l.startsWith('  ['));
  assert.deepEqual(lines, [
    '  [Bloqueante] src/app.ts:1 — "missing" não exportado(s) por src/math.ts',
    '  [Bloqueante] src/app.ts:2 — "./nope" não existe no head (testado: src/nope + extensões .ts/.tsx/.js/.jsx/.mjs/.cjs/.json/… e /index.*)',
    '  [Bloqueante] src/app.ts:8 — "./old" aponta para src/old.ts, removido/renomeado nesta PR',
    '  [Bloqueante] src/user.ts:1 — "./old" aponta para src/old.ts, removido/renomeado nesta PR',
    '  [Ressalva]   src/app.ts:5 — pacote "left-pad" não declarado em package.json',
  ]);
  assert.match(text, /Dir: .*head$/);
});

test('baixa contexto para head/ e só usa a allowlist', async () => {
  const s = setup();
  await run([s.dir, 'src/lib/thing.ts', 'src/ghost.ts'], s);
  assert.equal(fs.readFileSync(path.join(s.dir, 'head', 'src', 'math.ts'), 'utf8'), 'export const calc = 1;\n');
  assert.ok(fs.existsSync(path.join(s.dir, 'head', 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(s.dir, 'head', 'src', 'user.ts')));
  assert.match(s.out.join('\n'), /Não existem no head: src\/ghost\.ts/);
  assert.match(s.out[0], /^Contexto: \d+ arquivos baixados \(1 pedidos, 1 docs, 5 espelho\), 0 fora do teto$/);
  for (const c of s.calls) assert.equal(c[0], 'api');
  const fetched = s.calls.map((c) => c[1]);
  assert.equal(new Set(fetched).size, fetched.length, 'cada arquivo baixado uma vez só');
});

test('recusa diretório fora da área da skill', async () => {
  const s = setup();
  assert.equal(await run([path.join(s.tmpRoot, 'outro')], s), 1);
  assert.match(s.out[0], /fora da área da skill/);
  assert.equal(s.calls.length, 0);
});

test('falha de leitura não derruba o script', async () => {
  const s = setup();
  const exec = async (args) => (args[1].includes('math.ts') ? Promise.reject(new Error('rede')) : s.exec(args));
  assert.equal(await run([s.dir], { ...s, exec }), 0);
  const text = s.out.join('\n');
  assert.match(text, /\[Incerto\]\s+src\/app\.ts:1 — "calc", "missing": export não confirmado em src\/math\.ts/);
  assert.match(text, /Falhas de leitura: src\/math\.ts/);
});
