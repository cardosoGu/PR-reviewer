# TYPECHECK — project typecheck (opt-in)

Read this file **only when the user explicitly asked** for typecheck ("rodar typecheck", "run typecheck"). Otherwise report `TYPECHECK: não solicitado` and never load it.

**Why opt-in:** slow on heavy repos, and IMPORT-CHECK (analyze.md §0) already catches the build-breaking import class. Detection is language-agnostic; only TypeScript is implemented — other stacks report `skipped` with a note.

## Execution model

Typecheck is a **shell command run in the background**, not a worker or sub-agent (an agent would spend tokens just waiting on a compiler). Start it right after FETCH, keep reviewing, and collect the result before VERDICT.

- Use the runtime's background mode for shell commands when available; otherwise prefix with `timeout 120` (bash / Git Bash).
- **120s timeout.** On timeout, kill it, continue, and report `TYPECHECK: timeout` (not a finding).
- **Never let the raw log into context.** Filter the output to the diff files plus config errors, capped:

```bash
<command> 2>&1 | grep -E '<diff-file-1>|<diff-file-2>|error TS5|error TS6' | head -40
```

Count total errors separately (`… 2>&1 | grep -c 'error TS'`) so the status reports the real number even when the list is capped.

## Priority (3 levels)

| Level | When | Action |
| ----- | ---- | ------ |
| **1 — Project script** | `package.json` has a typecheck script | Run it in each affected package |
| **2 — Stack fallback** | TS project, no script | `tsc -p` (single package) or `tsc -b` (monorepo package) |
| **3 — Skip** | Nothing detected | Note once; continue with manual analyze.md §2.1 |

## Hard rules

- **Never** `tsc --noEmit -- file1 file2` — TypeScript ignores tsconfig (paths, strict, references) → false negatives
- **Never** full-repo `tsc --noEmit` at the monorepo root as default
- **Never** `npm run build` as automatic fallback — slow, may write artifacts, not guaranteed to catch types
- **Never** install tools or create/edit files in the repo under review; **do not run ESLint**

## Step A — Map diff files to packages

For each file in the filtered diff list, find the nearest package root (directory containing `package.json` or `tsconfig.json`). Deduplicate.

## Step B — Level 1: project script (preferred)

In each affected package (or the repo root if single-package), read `package.json` scripts and use the **first match**: `typecheck` → `check:types` → `check-types` → `validate:types` → `tsc`.

Package manager from lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`/`bun.lock`, else npm): run `<pm> run <script>` from the package directory. If a root script typechecks the whole workspace and all diff files belong to it, the root is sufficient.

## Step C — Level 2: TypeScript fallback

When no script matches but `tsconfig.json` exists:

- **Single package / app:** `npx tsc -p <path/to/tsconfig.json> --noEmit --pretty false` (tsconfig nearest to the changed files).
- **Monorepo** (package has `composite: true`, or root tsconfig has `references`): `npx tsc -b <path/to/package> --pretty false`, only for packages containing diff files, one invocation each. `--noEmit` is incompatible with `tsc -b`; build mode is incremental (`.tsbuildinfo`).
- **Diff-scoped tools** (`tsc-files`, `typecheck-files`) only if already in `devDependencies` or scripts. Do not install.

## Step D — Level 3: skip

No script and no tsconfig for the affected packages → `TYPECHECK: skipped — no typecheck script or tsconfig detected`; continue with manual §2.1.

## Status

| Condition | Report |
| --------- | ------ |
| Completed, no errors | `TYPECHECK: ok` |
| Errors found | `TYPECHECK: <N> erros` (each error in a diff file is also a finding) |
| Timeout | `TYPECHECK: timeout`; review continues |
| Config broken (tsconfig missing/unparsable, or only TS5xxx/TS6xxx option errors) | `TYPECHECK: falhou (config)` (not a finding) |
| Several packages, mixed results | Combine per package, e.g. `TYPECHECK: 3 erros; falhou (config) em packages/api` — a config failure in one package never hides errors in another |
| Nothing detected | `TYPECHECK: skipped` |

Merge TYPECHECK findings with the manual typing review (analyze.md §2.1). Pre-existing errors outside the diff files are not reported.
