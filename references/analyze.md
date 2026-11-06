# ANALYZE — Code Review

**Goal:** Review **every** file in the diff for broken imports, type errors, logic bugs, security issues, standards violations, and over-engineering. IMPORT-CHECK (§0) is deterministic and always on; manual analysis (§2) is primary; TYPECHECK is opt-in ([typecheck.md](typecheck.md), loaded only on request).

**Completion criterion:** Every filtered file reviewed; each finding has file:line, snippet, impact, fix, and RC draft.

**No early exit** — continue through all files even after blockers are found.

---

## 0. IMPORT-CHECK — deterministic import verification (always on)

Runs in **every scope**, by the orchestrator (never delegated to workers), before the per-file review. Read-only git at `HEAD` only (no checkout, no project tooling). `<ref>` comes from FETCH.

**Batch, don't loop.** Every step below is **one command for the whole PR** (alternatives joined with `-e` or `(A|B|C)`), not one per import. A typical review costs ~6 commands, whatever the number of imports.

**Never print the file list.** `git ls-tree -r` is always piped into a filter; its unfiltered output can be tens of thousands of lines in a monorepo.

**Shells.** Recipes use `git grep -P` / `grep -P` with `\x27` (single quote) and `\x22` (double quote), so patterns contain no quote characters and run as written in bash, Git Bash and PowerShell. PowerShell has no `grep`: replace `| grep -xE -e 'X' -e 'Y'` with `| Select-String -CaseSensitive -Pattern '^(X|Y)$'` (and `| grep -E` with `| Select-String -CaseSensitive -Pattern`).

**Input:** added lines of JS/TS files in the filtered diff, plus deleted/renamed files from FETCH (`--name-status -M`).

**Governing rule:** only a deterministic, confirmed miss is **Bloqueante**. A miss that could be a recipe limitation, or any ambiguous resolution, is `[Incerto]`.

### Step A — Extract specifiers from added lines (1 command)

```bash
git diff <ref>...HEAD -U0 --no-color -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' | grep -P '^(\+\+\+ |@@ |\+([^+].*)?(from\s*[\x27\x22]|import\s*[\x27\x22]|require\(|import\())'
```

Keeps file headers (`+++ b/<path>`), hunk headers (`@@ -a,b +c,d @@`) and added lines with `from "x"`, `import "x"` (side-effect), `export … from "x"`, `require("x")`, `import("x")`. Line numbers: with `-U0` the first `+` line after `@@ … +c,d @@` is line `c`, the next `c+1`, … (do not count `-` lines). The grep drops non-import added lines, so when a hunk has other added lines before the import, read that hunk to get the exact line.

