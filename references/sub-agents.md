# Sub-Agent Delegation (v2.1 — active when trigger ON)

**Goal:** Reduce wall-clock on large PRs by parallelizing TSC and optional file analysis. Keep orchestrator context lean — workers return compact summaries only.

Read this file when **trigger ON** (from FETCH) or before offering ANALYZE workers.

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
| **TSC worker** | **Automatic** when trigger ON and `tsconfig.json` exists |
| **ANALYZE workers** | **Offer-then-confirm only** — never auto-spawn |

---

## TSC Worker (automatic)

### When

Trigger ON + TypeScript project detected.

### Spawn

In parallel with orchestrator **STANDARDS** phase (after FETCH handoff).

### Worker runs

```bash
npx tsc -p <tsconfig> --noEmit --pretty false -- <file1> <file2> ...
```

Only files from the filtered diff list. **Never** full-project `tsc` without file list.

### Worker returns (compact — max ~300 tokens)

```
TSC complete:
- Errors in diff: <N>
  - <file>:<line> — <code> — <message>
- TSC status: ok | failed (reason if config broken)
```

No raw TSC log. Orchestrator merges into ANALYZE findings.

### Fallback

If sub-agent unavailable: orchestrator runs diff-scoped TSC inline during ANALYZE.

---

## ANALYZE Workers (offer-then-confirm)

### When

Scope is **Large** (11+ files OR >500 diff lines) AND user accepts.

**Offer (never auto):**

> Esta PR tem [N] arquivos / [L] linhas no diff. Posso dividir a análise em sub-agentes paralelos por lote de arquivos para acelerar. Deseja usar sub-agentes?

User must accept. If declined, orchestrator runs ANALYZE sequentially.

### Execution model

```
Orchestrator
  ├── FETCH (done)
  ├── TSC worker ∥ STANDARDS (orchestrator)
  ├── [if user accepted] Worker 1 → batch A
  ├── [if user accepted] Worker 2 → batch B
  └── Orchestrator → VERDICT + REPORT (merge, dedup, rank, RC)
```

**Batch size:** ~5 files per worker.

### Worker receives

- File list for its batch
- Diff hunks for those files only (`git diff <base>...HEAD -- <file>`)
- Standards snapshot (compact)
- Checklist summary from analyze.md §2.1–2.6 (not full reference files)

### Worker returns (compact)

```
Batch <id> complete:
- Bloqueantes: <file>:<line> — <summary> | RC: <one-line RC>
- Ressalvas: <file>:<line> — <summary> | RC: <one-line RC>
- Sugestões: <file>:<line> — <summary> | RC: <one-line RC>
```

No raw diff replay. Each finding must include RC in worker output.

Orchestrator merges into VERDICT phase, deduplicates, refines RC in REPORT if needed.

---

## What Workers Must Not Do

- Spawn sub-sub-agents
- Run git state-changing commands
- Edit repository files
- Invent standards not in the snapshot
- Return full TSC log or full diff
- Skip over-engineering checklist (§2.6)

---

## Fallback

| Condition | Behavior |
| --------- | -------- |
| Trigger OFF | Single agent, full workflow |
| User declines ANALYZE workers | Single agent ANALYZE |
| Sub-agent unavailable | Inline diff-scoped TSC + sequential ANALYZE |
