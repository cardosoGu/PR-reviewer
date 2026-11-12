# diffs-reviewer v2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a skill `diffs-reviewer` numa review de PR do GitHub a partir do link, com coleta 100% via `gh` feita por dois scripts Node e análise pelo modelo em duas passadas.

**Architecture:** `scripts/fetch-pr.mjs` coleta metadados, diff por arquivo e árvore (1 turno). `scripts/fetch-context.mjs` baixa contexto em lote e roda o IMPORT-CHECK determinístico (1 turno). Toda chamada `gh` passa por `runGh`, que aplica uma allowlist fechada de leitura. As referências Markdown (`SKILL.md`, `references/*.md`) passam a orquestrar o modelo em cima da saída dos scripts.

**Tech Stack:** Node ≥ 18 (testado em 22), só `node:` built-ins, `node:test` + `node:assert/strict`; GitHub CLI (`gh`) ≥ 2.48 (por causa do `--slurp`).

**Spec:** `docs/superpowers/specs/2026-11-12-diffs-reviewer-v2-design.md`

## Global Constraints

- Entrada única: `/diffs-reviewer <link da PR>`; link no formato `https://github.com/<owner>/<repo>/pull/<n>`.
- A skill **nunca** executa ação na PR nem no GitHub (comentar, review, reagir, editar, ready/draft, fechar, reabrir, merge, checkout, workflows), **mesmo a pedido do usuário**.
- Allowlist fechada do `gh` (só dentro dos scripts): `gh pr view <link> --json <campos>`, `gh pr diff <link>`, `gh api` GET nos endpoints `repos/{o}/{r}/pulls/{n}/files?per_page=100`, `repos/{o}/{r}/git/trees/{sha}?recursive=1`, `repos/{o}/{r}/contents/{path}?ref={sha}`; flags extras só `--paginate`, `--slurp`, `-H "Accept: application/vnd.github.raw"`.
- O modelo nunca chama `gh` ou `git` diretamente; só os dois scripts e leitura/grep em `<dir>`.
- `<dir>` = `<os.tmpdir()>/diffs-reviewer/<owner>__<repo>__pr-<n>`; nada é escrito fora dele.
- PR `CLOSED`, `MERGED` ou draft → `fetch-pr.mjs` sai com código 2; a skill para e pede confirmação; só então `--force`.
- Exclusões fixas: dependências, lockfiles, build/gerados, binários, i18n JSON (`locales/`, `i18n/`, `translations/`), `*.md`/`*.mdx`.
- Escopo: Small ≤3 arquivos e ≤100 linhas; Large 11+ arquivos ou >500 linhas; Medium o resto.
- Tetos: 10 arquivos pedidos; 15 docs; 30 alvos de IMPORT-CHECK C; espelho 60 arquivos / 2 MB; concorrência 8.
- Sem dependências npm; testes rodam sem rede: `node --test "tests/*.test.mjs"`.
- Mensagens ao usuário em português, como no resto da skill.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `scripts/lib/gh.mjs` | `parseLink`, allowlist (`assertAllowed`), `runGh`, `encodePath`, `ghError` |
| `scripts/lib/workdir.mjs` | diretório de trabalho, `safeJoin`, `diffPath`, `mapLimit`, `isMain` |
| `scripts/lib/diff.mjs` | linhas adicionadas de um patch; divisão de `gh pr diff` por arquivo |
| `scripts/lib/filter.mjs` | exclusões fixas e classificação de escopo |
| `scripts/fetch-pr.mjs` | Fase 1 (CLI) |
| `scripts/lib/imports.mjs` | extração de imports (IMPORT-CHECK A) |
| `scripts/lib/resolve.mjs` | resolução de caminho, alias e pacote (IMPORT-CHECK B/E) |
| `scripts/lib/exports.mjs` | análise de exports (IMPORT-CHECK C) |
| `scripts/lib/select.mjs` | escolha de docs e espelho do módulo |
| `scripts/fetch-context.mjs` | Fase 3 (CLI) + IMPORT-CHECK A–E |
| `tests/*.test.mjs` | um arquivo de teste por módulo |
| `SKILL.md`, `references/fetch.md`, `references/analyze.md`, `references/standards.md`, `references/report.md` | orquestração do modelo |
| `README.md`, `SPEC.md`, `.skill-meta.json` | documentação e versão 2.0.0 |
| removidos | `references/fetch-diff.md`, `references/typecheck.md`, `references/sub-agents.md`, `tests/check-recipes.js`, `tests/expected-review.md` |

Todo o código abaixo foi executado e os 45 testes passam (Node 22.12, Windows). `fetch-pr.mjs` e `fetch-context.mjs` também foram rodados contra a PR #1 real deste repo.

---

### Task 1: Allowlist do gh e diretório de trabalho

**Files:**
- Create: `scripts/lib/gh.mjs`
- Create: `scripts/lib/workdir.mjs`
- Test: `tests/gh.test.mjs`, `tests/workdir.test.mjs`

**Interfaces:**
- Produces: `parseLink(link) -> {owner, repo, number, url}` (lança `Link inválido`); `assertAllowed(args: string[])` (lança `Comando gh bloqueado`); `runGh(args, exec?) -> Promise<string>`; `RAW` (header Accept); `encodePath(p)`; `ghError(e) -> string`; `workDir(tmpRoot, pr)`; `assertWorkDir(tmpRoot, dir) -> abs`; `safeJoin(base, rel)`; `diffPath(dir, file)`; `mapLimit(items, limit, fn)`; `isMain(import.meta.url)`.
- `exec` injetável: `async (args: string[]) => stdout`. Os testes nunca chamam o `gh` real.

- [ ] **Step 1: Escrever os testes**

`tests/gh.test.mjs`:

```js
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
```

`tests/workdir.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/gh.test.mjs tests/workdir.test.mjs`
Expected: FAIL com `Cannot find module '.../scripts/lib/gh.mjs'`.

- [ ] **Step 3: Implementar**

`scripts/lib/gh.mjs`:

```js
import { execFile } from 'node:child_process';

const LINK_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:\/[^\s?#]*)?(?:[?#]\S*)?$/;

export function parseLink(link) {
  const m = LINK_RE.exec(String(link ?? '').trim());
  if (!m) {
    throw new Error(
      `Link inválido: "${link ?? ''}". Formato esperado: https://github.com/<owner>/<repo>/pull/<n>`,
    );
  }
  const [, owner, repo, num] = m;
  return { owner, repo, number: Number(num), url: `https://github.com/${owner}/${repo}/pull/${num}` };
}

export const RAW = 'Accept: application/vnd.github.raw';

const SEG = '[A-Za-z0-9_.-]+';
const SHA = '[0-9a-f]{40}';
const ENDPOINTS = [
  new RegExp(`^repos/${SEG}/${SEG}/pulls/\\d+/files\\?per_page=100$`),
  new RegExp(`^repos/${SEG}/${SEG}/git/trees/${SHA}\\?recursive=1$`),
  new RegExp(`^repos/${SEG}/${SEG}/contents/[^?\\s]+\\?ref=${SHA}$`),
];

function deny(args, why) {
  throw new Error(`Comando gh bloqueado (${why}): gh ${args.join(' ')}`);
}

// Única porta de saída para o gh. Tudo que não está aqui é proibido.
export function assertAllowed(args) {
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    deny([String(args)], 'argumentos inválidos');
  }
  const [cmd, sub, ...rest] = args;
  if (cmd === 'pr' && sub === 'view') {
    if (rest.length !== 3 || rest[1] !== '--json' || !/^[A-Za-z]+(,[A-Za-z]+)*$/.test(rest[2])) {
      deny(args, 'pr view só aceita <link> --json <campos>');
    }
    parseLink(rest[0]);
    return;
  }
  if (cmd === 'pr' && sub === 'diff') {
    if (rest.length !== 1) deny(args, 'pr diff só aceita <link>');
    parseLink(rest[0]);
    return;
  }
  if (cmd === 'api') {
    if (!ENDPOINTS.some((re) => re.test(sub ?? ''))) deny(args, 'endpoint fora da allowlist');
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--paginate' || a === '--slurp') continue;
      if (a === '-H' && rest[i + 1] === RAW) {
        i++;
        continue;
      }
      deny(args, `flag não permitida: ${a}`);
    }
    return;
  }
  deny(args, 'subcomando fora da allowlist');
}

function defaultExec(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
        } else resolve(stdout);
      },
    );
  });
}

export async function runGh(args, exec = defaultExec) {
  assertAllowed(args);
  return exec(args);
}

export function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

export function ghError(e) {
  if (String(e?.message ?? '').startsWith('Comando gh bloqueado')) return e.message;
  if (e?.code === 'ENOENT') return 'gh não encontrado. Instale o GitHub CLI e rode `gh auth login`.';
  const first = String(e?.stderr || e?.message || e).trim().split('\n')[0];
  return `Falha no gh: ${first}. Verifique \`gh auth status\` e o acesso ao repositório.`;
}
```

`scripts/lib/workdir.mjs`:

```js
import path from 'node:path';

export const ROOT_NAME = 'diffs-reviewer';

export function workDir(tmpRoot, pr) {
  return path.join(tmpRoot, ROOT_NAME, `${pr.owner}__${pr.repo}__pr-${pr.number}`);
}

export function assertWorkDir(tmpRoot, dir) {
  const root = path.resolve(tmpRoot, ROOT_NAME) + path.sep;
  const abs = path.resolve(String(dir ?? ''));
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (!dir || !norm(abs).startsWith(norm(root))) {
    throw new Error(`Diretório fora da área da skill: "${dir ?? ''}". Use o Dir impresso por fetch-pr.mjs.`);
  }
  return abs;
}

export function safeJoin(base, rel) {
  const absBase = path.resolve(base);
  const p = path.resolve(absBase, ...rel.split('/'));
  if (!p.startsWith(absBase + path.sep)) throw new Error(`Caminho inválido: ${rel}`);
  return p;
}

