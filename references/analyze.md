# ANALYZE — Code Review



**Goal:** Review **every** file in the diff for broken imports, type errors, logic bugs, security issues, standards violations, and over-engineering. IMPORT-CHECK (§0) is deterministic and always on; manual analysis is primary; TYPECHECK (§1) is opt-in.



**Completion criterion:** Every filtered file reviewed; each finding has file:line, snippet, impact, fix, and RC draft.



**No early exit** — continue through all files even after blockers are found.



---



## Process



### 0. IMPORT-CHECK — deterministic import verification (always on)



Runs in **every scope**, by the orchestrator, before the per-file review. Uses only read-only git at `HEAD` (no checkout, no project tooling). `<ref>` comes from FETCH.



Recipes are written for bash / Git Bash and use `git grep -P` / `grep -P` with `\x27` (single quote) and `\x22` (double quote) so the patterns contain no quote characters. Under PowerShell, run the git commands directly (they work as written) and run the `| grep` filter via `bash -c` or replace it with `Select-String`.



**Input:** added lines of JS/TS files in the diff, plus deleted/renamed files from `git diff <ref>...HEAD --name-status -M`.



**Governing rule:** only a deterministic, confirmed miss is **Bloqueante**. A grep miss that could be a recipe limitation, or any ambiguous resolution, is `[Incerto]`.



#### Step A — Extract specifiers from added lines



```bash

git diff <ref>...HEAD -U0 --no-color -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' | grep -P '^\+([^+].*)?(from\s*[\x27\x22]|import\s*[\x27\x22]|require\(|import\()'

```



This keeps added lines (a single leading `+`, so `+++ b/file` headers are excluded) containing `from "x"`, `import "x"` (side-effect imports), `export … from "x"`, `require("x")`, `import("x")`. To get file:line, run the diff without the grep (or per file): the `+++ b/<path>` header gives the file and the `@@ -a,b +c,d @@` header gives the start line `c`; with `-U0` each hunk contains only added/removed lines, so the first `+` line after the header is line `c`, and each following `+` line is `c+1`, `c+2`, … (do not count `-` lines). Strip `?query` / `#hash` suffixes (`?raw`, `?url`) from specifiers. Skip external packages (specifier without leading `.`/`/` and not matching a tsconfig alias; follow the tsconfig `extends` chain, also `jsconfig.json`) — they go to Step E. Specifiers that are not valid npm package names (`@/`, `~/`, `#`) are aliases: if unresolved → `[Incerto]`, never Step E.



