---
name: diffs-reviewer
description: >-
  PR review local read-only da branch atual contra a base. Verifica TypeScript
  (TSC no diff), lógica, segurança e padrões do repo (docs + inferência
  conservadora). Veredito Aprovado / Aprovado com ressalvas / Reprovado.
  Use quando o usuário pedir revisar PR, review de código, analisar diff ou
  /diffs-reviewer. Apenas comandos git read-only; não altera arquivos.
disable-model-invocation: true
metadata:
  author: cardo
  version: 2.0.0
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

## Auto-Sizing

| Scope    | Files | Diff lines | v1 execution                          |
| -------- | ----- | ---------- | ------------------------------------- |
| Small    | ≤3    | ≤100       | Full workflow, single agent, inline  |
| Medium   | 4–10  | ≤500       | Full workflow, single agent           |
| Large    | 11+   | >500       | Full workflow, single agent + note that v2 sub-agents are available |

**v1:** always single agent. For Large scope, mention that parallel sub-agents are planned (see [sub-agents.md](references/sub-agents.md)).

## Workflow

1. **FETCH** — Read [fetch-diff.md](references/fetch-diff.md). Obtain diff and file list.
2. **STANDARDS** — Read [standards.md](references/standards.md). Load documented rules + infer conventions.
3. **ANALYZE** — Read [analyze.md](references/analyze.md). Review each changed file (logic, security, TSC).
4. **VERDICT** — Read [verdict.md](references/verdict.md). Classify findings.
5. **REPORT** — Read [report.md](references/report.md). Emit phased progress + final report.

Display progress by **phase** (not per-file). Use the user's conversation language for output.

## Context Loading Strategy

**Load on demand (one phase at a time):**

- `fetch-diff.md` — FETCH phase only
- `standards.md` — after file list is known
- `analyze.md` — with diff + standards context
- `verdict.md` + `report.md` — after analysis complete

**Never load simultaneously:** `standards.md` + full diff content for Large PRs (>10 files) — process standards first, then analyze file by file.

## Commands

| Trigger | Action |
| ------- | ------ |
| Revisar PR, review de código, analisar diff, `/diffs-reviewer` | Full workflow (all phases) |
| `base=<branch>` mentioned explicitly | Use as base branch (see fetch-diff.md) |
| Revisar só segurança | Full workflow but emphasize analyze.md security section |
| Revisar padrões | Full workflow but emphasize standards.md |

## Sub-Agent Delegation

**v1:** not active — single agent only.

**v2:** documented in [sub-agents.md](references/sub-agents.md) — offer-then-confirm parallel workers for Large PRs.

## Additional Resources

- Product decisions and history: [SPEC.md](SPEC.md) (author reference — do not load during review)