export function diffPath(dir, file) {
  return safeJoin(path.join(dir, 'diffs'), file) + '.diff';
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  const self = new URL(metaUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const norm = (p) => path.resolve(decodeURIComponent(p)).toLowerCase();
  return norm(self) === norm(process.argv[1]);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/gh.test.mjs tests/workdir.test.mjs`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/gh.mjs scripts/lib/workdir.mjs tests/gh.test.mjs tests/workdir.test.mjs
git commit -m "feat(scripts): allowlist do gh e diretório de trabalho

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Diff por arquivo e exclusões

**Files:**
- Create: `scripts/lib/diff.mjs`, `scripts/lib/filter.mjs`
- Test: `tests/diff-filter.test.mjs`

**Interfaces:**
- Produces: `addedLines(patch) -> [{line, text, hunk}]` (linha do lado novo); `splitUnifiedDiff(text) -> Map<caminho, patch a partir do primeiro @@>`; `ignoreReason(file) -> 'dependência'|'lockfile'|'gerado'|'binário'|'i18n'|'docs'|null`; `classifyScope(files, lines) -> 'Small'|'Medium'|'Large'`.

- [ ] **Step 1: Escrever os testes**

`tests/diff-filter.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/diff-filter.test.mjs`
Expected: FAIL com `Cannot find module`.

- [ ] **Step 3: Implementar**

`scripts/lib/diff.mjs`:

```js
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Linhas adicionadas de um patch, com o número da linha no arquivo novo.
export function addedLines(patch) {
  const out = [];
  let line = 0;
  let hunk = -1;
  for (const r of String(patch ?? '').split('\n')) {
    const raw = r.replace(/\r$/, '');
    const m = HUNK_RE.exec(raw);
    if (m) {
      line = Number(m[1]);
      hunk++;
      continue;
    }
    if (hunk < 0) continue;
    if (raw.startsWith('+')) {
      out.push({ line, text: raw.slice(1), hunk });
      line++;
    } else if (raw.startsWith('-') || raw.startsWith('\\')) {
      // lado antigo ou "\ No newline at end of file"
    } else {
      line++;
    }
  }
  return out;
}

// Divide a saída de `gh pr diff` em Map(caminho novo -> patch a partir do primeiro @@).
export function splitUnifiedDiff(text) {
  const files = new Map();
  for (const chunk of String(text ?? '').split(/^diff --git /m).slice(1)) {
    const lines = chunk.split('\n');
    const start = lines.findIndex((l) => l.startsWith('@@'));
    const header = start === -1 ? lines : lines.slice(0, start);
    let file = null;
    const plus = header.find((l) => l.startsWith('+++ '));
    if (plus && plus.slice(4).trim() !== '/dev/null') file = plus.slice(4).trim().replace(/^b\//, '');
    if (!file) {
      const minus = header.find((l) => l.startsWith('--- '));
      if (minus && minus.slice(4).trim() !== '/dev/null') file = minus.slice(4).trim().replace(/^a\//, '');
    }
    if (!file) {
      const m = /^a\/(\S+) b\/(\S+)/.exec(lines[0]);
      if (m) file = m[2];
    }
    if (file) files.set(file, start === -1 ? '' : lines.slice(start).join('\n').replace(/\n+$/, ''));
  }
  return files;
}
```

`scripts/lib/filter.mjs`:

```js
const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'composer.lock', 'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'go.sum',
]);
const GENERATED_DIRS = new Set(['dist', 'build', 'out', 'coverage', '.next', '__snapshots__']);
const I18N_DIRS = new Set(['locales', 'i18n', 'translations']);
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|bmp|ico|avif|tiff?|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|rar|7z|jar|exe|dll|so|dylib|mp3|mp4|mov|avi|webm|wav|ogg)$/i;

// Motivo para ignorar o arquivo (regra fixa) ou null se deve ser analisado.
export function ignoreReason(file) {
  const segs = file.split('/');
  const base = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  if (segs.includes('node_modules') || dirs.includes('vendor')) return 'dependência';
  if (LOCKFILES.has(base)) return 'lockfile';
  if (dirs.some((d) => GENERATED_DIRS.has(d)) || /\.(min\.js|min\.css|map|snap)$/.test(base)) return 'gerado';
  if (BINARY_EXT.test(base)) return 'binário';
  if (/\.json$/i.test(base) && dirs.some((d) => I18N_DIRS.has(d))) return 'i18n';
  if (/\.mdx?$/i.test(base)) return 'docs';
  return null;
}

export function classifyScope(files, lines) {
  if (files <= 3 && lines <= 100) return 'Small';
  if (files >= 11 || lines > 500) return 'Large';
  return 'Medium';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/diff-filter.test.mjs`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/diff.mjs scripts/lib/filter.mjs tests/diff-filter.test.mjs
git commit -m "feat(scripts): parser de diff e exclusões fixas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `fetch-pr.mjs` (Fase 1)

**Files:**
- Create: `scripts/fetch-pr.mjs`
- Test: `tests/fetch-pr.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`parseLink`, `runGh`, `ghError`, `workDir`, `diffPath`, `isMain`), Task 2 (`splitUnifiedDiff`, `ignoreReason`, `classifyScope`).
- Produces: `run(argv, {exec, tmpRoot, log}) -> Promise<0|1|2|3>`. Grava em `<dir>`: `diffs/<caminho>.diff`, `tree.txt` (`caminho<TAB>tamanho` por linha), `meta.json`:
  `{owner, repo, number, url, title, state, baseRefName, headSha, headOwner, headRepo, treeTruncated, files: [{path, status: 'A'|'M'|'D'|'R'|'C', previous, additions, deletions, ignored, diff}]}` — consumido pela Task 8.

- [ ] **Step 1: Escrever os testes**

`tests/fetch-pr.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/fetch-pr.test.mjs`
Expected: FAIL com `Cannot find module '.../scripts/fetch-pr.mjs'`.

- [ ] **Step 3: Implementar**

`scripts/fetch-pr.mjs`:

```js
#!/usr/bin/env node
// Fase 1 do diffs-reviewer: coleta metadados, diff por arquivo e árvore de uma PR via gh (só leitura).
// Uso: node fetch-pr.mjs <link-da-pr> [--force]
// Saída: 0 ok · 1 erro · 2 PR fechada/mergeada/draft (pedir confirmação) · 3 nenhum arquivo relevante
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLink, runGh, ghError } from './lib/gh.mjs';
import { splitUnifiedDiff } from './lib/diff.mjs';
import { ignoreReason, classifyScope } from './lib/filter.mjs';
import { workDir, diffPath, isMain } from './lib/workdir.mjs';

const VIEW_FIELDS =
  'title,body,state,isDraft,baseRefName,headRefOid,headRepository,headRepositoryOwner,commits,url,number';
const STATUS = { added: 'A', modified: 'M', changed: 'M', unchanged: 'M', removed: 'D', renamed: 'R', copied: 'C' };

function intent(view) {
  const body = String(view.body ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (body.length) return [...body.slice(0, 8), ...(body.length > 8 ? ['…'] : [])];
  const commits = (view.commits ?? []).map((c) => `- ${c.messageHeadline}`).filter((l) => l.length > 2);
  return commits.length ? commits.slice(0, 10) : ['(sem descrição nem commits)'];
}

export async function run(argv, { exec, tmpRoot = os.tmpdir(), log = console.log } = {}) {
  const force = argv.includes('--force');
  const link = argv.find((a) => !a.startsWith('--'));
  let pr;
  try {
    pr = parseLink(link);
  } catch (e) {
    log(e.message);
    return 1;
  }
  const gh = (args) => runGh(args, exec);

  let view;
  let pages;
  try {
    [view, pages] = await Promise.all([
      gh(['pr', 'view', pr.url, '--json', VIEW_FIELDS]).then(JSON.parse),
      gh(['api', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/files?per_page=100`, '--paginate', '--slurp']).then(JSON.parse),
    ]);
  } catch (e) {
    log(ghError(e));
    return 1;
  }

  const stateLabel = view.state === 'OPEN' && view.isDraft ? 'DRAFT' : view.state;
  if (!force && stateLabel !== 'OPEN') {
    log(`Aviso: a PR #${pr.number} está ${stateLabel}. Nada foi coletado.`);
    log('Pergunte ao usuário se deve continuar; só com confirmação rode de novo com --force.');
    return 2;
  }

  const headSha = view.headRefOid;
  const headOwner = view.headRepositoryOwner?.login ?? pr.owner;
  const headRepo = view.headRepository?.name ?? pr.repo;
  let tree;
  try {
    tree = JSON.parse(await gh(['api', `repos/${headOwner}/${headRepo}/git/trees/${headSha}?recursive=1`]));
  } catch (e) {
    log(ghError(e));
    return 1;
  }

  const files = pages.flat().map((f) => ({
    path: f.filename,
    status: STATUS[f.status] ?? 'M',
    previous: f.previous_filename ?? null,
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    patch: f.patch ?? null,
    ignored: ignoreReason(f.filename),
  }));

  const needFull = files.filter((f) => !f.ignored && f.patch === null && f.additions + f.deletions > 0);
  if (needFull.length) {
    try {
      const split = splitUnifiedDiff(await gh(['pr', 'diff', pr.url]));
      for (const f of needFull) f.patch = split.get(f.path) || null;
    } catch {
      // continuam sem patch e aparecem em "Não alcançados"
    }
  }

  const dir = workDir(tmpRoot, pr);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const relevant = files.filter((f) => !f.ignored);
  for (const f of relevant) {
    if (!f.patch) continue;
    const out = diffPath(dir, f.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, f.patch.endsWith('\n') ? f.patch : `${f.patch}\n`);
  }

  const blobs = (tree.tree ?? []).filter((e) => e.type === 'blob');
  fs.writeFileSync(path.join(dir, 'tree.txt'), blobs.map((e) => `${e.path}\t${e.size ?? 0}`).join('\n') + '\n');
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        owner: pr.owner, repo: pr.repo, number: pr.number, url: pr.url, title: view.title, state: stateLabel,
        baseRefName: view.baseRefName, headSha, headOwner, headRepo, treeTruncated: Boolean(tree.truncated),
        files: files.map(({ patch, ...rest }) => ({ ...rest, diff: Boolean(patch) && !rest.ignored })),
      },
      null,
      2,
    ),
  );

  if (!relevant.length) {
    log('Nenhum arquivo relevante na PR.');
    return 3;
  }

  const diffLines = relevant.reduce((s, f) => s + f.additions + f.deletions, 0);
  const ignoredByReason = {};
  for (const f of files) if (f.ignored) ignoredByReason[f.ignored] = (ignoredByReason[f.ignored] ?? 0) + 1;
  const ignoredTotal = files.length - relevant.length;
  const unreached = relevant.filter((f) => !f.patch && f.additions + f.deletions > 0).map((f) => f.path);

  log(`PR #${pr.number} ${view.title} — ${stateLabel} — base ${view.baseRefName} ← head ${headSha.slice(0, 7)}`);
  log('Intent:');
  for (const l of intent(view)) log(`  ${l}`);
  log(`Arquivos (${relevant.length} analisados, ${ignoredTotal} ignorados, ${diffLines} linhas, escopo ${classifyScope(relevant.length, diffLines)}):`);
  for (const f of relevant) {
    const counts = f.status === 'D' ? '' : ` +${f.additions} -${f.deletions}`;
    log(`  ${f.status} ${f.path}${f.previous ? ` ← ${f.previous}` : ''}${counts}`);
  }
  log(`Ignorados: ${Object.entries(ignoredByReason).map(([r, n]) => `${r} ${n}`).join(', ') || 'nenhum'}`);
  log(`Não alcançados: ${unreached.join(', ') || 'nenhum'}`);
  if (tree.truncated) log('Aviso: árvore do repositório truncada pelo GitHub; o IMPORT-CHECK pode marcar [Incerto].');
  log(`Dir: ${dir}`);
  return 0;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/fetch-pr.test.mjs`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-pr.mjs tests/fetch-pr.test.mjs
git commit -m "feat(scripts): fetch-pr coleta PR via gh (fase 1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Extração de imports (IMPORT-CHECK A)

**Files:**
- Create: `scripts/lib/imports.mjs`
- Test: `tests/imports.test.mjs`

**Interfaces:**
- Consumes: `addedLines` (Task 2).
- Produces: `JS_EXT`; `parseNames(clause) -> string[]`; `extractFromPatch(patch)` e `extractFromSource(source)` → `[{spec, names: [{name, line}] | null, line, kind: 'import'|'export'|'side'|'require'|'dynamic', partial}]`; `stripComments(source)` (usado pela Task 6).
- Regra importante: `import`/`export` só contam no **início da linha**, e `require()`/`import()` são ignorados dentro de string. Sem isso, fixtures de teste que escrevem código como texto geram Bloqueantes falsos (aconteceu na PR #1 real).

- [ ] **Step 1: Escrever os testes**

`tests/imports.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/imports.test.mjs`
Expected: FAIL com `Cannot find module`.

- [ ] **Step 3: Implementar**

`scripts/lib/imports.mjs`:

```js
import { addedLines } from './diff.mjs';

export const JS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

