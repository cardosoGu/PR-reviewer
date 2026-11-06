---
name: diffs-reviewer
description: >-
  PR review local da branch atual contra origin/<base>. IMPORT-CHECK
  determinístico (imports/exports inexistentes, arquivos removidos ainda
  importados); lógica, segurança, over-engineering com evidência e padrões do
  repo. TYPECHECK opt-in. Cada achado inclui RC pronto para PR. Veredito
  Aprovado / Aprovado com ressalvas / Reprovado. Use quando o usuário pedir
  revisar PR, review de código, analisar diff ou /diffs-reviewer. Git
  read-only (único acesso à rede: git fetch --no-tags origin <base>); não altera
  arquivos.
disable-model-invocation: true
metadata:
  author: cardo
  version: 1.2.0
---

# Diffs Reviewer

Review local read-only focado em problemas de alta relevância. Analisa o diff da branch atual contra a branch base. Invocado manualmente pelo usuário.

```
FETCH → STANDARDS → ANALYZE → VERDICT + REPORT
```

## Critical Rules (read before acting)

**Loading this skill's files.** References live under `references/` in this skill's own directory (where this `SKILL.md` resides) — never the workspace root. Read each reference **when its phase starts**, completely (to EOF). Optional references (`typecheck.md`, `sub-agents.md`) are read only when their condition holds.

**Execution contract — non-negotiable:**

1. **Read-only** — only the commands in the allowlist of [fetch-diff.md](references/fetch-diff.md); the single network command is `git fetch --no-tags origin <base>`. Never `push`, `pull`, `commit`, `checkout`, `reset` or anything that writes to the repo or to GitHub.
2. **No file edits** in the repository under review.
3. **Analyze only files in the diff** — other files only for context and patterns. Exception: IMPORT-CHECK Step D reports importers outside the diff that still reference a deleted/renamed file.
4. **Blockers → Reprovado** — never "Aprovado com ressalvas" when a blocking issue exists.
5. **Do not invent rules** — documented standards override inference; inference requires 3+ agreeing peers.
6. **Do not speculate** — if uncertain, mark `[Incerto]`; prefer omission over false positives.
7. **RC on every finding** — per [report.md](references/report.md).
8. **Over-engineering** — mandatory checklist on every file ([analyze.md](references/analyze.md) §2.6); **no finding without verification evidence**.
9. **No early exit** — review all files even after blockers are found.
10. **IMPORT-CHECK always, TYPECHECK opt-in** — IMPORT-CHECK (analyze.md §0) runs on every review, batched; TYPECHECK only when the user asks ([typecheck.md](references/typecheck.md)).
11. **Keep context lean** — never print an unfiltered `git ls-tree -r`, a full diff on Large scope, whole peer files, or raw compiler logs.

## Workflow

1. **FETCH** — Read [fetch-diff.md](references/fetch-diff.md). Base, fetch, filtered file list, PR intent, scope (Small / Medium / Large). If the user asked for typecheck, read [typecheck.md](references/typecheck.md) and start it in the background now.
2. **STANDARDS** — Read [standards.md](references/standards.md). Documented rules + conservative inference from peer excerpts.
3. **ANALYZE** — Read [analyze.md](references/analyze.md). IMPORT-CHECK (§0), then each changed file (logic, intent, security, standards, over-engineering with evidence). On very large PRs (≥25 files or >1500 diff lines), read [sub-agents.md](references/sub-agents.md) before starting and offer workers.
4. **VERDICT + REPORT** — Read [report.md](references/report.md). Classify, dedup, verdict, final report with RC per finding.

Display progress by **phase** (never per file). Use the user's conversation language for output.

## Commands

| Trigger | Action |
| ------- | ------ |
| Revisar PR, review de código, analisar diff, `/diffs-reviewer` | Full workflow |
| `base=<branch>` | Use as base branch (fetch-diff.md) |
| "rodar typecheck" / "run typecheck" | Full workflow + TYPECHECK |
| Revisar só segurança | Full workflow, emphasize analyze.md §2.3 |
| Revisar padrões | Full workflow, emphasize standards.md |

## Additional Resources

- Product decisions and history: [SPEC.md](SPEC.md) (author reference — do not load during review)
- Recipe regression test: `tests/check-recipes.js` (author reference — do not run during review)
