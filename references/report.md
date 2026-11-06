# REPORT — Output Format

**Goal:** Emit phased progress during execution and a clear final report in the **user's conversation language**, with **RC** on every finding.

**Completion criterion:** Full report emitted; every finding in all sections has an RC line.

---

## Progress Phases

Display these five phase markers during the workflow (from respective reference files):

```
[Fase 1/5] FETCH — ...
[Fase 2/5] STANDARDS — ...
[Fase 3/5] ANALYZE — ...
[Fase 4/5] VERDICT — ...
[Fase 5/5] REPORT — gerando relatório
```

Language: match the user's language (Portuguese if user writes in Portuguese, English if in English).

---

## RC — Review Comment (mandatory)

Every finding in **Problemas bloqueantes**, **Ressalvas**, and **Sugestões** must include one **RC** line — short, PR-ready, collaborative tone.

### Template (strict)

**Portuguese:**

```
RC: Parece que [observação concreta com símbolo/path/classe], poderia verificar por favor?
```

Variant: `por gentileza` instead of `por favor` — either is fine.

**English:**

```
RC: It looks like [concrete observation with symbol/path/class] — could you verify please?
```

### RC rules

| Rule | Detail |
| ---- | ------ |
| Length | 1–2 sentences, ~15–40 words |
| Tone | Question, not accusation — "Parece que…" / "It looks like…" |
| Content | Name symbol, import, path, extends/implements, or duplicate relationship |
| `[Incerto]` | "Parece que… poderia confirmar se…?" / "It looks like… could you confirm whether…?" |
| Evidence | When the finding comes from IMPORT-CHECK or an over-engineering signal, the RC names the evidence (path tested, grep result, base-class snippet) |
| Distinct from | "Por que…" / "Sugestão" stay technical; RC is what you paste on the PR |

### RC examples

```
RC: Parece que esse objeto importado não existe em `globals/MongoDB`, poderia verificar por favor?

RC: O plugin `aggregatePaginate` já é aplicado em `baseSchema`, que `RankingGoalsSchemaClass` estende — poderia verificar se é necessário aplicar novamente?

RC: Parece que `ProposalSituationRecordsErros` importado não existe em `ProposalSituationRecords/ProposalSituationRecords`, poderia verificar por gentileza?

RC: Parece que `src/old.ts` foi removido neste PR mas ainda é importado em `src/user.ts:1`, poderia verificar por favor?

RC: Parece que o export `neverUsed` em `src/dead.ts` não tem nenhuma referência no repositório, poderia verificar se ainda é necessário?
```

---

## Final Report Template

```markdown
Veredito: [Aprovado | Aprovado com ressalvas | Reprovado]

Problemas bloqueantes: [N]
Ressalvas: [R]
Sugestões: [S]

Branch: [current] → base: [base] ([M] commits, [F] arquivos)
IMPORT-CHECK: [ok | N achados (B bloqueantes, I incertos)]
TYPECHECK: [não solicitado | ok | timeout | skipped]

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

\`\`\`
[código]
\`\`\`

[explicação]
Sugestão: [melhoria]
RC: Parece que …, poderia verificar por favor?

---

## Sugestões (opcional)

### [arquivo:linha] Título curto

[explicação]
RC: Parece que …, poderia verificar por favor?
```

For suggestion-only items without a code block, RC is still mandatory.

---

## Empty States

The two status lines (`IMPORT-CHECK`, `TYPECHECK`) appear in every report, including empty states, placed as in the Final Report Template.

**No blockers, no ressalvas:**

```markdown
Veredito: Aprovado

Problemas bloqueantes: 0
Ressalvas: 0
Sugestões: [S]
IMPORT-CHECK: [ok | N achados (B bloqueantes, I incertos)]
TYPECHECK: [não solicitado | ok | timeout | skipped]

Nenhum problema de alta relevância encontrado.
```

**No blockers, with ressalvas:**

```markdown
Veredito: Aprovado com ressalvas
IMPORT-CHECK: [ok | N achados (B bloqueantes, I incertos)]
TYPECHECK: [não solicitado | ok | timeout | skipped]

Nenhum problema bloqueante. [R] ressalva(s) recomendada(s) abaixo.
```

**Blockers present:**

```markdown
Veredito: Reprovado
IMPORT-CHECK: [ok | N achados (B bloqueantes, I incertos)]
TYPECHECK: [não solicitado | ok | timeout | skipped]

[N] problema(s) bloqueante(s) deve(m) ser corrigido(s) antes do merge.
```

---

## Formatting Rules

1. **Objective** — every issue tied to file:line and code snippet (when applicable)
2. **RC always** — no finding without RC
3. **No speculation** — use `[Incerto]` when unsure
4. **Separate sections** — bloqueantes, ressalvas, sugestões never mixed
5. **Counters in header** — quick overview
6. **Plain text friendly** — readable in terminal/chat without complex formatting
7. **Large PRs** — group findings by file within each section

---

## Progress Message (final)

```
[Fase 5/5] REPORT — concluído
```

Then output the full report below.
