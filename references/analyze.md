# ANALYZE — Code Review



**Goal:** Review **every** file in the diff for broken imports, type errors, logic bugs, security issues, standards violations, and over-engineering. IMPORT-CHECK (§0) is deterministic and always on; manual analysis is primary; TYPECHECK (§1) is opt-in.



**Completion criterion:** Every filtered file reviewed; each finding has file:line, snippet, impact, fix, and RC draft.



**No early exit** — continue through all files even after blockers are found.



---



## Process



### 0. IMPORT-CHECK — deterministic import verification (always on)



Runs in **every scope**, by the orchestrator, before the per-file review. Uses only read-only git at `HEAD` (no checkout, no project tooling). `<ref>` comes from FETCH.



**Input:** added lines of JS/TS files in the diff, plus deleted/renamed files from `git diff <ref>...HEAD --name-status -M`.



#### Step A — Extract specifiers from added lines



```bash

git diff <ref>...HEAD -U0 --no-color -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs'

```



Keep lines starting with a single `+` that match `from "x"`, `import "x"`, `export … from "x"`, `require("x")`, `import("x")`. Track file and line from the `@@ -a,b +c,d @@` hunk header. Skip external packages (specifier without leading `.`/`/` and not matching a tsconfig alias) — they go to Step E.



#### Step B — Resolve paths against HEAD



Relative specifiers, and aliases from the nearest tsconfig (`git show HEAD:<tsconfig>` → `paths`/`baseUrl`). Build the file list once and reuse it:



```bash

git ls-tree -r --name-only HEAD

```



A specifier `./x` resolves if the list contains `x.ts|.tsx|.js|.jsx|.mjs|.cjs|.json`, `x/index.ts|.tsx|.js|.jsx`, or — ESM convention — `./x.js` maps to `x.ts`/`x.tsx`. None found → finding.



#### Step C — Named exports



For `import { A, B } from "./local"`, confirm each name is exported by the resolved file:



```bash

git grep -nE 'export (const|let|var|function|class|type|interface|enum) A\b|export \{[^}]*\bA\b' HEAD -- <resolved-file>

```



`export default` covers default imports; `export * from` or any chained re-export that cannot be followed in one hop → mark `[Incerto]`, do not report as blocker.



#### Step D — Reverse check (deleted/renamed files)



For each `D`/`R` entry (old path), find remaining importers at `HEAD`:



```bash

git grep -nE "['\"][^'\"]*/<stem>(\.[a-z]+)?['\"]" HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs'

```



Resolve each hit; if it points to the old path, it is a finding (list every importer). Importers deleted in the same diff do not appear at `HEAD`.



#### Step E — New external packages



For external specifiers added by the diff, check the nearest `package.json` at `HEAD` (dependencies, devDependencies, peerDependencies; workspace root too):



```bash

git show HEAD:package.json

```



Absent → finding (`[Incerto]` if the package may be provided by the workspace/runtime, e.g. node builtins `node:*`, `fs`, `path`).



#### Classification and evidence



| Result | Severity |

| ------ | -------- |

| Relative/alias path does not resolve | **Bloqueante** |

| Named export does not exist in resolved file | **Bloqueante** |

| Deleted/renamed file still imported | **Bloqueante** (list all importers) |

| External package not declared | **Ressalva** (`[Incerto]` when plausibly provided elsewhere) |

| Ambiguous resolution (`export *` chains, exotic `paths`, generated files matching `.gitignore`) | `[Incerto]` → **Sugestão** |



Every finding must cite the import `file:line` and the verification result (e.g. "`./missing` não existe em HEAD; testados: `.ts .tsx .js .jsx .mjs .cjs .json`, `/index.*`").



Report the status line once: `IMPORT-CHECK: ok` or `IMPORT-CHECK: <N> achados`.



---





### 1. TYPECHECK — detect and run project typecheck



Run when a typecheck path exists for affected packages. Language-agnostic detection; **v1 implements TypeScript fully** — other stacks skip with a note (see SPEC roadmap).



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



| Condition | Who runs TYPECHECK |

| --------- | ------------------ |

| Small scope OR trigger OFF | Orchestrator inline at ANALYZE start |

| Trigger ON | TYPECHECK worker in parallel with STANDARDS (see [sub-agents.md](sub-agents.md)) |



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



Always check for:



| Signal | What to look for |

| ------ | ---------------- |

| Speculative generality | Abstraction/interface with no use in diff or module |

| Duplicated infrastructure | Plugin/middleware/helper already in base class or shared schema |

| Middle man | Class/function that only delegates without adding logic |

| Unnecessary wrapper | Factory/builder for a single code path |

| Future-only config | Flags or params with no requirement in this change |

| Premature abstraction | Strategy/Factory with one implementation |

| Dead code in diff | New export/function never referenced |



Classify severity per [verdict.md](verdict.md) over-engineering table. Always include RC.



**Examples:**



- Plugin `aggregatePaginate` applied again on schema that extends `baseSchema` where plugin is already applied → **Ressalva**

- New service layer wrapping a single direct call → **Sugestão** or **Ressalva**



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