Multi-line imports: a `+` line like `} from "x"` has its names on other lines. Resolve the path normally; the names are on the other `+` lines of the same hunk: read the hunk to get them (report the name's own line). `[Incerto]` only if the names are on unchanged context lines.



#### Step B — Resolve paths against HEAD



Relative specifiers resolve against the **importing file's directory**, with `./` and `../` normalized (not against the repo root). Aliases come from the nearest tsconfig (`git show HEAD:<tsconfig>` → `paths`/`baseUrl`); follow the tsconfig `extends` chain (also `jsconfig.json`). Build the file list once and reuse it:



```bash

git ls-tree -r --name-only HEAD

```



For a normalized path `P` (no `?query`), test in this order against the list:



1. the literal path `P` (the specifier may already carry an extension: `./style.css`, `./logo.svg`, `./data.json`, `./x.js`);

2. `P.ts|.tsx|.mts|.cts|.d.ts|.d.mts|.d.cts|.js|.jsx|.mjs|.cjs|.json|.vue|.svelte|.astro`, then `P/index.ts|.tsx|.js|.jsx`;

3. ESM convention — if `P` ends in `.js|.jsx|.mjs|.cjs`, strip it to `P0` and test `P0.ts|.tsx|.d.ts` (`.mjs` → `.mts|.d.mts`; `.cjs` → `.cts|.d.cts`):



```bash

git ls-tree -r --name-only HEAD | grep -xE -e 'P0\.(ts|tsx|d\.ts)'

```



One command covers 1 and 2 (escape regex metacharacters in `P`, e.g. `.` → `\.`):



```bash

git ls-tree -r --name-only HEAD | grep -xE -e 'P' -e 'P\.(d\.ts|d\.mts|d\.cts|ts|tsx|mts|cts|js|jsx|mjs|cjs|json|vue|svelte|astro)' -e 'P/index\.(ts|tsx|js|jsx)'

```



If nothing matches and rule 3 fails, apply a final net: list the directory of the normalized path and look for any entry with the same stem (any other extension, or a directory). `<dir>` = `P` minus its last segment; `<stem>` = the last path segment with any `.js|.jsx|.mjs|.cjs` stripped:



```bash

git ls-tree --name-only HEAD <dir>/ | grep -E '^<dir>/<stem>(\.|/|$)'

```



If `<dir>` is empty (repo root), run instead:



```bash

git ls-tree --name-only HEAD | grep -E '^<stem>(\.|/|$)'

```



Any output → `[Incerto]` (an unlisted extension or loader). If `P` or an ancestor directory is matched by a `.gitignore` at HEAD (`git show HEAD:<dir>/.gitignore`, for the root and each ancestor directory), or the path contains `generated`, `__generated__` or `.gen.` → `[Incerto]`. **Bloqueante only when no entry with that stem exists in the directory** and the specifier is a plain relative path. A bundler-specific scheme or an alias not defined in tsconfig → `[Incerto]`.



#### Step C — Named exports



For `import { A, B } from "./local"` (also `import type { A }` / `import { type A }`), confirm each name is exported by the resolved file. For `import { A as B }`, check the **original** name `A`. Replace `A` with the name:



```bash

git grep -nP 'export +((declare|abstract|async|const) +)*(const|let|var|function|class|type|interface|enum|namespace|module) *\*? *(?<![\w$])A(?![\w$])|export *(type +)?\{[^}]*(?<![\w$])A(?![\w$])' HEAD -- <resolved-file>

```



**C1** covers `export const|let|var|function|function*|async function|class|abstract class|declare …|const enum|type|interface|enum|namespace|module` and single-line `export { A }` / `export type { A }` / `export { X as A }`. `export default` covers default imports. Names are bounded with `(?<![\w$])A(?![\w$])` instead of `\b`, so identifiers containing `$` (`$store`, `jQuery$`) match; escape `$` in the name as `\$`. A C1 hit on a re-export line (`export { A } from "./x"`, `export type { A } from "./x"`) counts as exported; the re-exported source is resolved by Step B only if that line is in the diff.



If C1 finds nothing, run the safety nets **C2** (constructs the recipe cannot follow) and **C3** (any `export` line mentioning the name):



```bash

git grep -nE 'export *\*|export *(type +)?\{[^}]*$|export *(type +)?\{[^}]*\} *from|module\.exports|exports\.' HEAD -- <resolved-file>

```



```bash

git grep -nP 'export.*(?<![\w$])A(?![\w$])' HEAD -- <resolved-file>

```



On a C2/C3 hit (`export *`, a multi-line `export {`, a re-export, CommonJS exports, e.g. `export const { A } = o`, `export import A = …`), read the file with `git show HEAD:<file>` and decide; `[Incerto]` only if it is still ambiguous (`export *` chains, dynamic CommonJS). **Bloqueante only if C1, C2 and C3 all miss.**



#### Step D — Reverse check (deleted/renamed files)



For each `D`/`R` entry (old path), find remaining importers at `HEAD`. `<stem>` is the file name without extension, regex-escaped (`.` → `\.`). When the file is `dir/index.<ext>`, use `<dir>(/index)?` as the stem so imports of the directory (`"./dir"`) are found too:



```bash

git grep -nP '[\x27\x22][^\x27\x22]*/<stem>(\.[a-z]+)?[\x27\x22]' HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs'

```



Resolve each hit against the importing file's directory; if it points to the old path, it is a finding (list every importer). Importers deleted in the same diff do not appear at `HEAD`.



#### Step E — New external packages



For external specifiers added by the diff, extract the package name: `@scope/pkg/sub` → `@scope/pkg`, `lodash/fp` → `lodash`. **Skip Node builtins entirely (not findings):** `node:*`, `fs`, `path`, `os`, `crypto`, `url`, `util`, `events`, `stream`, `child_process`, `http`, `https`, `zlib`, `buffer`, `assert`, `querystring`, `readline`, `net`, `tls`, `dns`, `worker_threads`, `perf_hooks`, `process`, `module`, `timers`, `v8`, `vm`.



Find the nearest `package.json` — those in ancestor directories of the importing file, plus the workspace root:



```bash

git ls-tree -r --name-only HEAD | grep -E '(^|/)package\.json$'

```



Check the package in dependencies, devDependencies, peerDependencies (and the workspace root):



```bash

git show HEAD:<package.json-path> | grep -P '\x22<package-name>\x22'

```



Absent → finding (`[Incerto]` if the package may be provided by the workspace/runtime).



#### Classification and evidence



| Result | Severity |

| ------ | -------- |

| Relative/alias path does not resolve and no same-stem entry exists in the directory (Step B net) | **Bloqueante** |

| Named export does not exist in resolved file (C1, C2 and C3 all miss) | **Bloqueante** |

| Deleted/renamed file still imported | **Bloqueante** (list all importers) |

| External package not declared | **Ressalva** (`[Incerto]` when plausibly provided elsewhere) |

| Ambiguous resolution (`export *` chains, multi-line exports, exotic `paths`, bundler schemes, generated files matching `.gitignore`) | `[Incerto]` → **Sugestão** |



Each IMPORT-CHECK finding follows the Finding Quality Rules (file:line, snippet, impact, fix, RC draft) plus the verification evidence, e.g. "`./missing` não existe em HEAD; testados: `.ts .tsx .js .jsx .mjs .cjs .json`, `/index.*`".



Report the status line once: `IMPORT-CHECK: ok` or `IMPORT-CHECK: <N> achados (<B> bloqueantes, <R> ressalvas, <I> incertos)`. Count **after dedup**: one finding per import statement (all missing names of one `import` = 1 finding) and one per orphan importer line; `N = B + R + I`. `ok` means zero findings of any kind.



---





### 1. TYPECHECK — detect and run project typecheck



**Opt-in.** TYPECHECK does **not** run by default (it is slow on heavy repos and IMPORT-CHECK §0 already catches the build-breaking import class). Run it **only** when the user explicitly asks (e.g. "rodar typecheck", "run typecheck"). Language-agnostic detection; **v1 implements TypeScript fully** — other stacks skip with a note (see SPEC roadmap).

**When requested:** run in the **background** with a **120s timeout**. If it exceeds the timeout, kill it, continue the review, and report `TYPECHECK: timeout` (not a finding).



#### Priority (3 levels)



| Level | When | Action |

| ----- | ---- | ------ |

| **1 — Project script** | `package.json` has a typecheck script | Run it in each affected package |

| **2 — Stack fallback** | TS project, no script | `tsc -p` (single package) or `tsc -b` (monorepo package) |

| **3 — Skip** | Nothing detected | Note once; continue with manual §2.1 |



#### Hard rules



- **Never** `tsc --noEmit -- file1 file2` — TypeScript ignores tsconfig (paths, strict, references) → false negatives

- **Never** full-repo `tsc --noEmit` at monorepo root as default

- **Never** `npm run build` as automatic fallback — slow, may write artifacts, not guaranteed to catch types

- **Never** install tools or create/edit files in the repo under review

- **Do not run ESLint**

- **Never** run TYPECHECK unless the user asked for it



#### Step A — Map diff files to packages



1. For each file in the filtered diff list, find the nearest package root (directory containing `package.json` or `tsconfig.json`)

2. Deduplicate affected packages



#### Step B — Level 1: project script (preferred)



In each affected package (or repo root if single-package), read `package.json` scripts. Use the **first match** in order:



```

typecheck → check:types → check-types → validate:types → tsc

```



Detect package manager from lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, else npm) and run:



