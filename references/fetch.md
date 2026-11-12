# FETCH and CONTEXTO — Running the scripts

**Goal:** Collect everything the review needs in **two commands**, via the skill's own scripts. You never call `gh` or `git` directly.

`<skill>` is the directory of this skill's `SKILL.md`. Both scripts need `gh` (authenticated) and Node ≥ 18.

---

## 1. `fetch-pr.mjs` — PR metadata and per-file diffs

```bash
node <skill>/scripts/fetch-pr.mjs <link-da-pr>
```

### Exit codes

| Code | Meaning | What you do |
| ---- | ------- | ----------- |
| 0 | Collected | Continue |
| 1 | Error (invalid link, `gh` missing / not authenticated / no access) | Show the message and stop |
| 2 | PR is CLOSED, MERGED or DRAFT — nothing collected | Show the warning, **stop and ask the user**. Only after an explicit yes: rerun with `--force` |
| 3 | No relevant file after the fixed exclusions | Tell the user "Nenhum arquivo relevante na PR." and stop |

### Output (always this shape)

```
PR #<n> <title> — <state> — base <base> ← head <sha7>
Intent:
  <PR body, up to 8 lines; or the commit subjects>
Arquivos (<N> analisados, <X> ignorados, <L> linhas, escopo <Small|Medium|Large>):
  M src/a.ts +12 -3
  D src/old.ts
  R src/b.ts ← src/b-old.ts +0 -0
Ignorados: <motivo n, …> | nenhum
Não alcançados: <files whose diff GitHub did not return> | nenhum
Dir: <dir>
```

- **Intent** is the PR intent used in PASSADA 1 (logic vs. stated goal). If the user pasted a description, it takes precedence.
- The diff of each file is at `<dir>/diffs/<path>.diff` (unified hunks, `@@` headers kept). Read one file at a time.
- Exclusions are fixed by the script (dependencies, lockfiles, build/generated, binaries, i18n JSON, `*.md`): do not reread ignored files.
- Tests are not excluded; use their diffs only to answer "does the change have tests?".
- `Não alcançados` and any warning line go to the report's `Cobertura` / `Limites`.

Progress message once FETCH completes:

```
[Fase 1/5] FETCH — PR #<n>: <N> arquivos (<X> ignorados), <L> linhas, escopo <S>
```

Omit `(<X> ignorados)` when X = 0.

---

## 2. `fetch-context.mjs` — context in one batch + IMPORT-CHECK

Run it **once**, after PASSADA 1, with the `Dir:` from §1 and up to **10** files you need for context (files the diff calls, extends or depends on that are not in the PR):

```bash
node <skill>/scripts/fetch-context.mjs <dir> src/services/order.ts src/base/schema.ts
```

With no extra files it still downloads docs and the module mirror and runs IMPORT-CHECK.

What it downloads into `<dir>/head/` (content at the PR head commit):

| Group | Contents | Cap |
| ----- | -------- | --- |
| Requested | the files you listed | 10 |
| Docs | `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.cursorrules`, `.github/copilot-instructions.md`, coding standards, `.cursor/rules/*` (≤5), and `CLAUDE.md` / `AGENTS.md` of every touched directory and its ancestors | 15 |
| Module mirror | code files of the directories touched by the PR (changed files first) | 60 files / 2 MB |
| IMPORT-CHECK | tsconfig/jsconfig chain, import targets (`export *` followed 2 levels), `package.json` files | 30 targets |

### Output

```
Contexto: <K> arquivos baixados (<p> pedidos, <d> docs, <m> espelho), <M> fora do teto[: lista]
Espelho truncado: <n> arquivos … não baixados          (only when the mirror hit its cap)
Não existem no head: <files>                           (only for requested files that do not exist)
IMPORT-CHECK: <n> imports em <f> arquivos — <b> bloqueantes, <r> ressalvas, <i> incertos
  [Bloqueante] src/a.ts:14 — "./utils/fmt" não existe no head (testado: …)
  [Ressalva]   src/a.ts:20 — pacote "left-pad" não declarado em package.json
  [Incerto]    src/b.ts:3 — "@/lib/x": alias não resolvido (tsconfig/jsconfig)
Falhas de leitura: <files>                             (only on network failure)
Dir: <dir>/head
```

- IMPORT-CHECK lines are **deterministic results**: use them as findings in PASSADA 2 (analyze.md §2.1). Only valid imports are omitted.
- `fora do teto`, `Espelho truncado` and `Falhas de leitura` go to the report's `Limites` as `contexto truncado: …`.
- Need something the batch did not bring? You may run the script **one more time** with up to 10 new files. Never more than two runs per review.

Progress message once CONTEXTO completes is the STANDARDS one (standards.md).
