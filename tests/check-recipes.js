#!/usr/bin/env node
// Regression test for the IMPORT-CHECK / over-engineering recipes in references/analyze.md.
//
// Builds a throwaway git repo with planted problems, extracts the recipe command lines
// verbatim from analyze.md / fetch-diff.md, fills in the placeholders, runs them with bash,
// and checks hits and misses. Run after any edit to the recipes:
//
//   node tests/check-recipes.js          # run and delete the fixture
//   node tests/check-recipes.js --keep   # keep the fixture (prints its path) for a manual
//                                        # smoke run of the skill; see tests/expected-review.md
//
// Needs git and bash (Git Bash on Windows). Never touches this repository.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SKILL = path.resolve(__dirname, '..');
const KEEP = process.argv.includes('--keep');

// ---------- shell helpers ----------
function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  const candidate = path.resolve(execPath, '../../../usr/bin/bash.exe');
  return fs.existsSync(candidate) ? candidate : 'bash';
}
const BASH = findBash();
const ENV = { ...process.env };
if (process.platform === 'win32' && path.isAbsolute(BASH)) {
  ENV.PATH = path.dirname(BASH) + path.delimiter + ENV.PATH;
}
let FX;
function sh(cmd) {
  try {
    return execFileSync(BASH, ['-c', cmd], { cwd: FX, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (e.status === 1 && !String(e.stderr || '').trim()) return ''; // grep "no match"
    throw new Error(`command failed (${e.status}): ${cmd}\n${e.stderr}`);
  }
}
const git = (...args) => execFileSync('git', args, { cwd: FX, encoding: 'utf8' }).trim();

// ---------- recipe extraction ----------
const read = (f) => fs.readFileSync(path.join(SKILL, f), 'utf8');
const analyze = read('references/analyze.md');
const fetchDiff = read('references/fetch-diff.md');
function recipe(doc, prefix) {
  const line = doc.split(/\r?\n/).find((l) => l.trimStart().startsWith(prefix));
  if (!line) throw new Error('recipe not found: ' + prefix);
  return line.trim();
}
function tableRecipe(doc, rowLabel) {
  const row = doc.split(/\r?\n/).find((l) => l.startsWith('| ' + rowLabel + ' |'));
  if (!row) throw new Error('table row not found: ' + rowLabel);
  const m = row.match(/`(git grep [^`]+)`/);
  return m[1].split('\\|').join('|'); // table escape → plain pipe
}
const esc$ = (n) => n.split('$').join('\\$');
const alt = (names) => '(' + names.map(esc$).join('|') + ')';

// ---------- fixture ----------
function write(rel, content) {
  const p = path.join(FX, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function buildFixture() {
  FX = fs.mkdtempSync(path.join(os.tmpdir(), 'diffs-reviewer-fx-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fx@example.invalid');
  git('config', 'user.name', 'fixture');
  git('config', 'core.autocrlf', 'false');
  write('package.json', '{\n  "name": "fx",\n  "dependencies": {\n    "lodash": "4.17.21"\n  }\n}\n');
  write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
  write('src/a.ts', [
    'export const foo = 1;',
    'export const $store = {};',
    'export function jQuery$() {}',
    'export async function af() {}',
    "export type { T9 } from './types';",
    'export default function main() {}',
    '',
  ].join('\n'));
  write('src/types.ts', 'export type T9 = string;\n');
  write('src/multi.ts', 'const multi = 2;\nexport {\n  multi,\n};\n');
  write('src/esm.ts', 'export const esm = 1;\n');
  write('src/old.ts', 'export const legacy = 1;\n');
  write('src/user.ts', "import { legacy } from './old';\nexport const u = legacy;\n");
  write('src/style.css', 'body {}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');

  git('checkout', '-q', '-b', 'feat');
  fs.rmSync(path.join(FX, 'src/old.ts'));
  write('pnpm-lock.yaml', 'lockfileVersion: 9\n' + 'x: 1\n'.repeat(300));
  write('src/new.ts', [
    "import { foo, nope } from './a';",
    "import { x } from './missing';",
    "import { esm } from './esm.js';",
    "import './style.css';",
    "import { $store, T9 } from './a';",
    "import main from './a';",
    "import { multi } from './multi';",
    "import _ from 'lodash';",
    "import dayjs from 'dayjs';",
    "import fs from 'node:fs';",
    "import { store } from './a';",
    'export const neverUsed = [foo, x, esm, $store, main, multi, _, dayjs, fs, store];',
    '',
  ].join('\n'));
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: add new module', '-m', 'Wires the new module into the app.');
}

// ---------- assertions ----------
let failed = 0;
function check(label, pass, detail) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail !== undefined ? '\n      ' + String(detail).replace(/\n/g, '\n      ') : ''}`);
}
const linesOf = (out) => (out ? out.split('\n') : []);
// Is `name` exported by `file` according to C1 output lines? (exported name in `X as Y` is Y)
function exportedIn(out, file, name) {
  const bound = new RegExp('(?<![\\w$])' + name.split('$').join('\\$') + '(?![\\w$])');
  return linesOf(out).some((l) => {
    if (!l.startsWith('HEAD:' + file + ':')) return false;
    const code = l.slice(('HEAD:' + file + ':').length).replace(/^\d+:/, '');
    const brace = code.match(/^export\s*(?:type\s+)?\{([^}]*)/);
    if (brace) {
      return brace[1].split(',').some((part) => {
        const exported = part.trim().split(/\s+as\s+/).pop().replace(/^type\s+/, '');
        return exported === name;
      });
    }
    return bound.test(code);
  });
}

