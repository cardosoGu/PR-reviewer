# FETCH — Obtain Diff

**Goal:** Resolve base branch, obtain the PR diff (read-only), classify scope, compute trigger, and produce the filtered file list for analysis.

**Completion criterion:** Base branch verified, filtered file list non-empty (or stop with message), scope + trigger + diff handoff mode assigned.

---

## Process

### 1. Resolve base branch

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

Look for `origin/HEAD -> origin/main` or `origin/master`.

**Verify:** `git rev-parse <base>` must succeed.

### 2. Check current branch

```bash
git branch --show-current
```

If current branch is `main` or `master` (same as base), stop and tell the user there is no feature diff to review against itself.

### 3. Obtain diff (three-dot, merge-base)

```bash
git diff <base>...HEAD --no-color
```

```bash
git diff <base>...HEAD --name-only --no-color
```

```bash
git log <base>..HEAD --oneline
```

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
git diff <base>...HEAD --no-color -- <file>
```

Read each file's hunks during ANALYZE only — do not accumulate full diff in context during STANDARDS.

### 7. Hand off to STANDARDS

Pass forward:

- Base branch name
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
| `git diff <base>...HEAD` | Diff content |
| `git diff <base>...HEAD --name-only` | Changed files |
| `git diff <base>...HEAD -- <file>` | Per-file hunks |
| `git log <base>..HEAD --oneline` | Commits in branch |
| `git show`, `git status` | Context when needed |

## Forbidden Git Commands

`push`, `commit`, `checkout`, `switch`, `reset`, `rebase`, `merge`, `branch -D`, `stash`, `clean`, `fetch` (read-only without network side effects)

---

## Progress Message

Emit once when FETCH completes:

```
[Fase 1/5] FETCH — diff obtido: <N> arquivos, <L> linhas vs <base> (<scope>, trigger <ON|OFF>)
```

If trigger ON, add:

```
Sub-agente TSC será ativado em paralelo com STANDARDS.
```
