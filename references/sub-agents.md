# Sub-Agent Delegation (v2 — not active in v1)

**Goal:** Speed up Large PR reviews by parallelizing file analysis. Documented for future implementation; v1 always runs single agent.

---

## Trigger (planned)

When FETCH phase classifies scope as **Large** (11+ files or 500+ diff lines):

**Offer-then-confirm (never auto-spawn):**

> "Esta PR tem [N] arquivos / [L] linhas no diff. Posso dividir a análise em sub-agentes paralelos por lote de arquivos para acelerar. Deseja usar sub-agentes?"

User must accept. If declined, continue single agent.

---

## Execution Model (planned)

```
Orchestrator
  ├── FETCH + STANDARDS (orchestrator, sequential)
  ├── Worker 1 → files batch A → compact findings summary
  ├── Worker 2 → files batch B → compact findings summary
  └── Orchestrator → VERDICT + REPORT (merge, dedup, rank)
```

**Batch size:** ~5 files per worker (adjust so each worker context stays lean).

**Worker receives:**

- File list for its batch
- Diff hunks for those files only
- Standards snapshot (documented + inferred)
- Brief from analyze.md (checklist only — not full repo)

**Worker returns (compact):**

```
Batch [N] complete:
- Bloqueantes: [list with file:line + one-line summary]
- Ressalvas: [list]
- Sugestões: [list]
```

No raw diff replay — orchestrator merges into VERDICT phase.

---

## What Workers Must Not Do

- Spawn sub-sub-agents
- Run git state-changing commands
- Edit repository files
- Invent standards not in the snapshot

---

## Fallback

If sub-agents unavailable or user declines: single agent runs full workflow (current v1 behavior).