```bash

<pm> run <script>   # from package directory

```



If root script typechecks the whole workspace and all diff files belong to it, root is sufficient.



#### Step C — Level 2: TypeScript fallback



When no script matches but `tsconfig.json` exists:



**Single package / app:**



```bash

npx tsc -p <path/to/tsconfig.json> --noEmit --pretty false

```



Use the tsconfig nearest to the changed files.



**Monorepo** (package has `composite: true`, or root tsconfig has `references`):



```bash

npx tsc -b <path/to/package> --pretty false

```



Run **only for packages containing diff files**. One invocation per affected package.



Note: `--noEmit` is incompatible with `tsc -b`. Build mode uses incremental `.tsbuildinfo` — faster and correct with project references.



**Diff-scoped tools (only if already in repo):**



If `tsc-files`, `typecheck-files`, or similar appears in `devDependencies` or scripts — invoke with diff file list. **Do not install** if missing.



#### Step D — Level 3: skip



If no script and no tsconfig for affected packages:



```

TYPECHECK: skipped — no typecheck script or tsconfig detected

```



Continue with manual typing review (§2.1).



#### Execution mode



| Condition | Behavior |

| --------- | -------- |

| User did not ask | Do not run. Report `TYPECHECK: não solicitado` |

| User asked | Run in background, 120s timeout, via orchestrator (or TYPECHECK worker if delegation is available — see [sub-agents.md](sub-agents.md)) |

| Timeout | Report `TYPECHECK: timeout`; review continues |

| Errors found | Report `TYPECHECK: <N> erros` (each error is also a finding) |

| Config broken (could not run: tsconfig missing/unparsable, or only TS5xxx/TS6xxx option errors) | Report `TYPECHECK: falhou (config)` (not a finding); review continues |

| Several packages, mixed results | Combine per package, e.g. `TYPECHECK: 3 erros; falhou (config) em packages/api` — a config failure in one package never hides errors found in another |

| Nothing detected (Level 3) | Report `TYPECHECK: skipped` |

| Completed, no errors | Report `TYPECHECK: ok` |



Merge TYPECHECK findings with manual typing review (§2.1).



---



### 2. Per-file manual review



For each file in the filtered diff list, read the hunk(s) and surrounding context. Cross-reference the standards snapshot from STANDARDS phase.



#### 2.1 Typing (manual + TYPECHECK)



