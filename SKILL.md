---
name: diffs-reviewer
description: >-
  PR review local read-only da branch atual contra a base. TYPECHECK via script
  do projeto ou tsc por package; lógica, segurança, over-engineering e padrões
  do repo (docs + inferência conservadora). Cada achado inclui RC pronto para PR.
  Veredito Aprovado / Aprovado com ressalvas / Reprovado. Use quando o usuário
  pedir revisar PR, review de código, analisar diff ou /diffs-reviewer. Apenas
  comandos git read-only; não altera arquivos.
disable-model-invocation: true
metadata:
  author: cardo
  version: 1.0.0
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

1. **Read-only** — git: `diff`, `log`, `show`, `status`, `branch`, `remote` only. Never `push`, `commit`, `checkout`, `reset`, `branch -D`, or any state-changing command.
2. **No file edits** in the repository under review.
3. **Analyze only files in the diff** — read other files for context and patterns only.
4. **Blockers → Reprovado** — never "Aprovado com ressalvas" when a blocking issue exists.
5. **Do not invent rules** — documented standards override inference; inference requires 3+ consistent occurrences.
6. **Do not speculate** — if uncertain, mark as uncertain; prefer omission over false positives.
7. **RC on every finding** — short PR-ready comment per [report.md](references/report.md).
8. **Over-engineering** — mandatory checklist in every file per [analyze.md](references/analyze.md) §2.6.
9. **No early exit** — review all files in the diff even after blockers are found.
10. **TYPECHECK** — script do projeto → `tsc -p` / `tsc -b` por package; never `tsc -- file1 file2`; never build as fallback (see [analyze.md](references/analyze.md)).

## Scope and Trigger

After FETCH, classify **scope** and compute **trigger** (see [fetch-diff.md](references/fetch-diff.md)):

| Scope  | Files | Diff lines | Execution |
| ------ | ----- | ---------- | --------- |
| Small  | ≤3    | ≤100       | Single agent; TYPECHECK inline; STANDARDS light (1 peer/module) |
| Medium | 4–10  | ≤500       | Single agent; TYPECHECK worker if trigger ON |
| Large  | 11+   | >500       | Trigger ON; hunks per file; offer ANALYZE workers |

**Trigger ON** when any of:

```
(files > 8 AND diff_lines > 400)
OR files > 12
OR diff_lines > 800
```

When trigger ON: spawn **TYPECHECK worker automatically** (parallel with STANDARDS). See [sub-agents.md](references/sub-agents.md).

**ANALYZE workers** (file batches): offer-then-confirm only — never auto-spawn. User must accept.

## Workflow

1. **FETCH** — Read [fetch-diff.md](references/fetch-diff.md). Obtain diff, file list, scope, trigger.
2. **STANDARDS** — Read [standards.md](references/standards.md). Load documented rules + infer conventions (peers per module).
3. **ANALYZE** — Read [analyze.md](references/analyze.md). Review each changed file (logic, security, TYPECHECK, over-engineering).
4. **VERDICT** — Read [verdict.md](references/verdict.md). Classify findings.
5. **REPORT** — Read [report.md](references/report.md). Emit phased progress + final report with RC per finding.

Display progress by **phase** (not per-file). Use the user's conversation language for output.

## Context Loading Strategy

**Load on demand (one phase at a time):**

- `fetch-diff.md` — FETCH phase only
- `standards.md` — after file list is known
- `analyze.md` — with diff + standards context
- `verdict.md` + `report.md` — after analysis complete
- `sub-agents.md` — when trigger ON or before offering ANALYZE workers

**Never load simultaneously:** `standards.md` + full diff content on Large PRs — process standards first, then analyze file by file (hunks only).

## Commands

| Trigger | Action |
| ------- | ------ |
| Revisar PR, review de código, analisar diff, `/diffs-reviewer` | Full workflow (all phases) |
| `base=<branch>` mentioned explicitly | Use as base branch (see fetch-diff.md) |
| Revisar só segurança | Full workflow but emphasize analyze.md security section |
| Revisar padrões | Full workflow but emphasize standards.md |

## Worker Delegation

Active when **trigger ON**. Read [sub-agents.md](references/sub-agents.md):

- **TYPECHECK worker** — auto when typecheck path detected; parallel with STANDARDS; compact return only
- **ANALYZE workers** — offer-then-confirm on Large scope; user must accept

Worker contracts are platform-agnostic (input/output/constraints). If delegation unavailable or trigger OFF: single agent runs full workflow inline.

## Additional Resources

- Product decisions and history: [SPEC.md](SPEC.md) (author reference — do not load during review)
