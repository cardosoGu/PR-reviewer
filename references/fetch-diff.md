# FETCH — Obtain Diff

**Goal:** Resolve base branch, obtain the PR diff (read-only), classify scope, compute trigger, and produce the filtered file list for analysis.

**Completion criterion:** Base branch verified, filtered file list non-empty (or stop with message), scope + trigger + diff handoff mode assigned.

---

## Process

### 1. Resolve base branch

**Base name `<base>`:** always the bare branch name (e.g. `main`, never `origin/main`). Strip any `origin/` prefix from `symbolic-ref` or `branch -r` output.

**Override (soft):** If the user explicitly mentions a base branch (e.g. `base=develop`, `branch base: main`, `comparar com jobs`), use it.

**Auto-detect (default):** Try in order until one resolves:

1. `main`
2. `master`
3. Remote default from `origin/HEAD`

**Cross-platform detection for origin/HEAD:**

```bash
git symbolic-ref refs/remotes/origin/HEAD
```

If that fails, try:

```bash
git branch -r
```

Look for `origin/HEAD -> origin/main` or `origin/master`, and keep only `main` / `master` as `<base>`.

**Freshness — fetch first (the only network command allowed):**

Check whether an `origin` remote exists:

```bash
git remote
```

- If `origin` is listed, run:

  ```bash
  git fetch --no-tags origin <base>
  ```

  Rules: exactly one branch, only `origin`, never `--all`, `--prune`, `--tags`. It updates only the remote-tracking ref; it does not touch the working tree, index, or local branches.

  If the fetch fails (offline, auth), continue and emit once:

  ```
  Aviso: origin/<base> pode estar desatualizada (fetch falhou).
  ```

- If there is no `origin` remote, skip the fetch and emit no warning.

**Resolve `<ref>` (only after the fetch):**

```bash
git rev-parse --verify --quiet origin/<base>
```

- If it succeeds, set `<ref>` = `origin/<base>` and use `<ref>` in **every** command below.
- Otherwise:

  ```bash
  git rev-parse --verify --quiet <base>
  ```

  - If it succeeds, set `<ref>` = `<base>` and note "sem remoto: usando base local".
  - If it fails too, stop and tell the user the base `<base>` was not found (neither `origin/<base>` nor `<base>` resolves).

### 2. Check current branch

```bash
git branch --show-current
```

If current branch equals `<base>` (bare name), stop and tell the user there is no feature diff to review against itself.

### 3. Obtain diff (three-dot, merge-base)

```bash
git diff <ref>...HEAD --no-color
```

```bash
git diff <ref>...HEAD --name-only --no-color
```

```bash
git diff <ref>...HEAD --name-status -M --no-color
```

```bash
git log <ref>..HEAD --oneline
```

`--name-status -M` feeds the IMPORT-CHECK reverse check (deleted/renamed files).

Count **diff_lines** from the full diff output (added + removed lines, excluding headers).

Three-dot compares against the merge-base — same semantics as a typical PR.

**Scope:** committed changes on the current branch only. Uncommitted/staged local changes are **not** included.

### 4. Filter ignored paths

Remove from the file list:

- `node_modules/**`
- `vendor/**`
- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- Binary files (`.png`, `.jpg`, `.gif`, `.ico`, `.woff`, `.pdf`, etc.) — note in report, do not analyze content
- Generated-only paths if clearly marked (e.g. `dist/`, `build/`) — skip unless the diff suggests hand-edited generated code

If the filtered list is empty, stop: "Nenhum arquivo relevante no diff."

### 5. Classify scope and trigger

**Scope** (use filtered file count and diff_lines):

| Scope  | Condition |
| ------ | --------- |
| Small  | ≤3 files AND ≤100 diff lines |
| Medium | 4–10 files OR ≤500 diff lines (and not Large) |
| Large  | 11+ files OR >500 diff lines |

**Trigger ON** when any of:

```
(files > 8 AND diff_lines > 400)
OR files > 12
OR diff_lines > 800
```

Pass `scope`, `trigger`, `file_count`, and `diff_lines` to all later phases.

### 6. Diff handoff mode

| Scope  | Handoff to ANALYZE |
| ------ | ------------------ |
| Small  | Full diff text allowed (compact PRs) |
| Medium | Full diff text allowed if diff_lines ≤400; otherwise hunks per file |
| Large  | **Hunks per file only** — never pass full diff to STANDARDS or ANALYZE at once |

For hunks per file:

```bash
git diff <ref>...HEAD --no-color -- <file>
```

Read each file's hunks during ANALYZE only — do not accumulate full diff in context during STANDARDS.

### 7. Hand off to STANDARDS

Pass forward:

- Base branch name and `<ref>` (with short sha of `<ref>`)
- Current branch name
- Commit list (one-liners)
- Filtered file list
- `scope`, `trigger`, `file_count`, `diff_lines`
- Diff handoff mode (full vs hunks)

Do **not** pass full diff text into STANDARDS on Large PRs.

---

## Allowed Git Commands

| Command | Purpose |
| ------- | ------- |
| `git branch --show-current` | Current branch |
| `git rev-parse <ref>` | Verify ref exists |
| `git symbolic-ref refs/remotes/origin/HEAD` | Default remote branch |
| `git branch -r` | List remote branches |
| `git remote` | Check that an `origin` remote exists |
| `git rev-parse --verify --quiet <ref>` | Resolve ref (no error output when missing) |
| `git rev-parse --short <ref>` | Short sha for the progress message |
| `git fetch --no-tags origin <base>` | **Only** network command: refresh the remote-tracking ref of the base |
| `git diff <ref>...HEAD` | Diff content |
| `git diff <ref>...HEAD --name-only` | Changed files |
| `git diff <ref>...HEAD --name-status -M` | Added/deleted/renamed files |
| `git diff <ref>...HEAD -- <file>` | Per-file hunks |
| `git log <ref>..HEAD --oneline` | Commits in branch |
| `git ls-tree -r --name-only HEAD` | File existence at HEAD (IMPORT-CHECK) |
| `git grep … HEAD -- <path>` | Reference/export search at HEAD (IMPORT-CHECK, over-engineering) |
| `git show HEAD:<path>` | Read a file at HEAD without checkout |
| `git show`, `git status` | Context when needed |

## Forbidden Git Commands

`push`, `pull`, `commit`, `checkout`, `switch`, `reset`, `rebase`, `merge`, `branch -D`, `stash`, `clean`, and any `fetch` other than `git fetch --no-tags origin <base>`.

---

## Progress Message

Emit once when FETCH completes:

```
[Fase 1/5] FETCH — diff obtido: <N> arquivos, <L> linhas vs origin/<base>@<sha curto> (<scope>, trigger <ON|OFF>)
```

(`<sha curto>` = `git rev-parse --short <ref>`. Se `<ref>` for a base local, usar `<base>@<sha curto>`.)
