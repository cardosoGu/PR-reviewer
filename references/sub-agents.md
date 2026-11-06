# ANALYZE Workers (very large PRs only)

**Goal:** Cut wall-clock time on very large PRs by splitting the per-file review (analyze.md §2) across parallel workers. Workers **save time, not tokens** — each one starts cold, so total consumption rises (typically 1.5–3×).

Read this file only when the PR has **≥25 filtered files or >1500 diff lines** (from FETCH). Below that, the single agent is cheaper and loses nothing.

**Platform-agnostic:** this file defines a contract (input, output, constraints). How workers are spawned depends on the runtime. If delegation is unavailable, the orchestrator runs everything inline — always valid.

There is **no TYPECHECK worker**: typecheck is a background shell command ([typecheck.md](typecheck.md)).

---

## Offer (never auto-spawn)

> Esta PR tem [N] arquivos / [L] linhas no diff. Posso dividir a revisão por arquivo em [W] workers paralelos — fica mais rápido, mas consome mais tokens no total. Deseja usar workers?

Declined → orchestrator reviews sequentially.

## What stays with the orchestrator

Workers only run the per-file checklist. The orchestrator keeps everything that needs the whole PR:

1. **FETCH, STANDARDS** and the standards snapshot.
2. **IMPORT-CHECK (analyze.md §0), entirely** — before dispatching. It is batched (a few commands for the whole PR) and Step D needs the global deleted/renamed list.
3. **Cross-batch pass** after merging: the same helper, plugin or abstraction introduced in 2+ batches; a symbol a worker flagged as dead that another batch uses.
4. **Re-verification of every Bloqueante** a worker reports — one command each, using the evidence returned. Not reproduced → downgrade to `[Incerto]`.
5. **VERDICT + REPORT** (dedup, rank, final RC wording).

## Batching

- Group by **module/directory** — a module never splits across workers; files that import each other go together.
- ~5–8 files per batch; at most 5 workers.
- If the runtime lets you pick a model, workers may use a faster/cheaper one; the orchestrator keeps the verdict.

## Worker receives

```
ANALYZE task:
- Repo path: <absolute>
- Skill directory: <absolute> — read references/analyze.md §2 and "Finding Quality Rules" only (skip §0, §1)
- Base ref: <ref>
- File batch: [<file>, ...] — hunks via `git diff <ref>...HEAD --no-color -- <file>`
- PR intent: <commit subjects, compact>
- Standards snapshot: <compact markdown>
- Rules: read-only (allowlist in references/fetch-diff.md); no repo edits; no sub-workers;
  §2.6 over-engineering checklist on every file; RC on every finding; uncertain → [Incerto]
```

## Worker returns (compact — ~400 tokens max, no raw logs or diff replay)

```
Batch <id> complete (<files reviewed>/<files in batch>):
- Bloqueante: <file>:<line> — <summary> | Evidência: <command> → <key output line> | RC: <one line>
- Ressalva: <file>:<line> — <summary> | Evidência: <short> | RC: <one line>
- Sugestão: <file>:<line> — <summary> | RC: <one line>
- Cross-file hints: <symbols/helpers this batch introduced or found unused, for the cross-batch pass>
```

Every Bloqueante **must** carry its evidence, or the orchestrator treats it as `[Incerto]`.

## Fallback Matrix

| Condition | Behavior |
| --------- | -------- |
| Below the threshold | Single agent, full workflow inline |
| User declines | Single agent, sequential ANALYZE |
| Delegation unavailable | Single agent, sequential ANALYZE |
| A worker fails or returns garbage | Orchestrator reviews that batch inline |
