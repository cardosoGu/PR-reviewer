# VERDICT + REPORT — Classify and Output

**Goal:** Classify every finding, dedup, assign the verdict, and emit the final report in the **user's conversation language** with an **RC** on every finding.

**Completion criterion:** Every finding classified and deduplicated; verdict assigned; full report emitted with an RC line per finding.

---

## Severity Levels

### Bloqueante (→ Reprovado)

- Type errors evident in the diff that break the build (manual reading — no typecheck runs)
- Logic bugs with clear functional impact (including a confirmed intent mismatch)
- Serious security vulnerabilities; data loss or state corruption risk
- Documented standard violation that **causes incorrect behavior**
- Over-engineering with **proven functional impact** (e.g. double-applied plugin causing a runtime error)
- **Broken import** (IMPORT-CHECK `[Bloqueante]` lines from `fetch-context.mjs`): path that does not resolve, named export that does not exist, deleted/renamed file still imported — with its evidence

**Never bloqueante:** style-only over-engineering, naming, or pattern mismatch without functional impact.

### Ressalva (non-blocking — drives "Aprovado com ressalvas")

- Refactoring opportunities (duplication, long functions); missing tests for risky logic
- Pattern mismatches and documented style violations without bug impact
- Performance concerns that are not O(n²) on hot paths
- **Over-engineering:** duplicated infra, unnecessary abstraction layer, middle man with maintenance cost
- Undeclared external package in a new import (IMPORT-CHECK `[Ressalva]`)

### Sugestão (optional — never changes the verdict alone)

- Readability tweaks, alternative idioms, optional extractions, low-impact performance notes
- **Over-engineering:** future-only params, minor wrapper
- Any `[Incerto]` finding (IMPORT-CHECK or over-engineering)

### Over-engineering (evidence is mandatory — analyze.md §2.3)

| Signal | Severity |
| ------ | -------- |
| Duplicated plugin/middleware (base snippet cited) | **Ressalva** |
| Abstraction layer unused in module (usage count cited) | **Ressalva** |
| Dead module-private export with 0 references in the mirror (grep cited; exclusions in analyze.md §2.3) | **Ressalva** |
| Public export with 0 references in the mirror (repo-wide not verifiable) | **Sugestão** `[Incerto]` |
| Middle man / unnecessary wrapper | **Ressalva** or **Sugestão** |
| Future-only flag or param; `[Incerto]` signal | **Sugestão** |
| Proven runtime/build break | **Bloqueante** |

---

## Verdict

| Condition | Verdict |
| --------- | ------- |
| 0 bloqueantes, 0 ressalvas | **Aprovado** |
| 0 bloqueantes, 1+ ressalvas | **Aprovado com ressalvas** |
| 1+ bloqueantes | **Reprovado** |

**Hard rule:** any bloqueante → **Reprovado**, never "Aprovado com ressalvas".

**Dedup and rank:** merge findings with the same line/root cause (one RC, combined); sort bloqueantes security > data loss > logic > types; ressalvas consistency > over-engineering > readability.

```
[Fase 5/5] VERDICT — <veredito>: <N> bloqueantes, <R> ressalvas, <S> sugestões
```

---

## RC — Review Comment (mandatory)

Every finding has one **RC** line — short, PR-ready, collaborative.

```
RC: Parece que [observação concreta com símbolo/path/classe], poderia verificar por favor?
RC: It looks like [concrete observation with symbol/path/class] — could you verify please?
```

| Rule | Detail |
| ---- | ------ |
| Length | 1–2 sentences, ~15–40 words; `por gentileza` is fine instead of `por favor` |
| Tone | Question, not accusation — "Parece que…" / "It looks like…" |
| Content | Name the symbol, import, path, extends/implements or duplicate relationship |
| `[Incerto]` | "Parece que… poderia confirmar se…?" / "It looks like… could you confirm whether…?" |
| Evidence | IMPORT-CHECK and over-engineering RCs name the evidence (path tested, grep result, base snippet) |
| Distinct from | "Por que…" / "Sugestão" stay technical; the RC is what gets pasted on the PR |

Examples:

```
RC: Parece que `ProposalSituationRecordsErros` importado não existe em `ProposalSituationRecords/ProposalSituationRecords`, poderia verificar por gentileza?
RC: O plugin `aggregatePaginate` já é aplicado em `baseSchema`, que `RankingGoalsSchemaClass` estende — poderia verificar se é necessário aplicar novamente?
RC: Parece que `src/old.ts` foi removido neste PR mas ainda é importado em `src/user.ts:1`, poderia verificar por favor?
RC: Parece que o export `neverUsed` em `src/dead.ts` não tem nenhuma referência no módulo, poderia verificar se ainda é necessário?
```

---

## Final Report

```
[Fase 5/5] REPORT — concluído
```

Then:

```markdown
Veredito: [Aprovado | Aprovado com ressalvas | Reprovado]

Problemas bloqueantes: [N]
Ressalvas: [R]
Sugestões: [S]

PR: [link] — [título] (head [sha7], [F] arquivos, escopo [S])
IMPORT-CHECK: [ok | N achados (B bloqueantes, R ressalvas, I incertos)]

[Resumo de uma linha — ver abaixo]

---

## Problemas bloqueantes

### [arquivo:linha] Título curto

\`\`\`
[código com problema]
\`\`\`

Por que é bloqueante: [explicação]
Sugestão: [correção]
RC: Parece que …, poderia verificar por favor?

---

## Ressalvas (não bloqueante)

### [arquivo:linha] Título curto
(same shape: snippet, explanation, Sugestão, RC)

---

## Sugestões (opcional)

### [arquivo:linha] Título curto

[explicação]
RC: Parece que …, poderia verificar por favor?

---

Cobertura: [A] analisados, [G] ignorados por regra ([motivo n, …]), [U] não alcançados ([lista] | nenhum)
Limites: tipos não verificados (sem typecheck); importadores fora da diff e do espelho de arquivos removidos não verificados[; contexto truncado: <o que ficou de fora>]
```

**One-line summary by verdict:**

- Aprovado → `Nenhum problema de alta relevância encontrado.`
- Aprovado com ressalvas → `Nenhum problema bloqueante. [R] ressalva(s) recomendada(s) abaixo.`
- Reprovado → `[N] problema(s) bloqueante(s) deve(m) ser corrigido(s) antes do merge.`

**Empty sections are omitted**, but the header (verdict, counters, PR line, IMPORT-CHECK line) and the closing `Cobertura` and `Limites` lines always appear. IMPORT-CHECK counts come from `fetch-context.mjs` after your self-validation (a finding you discarded is not counted); `N = B + R + I`, `ok` = zero findings. `Cobertura` copies the counts from `fetch-pr.mjs` (`Ignorados`, `Não alcançados`). `Limites` adds `contexto truncado: …` whenever `fetch-context.mjs` printed `fora do teto`, `Espelho truncado` or `Falhas de leitura`.

## Formatting Rules

1. Every issue tied to file:line and a snippet (when applicable)
2. RC always — no finding without RC
3. `[Incerto]` when unsure — no speculation
4. Sections never mixed; counters in the header
5. Plain-text friendly (terminal/chat)
6. Large PRs — group findings by file within each section