function run() {
  buildFixture();

  // FETCH commands
  const numstat = sh(recipe(fetchDiff, 'git diff <ref>...HEAD --numstat').replace('<ref>', 'main'));
  check('FETCH numstat lists src/new.ts', /\bsrc\/new\.ts$/m.test(numstat), numstat);
  check('FETCH numstat lists the lockfile (to be filtered)', /pnpm-lock\.yaml$/m.test(numstat), numstat);
  const log = sh(recipe(fetchDiff, 'git log <ref>..HEAD').replace('<ref>', 'main'));
  check('FETCH log shows subject and body', log.includes('- feat: add new module') && log.includes('Wires the new module'), log);

  // Step A
  const a = sh(recipe(analyze, 'git diff <ref>...HEAD -U0').replace('<ref>', 'main'));
  const importLines = linesOf(a).filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  check('A keeps the file header', a.includes('+++ b/src/new.ts'), a);
  check('A keeps the hunk header', /^@@ .*\+1,\d+ @@/m.test(a), a);
  check('A extracts all 11 import lines (not the export line)', importLines.length === 11, importLines.join('\n'));

  // Step B
  const bLine = recipe(analyze, "git ls-tree -r --name-only HEAD | grep -xE -e '<P1>");
  const suffix = bLine.match(/-e '<P1>([^']*)'/)[1];
  const p0Suffix = bLine.match(/-e '<P0>([^']*)'/)[1];
  const prefix = bLine.slice(0, bLine.indexOf("-e '<P1>"));
  const specs = ['src/a', 'src/missing', 'src/esm\\.js', 'src/style\\.css', 'src/multi'];
  const bCmd = prefix + specs.map((p) => `-e '${p}${suffix}'`).join(' ') + ` -e 'src/esm${p0Suffix}'`;
  const b = linesOf(sh(bCmd));
  check('B resolves ./a → src/a.ts', b.includes('src/a.ts'), b.join('\n'));
  check('B resolves ./esm.js → src/esm.ts (ESM rule)', b.includes('src/esm.ts'), b.join('\n'));
  check('B resolves ./style.css literally', b.includes('src/style.css'), b.join('\n'));
  check('B resolves ./multi → src/multi.ts', b.includes('src/multi.ts'), b.join('\n'));
  check('B finds nothing for ./missing', !b.some((l) => l.startsWith('src/missing')), b.join('\n'));
  check('B never prints the whole tree', b.length === 4, b.join('\n'));

  const netLine = recipe(analyze, "git ls-tree -r --name-only HEAD | grep -E -e '^<dir>/<stem>");
  const netPrefix = netLine.slice(0, netLine.indexOf("-e '^<dir>"));
  const netTpl = netLine.match(/-e '\^<dir>\/<stem>([^']*)'/)[1];
  check('B net is empty for ./missing', sh(`${netPrefix}-e '^src/missing${netTpl}'`) === '');
  check('B net finds a same-stem entry (src/types.ts)', sh(`${netPrefix}-e '^src/types${netTpl}'`) === 'src/types.ts');

  // Step C
  const names = ['foo', 'nope', '$store', 'T9', 'store', 'multi'];
  const c1Cmd = recipe(analyze, "git grep -nP 'export +((declare")
    .split('(A|B|C)').join(alt(names))
    .replace('<resolved-file-1> <resolved-file-2>', 'src/a.ts src/multi.ts');
  const c1 = sh(c1Cmd);
  check('C1 confirms foo', exportedIn(c1, 'src/a.ts', 'foo'), c1);
  check('C1 confirms $store', exportedIn(c1, 'src/a.ts', '$store'), c1);
  check('C1 confirms T9 (export type { } from)', exportedIn(c1, 'src/a.ts', 'T9'), c1);
  check('C1 shows export default for default import', /HEAD:src\/a\.ts:\d+:export default/.test(c1), c1);
  check('C1 misses nope', !exportedIn(c1, 'src/a.ts', 'nope'), c1);
  check('C1 misses store ($store must not count)', !exportedIn(c1, 'src/a.ts', 'store'), c1);
  check('C1 misses multi (multi-line export, left to C2)', !exportedIn(c1, 'src/multi.ts', 'multi'), c1);
  check('C1 bounded alternation works with jQuery$', exportedIn(sh(recipe(analyze, "git grep -nP 'export +((declare")
    .split('(A|B|C)').join(alt(['jQuery$', 'af'])).replace('<resolved-file-1> <resolved-file-2>', 'src/a.ts')), 'src/a.ts', 'jQuery$'));

  const c2 = sh(recipe(analyze, "git grep -nE 'export *\\*").replace('<files-with-misses>', 'src/multi.ts'));
  check('C2 flags the multi-line export in src/multi.ts', /HEAD:src\/multi\.ts:2:export \{$/m.test(c2), c2);
  const c3 = sh(recipe(analyze, "git grep -nP 'export.*").split('(A|B)').join(alt(['nope', 'store'])).replace('<files-with-misses>', 'src/a.ts'));
  check('C3 misses nope and store → Bloqueante', c3 === '', c3);

  // Step D
  const d = sh(recipe(analyze, "git grep -nP '[\\x27\\x22][^\\x27\\x22]*/(<stem1>|<stem2>)").replace('(<stem1>|<stem2>)', '(old)'));
  check('D finds src/user.ts importing deleted src/old.ts', /^HEAD:src\/user\.ts:1:/m.test(d), d);

  // Step E
  const e = sh(recipe(analyze, "git grep -nP '\\x22(<pkg1>|<pkg2>)\\x22")
    .replace('(<pkg1>|<pkg2>)', '(lodash|dayjs)')
    .replace('package.json <dir>/package.json <dir>/<sub>/package.json', 'package.json src/package.json'));
  check('E finds lodash declared', /"lodash"/.test(e), e);
  check('E does not find dayjs (undeclared → Ressalva)', !/"dayjs"/.test(e), e);

  // §2.6 dead code
  const dead = sh(tableRecipe(analyze, 'Dead code in diff').split('(<E1>|<E2>)').join(alt(['neverUsed'])));
  check('2.6 neverUsed only referenced in its own file', linesOf(dead).length > 0 && linesOf(dead).every((l) => l.startsWith('HEAD:src/new.ts:')), dead);
  const usage = sh(tableRecipe(analyze, 'Speculative generality').split('(<S1>|<S2>)').join(alt(['$store'])).replace('<module>', 'src'));
  check('2.6 usage grep matches $store (a.ts + new.ts)', linesOf(usage).length === 3, usage);

  // Formatting guards
  for (const f of ['SKILL.md', 'README.md', 'SPEC.md', ...fs.readdirSync(path.join(SKILL, 'references')).map((x) => 'references/' + x)]) {
    const s = read(f);
    check(`${f}: CRLF only`, !/(?<!\r)\n/.test(s));
    check(`${f}: no blank lines inside tables`, !/\|\r?\n\r?\n\|/.test(s));
  }
}

try {
  run();
} catch (err) {
  failed++;
  console.error('ERROR', err.message);
} finally {
  if (FX && !KEEP) fs.rmSync(FX, { recursive: true, force: true });
  if (FX && KEEP) console.log(`\nFixture kept at: ${FX} (branch feat vs main)`);
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
