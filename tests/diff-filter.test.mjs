import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, splitUnifiedDiff } from '../scripts/lib/diff.mjs';
import { ignoreReason, classifyScope } from '../scripts/lib/filter.mjs';

test('addedLines numera pelo lado novo e ignora linhas removidas', () => {
  const patch = '@@ -1,3 +1,4 @@\n ctx\n-old\n+new1\n+new2\n ctx2\n@@ -20,1 +21,2 @@\n ctx\n+late\n\\ No newline at end of file';
  assert.deepEqual(addedLines(patch), [
    { line: 2, text: 'new1', hunk: 0 },
    { line: 3, text: 'new2', hunk: 0 },
    { line: 22, text: 'late', hunk: 1 },
  ]);
});

test('addedLines tolera CRLF e patch vazio', () => {
  assert.deepEqual(addedLines('@@ -0,0 +1 @@\r\n+a\r\n'), [{ line: 1, text: 'a', hunk: 0 }]);
  assert.deepEqual(addedLines(null), []);
});

test('splitUnifiedDiff separa arquivos, inclusive removidos', () => {
  const text = [
    'diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-x', '+y',
    'diff --git a/src/old.ts b/src/old.ts', 'deleted file mode 100644', '--- a/src/old.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-z',
    'diff --git a/img.png b/img.png', 'Binary files differ',
  ].join('\n');
  const m = splitUnifiedDiff(text);
  assert.equal(m.get('src/a.ts'), '@@ -1 +1 @@\n-x\n+y');
  assert.equal(m.get('src/old.ts'), '@@ -1 +0,0 @@\n-z');
  assert.equal(m.get('img.png'), '');
});

test('ignoreReason aplica as exclusões fixas', () => {
  const cases = {
    'node_modules/x/index.js': 'dependência',
    'vendor/lib.php': 'dependência',
    'package-lock.json': 'lockfile',
    'apps/web/pnpm-lock.yaml': 'lockfile',
    'dist/app.js': 'gerado',
    'src/x.min.js': 'gerado',
    'src/__snapshots__/a.snap': 'gerado',
    'assets/logo.png': 'binário',
    'src/locales/pt/common.json': 'i18n',
    'README.md': 'docs',
    'docs/guide.mdx': 'docs',
    'src/app.ts': null,
    'src/app.test.ts': null,
    'src/config.json': null,
  };
  for (const [file, reason] of Object.entries(cases)) assert.equal(ignoreReason(file), reason, file);
});

test('classifyScope segue os limites da spec', () => {
  assert.equal(classifyScope(3, 100), 'Small');
  assert.equal(classifyScope(4, 10), 'Medium');
  assert.equal(classifyScope(3, 101), 'Medium');
  assert.equal(classifyScope(10, 500), 'Medium');
  assert.equal(classifyScope(11, 1), 'Large');
  assert.equal(classifyScope(2, 501), 'Large');
});