- Strip `?query` / `#hash` suffixes (`?raw`, `?url`).
- External packages (no leading `.`/`/`, not a tsconfig alias — follow the tsconfig `extends` chain, also `jsconfig.json`) → Step E.
- Specifiers that are not valid npm names (`@/`, `~/`, `#`) are aliases: unresolved → `[Incerto]`, never Step E.
- Multi-line imports: a `+` line like `} from "x"` has its names on other `+` lines of the same hunk — read the hunk (report the name's own line). `[Incerto]` only if the names are on unchanged context lines.

### Step B — Resolve paths against HEAD (1 command + 1 net)

Relative specifiers resolve against the **importing file's directory**, with `./` and `../` normalized (not the repo root). Aliases come from the nearest tsconfig (`git show HEAD:<tsconfig>` → `paths`/`baseUrl`, following `extends`). Escape regex metacharacters in each normalized path `P` (`.` → `\.`).

One `-e` per specifier, all in a single command:

```bash
git ls-tree -r --name-only HEAD | grep -xE -e '<P1>(\.(d\.ts|d\.mts|d\.cts|ts|tsx|mts|cts|js|jsx|mjs|cjs|json|vue|svelte|astro)|/index\.(ts|tsx|js|jsx))?' -e '<P2>(…same suffix…)?' -e '<P0>\.(ts|tsx|d\.ts)'
```

- The bare `P` covers specifiers that already carry an extension (`./style.css`, `./logo.svg`, `./data.json`, `./x.js`).
- **ESM convention:** if `P` ends in `.js|.jsx|.mjs|.cjs`, also add `-e '<P0>\.(ts|tsx|d\.ts)'` with the extension stripped (`.mjs` → `.mts|.d.mts`; `.cjs` → `.cts|.d.cts`).
- Each specifier with **no output line** is a candidate miss.

**Net for candidate misses** (one command for all of them). `<dir>` = `P` minus its last segment; `<stem>` = the last segment with any `.js|.jsx|.mjs|.cjs` stripped; at the repo root drop `<dir>/`:

```bash
git ls-tree -r --name-only HEAD | grep -E -e '^<dir>/<stem>(\.|/|$)' -e '^<stem2>(\.|/|$)'
```

Any output for a specifier → `[Incerto]` (unlisted extension or loader). Also `[Incerto]`: `P` or an ancestor matched by a `.gitignore` at HEAD (`git show HEAD:<dir>/.gitignore`), a path containing `generated`, `__generated__` or `.gen.`, a bundler-specific scheme, or an alias not defined in tsconfig. **Bloqueante only when the net is empty** for a plain relative path.

### Step C — Named exports (1 command + nets on misses)

For `import { A, B } from "./local"` (also `import type { A }` / `import { type A }`), confirm each name is exported by its resolved file; for `import { A as B }` check the **original** `A`. One command for all resolved files, with the union of names:

```bash
git grep -nP 'export +((declare|abstract|async|const) +)*(const|let|var|function|class|type|interface|enum|namespace|module) *\*? *(?<![\w$])(A|B|C)(?![\w$])|export *(type +)?\{[^}]*(?<![\w$])(A|B|C)(?![\w$])|export +default(?![\w$])' HEAD -- <resolved-file-1> <resolved-file-2>
```

**C1** covers `export const|let|var|function|function*|async function|class|abstract class|declare …|const enum|type|interface|enum|namespace|module`, single-line `export { A }` / `export type { A }` / `export { X as A }`, and `export default` (for default imports). Then decide **per (file, name) pair**: the name is exported when an output line **of that file** declares it, or is a brace list containing it as the exported name (in `X as Y` the exported name is `Y`). A hit on a re-export line (`export { A } from "./x"`) counts as exported.

Names are bounded with `(?<![\w$])…(?![\w$])` instead of `\b`, so identifiers with `$` (`$store`, `jQuery$`) match; escape `$` as `\$`.

For pairs C1 did not confirm, run the safety nets once, only on the files with misses — **C2** (constructs the recipe cannot follow) and **C3** (any `export` line mentioning the names):

```bash
git grep -nE 'export *\*|export *(type +)?\{[^}]*$|export *(type +)?\{[^}]*\} *from|module\.exports|exports\.' HEAD -- <files-with-misses>
```

```bash
git grep -nP 'export.*(?<![\w$])(A|B)(?![\w$])' HEAD -- <files-with-misses>
```

On a C2/C3 hit (`export *`, multi-line `export {`, re-export, CommonJS, `export const { A } = o`, `export import A = …`), read the file (`git show HEAD:<file>`) and decide; `[Incerto]` only if still ambiguous (`export *` chains, dynamic CommonJS). **Bloqueante only if C1, C2 and C3 all miss.**

### Step D — Reverse check for deleted/renamed files (1 command)

For the `D`/`R` entries (old paths), find remaining importers at `HEAD`. `<stem>` = file name without extension, regex-escaped; for `dir/index.<ext>` use `<dir>(/index)?` so directory imports (`"./dir"`) are found too. All stems in one alternation:

```bash
git grep -nP '[\x27\x22][^\x27\x22]*/(<stem1>|<stem2>)(\.[a-z]+)?[\x27\x22]' HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs'
```

Resolve each hit against the importing file's directory; if it points to an old path, it is a finding (list every importer — they may be outside the diff). Importers deleted in the same diff do not appear at `HEAD`.

### Step E — New external packages (1 command)

Package name: `@scope/pkg/sub` → `@scope/pkg`, `lodash/fp` → `lodash`. **Skip Node builtins (not findings):** `node:*`, `fs`, `path`, `os`, `crypto`, `url`, `util`, `events`, `stream`, `child_process`, `http`, `https`, `zlib`, `buffer`, `assert`, `querystring`, `readline`, `net`, `tls`, `dns`, `worker_threads`, `perf_hooks`, `process`, `module`, `timers`, `v8`, `vm`.

Candidate manifests: `package.json` in each ancestor directory of the importing files, plus the root. Search them all at once (paths that do not exist are simply not matched):

```bash
git grep -nP '\x22(<pkg1>|<pkg2>)\x22 *:' HEAD -- package.json <dir>/package.json <dir>/<sub>/package.json
```

A hit inside `dependencies`, `devDependencies` or `peerDependencies` of any candidate = declared. Absent → finding (`[Incerto]` if plausibly provided by the workspace/runtime).

### Classification and evidence

| Result | Severity |
| ------ | -------- |
| Relative/alias path does not resolve and the Step B net is empty | **Bloqueante** |
| Named export does not exist in the resolved file (C1, C2 and C3 all miss) | **Bloqueante** |
| Deleted/renamed file still imported | **Bloqueante** (list all importers) |
| External package not declared | **Ressalva** (`[Incerto]` when plausibly provided elsewhere) |
| Ambiguous resolution (`export *` chains, multi-line exports, exotic `paths`, bundler schemes, generated/ignored files) | `[Incerto]` → **Sugestão** |

Each finding follows the Finding Quality Rules plus its evidence, e.g. "`./missing` não existe em HEAD; testados: `.ts .tsx .js .jsx .mjs .cjs .json`, `/index.*`".

Status line: `IMPORT-CHECK: ok` or `IMPORT-CHECK: <N> achados (<B> bloqueantes, <R> ressalvas, <I> incertos)`. Count **after dedup** — one finding per import statement (all missing names of one `import` = 1) and one per orphan importer line; `N = B + R + I`. `ok` = zero findings of any kind.

---

## 1. TYPECHECK (opt-in)

Not part of a default review. Only if the user asked: read [typecheck.md](typecheck.md) right after FETCH and start it in the background. Otherwise report `TYPECHECK: não solicitado`.

---

## 2. Per-file manual review

For each file in the filtered diff list, read its hunk(s) and the surrounding context needed. Cross-reference the standards snapshot and the **PR intent** (commit messages from FETCH).

### 2.1 Typing (manual + TYPECHECK when run)

- Types incompatible with usage; missing required props (React/components)
- Incorrect function signatures
- Unsafe casts hiding real errors (`as any`, `@ts-ignore` without justification)

### 2.2 Logic and business rules

- Inverted or missing conditions (`if (x = 5)` vs `===`); off-by-one, wrong operator, dead branches
- Null/undefined accessed without guard
- Bypassable validation; inconsistent state updates
- Race conditions (async without await, shared mutable state)
- Side effects inside ternaries or pure-looking functions
- **Intent mismatch:** the code does not do what the commit messages state (e.g. "fix: only admins can delete" but the check is missing on one route). Report only with the concrete line that contradicts the stated intent; vague messages are not evidence.

### 2.3 Security

- SQL/command injection (string concatenation in queries/shell); XSS (unsanitized input in HTML/DOM)
- Hardcoded secrets (API keys, passwords, tokens)
- Empty catch blocks swallowing errors silently
- Missing authorization checks on sensitive operations
- Dangerous APIs (`eval`, `Function`, unsafe deserialization); path traversal in file operations

### 2.4 Standards (from STANDARDS)

- Documented rule violations
- Inferred convention mismatches (classification in standards.md)

### 2.5 Context tracing (when relevant)

For API/handler changes with unclear impact, trace `route/endpoint → controller/handler → service → repository/data layer`. Read imported modules only as needed — do not load unrelated areas.

### 2.6 Over-engineering (mandatory — every file)

Run the checklist on every file. **Each signal requires its verification** — even when the conclusion is "nothing found".

| Signal | Como confirmar (cheap) | Evidência exigida |
| ------ | ---------------------- | ----------------- |
| Speculative generality | `git grep -nP '(?<![\w$])(<S1>\|<S2>)(?![\w$])' HEAD -- <module>`; count uses outside the definition | usage count and where |
| Duplicated infrastructure | Read the base class / parent schema / middleware chain and check whether it already applies the same plugin, helper or hook | quoted snippet of the base that already covers it |
| Middle man | Read the body: only delegates, no logic, no error handling, no transformation | summarized body |
| Unnecessary wrapper / Premature abstraction | Count implementations and call sites of the Factory/Builder/Strategy (`git grep` for `implements`, `extends`, usages) | number of implementations (1 confirms) |
| Future-only config | `git grep` the flag/param; does any call site pass a non-default value? | call sites found |
| Dead code in diff | `git grep -nP '(?<![\w$])(<E1>\|<E2>)(?![\w$])' HEAD`; zero references outside its own file and tests | grep result |

(`\|` above is a table escape — the command uses a plain `|`.)

- **Batch the greps:** one command per module with all candidate symbols in the alternation, not one per symbol. Scope to the file's module/package; repo-wide only for public exports.
- **Dead code exclusions:** default/framework exports of page, route or config files; files referenced by `package.json` `main`/`exports`/`bin`; ambient `.d.ts`; exports of files that are themselves new and unreferenced (report the file once). Uncertain → `[Incerto]`.
- Bound names with `(?<![\w$])…(?![\w$])`, not `\b` (names with `$` must match; escape `$` as `\$`). A zero result from a `\b` grep on a `$` name is not evidence.

**Sem evidência, sem achado.** A signal without confirmation is not reported. Strong hint but incomplete confirmation → `[Incerto]` (→ Sugestão). The evidence goes into the finding and the RC. At most one verification per candidate symbol.

Classify per the over-engineering table in [report.md](report.md). Examples: plugin `aggregatePaginate` re-applied on a schema whose `baseSchema` already applies it (snippet quoted) → **Ressalva**; new export `neverUsed` with 0 references at `HEAD` (grep cited) → **Ressalva**; new service layer wrapping a single direct call → **Sugestão** or **Ressalva**.

---

## Finding Quality Rules

Each finding includes: **file and line**; **code snippet**; **why it matters** (impact, not preference); **suggested fix** (concrete, minimal); **RC draft** per [report.md](report.md).

If uncertain: prefix with `[Incerto]`; the RC uses "Parece que… poderia confirmar…?" / "It looks like… could you confirm…?".

**Do not report:** hypothetical edge cases with no plausible trigger; style/naming as blockers; pre-existing errors outside the diff; lock file or generated-only changes (filtered in FETCH); over-engineering as **Bloqueante** unless functional/security impact is clear.

---

## Progress Message

Emit once when ANALYZE starts and once when complete (phases only, never per file):

```
[Fase 3/5] ANALYZE — revisando <N> arquivos...
[Fase 3/5] ANALYZE — concluído (<B> bloqueantes candidatos, <R> ressalvas candidatas)
```