// import/export só contam no início da linha (texto dentro de string não é import).
const PATTERNS = [
  { kind: 'import', re: /^[ \t]*import\s+(type\s+)?([^;'"]*?)\s*\bfrom\s*['"]([^'"\n]+)['"]/gm, clause: 2, spec: 3 },
  { kind: 'export', re: /^[ \t]*export\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^;'"]*?\})\s*from\s*['"]([^'"\n]+)['"]/gm, clause: 2, spec: 3 },
  { kind: 'side', re: /^[ \t]*import\s*['"]([^'"\n]+)['"]/gm, clause: 0, spec: 1 },
  { kind: 'require', re: /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g, clause: 0, spec: 1, checkString: true },
  { kind: 'dynamic', re: /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g, clause: 0, spec: 1, checkString: true },
];

// A posição idx está dentro de uma string aberta na mesma linha?
function inString(text, idx) {
  let q = null;
  for (let i = text.lastIndexOf('\n', idx - 1) + 1; i < idx; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '\\') i++;
      else if (ch === q) q = null;
    } else if (ch === '"' || ch === "'" || ch === '`') q = ch;
  }
  return q !== null;
}

// Nomes importados de uma cláusula: originais de `{ A as B }`, e "default" para import padrão.
export function parseNames(clause) {
  const c = String(clause ?? '').trim();
  const names = [];
  const brace = /\{([^}]*)\}/.exec(c);
  if (brace) {
    for (let item of brace[1].split(',')) {
      item = item.trim().replace(/^type\s+/, '');
      if (!item) continue;
      const orig = item.split(/\s+as\s+/)[0].trim();
      if (orig) names.push(orig);
    }
  }
  const head = c.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
  if (head && !head.startsWith('*') && /^[\w$]+/.test(head)) names.push('default');
  return names;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function makeLineAt(starts, lines) {
  return (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= off) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return lines[ans] ?? 1;
  };
}

// Referências de import num texto. names: [{name, line}] ou null (multi-linha parcial).
export function extractRefs(text, lineAt) {
  const refs = [];
  const covered = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      if (p.checkString && inString(text, m.index)) continue;
      covered.push([m.index, m.index + m[0].length]);
      const names = p.clause
        ? parseNames(m[p.clause]).map((name) => {
            if (name === 'default') return { name, line: lineAt(m.index) };
            const hit = new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`).exec(m[0]);
            return { name, line: lineAt(m.index + (hit ? hit.index : 0)) };
          })
        : [];
      refs.push({ spec: m[p.spec].replace(/[?#].*$/, ''), names, line: lineAt(m.index), kind: p.kind, partial: false });
    }
  }
  const orphan = /^[ \t]*\}\s*from\s*['"]([^'"\n]+)['"]/gm;
  let m;
  while ((m = orphan.exec(text))) {
    const at = m.index;
    if (covered.some(([s, e]) => at >= s && at < e)) continue;
    refs.push({ spec: m[1].replace(/[?#].*$/, ''), names: null, line: lineAt(at), kind: 'import', partial: true });
  }
  return refs.sort((a, b) => a.line - b.line);
}

const isCommentLine = (t) => /^\s*(\/\/|\/\*|\*)/.test(t);

export function extractFromPatch(patch) {
  let text = '';
  const starts = [];
  const lines = [];
  let prev = null;
  for (const a of addedLines(patch)) {
    if (prev && (a.hunk !== prev.hunk || a.line !== prev.line + 1)) text += ';\n';
    starts.push(text.length);
    lines.push(a.line);
    text += `${isCommentLine(a.text) ? '' : a.text}\n`;
    prev = a;
  }
  return extractRefs(text, makeLineAt(starts, lines));
}

export function stripComments(source) {
  return String(source ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

export function extractFromSource(source) {
  const text = stripComments(source);
  const starts = [0];
  const lines = [1];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1);
      lines.push(lines.length + 1);
    }
  }
  return extractRefs(text, makeLineAt(starts, lines));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/imports.test.mjs`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/imports.mjs tests/imports.test.mjs
git commit -m "feat(scripts): extração de imports das linhas adicionadas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Resolução de caminhos, aliases e pacotes (IMPORT-CHECK B/E)

**Files:**
- Create: `scripts/lib/resolve.mjs`
- Test: `tests/resolve.test.mjs`

**Interfaces:**
- Produces: `dirOf(p)` ('' na raiz); `candidatePaths(base)`; `findInTree(base, treeSet) -> caminho|null`; `nearMiss(base, treeList) -> bool`; `packageName(spec)`; `isBuiltin(spec)`; `matchAlias(spec, alias) -> string[]|null`; `classify(importer, spec, alias) -> {kind: 'path', bases} | {kind: 'external', pkg} | {kind: 'builtin'|'unknownAlias'|'outside'|'unsupported'}`; `parseJsonc(text)`; `aliasFromChain([{dir, json}]) -> {paths, baseDir, baseUrlDir} | null`; `nearestConfig(file, treeSet)`; `extendsPath(configPath, json)`.

- [ ] **Step 1: Escrever os testes**

`tests/resolve.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/resolve.test.mjs`
Expected: FAIL com `Cannot find module`.

- [ ] **Step 3: Implementar**

`scripts/lib/resolve.mjs`:

```js
import path from 'node:path';

const P = path.posix;
const EXTS = ['d.ts', 'd.mts', 'd.cts', 'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'vue', 'svelte', 'astro'];
const INDEX_EXTS = ['ts', 'tsx', 'js', 'jsx'];
const BUILTINS = new Set([
  'fs', 'path', 'os', 'crypto', 'url', 'util', 'events', 'stream', 'child_process', 'http', 'https', 'zlib',
  'buffer', 'assert', 'querystring', 'readline', 'net', 'tls', 'dns', 'worker_threads', 'perf_hooks', 'process',
  'module', 'timers', 'v8', 'vm',
]);
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export const dirOf = (p) => (P.dirname(p) === '.' ? '' : P.dirname(p));

export function candidatePaths(base) {
  const c = [base, ...EXTS.map((e) => `${base}.${e}`), ...INDEX_EXTS.map((e) => `${base}/index.${e}`)];
  const esm = /^(.*)\.(js|jsx|mjs|cjs)$/.exec(base);
  if (esm) {
    const [, stem, ext] = esm;
    if (ext === 'mjs') c.push(`${stem}.mts`, `${stem}.d.mts`);
    else if (ext === 'cjs') c.push(`${stem}.cts`, `${stem}.d.cts`);
    else c.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`);
  }
  return c;
}

export function findInTree(base, tree) {
  return candidatePaths(base).find((p) => tree.has(p)) ?? null;
}

// Existe arquivo com o mesmo nome e outra extensão (loader/extensão não listada)?
export function nearMiss(base, treeList) {
  const stem = P.basename(base).replace(/\.(js|jsx|mjs|cjs)$/, '');
  const dir = dirOf(base);
  const prefix = dir ? `${dir}/${stem}` : stem;
  return treeList.some((p) => p.startsWith(`${prefix}.`) || p.startsWith(`${prefix}/`));
}

export function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function isBuiltin(spec) {
  return spec.startsWith('node:') || BUILTINS.has(packageName(spec));
}

export function matchAlias(spec, alias) {
  for (const [pattern, targets] of Object.entries(alias?.paths ?? {})) {
    const star = pattern.indexOf('*');
    let captured = null;
    if (star === -1) {
      if (spec === pattern) captured = '';
    } else {
      const pre = pattern.slice(0, star);
      const post = pattern.slice(star + 1);
      if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) {
        captured = spec.slice(pre.length, spec.length - post.length);
      }
    }
    if (captured !== null) {
      return targets.map((t) => P.normalize(P.join(alias.baseDir, t.replace('*', captured))));
    }
  }
  return null;
}

// Classifica um specifier importado por `importer`.
export function classify(importer, spec, alias) {
  if (spec.startsWith('.')) {
    const base = P.normalize(P.join(dirOf(importer), spec));
    if (base === '..' || base.startsWith('../')) return { kind: 'outside' };
    return { kind: 'path', bases: [base] };
  }
  if (spec.startsWith('/')) return { kind: 'unsupported' };
  const viaAlias = matchAlias(spec, alias);
  if (viaAlias) return { kind: 'path', bases: viaAlias };
  if (isBuiltin(spec)) return { kind: 'builtin' };
  const pkg = packageName(spec);
  if (!NPM_NAME.test(pkg)) return { kind: 'unknownAlias' };
  return { kind: 'external', pkg };
}

