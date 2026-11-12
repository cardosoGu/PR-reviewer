---
name: diffs-reviewer
description: >-
  Review de PR do GitHub a partir do link (/diffs-reviewer <link da PR>).
  Coleta via gh com dois scripts Node (diff por arquivo, contexto em lote,
  IMPORT-CHECK determinístico); lógica, segurança, over-engineering com
  evidência e padrões do repo, em duas passadas com autovalidação. Cada achado
  inclui RC pronto para PR. Veredito Aprovado / Aprovado com ressalvas /
  Reprovado. Use quando o usuário pedir para revisar uma PR pelo link ou
  /diffs-reviewer. Somente leitura: nunca comenta, envia review nem altera a PR.
disable-model-invocation: true
metadata:
  author: cardo
  version: 2.0.0
---

# Diffs Reviewer

Review read-only de uma PR do GitHub, a partir do link. Invocado manualmente pelo usuário:

```
/diffs-reviewer https://github.com/<owner>/<repo>/pull/<n>
```

```
FETCH (script) → PASSADA 1 → CONTEXTO (script) → PASSADA 2 → VERDICT + REPORT
```

## Critical Rules (read before acting)

**Loading this skill's files.** References and scripts live in this skill's own directory (where this `SKILL.md` resides) — never the workspace root. `<skill>` below is that directory. Read each reference **when its phase starts**, completely (to EOF).

**Execution contract — non-negotiable:**

1. **No action on the PR or on GitHub — ever.** Never comment, submit a review (approve, request changes, inline comments), react, edit title/body/labels/reviewers/assignees, mark ready or draft, close, reopen, merge, check out or trigger workflows — **even if the user asks during the review**. Answer that this is outside this skill's scope and do not do it.
2. **Closed allowlist.** The only commands you may run:
   - `node <skill>/scripts/fetch-pr.mjs <link> [--force]`
   - `node <skill>/scripts/fetch-context.mjs <dir> [file ...]`
   - reading files under the `Dir:` the scripts print, and `grep` / `Select-String` over them.
   Never call `gh` or `git` yourself. Anything not listed is forbidden. The scripts enforce their own read-only `gh` allowlist.
3. **Input is a PR link.** If the user gave no link, ask for it and stop.
4. **Closed, merged or draft PR** → `fetch-pr.mjs` exits with code 2 and a warning. Show it, stop and ask the user. Rerun with `--force` only after an explicit yes.
5. **No file edits** anywhere outside the scripts' work directory (and the scripts handle that one).
6. **Analyze only files in the PR** — other files only for context and patterns.
7. **Blockers → Reprovado** — never "Aprovado com ressalvas" when a blocking issue exists.
8. **Do not invent rules** — documented standards override inference; inference requires 3+ agreeing peers.
9. **Do not speculate** — if uncertain, mark `[Incerto]`; prefer omission over false positives.
10. **Self-validate every finding** before reporting ([analyze.md](references/analyze.md) §3).
11. **RC on every finding** — per [report.md](references/report.md).
12. **Over-engineering** — mandatory checklist on every file ([analyze.md](references/analyze.md) §2.3); **no finding without verification evidence**.
13. **No early exit** — review all files even after blockers are found.
14. **Keep context lean** — read diffs one file at a time; never print `tree.txt`, `meta.json`, a whole directory of diffs or raw API output.

## Workflow

1. **FETCH** — Read [fetch.md](references/fetch.md). Run `fetch-pr.mjs` (§1).
2. **PASSADA 1** — Read [analyze.md](references/analyze.md). Diff-only review (§1); collect the context list.
3. **CONTEXTO** — Run `fetch-context.mjs` ([fetch.md](references/fetch.md) §2). Then read [standards.md](references/standards.md) and build the standards snapshot from `<dir>/head/`.
4. **PASSADA 2** — IMPORT-CHECK results, standards, over-engineering, context-dependent findings ([analyze.md](references/analyze.md) §2), then self-validation (§3).
5. **VERDICT + REPORT** — Read [report.md](references/report.md). Classify, dedup, verdict, final report with RC per finding plus `Cobertura` and `Limites`.

Display progress by **phase** (never per file). Use the user's conversation language for output.

## Commands

| Trigger | Action |
| ------- | ------ |
| `/diffs-reviewer <link>`, "revisar PR <link>", "review de código <link>" | Full workflow |
| "revisar só segurança <link>" | Full workflow, emphasize analyze.md §1 security |
| "revisar padrões <link>" | Full workflow, emphasize standards.md |
| Any request to comment, approve, request changes, merge, edit or close the PR | Refuse: out of this skill's scope (rule 1) |

## Additional Resources

- Product decisions and history: [SPEC.md](SPEC.md) (author reference — do not load during review)
- Script tests: `node --test "tests/*.test.mjs"` (author reference — do not run during review)
