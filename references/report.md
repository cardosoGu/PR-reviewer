# REPORT — Output Format

**Goal:** Emit phased progress during execution and a clear final report in the **user's conversation language**.

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

## Final Report Template

```markdown
Veredito: [Aprovado | Aprovado com ressalvas | Reprovado]

Problemas bloqueantes: [N]
Ressalvas: [R]
Sugestões: [S]

Branch: [current] → base: [base] ([M] commits, [F] arquivos)

---

## Problemas bloqueantes

### [arquivo:linha] Título curto

\`\`\`
[código com problema]
\`\`\`

Por que é bloqueante: [explicação]
Sugestão: [correção]

---

## Ressalvas (não bloqueante)

### [arquivo:linha] Título curto

[explicação]
Sugestão: [melhoria]

---

## Sugestões (opcional)

- [sugestão 1]
- [sugestão 2]
```

---

## Empty States

**No blockers, no ressalvas:**

```markdown
Veredito: Aprovado

Problemas bloqueantes: 0
Ressalvas: 0
Sugestões: [S]

Nenhum problema de alta relevância encontrado.
```

**No blockers, with ressalvas:**

```markdown
Veredito: Aprovado com ressalvas

Nenhum problema bloqueante. [R] ressalva(s) recomendada(s) abaixo.
```

**Blockers present:**

```markdown
Veredito: Reprovado

[N] problema(s) bloqueante(s) deve(m) ser corrigido(s) antes do merge.
```

---

## Formatting Rules

1. **Objective** — every issue tied to file:line and code snippet
2. **No speculation** — use `[Incerto]` when unsure
3. **Separate sections** — bloqueantes, ressalvas, sugestões never mixed
4. **Counters in header** — quick overview
5. **Plain text friendly** — readable in terminal/chat without complex formatting
6. **Large PRs** — group findings by file within each section

---

## Progress Message (final)

```
[Fase 5/5] REPORT — concluído
```

Then output the full report below.