- Types incompatible with usage

- Missing required props (React/components)

- Incorrect function signatures

- Unsafe casts hiding real errors (`as any`, `@ts-ignore` without justification)

- Imports referencing symbols/paths that do not exist



#### 2.2 Logic and business rules



- Inverted or missing conditions (`if (x = 5)` vs `===`)

- Null/undefined accessed without guard

- Off-by-one, wrong operator, dead branches

- Bypassable validation

- Inconsistent state updates

- Race conditions (async without await, shared mutable state)

- Side effects inside ternary or pure-looking functions



#### 2.3 Security



- SQL/command injection (string concatenation in queries/shell)

- XSS (unsanitized user input in HTML/DOM)

- Hardcoded secrets (API keys, passwords, tokens)

- Empty catch blocks swallowing errors silently

- Missing authorization checks on sensitive operations

- Dangerous APIs (`eval`, `Function`, unsafe deserialization)

- Path traversal in file operations



#### 2.4 Standards (from STANDARDS phase)



- Documented rule violations

- Inferred convention mismatches (apply verdict rules from standards.md)



#### 2.5 Context tracing (when relevant)



For API/handler changes, trace flow when impact is unclear:



```

route/endpoint → controller/handler → service → repository/data layer

```



Read imported modules only as needed — do not load unrelated areas.



#### 2.6 Over-engineering (mandatory — every file)


Run the checklist on every file. **Each signal requires its verification** — even when the conclusion is "nothing found".


| Signal | Como confirmar (cheap) | Evidência exigida |

| ------ | ---------------------- | ----------------- |

| Speculative generality | `git grep -nP '(?<![\w$])<Symbol>(?![\w$])' HEAD -- <module>`; count uses outside the definition | usage count and where |

| Duplicated infrastructure | Read the base class / parent schema / middleware chain of the file and check whether it already applies the same plugin, helper or hook | quoted snippet of the base that already covers it |

| Middle man | Read the body: only delegates, no logic, no error handling, no transformation | summarized body |

| Unnecessary wrapper / Premature abstraction | Count implementations and call sites of the Factory/Builder/Strategy (`git grep` for `implements`, `extends`, usages) | number of implementations (1 confirms) |

| Future-only config | `git grep` the flag/param; check if any call site passes a non-default value | call sites found |

| Dead code in diff | `git grep -nP '(?<![\w$])<newExport>(?![\w$])' HEAD`; zero references outside its own file and tests. Exclude convention or entry exports: default/framework exports of page, route or config files, files referenced by `package.json` `main`/`exports`/`bin`, ambient `.d.ts`, and exports of files that are themselves new and unreferenced (report the file once). Uncertain → `[Incerto]`. | grep result |


Symbol greps bound names with `(?<![\w$])…(?![\w$])` (not `\b`), so names containing `$` match; escape `$` as `\$`. A zero result from a `\b` grep on a `$` name is not evidence.

**Sem evidência, sem achado.** A signal without confirmation is not reported. With a strong hint but incomplete confirmation, report as `[Incerto]` (→ Sugestão per verdict.md). The evidence goes into the finding and into the RC.


**Orçamento.** At most one verification per candidate symbol; scope greps to the file's module/package; repo-wide only for public exports. No cross-file second pass in this version.


Classify severity per [verdict.md](verdict.md) over-engineering table. Always include RC.


**Examples:**


- Plugin `aggregatePaginate` applied again on schema that extends `baseSchema`, and the base snippet already applies it (quoted) → **Ressalva**

- New export `neverUsed` with 0 references at `HEAD` (grep result cited) → **Ressalva**

- New service layer wrapping a single direct call (body summarized) → **Sugestão** or **Ressalva**



---



## Finding Quality Rules



Each finding must include:



- **File and line** (from diff or read tool)

- **Code snippet** showing the issue

- **Why it matters** (impact, not preference)

- **Suggested fix** (concrete, minimal)

- **RC draft** — PR-ready comment per [report.md](report.md) (refine in REPORT phase)



If uncertain: prefix finding with `[Incerto]` and RC uses "Parece que…" / "It looks like…" with "poderia confirmar…?" / "could you confirm…?"



**Do not report:**



- Hypothetical edge cases with no plausible trigger

- Style/naming as blockers

- Pre-existing type errors outside the diff (unless TYPECHECK surfaced them in changed packages)

- Lock file or dependency-only changes (already filtered)

- Over-engineering as **Bloqueante** unless functional/security impact is clear



---



## Progress Message



Emit once when ANALYZE starts and once when complete:



```

[Fase 3/5] ANALYZE — revisando <N> arquivos...

```



```

[Fase 3/5] ANALYZE — concluído (<B> bloqueantes candidatos, <R> ressalvas candidatas)

```



Do not emit per-file progress — phases only.


