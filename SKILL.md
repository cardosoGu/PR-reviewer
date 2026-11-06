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
  version: 1.1.1
---

# Diffs Reviewer

Review local read-only focado em problemas de alta relevância. Analisa o diff da branch atual contra a branch base. Invocado manualmente pelo usuário.

```
┌─────────┐   ┌───────────┐   ┌─────────┐   ┌─────────┐   ┌────────┐
│  FETCH  │ → │ STANDARDS │ → │ ANALYZE │ → │ VERDICT │ → │ REPORT │
└─────────┘   └───────────┘   └─────────┘   └─────────┘   └────────┘
  required      required        required      required      required
```

## Critical Rules (read before acting)

**Loading this skill's files.** Reference files live under `references/` in this skill's own directory (where this `SKILL.md` resides). Resolve them relative to the skill directory — never the workspace root. When a step tells you to read a reference, **read it completely (to EOF)** before acting.

**Execution contract — non-negotiable:**

1. **Read-only** — git: `diff`, `log`, `show`, `status`, `branch`, `remote`, `rev-parse`, `ls-tree`, `grep` only, plus the single network command `git fetch --no-tags origin <base>`. Never `push`, `pull`, `commit`, `checkout`, `reset`, `branch -D`, or any other state-changing command.
2. **No file edits** in the repository under review.
3. **Analyze only files in the diff** — read other files for context and patterns only. Exception: IMPORT-CHECK Step D reports importers outside the diff that still reference a deleted/renamed file.
4. **Blockers → Reprovado** — never "Aprovado com ressalvas" when a blocking issue exists.
5. **Do not invent rules** — documented standards override inference; inference requires 3+ consistent occurrences.
6. **Do not speculate** — if uncertain, mark as uncertain; prefer omission over false positives.
7. **RC on every finding** — short PR-ready comment per [report.md](references/report.md).
8. **Over-engineering** — mandatory checklist in every file per [analyze.md](references/analyze.md) §2.6; **no finding without verification evidence**.
9. **No early exit** — review all files in the diff even after blockers are found.
10. **IMPORT-CHECK always, TYPECHECK opt-in** — IMPORT-CHECK ([analyze.md](references/analyze.md) §0) runs on every review; TYPECHECK ([analyze.md](references/analyze.md) §1) only when the user asks, in background with 120s timeout; never `tsc -- file1 file2`; never build as fallback.

## Scope and Trigger

After FETCH, classify **scope** and compute **trigger** (see [fetch-diff.md](references/fetch-diff.md)):

| Scope  | Condition | Execution |
| ------ | --------- | --------- |
| Small  | ≤3 files AND ≤100 diff lines | Single agent; IMPORT-CHECK inline; STANDARDS light (1 peer/module) |
| Medium | Not Small and not Large | Single agent; IMPORT-CHECK inline |
| Large  | 11+ files OR >500 diff lines | Hunks per file; offer ANALYZE workers |

**Trigger ON** when any of:

```
(files > 8 AND diff_lines > 400)
OR files > 12
OR diff_lines > 800
```

Trigger ON does not spawn TYPECHECK and does not gate the ANALYZE-workers offer (that depends on Large scope); the TYPECHECK worker runs only if the user asked for typecheck. See [sub-agents.md](references/sub-agents.md).

**ANALYZE workers** (file batches): offer-then-confirm only — never auto-spawn. User must accept.

## Workflow

1. **FETCH** — Read [fetch-diff.md](references/fetch-diff.md). Obtain diff, file list, scope, trigger.
2. **STANDARDS** — Read [standards.md](references/standards.md). Load documented rules + infer conventions (peers per module).
3. **ANALYZE** — Read [analyze.md](references/analyze.md). Run IMPORT-CHECK (§0), then review each changed file (logic, security, over-engineering with evidence). TYPECHECK (§1) only on request.
4. **VERDICT** — Read [verdict.md](references/verdict.md). Classify findings.
5. **REPORT** — Read [report.md](references/report.md). Emit phased progress + final report with RC per finding.

Display progress by **phase** (not per-file). Use the user's conversation language for output.

## Context Loading Strategy

**Load on demand (one phase at a time):**

- `fetch-diff.md` — FETCH phase only
- `standards.md` — after file list is known
- `analyze.md` — with diff + standards context
- `verdict.md` + `report.md` — after analysis complete
- `sub-agents.md` — when scope is Large (before offering ANALYZE workers) or the user asked for typecheck

**Never load simultaneously:** `standards.md` + full diff content on Large PRs — process standards first, then analyze file by file (hunks only).

## Commands

| Trigger | Action |
| ------- | ------ |
| Revisar PR, review de código, analisar diff, `/diffs-reviewer` | Full workflow (all phases) |
| `base=<branch>` mentioned explicitly | Use as base branch (see fetch-diff.md) |
| Revisar só segurança | Full workflow but emphasize analyze.md security section |
| Revisar padrões | Full workflow but emphasize standards.md |

## Worker Delegation

The ANALYZE-workers offer is active when **scope is Large**; the TYPECHECK worker only when the user asked for typecheck (any scope). Read [sub-agents.md](references/sub-agents.md):

- **TYPECHECK worker** — only when the user asked for typecheck; compact return only
- **ANALYZE workers** — offer-then-confirm on Large scope; user must accept

Worker contracts are platform-agnostic (input/output/constraints). If delegation unavailable or scope is not Large: single agent runs full workflow inline.

## Additional Resources

- Product decisions and history: [SPEC.md](SPEC.md) (author reference — do not load during review)
