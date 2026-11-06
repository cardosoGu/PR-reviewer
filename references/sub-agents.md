# Worker Delegation (active when trigger ON)

**Goal:** Reduce wall-clock on large PRs by parallelizing TYPECHECK and optional file analysis. Keep orchestrator context lean — workers return compact summaries only.

Read this file when **trigger ON** (from FETCH) or before offering ANALYZE workers.

**Platform-agnostic:** this file defines worker **contracts** (input, output, constraints). How to spawn workers depends on the runtime — never assume a specific IDE, tool, or API.

---

## Worker Contract (all workers)

When parallel delegation is **available** in the runtime:

| Field | Requirement |
| ----- | ----------- |
| **Input** | Repo path, task scope, read-only git context |
| **Output** | Compact summary only (~300 tokens max) — no raw logs, no full diff replay |
| **Constraints** | Read-only; no repo file edits; no state-changing git commands |
| **Fallback** | If delegation unavailable → orchestrator runs the same work **inline sequentially** (always valid) |

Workers must **not**: spawn sub-workers, invent standards, skip over-engineering checklist (analyze.md §2.6), or return unstructured dumps.

---

## Trigger Recap

**Trigger ON** when any of:

```
(files > 8 AND diff_lines > 400)
OR files > 12
OR diff_lines > 800
```

| Worker | Activation |
| ------ | ---------- |
| **TYPECHECK worker** | **Only when the user asked for typecheck** (opt-in) and typecheck path detected (see analyze.md §1); never automatic |
| **ANALYZE workers** | **Offer-then-confirm only** — never auto-spawn |

---

## TYPECHECK Worker (opt-in)

### When

User asked for typecheck + Level 1 or Level 2 applies (project script or tsconfig). Trigger ON alone does **not** activate this worker.

### Parallel with STANDARDS

Start after FETCH handoff, in parallel with orchestrator STANDARDS phase.

### Worker receives

```
TYPECHECK task:
- Repo path: <absolute>
- Affected packages: [<package-dir>, ...]
- Diff files: [<file>, ...]
- Commands to run: [<pm run typecheck | tsc -p … | tsc -b …>, ...]
- Rules: read-only; no repo edits; follow analyze.md §1 priority
```

Resolve commands using analyze.md §1 (script first, then `tsc -p` / `tsc -b` per package).

### Worker runs

Execute the resolved commands from each package directory. **Never** `tsc -- file1 file2`. **Never** `npm run build` unless the project's typecheck script IS build (rare — prefer explicit typecheck scripts). Run with a **120s timeout**; on timeout return `Status: timeout`.

### Worker returns (compact — max ~300 tokens)

```
TYPECHECK complete:
- Level: script | tsc-p | tsc-b | skipped
- Packages checked: <N>
- Errors in diff scope: <N>
  - <file>:<line> — <code> — <message>
- Status: ok | failed (reason if config broken) | timeout
```

No raw compiler log. Orchestrator merges into ANALYZE findings.

### Fallback

If worker delegation unavailable and the user asked for typecheck: orchestrator runs TYPECHECK inline in the background at ANALYZE start (same commands, same rules, 120s timeout). Otherwise skip it.

---

## ANALYZE Workers (offer-then-confirm)

### When

Scope is **Large** (11+ files OR >500 diff lines) AND user accepts.

**Offer (never auto):**

> Esta PR tem [N] arquivos / [L] linhas no diff. Posso dividir a análise em workers paralelos por lote de arquivos para acelerar. Deseja usar workers?

User must accept. If declined, orchestrator runs ANALYZE sequentially.

### Execution model

```
Orchestrator
  ├── FETCH (done)
  ├── [only if user asked] TYPECHECK worker ∥ STANDARDS (orchestrator)
  ├── [if user accepted] Worker 1 → batch A
  ├── [if user accepted] Worker 2 → batch B
  └── Orchestrator → VERDICT + REPORT (merge, dedup, rank, RC)
```

**Batch size:** ~5 files per worker.

### Worker receives

```
ANALYZE task:
- Repo path: <absolute>
- Base branch: <base>
- File batch: [<file>, ...]
- Diff hunks: per file (git diff <base>...HEAD -- <file>)
- Standards snapshot: <compact markdown>
- Checklist: analyze.md §2.1–2.6 summary
- Rules: read-only; RC on every finding; no speculation without [Incerto]
```

### Worker returns (compact)

```
Batch <id> complete:
- Bloqueantes: <file>:<line> — <summary> | RC: <one-line RC>
- Ressalvas: <file>:<line> — <summary> | RC: <one-line RC>
- Sugestões: <file>:<line> — <summary> | RC: <one-line RC>
```

Orchestrator merges into VERDICT phase, deduplicates, refines RC in REPORT if needed.

---

## Fallback Matrix

| Condition | Behavior |
| --------- | -------- |
| Trigger OFF | Single agent, full workflow inline |
| User declines ANALYZE workers | Single agent ANALYZE |
| Worker delegation unavailable | Inline TYPECHECK (only if asked) + sequential ANALYZE |
| TYPECHECK not requested | Skip TYPECHECK; IMPORT-CHECK §0 and manual §2.1 only |
| No typecheck path detected | Skip TYPECHECK; manual §2.1 only |