// JSON com comentários e vírgulas sobrando (tsconfig/jsconfig).
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  const s = String(text ?? '');
  while (i < s.length) {
    const ch = s[i];
    const nx = s[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\') {
        out += nx ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && nx === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && nx === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// chain: [{dir, json}] do tsconfig mais próximo para os que ele estende.
export function aliasFromChain(chain) {
  let paths = null;
  let pathsDir = null;
  let baseUrlDir = null;
  for (const { dir, json } of chain) {
    const co = json?.compilerOptions ?? {};
    if (paths === null && co.paths) {
      paths = co.paths;
      pathsDir = dir;
    }
    if (baseUrlDir === null && typeof co.baseUrl === 'string') baseUrlDir = P.normalize(P.join(dir, co.baseUrl));
  }
  if (!paths && baseUrlDir === null) return null;
  return { paths: paths ?? {}, baseDir: baseUrlDir ?? pathsDir, baseUrlDir };
}

// tsconfig.json ou jsconfig.json mais próximo subindo a partir do arquivo.
export function nearestConfig(file, tree) {
  let d = dirOf(file);
  for (;;) {
    for (const n of ['tsconfig.json', 'jsconfig.json']) {
      const p = d ? `${d}/${n}` : n;
      if (tree.has(p)) return p;
    }
    if (!d) return null;
    d = dirOf(d);
  }
}

export function extendsPath(configPath, json) {
  const ext = Array.isArray(json?.extends) ? json.extends[0] : json?.extends;
  if (typeof ext !== 'string' || !ext.startsWith('.')) return null;
  const p = P.normalize(P.join(dirOf(configPath), ext));
  return p.endsWith('.json') ? p : `${p}.json`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/resolve.test.mjs`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/resolve.mjs tests/resolve.test.mjs
git commit -m "feat(scripts): resolução de caminho, alias tsconfig e pacote

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Análise de exports (IMPORT-CHECK C)

**Files:**
- Create: `scripts/lib/exports.mjs`
- Test: `tests/exports.test.mjs`

**Interfaces:**
- Consumes: `stripComments` (Task 4).
- Produces: `NAMED_CHECKABLE`; `analyzeExports(source) -> {names: Set, hasDefault, starFrom: string[], ambiguous}`; `checkName(file, name, {info, resolve}, depth=0) -> 'yes'|'no'|'unknown'` (segue `export *` até 2 níveis; CommonJS/destructuring → `unknown`).

- [ ] **Step 1: Escrever os testes**

`tests/exports.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/exports.test.mjs`
Expected: FAIL com `Cannot find module`.

- [ ] **Step 3: Implementar**

`scripts/lib/exports.mjs`:

```js
import { stripComments } from './imports.mjs';

export const NAMED_CHECKABLE = /\.(d\.)?[mc]?[tj]sx?$/;

export function analyzeExports(source) {
  const src = stripComments(source);
  const names = new Set();
  const starFrom = [];
  let hasDefault = /\bexport\s+default\b/.test(src);
  const DECL =
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+enum|const|let|var|function\s*\*?|class|type|interface|enum|namespace|module)\s+([\w$]+)/g;
  for (const m of src.matchAll(DECL)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+import\s+([\w$]+)\s*=/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (let item of m[1].split(',')) {
      item = item.trim().replace(/^type\s+/, '');
      if (!item) continue;
      const parts = item.split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0]).trim();
      if (exported === 'default') hasDefault = true;
      else names.add(exported);
    }
  }
  for (const m of src.matchAll(/\bexport\s+\*\s+as\s+([\w$]+)\s+from/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+\*\s+from\s*['"]([^'"\n]+)['"]/g)) starFrom.push(m[1]);
  const ambiguous =
    /\bexport\s+(?:const|let|var)\s+[{[]/.test(src) || /\bmodule\.exports\b|\bexports\.[\w$]+\s*=/.test(src);
  return { names, hasDefault, starFrom, ambiguous };
}

// 'yes' | 'no' | 'unknown'. ctx.info(file) -> analyzeExports ou null; ctx.resolve(file, spec) -> caminho ou null.
export function checkName(file, name, ctx, depth = 0) {
  const info = ctx.info(file);
  if (!info) return 'unknown';
  if (name === 'default' ? info.hasDefault : info.names.has(name)) return 'yes';
  if (name !== 'default' && info.starFrom.length) {
    if (depth >= 2) return 'unknown';
    let sawUnknown = false;
    for (const spec of info.starFrom) {
      const target = ctx.resolve(file, spec);
      if (!target) {
        sawUnknown = true;
        continue;
      }
      const r = checkName(target, name, ctx, depth + 1);
      if (r === 'yes') return 'yes';
      if (r === 'unknown') sawUnknown = true;
    }
    if (sawUnknown) return 'unknown';
  }
  return info.ambiguous ? 'unknown' : 'no';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/exports.test.mjs`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/exports.mjs tests/exports.test.mjs
git commit -m "feat(scripts): análise de exports nomeados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Seleção de docs e espelho do módulo

**Files:**
- Create: `scripts/lib/select.mjs`
- Test: `tests/select.test.mjs`

**Interfaces:**
- Consumes: `ignoreReason` (Task 2), `dirOf` (Task 5).
- Produces: `CODE_EXT`; `ancestors(dir)`; `touchedDirs(changed)`; `selectDocs(changed, treeList, max=15) -> string[]`; `selectMirror(changed, treeEntries, {maxFiles=60, maxBytes=2_000_000}) -> {files, skipped}`. `changed` = itens de `meta.files` não ignorados; `treeEntries` = `[{path, size}]`.

- [ ] **Step 1: Escrever os testes**

`tests/select.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/select.test.mjs`
Expected: FAIL com `Cannot find module`.

- [ ] **Step 3: Implementar**

`scripts/lib/select.mjs`:

```js
import { ignoreReason } from './filter.mjs';
import { dirOf } from './resolve.mjs';

const ROOT_DOCS = [
  'CLAUDE.md', 'AGENTS.md', '.cursorrules', '.github/copilot-instructions.md', 'CONTRIBUTING.md',
  'docs/CONTRIBUTING.md', 'CODING_STANDARDS.md', 'docs/coding-standards.md', 'STYLEGUIDE.md',
];
const DIR_DOCS = ['CLAUDE.md', 'AGENTS.md'];
export const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|py|go|rb|java|kt|cs|php|rs)$/;

// 'a/b' -> ['a/b', 'a', '']
export function ancestors(dir) {
  const out = [];
  let d = dir;
  for (;;) {
    out.push(d);
    if (!d) return out;
    d = dirOf(d);
  }
}

// Diretórios tocados pela PR, do que tem mais arquivos alterados para o que tem menos.
export function touchedDirs(changed) {
  const count = new Map();
  for (const f of changed) {
    for (const p of [f.path, f.previous].filter(Boolean)) {
      const d = dirOf(p);
      count.set(d, (count.get(d) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
}

export function selectDocs(changed, treeList, max = 15) {
  const tree = new Set(treeList);
  const picks = [];
  const push = (p) => {
    if (tree.has(p) && !picks.includes(p)) picks.push(p);
  };
  ROOT_DOCS.forEach(push);
  treeList.filter((p) => p.startsWith('.cursor/rules/')).slice(0, 5).forEach(push);
  for (const d of touchedDirs(changed)) {
    for (const a of ancestors(d)) for (const n of DIR_DOCS) push(a ? `${a}/${n}` : n);
  }
  return picks.slice(0, max);
}

// Arquivos de código dos diretórios tocados, até maxFiles / maxBytes.
export function selectMirror(changed, treeEntries, { maxFiles = 60, maxBytes = 2_000_000 } = {}) {
  const changedSet = new Set(changed.map((f) => f.path));
  const byDir = new Map();
  for (const e of treeEntries) {
    if (!CODE_EXT.test(e.path) || ignoreReason(e.path)) continue;
    const d = dirOf(e.path);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(e);
  }
  const files = [];
  let bytes = 0;
  let skipped = 0;
  for (const d of touchedDirs(changed)) {
    const entries = (byDir.get(d) ?? []).sort(
      (a, b) => Number(changedSet.has(b.path)) - Number(changedSet.has(a.path)) || a.path.localeCompare(b.path),
    );
    for (const e of entries) {
      if (files.includes(e.path)) continue;
      if (files.length >= maxFiles || bytes + e.size > maxBytes) {
        skipped++;
        continue;
      }
      files.push(e.path);
      bytes += e.size;
    }
  }
  return { files, skipped };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/select.test.mjs`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/select.mjs tests/select.test.mjs
git commit -m "feat(scripts): seleção de docs e espelho do módulo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `fetch-context.mjs` (Fase 3 + IMPORT-CHECK)

**Files:**
- Create: `scripts/fetch-context.mjs`
- Test: `tests/fetch-context.test.mjs`

**Interfaces:**
- Consumes: tudo das Tasks 1–7 e o `<dir>` gravado pela Task 3 (`meta.json`, `tree.txt`, `diffs/`).
- Produces: `run(argv, {exec, tmpRoot, log}) -> Promise<0|1>`. Grava conteúdo do head em `<dir>/head/<caminho>`. Saída:
  `Contexto: …`, opcional `Espelho truncado: …`, opcional `Não existem no head: …`, `IMPORT-CHECK: <n> imports em <f> arquivos — <b> bloqueantes, <r> ressalvas, <i> incertos`, uma linha `  [Severidade] arquivo:linha — mensagem` por achado (ordem Bloqueante, Ressalva, Incerto), opcional `Falhas de leitura: …`, `Dir: <dir>/head`.

- [ ] **Step 1: Escrever os testes**

`tests/fetch-context.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/fetch-context.test.mjs`
Expected: FAIL com `Cannot find module '.../scripts/fetch-context.mjs'`.

- [ ] **Step 3: Implementar**

`scripts/fetch-context.mjs`:

```js
#!/usr/bin/env node
// Fase 3 do diffs-reviewer: baixa contexto em lote (pedidos, docs, espelho do módulo) e roda o IMPORT-CHECK.
// Uso: node fetch-context.mjs <Dir impresso por fetch-pr.mjs> [arquivo ...]   (até 10 arquivos)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGh, encodePath, RAW } from './lib/gh.mjs';
import { assertWorkDir, safeJoin, diffPath, mapLimit, isMain } from './lib/workdir.mjs';
import { JS_EXT, extractFromPatch, extractFromSource } from './lib/imports.mjs';
import {
  classify, findInTree, candidatePaths, nearMiss, parseJsonc, aliasFromChain, nearestConfig, extendsPath, dirOf,
} from './lib/resolve.mjs';
import { analyzeExports, checkName, NAMED_CHECKABLE } from './lib/exports.mjs';
import { selectDocs, selectMirror, ancestors } from './lib/select.mjs';

const P = path.posix;
const MAX_REQUESTED = 10;
const MAX_TARGETS = 30;
const SEV_ORDER = { Bloqueante: 0, Ressalva: 1, Incerto: 2 };

function makeFetcher({ exec, meta, headDir }) {
  const cache = new Map();
  const failed = [];
  async function fetchMany(paths) {
    const todo = [...new Set(paths)].filter((p) => !cache.has(p));
    await mapLimit(todo, 8, async (p) => {
      try {
        const endpoint = `repos/${meta.headOwner}/${meta.headRepo}/contents/${encodePath(p)}?ref=${meta.headSha}`;
        const body = await runGh(['api', endpoint, '-H', RAW], exec);
        cache.set(p, body);
        const out = safeJoin(headDir, p);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, body);
      } catch {
        cache.set(p, null);
        failed.push(p);
      }
    });
  }
  return { fetchMany, get: (p) => cache.get(p) ?? null, has: (p) => cache.has(p), failed };
}

export async function run(argv, { exec, tmpRoot = os.tmpdir(), log = console.log } = {}) {
  const [dirArg, ...requested] = argv;
  let dir;
  try {
    dir = assertWorkDir(tmpRoot, dirArg);
  } catch (e) {
    log(e.message);
    return 1;
  }
  if (!fs.existsSync(path.join(dir, 'meta.json'))) {
    log(`meta.json não encontrado em ${dir}. Rode fetch-pr.mjs antes.`);
    return 1;
  }
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const treeEntries = fs
    .readFileSync(path.join(dir, 'tree.txt'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [p, s] = l.split('\t');
      return { path: p, size: Number(s) || 0 };
    });
  const treeList = treeEntries.map((e) => e.path);
  const tree = new Set(treeList);
  const headDir = path.join(dir, 'head');
  const fetcher = makeFetcher({ exec, meta, headDir });

  const findings = [];
  const seen = new Set();
  const add = (sev, file, line, msg) => {
    const key = `${file}:${line}:${msg}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ sev, file, line, msg });
  };

  const changed = meta.files.filter((f) => !f.ignored);
  const removedOld = new Set(
    meta.files.flatMap((f) => (f.status === 'D' ? [f.path] : f.status === 'R' && f.previous ? [f.previous] : [])),
  );

  // Pedidos do modelo (até 10) e docs de padrões.
  const reqMissing = requested.filter((p) => !tree.has(p));
  const reqValid = [...new Set(requested.filter((p) => tree.has(p)))];
  const reqTake = reqValid.slice(0, MAX_REQUESTED);
  const overCap = reqValid.slice(MAX_REQUESTED);
  const docs = selectDocs(changed, treeList);

  // IMPORT-CHECK A: specifiers das linhas adicionadas.
  const refsByFile = changed
    .filter((f) => f.status !== 'D' && f.diff && JS_EXT.test(f.path))
    .map((f) => ({ file: f.path, refs: extractFromPatch(fs.readFileSync(diffPath(dir, f.path), 'utf8')) }))
    .filter((x) => x.refs.length);

  // Aliases: tsconfig/jsconfig mais próximo + extends relativos.
  await fetcher.fetchMany([...new Set(refsByFile.map((x) => nearestConfig(x.file, tree)).filter(Boolean))]);
  const aliasCache = new Map();
  async function aliasFor(file) {
    const cfg = nearestConfig(file, tree);
    if (!cfg) return null;
    if (aliasCache.has(cfg)) return aliasCache.get(cfg);
    const chain = [];
    let cur = cfg;
    for (let i = 0; cur && i < 4; i++) {
      await fetcher.fetchMany([cur]);
      const text = fetcher.get(cur);
      if (text === null) break;
      let json;
      try {
        json = parseJsonc(text);
      } catch {
        break;
      }
      chain.push({ dir: dirOf(cur), json });
      cur = extendsPath(cur, json);
    }
    const alias = aliasFromChain(chain);
    aliasCache.set(cfg, alias);
    return alias;
  }

  function missFinding(file, ref, bases) {
    const removedHit = bases.flatMap(candidatePaths).find((p) => removedOld.has(p));
    if (removedHit) return add('Bloqueante', file, ref.line, `"${ref.spec}" aponta para ${removedHit}, removido/renomeado nesta PR`);
    if (bases.some((b) => /generated|\.gen\./.test(b))) return add('Incerto', file, ref.line, `"${ref.spec}": caminho gerado — não verificável no head`);
    if (bases.some((b) => nearMiss(b, treeList))) return add('Incerto', file, ref.line, `"${ref.spec}": existe arquivo com o mesmo nome e extensão não reconhecida — verificar`);
    if (meta.treeTruncated) return add('Incerto', file, ref.line, `"${ref.spec}": não encontrado, mas a árvore do repositório veio truncada`);
    return add('Bloqueante', file, ref.line, `"${ref.spec}" não existe no head (testado: ${bases[0]} + extensões .ts/.tsx/.js/.jsx/.mjs/.cjs/.json/… e /index.*)`);
  }

  // IMPORT-CHECK B: existência.
  const namedTargets = new Map();
  const externals = [];
  let importCount = 0;
  for (const { file, refs } of refsByFile) {
    const alias = await aliasFor(file);
    for (const ref of refs) {
      importCount++;
      let c = classify(file, ref.spec, alias);
      if (c.kind === 'external' && alias?.baseUrlDir != null) {
        const viaBase = P.normalize(P.join(alias.baseUrlDir, ref.spec));
        if (findInTree(viaBase, tree)) c = { kind: 'path', bases: [viaBase] };
      }
      if (c.kind === 'builtin' || c.kind === 'unsupported') continue;
      if (c.kind === 'external') {
        externals.push({ file, line: ref.line, pkg: c.pkg });
        continue;
      }
      if (c.kind === 'unknownAlias') {
        add('Incerto', file, ref.line, `"${ref.spec}": alias não resolvido (tsconfig/jsconfig)`);
        continue;
      }
      if (c.kind === 'outside') {
        add('Incerto', file, ref.line, `"${ref.spec}" aponta para fora da raiz do repositório`);
        continue;
      }
      const target = c.bases.map((b) => findInTree(b, tree)).find(Boolean);
      if (!target) {
        missFinding(file, ref, c.bases);
        continue;
      }
      if (ref.partial) {
        add('Incerto', file, ref.line, `"${ref.spec}": import multi-linha com nomes em linhas não alteradas — nomes não verificados`);
        continue;
      }
      if (ref.names.length && NAMED_CHECKABLE.test(target)) {
        if (!namedTargets.has(target)) namedTargets.set(target, []);
        namedTargets.get(target).push({ file, names: ref.names });
      }
    }
  }

  // IMPORT-CHECK C: exports nomeados (até 30 alvos, seguindo export * até 2 níveis).
  const targetList = [...namedTargets.keys()];
  const targetTake = targetList.slice(0, MAX_TARGETS);
  const targetOver = new Set(targetList.slice(MAX_TARGETS));
  await fetcher.fetchMany(targetTake);
  const infoCache = new Map();
  const info = (p) => {
    if (!infoCache.has(p)) {
      const s = fetcher.get(p);
      infoCache.set(p, s === null ? null : analyzeExports(s));
    }
    return infoCache.get(p);
  };
  const resolveStar = (from, spec) =>
    spec.startsWith('.') ? findInTree(P.normalize(P.join(dirOf(from), spec)), tree) : null;
  let frontier = targetTake;
  let budget = MAX_TARGETS - targetTake.length;
  for (let depth = 0; depth < 2 && budget > 0; depth++) {
    const next = new Set();
    for (const p of frontier) {
      for (const s of info(p)?.starFrom ?? []) {
        const t = resolveStar(p, s);
        if (t && !fetcher.has(t)) next.add(t);
      }
    }
    const batch = [...next].slice(0, budget);
    if (!batch.length) break;
    budget -= batch.length;
    await fetcher.fetchMany(batch);
    frontier = batch;
  }
  const quote = (ns) => ns.map((n) => `"${n.name}"`).join(', ');
  for (const [target, uses] of namedTargets) {
    for (const u of uses) {
      if (targetOver.has(target)) {
        add('Incerto', u.file, u.names[0].line, `${quote(u.names)}: export não verificado em ${target} (fora do teto de contexto)`);
        continue;
      }
      const missing = [];
      const unknown = [];
      for (const n of u.names) {
        const st = checkName(target, n.name, { info, resolve: resolveStar });
        if (st === 'no') missing.push(n);
        else if (st === 'unknown') unknown.push(n);
      }
      if (missing.length) add('Bloqueante', u.file, missing[0].line, `${quote(missing)} não exportado(s) por ${target}`);
      if (unknown.length) add('Incerto', u.file, unknown[0].line, `${quote(unknown)}: export não confirmado em ${target} (export *, CommonJS ou destructuring)`);
    }
  }

  // IMPORT-CHECK E: pacotes externos declarados em algum package.json relevante.
  if (externals.length) {
    const manifests = new Set();
    for (const e of externals) {
      for (const d of ancestors(dirOf(e.file))) {
        const m = d ? `${d}/package.json` : 'package.json';
        if (tree.has(m)) manifests.add(m);
      }
    }
    if (manifests.size) {
      await fetcher.fetchMany([...manifests]);
      const declared = new Set();
      let workspaces = false;
      for (const m of manifests) {
        const s = fetcher.get(m);
        if (!s) continue;
        try {
          const j = JSON.parse(s);
          for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            Object.keys(j[k] ?? {}).forEach((n) => declared.add(n));
          }
          if (m === 'package.json' && j.workspaces) workspaces = true;
        } catch {
          // package.json inválido: ignora
        }
      }
      const once = new Set();
      for (const e of externals) {
        if (declared.has(e.pkg) || once.has(`${e.file}:${e.pkg}`)) continue;
        once.add(`${e.file}:${e.pkg}`);
        add(
          workspaces ? 'Incerto' : 'Ressalva',
          e.file,
          e.line,
          `pacote "${e.pkg}" não declarado em package.json${workspaces ? ' (monorepo: pode vir do workspace)' : ''}`,
        );
      }
    }
  }

  // Contexto: pedidos, docs e espelho do módulo.
  const mirror = selectMirror(changed, treeEntries);
  await fetcher.fetchMany([...reqTake, ...docs, ...mirror.files]);

  // IMPORT-CHECK D: arquivos do espelho que ainda importam caminhos removidos/renomeados.
  if (removedOld.size) {
    for (const p of mirror.files.filter((f) => JS_EXT.test(f))) {
      const src = fetcher.get(p);
      if (src === null) continue;
      for (const ref of extractFromSource(src)) {
        if (!ref.spec.startsWith('.')) continue;
        const base = P.normalize(P.join(dirOf(p), ref.spec));
        if (findInTree(base, tree)) continue;
        const hit = candidatePaths(base).find((c) => removedOld.has(c));
        if (hit) add('Bloqueante', p, ref.line, `"${ref.spec}" aponta para ${hit}, removido/renomeado nesta PR`);
      }
    }
  }

  // Saída.
  const got = (list) => list.filter((p) => fetcher.get(p) !== null).length;
  const totalFetched = [...new Set([...reqTake, ...docs, ...mirror.files, ...targetTake])].filter((p) => fetcher.get(p) !== null).length;
  const over = [...overCap, ...targetOver];
  findings.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || a.file.localeCompare(b.file) || a.line - b.line);
  const count = (s) => findings.filter((f) => f.sev === s).length;

  log(
    `Contexto: ${totalFetched} arquivos baixados (${got(reqTake)} pedidos, ${got(docs)} docs, ${got(mirror.files)} espelho), ` +
      `${over.length} fora do teto${over.length ? `: ${over.slice(0, 10).join(', ')}${over.length > 10 ? ', …' : ''}` : ''}`,
  );
  if (mirror.skipped) log(`Espelho truncado: ${mirror.skipped} arquivos dos diretórios tocados não baixados (teto 60 arquivos / 2 MB)`);
  if (reqMissing.length) log(`Não existem no head: ${reqMissing.join(', ')}`);
  log(
    `IMPORT-CHECK: ${importCount} imports em ${refsByFile.length} arquivos — ` +
      `${count('Bloqueante')} bloqueantes, ${count('Ressalva')} ressalvas, ${count('Incerto')} incertos`,
  );
  for (const f of findings) log(`  [${f.sev}]${' '.repeat(10 - f.sev.length)} ${f.file}:${f.line} — ${f.msg}`);
  if (fetcher.failed.length) log(`Falhas de leitura: ${fetcher.failed.join(', ')}`);
  log(`Dir: ${headDir}`);
  return 0;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
```

- [ ] **Step 4: Rodar a suíte inteira**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS — `# pass 45`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-context.mjs tests/fetch-context.test.mjs
git commit -m "feat(scripts): fetch-context com contexto em lote e IMPORT-CHECK

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Smoke test contra uma PR real

**Files:** nenhum (só verificação).

- [ ] **Step 1: PR mergeada para e pede confirmação**

Run: `node scripts/fetch-pr.mjs https://github.com/cardosoGu/diffs-reviewer/pull/1; echo "exit=$?"`
Expected: `Aviso: a PR #1 está MERGED. Nada foi coletado.` e `exit=2`.

- [ ] **Step 2: Com `--force` coleta**

Run: `node scripts/fetch-pr.mjs https://github.com/cardosoGu/diffs-reviewer/pull/1 --force`
Expected: cabeçalho `PR #1 Feat/v1.1 — MERGED — base main ← head 807240d`, `Arquivos (2 analisados, 11 ignorados, 239 linhas, escopo Medium)`, `Ignorados: docs 11` e uma linha `Dir: …cardosoGu__diffs-reviewer__pr-1`. Tempo ~1–3 s.

- [ ] **Step 3: Contexto e IMPORT-CHECK**

Run: `node scripts/fetch-context.mjs "<Dir do passo anterior>" SKILL.md`
Expected: `IMPORT-CHECK: 4 imports em 1 arquivos — 0 bloqueantes, 0 ressalvas, 0 incertos` (os 4 são builtins do Node; os imports escritos dentro de strings em `tests/check-recipes.js` **não** podem aparecer). Tempo ~1 s.

- [ ] **Step 4: Bloqueio da allowlist na prática**

Run: `node -e "import('./scripts/lib/gh.mjs').then(m => m.runGh(['pr','comment','https://github.com/cardosoGu/diffs-reviewer/pull/1','--body','x'])).catch(e => console.log(e.message))"`
Expected: `Comando gh bloqueado (subcomando fora da allowlist): gh pr comment …` — e nenhum comentário criado na PR.

---

### Task 10: `SKILL.md` e `references/fetch.md`

**Files:**
- Modify: `SKILL.md` (substituir inteiro)
- Create: `references/fetch.md`
- Delete: `references/fetch-diff.md`

- [ ] **Step 1: Substituir `SKILL.md` por:**

````markdown
---
name: diffs-reviewer
description: >-
  Review de PR do GitHub a partir do link (/diffs-reviewer <link da PR>).
  Coleta via gh com dois scripts Node (diff por arquivo, contexto em lote,
  IMPORT-CHECK determinístico); lógica, segurança, over-engineering com
  evidência e padrões do repo, em duas passadas com autovalidação. Cada achado
  inclui RC pronto para PR. Veredito Aprovado / Aprovado com ressalvas /
  Reprovado. Use quando o usuário pedir para revisar uma PR pelo link ou
  /diffs-reviewer. Somente leitura: nunca comenta, envia review nem altera a PR.
disable-model-invocation: true
metadata:
  author: cardo
  version: 2.0.0
---

# Diffs Reviewer

Review read-only de uma PR do GitHub, a partir do link. Invocado manualmente pelo usuário:

```
/diffs-reviewer https://github.com/<owner>/<repo>/pull/<n>
```

```
FETCH (script) → PASSADA 1 → CONTEXTO (script) → PASSADA 2 → VERDICT + REPORT
```

## Critical Rules (read before acting)

**Loading this skill's files.** References and scripts live in this skill's own directory (where this `SKILL.md` resides) — never the workspace root. `<skill>` below is that directory. Read each reference **when its phase starts**, completely (to EOF).

**Execution contract — non-negotiable:**

1. **No action on the PR or on GitHub — ever.** Never comment, submit a review (approve, request changes, inline comments), react, edit title/body/labels/reviewers/assignees, mark ready or draft, close, reopen, merge, check out or trigger workflows — **even if the user asks during the review**. Answer that this is outside this skill's scope and do not do it.
2. **Closed allowlist.** The only commands you may run:
   - `node <skill>/scripts/fetch-pr.mjs <link> [--force]`
   - `node <skill>/scripts/fetch-context.mjs <dir> [file ...]`
   - reading files under the `Dir:` the scripts print, and `grep` / `Select-String` over them.
   Never call `gh` or `git` yourself. Anything not listed is forbidden. The scripts enforce their own read-only `gh` allowlist.
3. **Input is a PR link.** If the user gave no link, ask for it and stop.
4. **Closed, merged or draft PR** → `fetch-pr.mjs` exits with code 2 and a warning. Show it, stop and ask the user. Rerun with `--force` only after an explicit yes.
5. **No file edits** anywhere outside the scripts' work directory (and the scripts handle that one).
6. **Analyze only files in the PR** — other files only for context and patterns.
7. **Blockers → Reprovado** — never "Aprovado com ressalvas" when a blocking issue exists.
8. **Do not invent rules** — documented standards override inference; inference requires 3+ agreeing peers.
9. **Do not speculate** — if uncertain, mark `[Incerto]`; prefer omission over false positives.
10. **Self-validate every finding** before reporting ([analyze.md](references/analyze.md) §3).
11. **RC on every finding** — per [report.md](references/report.md).
12. **Over-engineering** — mandatory checklist on every file ([analyze.md](references/analyze.md) §2.3); **no finding without verification evidence**.
13. **No early exit** — review all files even after blockers are found.
14. **Keep context lean** — read diffs one file at a time; never print `tree.txt`, `meta.json`, a whole directory of diffs or raw API output.

## Workflow

1. **FETCH** — Read [fetch.md](references/fetch.md). Run `fetch-pr.mjs` (§1).
2. **PASSADA 1** — Read [analyze.md](references/analyze.md). Diff-only review (§1); collect the context list.
3. **CONTEXTO** — Run `fetch-context.mjs` ([fetch.md](references/fetch.md) §2). Then read [standards.md](references/standards.md) and build the standards snapshot from `<dir>/head/`.
4. **PASSADA 2** — IMPORT-CHECK results, standards, over-engineering, context-dependent findings ([analyze.md](references/analyze.md) §2), then self-validation (§3).
5. **VERDICT + REPORT** — Read [report.md](references/report.md). Classify, dedup, verdict, final report with RC per finding plus `Cobertura` and `Limites`.

Display progress by **phase** (never per file). Use the user's conversation language for output.

## Commands

| Trigger | Action |
| ------- | ------ |
| `/diffs-reviewer <link>`, "revisar PR <link>", "review de código <link>" | Full workflow |
| "revisar só segurança <link>" | Full workflow, emphasize analyze.md §1 security |
| "revisar padrões <link>" | Full workflow, emphasize standards.md |
| Any request to comment, approve, request changes, merge, edit or close the PR | Refuse: out of this skill's scope (rule 1) |

## Additional Resources

- Product decisions and history: [SPEC.md](SPEC.md) (author reference — do not load during review)
- Script tests: `node --test "tests/*.test.mjs"` (author reference — do not run during review)
````

- [ ] **Step 2: Criar `references/fetch.md`:**

````markdown
# FETCH and CONTEXTO — Running the scripts

**Goal:** Collect everything the review needs in **two commands**, via the skill's own scripts. You never call `gh` or `git` directly.

`<skill>` is the directory of this skill's `SKILL.md`. Both scripts need `gh` (authenticated) and Node ≥ 18.

---

## 1. `fetch-pr.mjs` — PR metadata and per-file diffs

```bash
node <skill>/scripts/fetch-pr.mjs <link-da-pr>
```

### Exit codes

| Code | Meaning | What you do |
| ---- | ------- | ----------- |
| 0 | Collected | Continue |
| 1 | Error (invalid link, `gh` missing / not authenticated / no access) | Show the message and stop |
| 2 | PR is CLOSED, MERGED or DRAFT — nothing collected | Show the warning, **stop and ask the user**. Only after an explicit yes: rerun with `--force` |
| 3 | No relevant file after the fixed exclusions | Tell the user "Nenhum arquivo relevante na PR." and stop |

### Output (always this shape)

```
PR #<n> <title> — <state> — base <base> ← head <sha7>
Intent:
  <PR body, up to 8 lines; or the commit subjects>
Arquivos (<N> analisados, <X> ignorados, <L> linhas, escopo <Small|Medium|Large>):
  M src/a.ts +12 -3
  D src/old.ts
  R src/b.ts ← src/b-old.ts +0 -0
Ignorados: <motivo n, …> | nenhum
Não alcançados: <files whose diff GitHub did not return> | nenhum
Dir: <dir>
```

- **Intent** is the PR intent used in PASSADA 1 (logic vs. stated goal). If the user pasted a description, it takes precedence.
- The diff of each file is at `<dir>/diffs/<path>.diff` (unified hunks, `@@` headers kept). Read one file at a time.
- Exclusions are fixed by the script (dependencies, lockfiles, build/generated, binaries, i18n JSON, `*.md`): do not reread ignored files.
- Tests are not excluded; use their diffs only to answer "does the change have tests?".
- `Não alcançados` and any warning line go to the report's `Cobertura` / `Limites`.

Progress message once FETCH completes:

```
[Fase 1/5] FETCH — PR #<n>: <N> arquivos (<X> ignorados), <L> linhas, escopo <S>
```

Omit `(<X> ignorados)` when X = 0.

---

## 2. `fetch-context.mjs` — context in one batch + IMPORT-CHECK

Run it **once**, after PASSADA 1, with the `Dir:` from §1 and up to **10** files you need for context (files the diff calls, extends or depends on that are not in the PR):

```bash
node <skill>/scripts/fetch-context.mjs <dir> src/services/order.ts src/base/schema.ts
```

With no extra files it still downloads docs and the module mirror and runs IMPORT-CHECK.

What it downloads into `<dir>/head/` (content at the PR head commit):

| Group | Contents | Cap |
| ----- | -------- | --- |
| Requested | the files you listed | 10 |
| Docs | `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.cursorrules`, `.github/copilot-instructions.md`, coding standards, `.cursor/rules/*` (≤5), and `CLAUDE.md` / `AGENTS.md` of every touched directory and its ancestors | 15 |
| Module mirror | code files of the directories touched by the PR (changed files first) | 60 files / 2 MB |
| IMPORT-CHECK | tsconfig/jsconfig chain, import targets (`export *` followed 2 levels), `package.json` files | 30 targets |

### Output

```
Contexto: <K> arquivos baixados (<p> pedidos, <d> docs, <m> espelho), <M> fora do teto[: lista]
Espelho truncado: <n> arquivos … não baixados          (only when the mirror hit its cap)
Não existem no head: <files>                           (only for requested files that do not exist)
IMPORT-CHECK: <n> imports em <f> arquivos — <b> bloqueantes, <r> ressalvas, <i> incertos
  [Bloqueante] src/a.ts:14 — "./utils/fmt" não existe no head (testado: …)
  [Ressalva]   src/a.ts:20 — pacote "left-pad" não declarado em package.json
  [Incerto]    src/b.ts:3 — "@/lib/x": alias não resolvido (tsconfig/jsconfig)
Falhas de leitura: <files>                             (only on network failure)
Dir: <dir>/head
```

- IMPORT-CHECK lines are **deterministic results**: use them as findings in PASSADA 2 (analyze.md §2.1). Only valid imports are omitted.
- `fora do teto`, `Espelho truncado` and `Falhas de leitura` go to the report's `Limites` as `contexto truncado: …`.
- Need something the batch did not bring? You may run the script **one more time** with up to 10 new files. Never more than two runs per review.

Progress message once CONTEXTO completes is the STANDARDS one (standards.md).
````

- [ ] **Step 3: Remover a referência antiga**

Run: `git rm references/fetch-diff.md`

- [ ] **Step 4: Verificar que nada aponta para arquivos removidos**

Run: `grep -rn "fetch-diff\|typecheck.md\|sub-agents.md\|git fetch\|base=" SKILL.md references/fetch.md`
Expected: nenhuma saída.

- [ ] **Step 5: Commit**

```bash
git add SKILL.md references/fetch.md
git commit -m "feat(skill): entrada por link da PR e contrato somente leitura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `analyze.md`, `standards.md` e `report.md`

**Files:**
- Modify: `references/analyze.md` (substituir inteiro)
- Modify: `references/standards.md`
- Modify: `references/report.md`

- [ ] **Step 1: Substituir `references/analyze.md` por:**

````markdown
# ANALYZE — Two passes and self-validation

**Goal:** Review **every** relevant file in the PR for broken imports, logic bugs, security issues, standards violations and over-engineering, with as few false positives as possible.

**Completion criterion:** Every relevant file reviewed in both passes; every finding self-validated (§3) and carrying file:line, snippet, impact, fix and RC draft.

**No early exit** — continue through all files even after blockers are found.

Paths: `<dir>` is the `Dir:` printed by `fetch-pr.mjs`. Diffs are in `<dir>/diffs/<path>.diff`; head content downloaded by `fetch-context.mjs` is in `<dir>/head/<path>`.

---

## 1. PASSADA 1 — diff only (no extra context)

Read the diff files one at a time, in **risk order**:

1. routes, controllers, handlers, webhooks
2. auth, permissions, crypto, signatures
3. persistence, queues, jobs, migrations
4. services and domain logic
5. utilities and helpers
6. UI components
7. tests last (only: does the risky change have tests?)

Look only at what the diff itself proves. Line numbers come from the hunk header: in `@@ -a,b +c,d @@` the first non-`-` line is line `c` of the new file; count `+` and context lines, never `-` lines. **Never estimate a line number.**

### 1.1 Logic and business rules

- Inverted or missing conditions (`if (x = 5)` vs `===`); off-by-one, wrong operator, dead branches
- Null/undefined accessed without guard
- Bypassable validation; inconsistent state updates
- Race conditions (async without await, shared mutable state)
- Side effects inside ternaries or pure-looking functions
- **Intent mismatch:** the code does not do what the PR intent (`Intent:` from FETCH) states. Report only with the concrete line that contradicts it; a vague description is not evidence.

### 1.2 Security

- SQL/command injection (string concatenation in queries/shell); XSS (unsanitized input in HTML/DOM)
- Hardcoded secrets (API keys, passwords, tokens)
- Empty catch blocks swallowing errors silently
- Missing authorization checks on sensitive operations
- Dangerous APIs (`eval`, `Function`, unsafe deserialization); path traversal in file operations
- Webhook/signature handling: signature verified over the raw body, constant-time comparison, replay protection

### 1.3 Typing (manual — no typecheck runs)

- Types clearly incompatible with their usage inside the diff; missing required props
- Incorrect function signatures visible in the diff
- Unsafe casts hiding real errors (`as any`, `@ts-ignore` without justification)

### 1.4 Context list

While reading, note what you **cannot** confirm from the diff alone (a called function, a base class, a schema, a consumer). At the end of the pass, pick **at most 10** files for `fetch-context.mjs` (fetch.md §2), most important first. Keep the open questions; PASSADA 2 answers them.

Progress:

```
[Fase 2/5] PASSADA 1 — <N> arquivos lidos, <C> candidatos, <K> arquivos de contexto pedidos
```

---

## 2. PASSADA 2 — with context

### 2.1 IMPORT-CHECK (from `fetch-context.mjs`)

The script already resolved every import added by the PR against the head commit. Take its lines as findings:

| Script line | Severity |
| ----------- | -------- |
| `[Bloqueante]` — path does not exist, named export missing, file removed/renamed in the PR still imported | **Bloqueante** |
| `[Ressalva]` — external package not declared in `package.json` | **Ressalva** |
| `[Incerto]` — alias not resolved, `export *` / CommonJS ambiguity, generated path, truncated tree, outside the cap | `[Incerto]` → **Sugestão** |

Evidence for the finding is the script line itself (e.g. "`./missing` não existe no head; testados: … e /index.*"). Still run §3 on each one: reread the diff line it points to.

Status line for the report: `IMPORT-CHECK: ok` or `IMPORT-CHECK: <N> achados (<B> bloqueantes, <R> ressalvas, <I> incertos)` — counted after dedup (all missing names of one import = 1 finding), `N = B + R + I`.

### 2.2 Standards (from STANDARDS)

- Documented rule violations
- Inferred convention mismatches (classification in standards.md)

### 2.3 Over-engineering (mandatory — every file)

Run the checklist on every file. **Each signal requires its verification** — even when the conclusion is "nothing found". Greps run over the module mirror in `<dir>/head/`, never over the whole repo (you do not have it).

| Signal | Como confirmar (cheap) | Evidência exigida |
| ------ | ---------------------- | ----------------- |
| Speculative generality | `grep -rnP '(?<![\w$])(<S1>\|<S2>)(?![\w$])' <dir>/head/<module>/`; count uses outside the definition | usage count and where |
| Duplicated infrastructure | Read the base class / parent schema / middleware chain in `<dir>/head/` and check whether it already applies the same plugin, helper or hook | quoted snippet of the base that already covers it |
| Middle man | Read the body: only delegates, no logic, no error handling, no transformation | summarized body |
| Unnecessary wrapper / Premature abstraction | Count implementations and call sites of the Factory/Builder/Strategy in the mirror (`grep -rn` for `implements`, `extends`, usages) | number of implementations (1 confirms) |
| Future-only config | `grep -rn` the flag/param in the mirror; does any call site pass a non-default value? | call sites found |
| Dead code in diff | `grep -rnP '(?<![\w$])(<E1>\|<E2>)(?![\w$])' <dir>/head/`; zero references outside its own file and tests | grep result |

(`\|` above is a table escape — the command uses a plain `|`.)

- **Batch the greps:** one command per module with all candidate symbols in the alternation, not one per symbol.
- **Mirror limit:** the mirror holds only the touched directories. Zero references for a **module-private** symbol is evidence; for a **public export** it is not (consumers may live elsewhere) → at most **Sugestão** `[Incerto]`.
- **Dead code exclusions:** default/framework exports of page, route or config files; files referenced by `package.json` `main`/`exports`/`bin`; ambient `.d.ts`; exports of files that are themselves new and unreferenced (report the file once). Uncertain → `[Incerto]`.
- Bound names with `(?<![\w$])…(?![\w$])`, not `\b` (names with `$` must match; escape `$` as `\$`). A zero result from a `\b` grep on a `$` name is not evidence.

**Sem evidência, sem achado.** A signal without confirmation is not reported. Strong hint but incomplete confirmation → `[Incerto]` (→ Sugestão). At most one verification per candidate symbol.

Classify per the over-engineering table in [report.md](report.md).

### 2.4 Context tracing

Answer the open questions from PASSADA 1 with `<dir>/head/`. For API/handler changes, trace `route/endpoint → controller/handler → service → repository/data layer` as far as the downloaded files allow. What you still cannot confirm stays `[Incerto]` or is dropped — never assumed.

---

## 3. Self-validation (mandatory, before the report)

For **every** candidate finding, reread the exact lines (the diff, or `<dir>/head/<path>`) and check:

1. **It exists:** the quoted code is at the cited file and line (line computed from `@@`, or counted in `<dir>/head/<path>`).
2. **It happens as written:** the problem occurs with the code as it is, not "depending on the input" or "if someone later…".
3. **It is new:** the line was added or changed by this PR (a `+` line, or behavior the PR changed).

Failed 1 or 3 → **drop it**. Failed 2 → `[Incerto]` (→ Sugestão) or drop it.

**Do not report:**

- Pre-existing problems outside the PR's changes
- What a linter or formatter catches
- Style, naming or pattern nitpicks without a documented rule
- Hypothetical edge cases with no plausible trigger
- A `CLAUDE.md` rule that the code explicitly silences (e.g. lint-ignore comment with a reason)
- Lockfile or generated-only changes (already excluded by FETCH)
- Over-engineering as **Bloqueante** unless functional/security impact is clear

---

## Finding Quality Rules

Each finding includes: **file and line**; **code snippet**; **why it matters** (impact, not preference); **suggested fix** (concrete, minimal); **RC draft** per [report.md](report.md).

If uncertain: prefix with `[Incerto]`; the RC uses "Parece que… poderia confirmar…?" / "It looks like… could you confirm…?".

---

## Progress Message

```
[Fase 4/5] PASSADA 2 — concluído (<B> bloqueantes, <R> ressalvas, <S> sugestões após autovalidação; <D> descartados)
```
````

- [ ] **Step 2: Editar `references/standards.md`**

2a. Substituir o parágrafo de abertura do Step 1:

```
Read (if they exist), extracting only **actionable rules** (naming, imports, error handling, validation, folder structure, API response shapes, test requirements):
```

por:

```
`fetch-context.mjs` already downloaded the documents that exist into `<dir>/head/` (root docs, `.cursor/rules/*` up to 5, and `CLAUDE.md` / `AGENTS.md` of every touched directory and its ancestors). Read them from there, extracting only **actionable rules** (naming, imports, error handling, validation, folder structure, API response shapes, test requirements):
```

2b. Substituir a linha da tabela:

```
| Lint config intent | `eslint.config.*`, `.eslintrc*`, `biome.json` (rules sections only — do not run linters) |
```

por:

```
| Lint config intent | `eslint.config.*`, `.eslintrc*`, `biome.json` — only if you requested it in `fetch-context.mjs` (counts toward the 10 files); rules sections only, never run linters |
```

2c. Substituir:

```
Group modified files by **module** (same directory or clear package boundary). Infer per module, not per file. **Large:** infer for at most 6 modules (those with the most changed lines); the rest use documented standards only.
```

por:

```
Group modified files by **module** (same directory or clear package boundary). Infer per module, not per file. **Large:** infer for at most 6 modules (those with the most changed lines); the rest use documented standards only. Peers come from the module mirror in `<dir>/head/<module>/` (capped at 60 files / 2 MB for the whole PR); a module with fewer than 3 files in the mirror infers nothing.
```

2d. Substituir:

```
- plus **targeted greps** for a dimension across the module's peers in one command (e.g. `git grep -nE 'catch *\(|Result<|throw new' HEAD -- <module>/`).
```

por:

```
- plus **targeted greps** for a dimension across the module's peers in one command (e.g. `grep -rnE 'catch *\(|Result<|throw new' <dir>/head/<module>/`).
```

2e. Substituir `Compact internal list (~30 lines max), passed to ANALYZE (and workers); not shown in the report unless asked:` por `Compact internal list (~30 lines max), passed to PASSADA 2; not shown in the report unless asked:`.

2f. Substituir o bloco de progresso e a linha seguinte:

```
[Fase 2/5] STANDARDS — <D> regras documentadas, <I> convenções inferidas (<M> módulos)
```

por:

```
[Fase 3/5] CONTEXTO — <D> regras documentadas, <I> convenções inferidas (<M> módulos)
```

e `If both are zero: \`[Fase 2/5] STANDARDS — nenhum padrão claro detectado; …\`` por `If both are zero: \`[Fase 3/5] CONTEXTO — nenhum padrão claro detectado; análise focará em lógica, segurança e over-engineering\``.

- [ ] **Step 3: Editar `references/report.md`**

3a. Em "Bloqueante", substituir `- Type/typecheck errors in diff files that break the build` por `- Type errors evident in the diff that break the build (manual reading — no typecheck runs)` e `- **Broken import** (IMPORT-CHECK, confirmed miss only — analyze.md §0): path that does not resolve, named export that does not exist, deleted/renamed file still imported — with its evidence` por `- **Broken import** (IMPORT-CHECK \`[Bloqueante]\` lines from \`fetch-context.mjs\`): path that does not resolve, named export that does not exist, deleted/renamed file still imported — with its evidence`.

3b. Em "Ressalva", substituir `- Undeclared external package in a new import (IMPORT-CHECK Step E)` por `- Undeclared external package in a new import (IMPORT-CHECK \`[Ressalva]\`)`.

3c. Na tabela de over-engineering, substituir a linha `| Dead export with 0 references (grep cited; exclusions in analyze.md §2.6) | **Ressalva** |` por duas linhas:

```
| Dead module-private export with 0 references in the mirror (grep cited; exclusions in analyze.md §2.6) | **Ressalva** |
| Public export with 0 references in the mirror (repo-wide not verifiable) | **Sugestão** `[Incerto]` |
```

3d. Substituir `[Fase 4/5] VERDICT — <veredito>: <N> bloqueantes, <R> ressalvas, <S> sugestões` por `[Fase 5/5] VERDICT — <veredito>: <N> bloqueantes, <R> ressalvas, <S> sugestões`.

3e. Substituir o exemplo `RC: Parece que o export \`neverUsed\` em \`src/dead.ts\` não tem nenhuma referência no repositório, poderia verificar se ainda é necessário?` por `RC: Parece que o export \`neverUsed\` em \`src/dead.ts\` não tem nenhuma referência no módulo, poderia verificar se ainda é necessário?`.

3f. No bloco do relatório final, substituir as três linhas

```
Branch: [current] → base: [base] ([M] commits, [F] arquivos)
IMPORT-CHECK: [ok | N achados (B bloqueantes, R ressalvas, I incertos)]
TYPECHECK: [não solicitado | ok | <N> erros | timeout | skipped | falhou (config)]
```

por

```
PR: [link] — [título] (head [sha7], [F] arquivos, escopo [S])
IMPORT-CHECK: [ok | N achados (B bloqueantes, R ressalvas, I incertos)]
```

e, logo depois da seção `## Sugestões (opcional)` do mesmo bloco (antes do fechamento do bloco de código), acrescentar:

```
---

Cobertura: [A] analisados, [G] ignorados por regra ([motivo n, …]), [U] não alcançados ([lista] | nenhum)
Limites: tipos não verificados (sem typecheck); importadores fora da diff e do espelho de arquivos removidos não verificados[; contexto truncado: <o que ficou de fora>]
```

3g. Substituir o parágrafo que começa com `**Empty sections are omitted**` por:

```
**Empty sections are omitted**, but the header (verdict, counters, PR line, IMPORT-CHECK line) and the closing `Cobertura` and `Limites` lines always appear. IMPORT-CHECK counts come from `fetch-context.mjs` after your self-validation (a finding you discarded is not counted); `N = B + R + I`, `ok` = zero findings. `Cobertura` copies the counts from `fetch-pr.mjs` (`Ignorados`, `Não alcançados`). `Limites` adds `contexto truncado: …` whenever `fetch-context.mjs` printed `fora do teto`, `Espelho truncado` or `Falhas de leitura`.
```

- [ ] **Step 4: Verificar resíduos**

Run: `grep -rn "TYPECHECK\|typecheck.md\|sub-agents\|workers\|git grep\|git show\|ls-tree\|HEAD\b" references/`
Expected: nenhuma saída, exceto ocorrências de `no typecheck runs` / `sem typecheck`.

- [ ] **Step 5: Commit**

```bash
git add references/analyze.md references/standards.md references/report.md
git commit -m "feat(skill): análise em duas passadas, autovalidação e relatório com cobertura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Remover TSC, workers e o teste antigo; README, SPEC e versão

**Files:**
- Delete: `references/typecheck.md`, `references/sub-agents.md`, `tests/check-recipes.js`, `tests/expected-review.md`
- Modify: `README.md` (substituir inteiro), `SPEC.md`, `.skill-meta.json`

- [ ] **Step 1: Remover arquivos**

Run: `git rm references/typecheck.md references/sub-agents.md tests/check-recipes.js tests/expected-review.md`

- [ ] **Step 2: Substituir `README.md` por:**

````markdown
# diffs-reviewer

**Review de PR do GitHub a partir do link, somente leitura.**

---

Skill que revisa uma PR do GitHub pelo link. Coleta tudo via `gh` com dois scripts Node e **nunca age na PR**: não comenta, não envia review, não altera nada — mesmo que você peça durante a review.

No final: **veredito** + relatório com comentários **RC** prontos para colar na PR.

```mermaid
flowchart LR
    LINK["link da PR"] --> A["① FETCH<br/>fetch-pr.mjs"]
    A --> B["② PASSADA 1<br/>só a diff"]
    B --> C["③ CONTEXTO<br/>fetch-context.mjs"]
    C --> D["④ PASSADA 2<br/>contexto + autovalidação"]
    D --> E["⑤ VERDICT + REPORT"]
    E --> OUT["Veredito + RC"]
```

Progresso: `[Fase 1/5]` … `[Fase 5/5]`

---

## O que faz

| Fase | Função |
|------|--------|
| **FETCH** | `fetch-pr.mjs`: metadados, intent (body da PR), diff por arquivo, árvore do repo, exclusões fixas, escopo. PR fechada/mergeada/draft → para e pede confirmação |
| **PASSADA 1** | Só a diff: lógica, intenção, segurança, tipos evidentes |
| **CONTEXTO** | `fetch-context.mjs`: até 10 arquivos pedidos, docs de padrões, espelho do módulo, **IMPORT-CHECK** determinístico |
| **PASSADA 2** | Padrões, over-engineering com evidência, rastreio de contexto, **autovalidação** de cada achado |
| **VERDICT + REPORT** | Veredito, RC em todo achado, linhas de Cobertura e Limites |

---

## Requisitos

- [GitHub CLI](https://cli.github.com/) ≥ 2.48, autenticado (`gh auth login`) com acesso de leitura ao repo da PR
- Node ≥ 18

## Instalar

```bash
git clone https://github.com/cardosoGu/diffs-reviewer.git ~/.cursor/skills/diffs-reviewer
```

Windows: `$env:USERPROFILE\.cursor\skills\diffs-reviewer`

Invocação **manual** — não roda sozinha. Não precisa ter o repo da PR aberto.

---

## Usar

```
/diffs-reviewer https://github.com/<owner>/<repo>/pull/<n>
```

Também: `revisar PR <link>` · `revisar só segurança <link>` · `revisar padrões <link>`

---

## Segurança

- O modelo só roda os dois scripts e lê os arquivos que eles gravam numa pasta temporária.
- Os scripts só chamam `gh pr view`, `gh pr diff` e `gh api` com GET em três endpoints (arquivos da PR, árvore, conteúdo de arquivo). Uma função única (`runGh`) recusa qualquer outro comando ou flag de escrita, com teste para cada caso.
- Nada é escrito fora de `<tmp>/diffs-reviewer/<owner>__<repo>__pr-<n>`.

---

## Output

### Veredito

| | Resultado | Quando |
|---|---|---|
| ✅ | **Aprovado** | 0 bloqueantes, 0 ressalvas |
| ⚠️ | **Aprovado com ressalvas** | 0 bloqueantes, 1+ ressalvas |
| ❌ | **Reprovado** | 1+ bloqueantes |

### RC

```
RC: Parece que [observação concreta], poderia verificar por favor?
```

Todo achado traz **RC** pronto. Idioma segue a conversa. O relatório termina com:

```
Cobertura: 12 analisados, 30 ignorados por regra (i18n 20, docs 10), 0 não alcançados
Limites: tipos não verificados (sem typecheck); importadores fora da diff e do espelho de arquivos removidos não verificados
```

---

## O que analisa

| Eixo | Detecta |
|------|---------|
| **IMPORT-CHECK** | Caminho inexistente, export nomeado inexistente, arquivo removido ainda importado, pacote não declarado *(sempre, determinístico)* |
| **Lógica** | Condições erradas, null unsafe, race, validação bypassável, divergência com a intenção da PR |
| **Segurança** | Injection, XSS, secrets, auth ausente, assinatura de webhook |
| **Padrões** | `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.cursor/rules/`, convenções do módulo |
| **Over-engineering** | Abstração morta, plugin duplicado, middle man — com evidência *(sempre)* |

Não roda typecheck nem linter: erros de tipo só quando evidentes na leitura (aparece em `Limites`).

---

## Escopo

| Escopo | PR | Efeito |
|--------|-----|--------|
| **Small** | ≤3 arquivos, ≤100 linhas | STANDARDS leve |
| **Medium** | entre Small e Large | — |
| **Large** | 11+ ou >500 linhas | inferência de padrões em até 6 módulos |

Sempre agente único; linhas contadas só nos arquivos que não foram ignorados.

---

## Testes

```bash
node --test "tests/*.test.mjs"
```

Sem rede: o `gh` é substituído por respostas simuladas. Cobrem a allowlist (inclusive cada ação proibida), parsing de diff, exclusões, extração e resolução de imports, exports e os dois scripts de ponta a ponta.

---

## Changelog

- **2.0.0** — review de PR pelo link, coleta via `gh` em dois scripts Node (2 turnos, chamadas em paralelo), IMPORT-CHECK portado para JS, análise em duas passadas com autovalidação, relatório com Cobertura e Limites. Proibida qualquer ação na PR, com allowlist no código. Removidos: TYPECHECK, workers, fluxo `git fetch`/`git diff`, `base=`.
- **1.2.0** — menos tokens e menos comandos: IMPORT-CHECK em lote, TYPECHECK só sob pedido, workers só em PRs muito grandes, teste de regressão `tests/check-recipes.js`.
- **1.1.1** — greps de símbolo seguros para nomes com `$`; `export type { } from` coberto no IMPORT-CHECK.
- **1.1.0** — IMPORT-CHECK determinístico; TYPECHECK opt-in; over-engineering com verificação ativa.
- **1.0.0** — versão inicial.

---

Feito por **cardosoGu**
````

- [ ] **Step 3: Editar `SPEC.md`**

3a. Trocar o título `# Spec: diffs-reviewer v1.2` por `# Spec: diffs-reviewer v2.0`.

3b. Inserir logo antes de `## Decisions Log`:

```markdown
## v2.0 changes

Design completo: `docs/superpowers/specs/2026-11-12-diffs-reviewer-v2-design.md`.

- **Entrada por link da PR**; coleta 100% via `gh` (sem repo local, checkout ou `git fetch`).
- **Dois scripts Node** (`scripts/fetch-pr.mjs`, `scripts/fetch-context.mjs`) fazem a coleta em 2 turnos, em paralelo; o modelo só analisa.
- **Somente leitura reforçado**: nenhuma ação na PR, mesmo a pedido; `runGh` aplica allowlist fechada com teste para cada caso proibido.
- **IMPORT-CHECK** portado para JS dentro de `fetch-context.mjs`; Step D limitado à diff + espelho do módulo.
- **Removidos**: TYPECHECK, workers, `base=`, review pré-PR.
- **Análise** em duas passadas (só diff, depois com contexto) + autovalidação obrigatória.
- **Relatório** com linhas fixas de Cobertura e Limites.
```

3c. Acrescentar ao fim da tabela do Decisions Log:

```
| Fonte da diff | `gh` a partir do link da PR (substitui `git diff base...HEAD`) | v2.0 |
| gh | Adotado, só leitura, allowlist fechada no código (substitui "descartado") | v2.0 |
| Coleta | Scripts Node, 2 turnos, chamadas em paralelo | v2.0 |
| TYPECHECK | Removido | v2.0 |
| ANALYZE workers | Removidos; agente único em duas passadas | v2.0 |
| PR fechada/mergeada/draft | Para e pede confirmação (`--force`) | v2.0 |
| Ações na PR | Proibidas, mesmo a pedido do usuário | v2.0 |
```

3d. Nas seções `## Canonical Rules`, `## File Structure` e `## Testing Checklist`, substituir toda menção a `git diff`, `git fetch`, `fetch-diff.md`, `typecheck.md`, `sub-agents.md`, `check-recipes.js` e workers pelos equivalentes v2 (`fetch-pr.mjs`, `fetch-context.mjs`, `references/fetch.md`, `node --test "tests/*.test.mjs"`). Conferir com:

Run: `grep -n "git diff\|git fetch\|fetch-diff\|typecheck.md\|sub-agents\|check-recipes" SPEC.md`
Expected: só ocorrências dentro das seções históricas `v1.1 changes`, `v1.2 changes` e das linhas v1/v1.1/v1.2 do Decisions Log.

- [ ] **Step 4: Versão**

Substituir o conteúdo de `.skill-meta.json` por:

```json
{
  "author": "cardo",
  "version": "2.0.0",
  "structure": "modular-phases-scripts",
  "updatedAt": "2026-11-12"
}
```

- [ ] **Step 5: Suíte e resíduos**

Run: `node --test "tests/*.test.mjs"` → `# pass 45`, `# fail 0`.
Run: `grep -rln "typecheck.md\|sub-agents.md\|fetch-diff.md\|check-recipes" --include=*.md . | grep -v "^./docs/\|SPEC.md"` → nenhuma saída.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat!: diffs-reviewer 2.0 — remove TSC, workers e fluxo git local

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Sincronizar a cópia instalada em `~/.claude/skills/diffs-reviewer`

**Files:** cópia fora do repo (`C:\Users\cardo\.claude\skills\diffs-reviewer`). **Pedir confirmação ao usuário antes**: a pasta será sobrescrita.

- [ ] **Step 1: Ver o que existe lá**

Run: `ls -R ~/.claude/skills/diffs-reviewer`

- [ ] **Step 2: Substituir pela versão nova (após o "sim")**

```bash
DEST=~/.claude/skills/diffs-reviewer
rm -rf "$DEST/references" "$DEST/tests" "$DEST/scripts"
cp -r SKILL.md README.md SPEC.md .skill-meta.json references scripts tests "$DEST/"
```

- [ ] **Step 3: Verificar**

Run: `cd ~/.claude/skills/diffs-reviewer && node --test "tests/*.test.mjs"`
Expected: `# pass 45`, `# fail 0`.
