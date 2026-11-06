# FETCH — Obtain Diff

**Goal:** Resolve the base branch, obtain the PR diff (read-only), filter noise, classify scope, and hand off the file list and PR intent.

**Completion criterion:** Base verified, filtered file list non-empty (or stop with message), scope and diff handoff mode assigned.

---

## Process

### 1. Resolve base branch

**Base name `<base>`:** always the bare branch name (`main`, never `origin/main`). Strip any `origin/` prefix from `symbolic-ref` or `branch -r` output.

**Override:** if the user names a base (`base=develop`, `branch base: main`, `comparar com jobs`), use it.

**Auto-detect:** first that resolves of `main`, `master`, then the remote default from `git symbolic-ref refs/remotes/origin/HEAD` (fallback: `git branch -r`, look for `origin/HEAD -> origin/<name>`).

**Fetch first (the only network command allowed).** Run `git remote`:

- If `origin` is listed: `git fetch --no-tags origin <base>`. Exactly one branch, only `origin`, never `--all`, `--prune`, `--tags`. It updates only the remote-tracking ref (no working tree, index or local branch change). If it fails (offline, auth), continue and emit once: `Aviso: origin/<base> pode estar desatualizada (fetch falhou).`
- No `origin` remote: skip the fetch, no warning.

**Resolve `<ref>` (after the fetch):** `git rev-parse --verify --quiet origin/<base>` → `<ref>` = `origin/<base>`. Otherwise `git rev-parse --verify --quiet <base>` → `<ref>` = `<base>` and note "sem remoto: usando base local". If both fail, stop: base `<base>` not found. Use `<ref>` in **every** command below.

### 2. Check current branch

`git branch --show-current` — if it equals `<base>`, stop: no feature diff to review against itself.

### 3. List changes and PR intent (no diff content yet)

```bash
git diff <ref>...HEAD --name-status -M --no-color
```

```bash
git diff <ref>...HEAD --numstat -M --no-color
```

```bash
git log <ref>..HEAD --no-merges -n 30 --format='- %s%n%w(0,2,2)%b'
```

- `--name-status -M` feeds the IMPORT-CHECK reverse check (deleted/renamed files).
- `--numstat` gives added/removed lines per file (`-` = binary) without loading the diff.
- The commit subjects and bodies are the **PR intent** used in ANALYZE §2.2 (last 30 commits; summarize long bodies to a few lines). Commit count: `git rev-list --count <ref>..HEAD`. If the user pasted a PR description, it takes precedence.

Three-dot compares against the merge-base — same semantics as a PR. Only committed changes are reviewed (uncommitted/staged changes are not).

### 4. Filter ignored paths

Remove before counting anything:

- Dependencies: `node_modules/**`, `vendor/**`
- Lockfiles: `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `bun.lock`, `composer.lock`, `Cargo.lock`, `poetry.lock`, `Gemfile.lock`, `go.sum`
- Generated / build output: `dist/`, `build/`, `out/`, `coverage/`, `.next/`, `*.min.js`, `*.min.css`, `*.map`, `__snapshots__/`, `*.snap` — skip unless the diff suggests hand-edited generated code
- Binary files (numstat `-`, or `.png`, `.jpg`, `.gif`, `.ico`, `.woff`, `.pdf`, …) — noted in the report, content not analyzed

If the filtered list is empty, stop: "Nenhum arquivo relevante no diff."

**diff_lines** = sum of added + removed from `--numstat` over the **filtered** files only (a lockfile never inflates the scope).

### 5. Classify scope

| Scope | Condition | Execution |
| ----- | --------- | --------- |
| Small | ≤3 files AND ≤100 diff lines | Single agent; full diff; STANDARDS light |
| Medium | Not Small and not Large | Single agent; full diff if diff_lines ≤400, else hunks per file |
| Large | 11+ files OR >500 diff lines | Single agent, hunks per file; ANALYZE workers offered only at ≥25 files or >1500 diff lines ([sub-agents.md](sub-agents.md)) |

### 6. Diff handoff

Always restrict diff content to the filtered files:

```bash
git diff <ref>...HEAD --no-color -- <filtered-file-1> <filtered-file-2>
```

Hunks per file (Large, or Medium >400 lines): `git diff <ref>...HEAD --no-color -- <file>`, read during ANALYZE only — never accumulate the full diff in context during STANDARDS.

### 7. Hand off

Pass forward: `<base>`, `<ref>` (+ short sha via `git rev-parse --short <ref>`), current branch, commit count and PR intent, filtered file list, ignored-file count, deleted/renamed list, `scope`, `file_count`, `diff_lines`, handoff mode.

---

## Allowed Git Commands

This is the **single allowlist** for the whole review (SKILL.md refers here). Anything not listed is forbidden.

| Command | Purpose |
| ------- | ------- |
| `git remote`, `git branch --show-current`, `git branch -r` | Remote / branch detection |
| `git symbolic-ref refs/remotes/origin/HEAD` | Default remote branch |
| `git rev-parse --verify --quiet <ref>`, `git rev-parse --short <ref>` | Resolve ref, short sha |
| `git fetch --no-tags origin <base>` | **Only** network command: refresh the base's remote-tracking ref |
| `git diff <ref>...HEAD [--name-status -M \| --numstat \| -U0] [-- <paths>]` | Changes, counts, hunks |
| `git log <ref>..HEAD`, `git rev-list --count <ref>..HEAD` | Commits and PR intent |
| `git ls-tree [-r] --name-only HEAD [<dir>/]` — **always piped into a filter** | File existence at HEAD (IMPORT-CHECK) |
| `git grep … HEAD -- <paths>` | Export / reference search at HEAD |
| `git show HEAD:<path>` | Read a file at HEAD without checkout |
| `git status` | Context when needed |

Non-git commands: read-only filters (`grep`, `head`, `Select-String`) and, **only when the user asked for typecheck**, the commands in [typecheck.md](typecheck.md).

**Forbidden:** `push`, `pull`, `commit`, `checkout`, `switch`, `reset`, `rebase`, `merge`, `branch -D`, `stash`, `clean`, `tag`, any `fetch` other than the one above, and any command that writes to the repository or to GitHub.

---

## Progress Message

Emit once when FETCH completes:

```
[Fase 1/5] FETCH — diff obtido: <N> arquivos (<X> ignorados), <L> linhas vs origin/<base>@<sha curto> (<scope>)
```

If `<ref>` is the local base, use `<base>@<sha curto>`. Omit `(<X> ignorados)` when X = 0.
