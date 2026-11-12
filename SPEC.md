# Spec: diffs-reviewer v2.0

## Problem Statement

Desenvolvedores precisam revisar código localmente antes de subir para o GitHub, com uma ferramenta segura (read-only), sem integração GitHub, focada em problemas de alta relevância — com comentários PR-ready (RC) e detecção sistemática de over-engineering.

## Solution (v1)

Skill modular com execução adaptativa:

- Orquestrador `SKILL.md` + referências por fase em `references/`
- 5 fases: FETCH → STANDARDS → ANALYZE → VERDICT → REPORT
- **Trigger** composto para workers (ANALYZE workers com confirmação; TYPECHECK só sob pedido desde v1.1)
- **Auto-sizing com dentes** — comportamento muda por Small/Medium/Large
- Padrões: docs primeiro + inferência por módulo (peers adaptativos, máx 7)
- **TYPECHECK** — script do projeto → `tsc -p` / `tsc -b` por package; skip se ausente (superado em v1.1)
- **RC obrigatório** em todo achado (template fixo, idioma do usuário)
- **Over-engineering** — checklist obrigatório em todo arquivo (severidade graduada)
- Veredito: bloqueantes = Reprovado; ressalvas = melhorias não-bloqueantes
- **Sem early exit** — review completa mesmo após bloqueantes
- Workers ativos quando trigger ON (contrato platform-agnostic)

## v1.1 changes

Spec de design completa: `Specs-Cardoso/skills/diffs-reviewer/2026-11-06-diffs-reviewer-v1.1-design.md`.

- **IMPORT-CHECK** determinístico sempre ligado (analyze.md §0): resolve imports contra HEAD, valida exports nomeados, checa arquivos deletados/renomeados ainda importados e pacotes novos.
- **TYPECHECK opt-in**: nunca automático; sob pedido, em background, timeout 120s.
- **Over-engineering com verificação ativa**: cada sinal exige "como confirmar"; sem evidência, sem achado.
- **Fluxo git**: compara com `origin/<base>`; único comando de rede é `git fetch --no-tags origin <base>`.

## v1.2 changes

- **Tokens:** IMPORT-CHECK em lote (≈6 comandos por review, não por import); `git ls-tree -r` sempre filtrado; TYPECHECK movido para `references/typecheck.md` (carregado só sob pedido); `verdict.md` fundido em `report.md`; peers lidos por trecho (≤60 linhas + greps), máx 5 por módulo; diff e contagem de linhas só sobre arquivos filtrados (lockfiles não inflam o escopo).
- **Qualidade:** intenção da PR (mensagens de commit) usada em ANALYZE §2.2; Small lê 3 peers (inferência exige 3+); allowlist única em `fetch-diff.md`; trigger removido.
- **Workers:** sem worker de TYPECHECK (comando em background); ANALYZE workers só a partir de 25 arquivos ou 1500 linhas; IMPORT-CHECK, passada entre lotes e reverificação de Bloqueantes ficam no orquestrador; lotes por módulo; Bloqueante de worker exige evidência.
- **Teste:** `tests/check-recipes.js` monta um fixture e valida as receitas copiadas do `analyze.md`.

## v2.0 changes

Design completo: `docs/superpowers/specs/2026-11-12-diffs-reviewer-v2-design.md`.

- **Entrada por link da PR**; coleta 100% via `gh` (sem repo local, checkout ou `git fetch`).
- **Dois scripts Node** (`scripts/fetch-pr.mjs`, `scripts/fetch-context.mjs`) fazem a coleta em 2 turnos, em paralelo; o modelo só analisa.
- **Somente leitura reforçado**: nenhuma ação na PR, mesmo a pedido; `runGh` aplica allowlist fechada com teste para cada caso proibido.
- **IMPORT-CHECK** portado para JS dentro de `fetch-context.mjs`; Step D limitado à diff + espelho do módulo.
- **Removidos**: TYPECHECK, workers, `base=`, review pré-PR.
- **Análise** em duas passadas (só diff, depois com contexto) + autovalidação obrigatória.
- **Relatório** com linhas fixas de Cobertura e Limites.

## Decisions Log

| Decisão | Escolha | Versão |
| ------- | ------- | ------ |
| Diff scope | `git diff base...HEAD` (commits da branch) | v1 |
| Base branch | Auto-detect + override soft se usuário mencionar | v1 |
| Git | Read-only apenas | v1 |
| TYPECHECK | Script do projeto → `tsc -p` / `tsc -b` por package; skip se ausente | v1 |
| TYPECHECK worker | Auto quando trigger ON + typecheck path detectado (superado em v1.1) | v1 |
| ESLint | Não roda | v1 |
| Padrões | Docs + inferência por módulo (2 peers, expande até 7) | v1 |
| Diff handoff | Large = hunks; Small/Medium = diff compacto ok | v1 |
| Trigger | `(files>8 AND lines>400) OR files>12 OR lines>800` | v1 |
| ANALYZE workers | Offer-then-confirm, Large scope | v1 |
| RC | Template fixo PT/EN, todo achado | v1 |
| Over-engineering | Sempre detectar; severidade graduada | v1 |
| Early exit | Desligado — review até o final | v1 |
| Regras de domínio | Fora de escopo | v1 |
| Idioma output | Idioma do usuário | v1 |
| Progresso | Por fases (1/5 … 5/5) | v1 |
| Local | `~/.cursor/skills/diffs-reviewer/` | v1 |
| TYPECHECK | Opt-in; background; timeout 120s (substitui auto quando trigger ON) | v1.1 |
| Import verification | IMPORT-CHECK determinístico sempre ligado, sem checkout | v1.1 |
| Over-engineering | Verificação ativa por sinal; sem evidência, sem achado | v1.1 |
| Base de comparação | `origin/<base>` + `git fetch --no-tags origin <base>` restrito | v1.1 |
| gh | Descartado (superfície de escrita no GitHub) | v1.1 |
| IMPORT-CHECK | Em lote: um comando por etapa para a PR inteira | v1.2 |
| TYPECHECK | Comando em background com saída filtrada; sem worker | v1.2 |
| Trigger | Removido; escopo (Small/Medium/Large) e limiar de workers (≥25 arquivos ou >1500 linhas) | v1.2 |
| Padrões | 3 peers por trecho em todo escopo; +2 se misto; máx 5; Large até 6 módulos | v1.2 |
| ANALYZE workers | ≥25 arquivos ou >1500 linhas; lotes por módulo; orquestrador reverifica Bloqueantes | v1.2 |
| Intenção da PR | Mensagens de commit (últimos 30) usadas na análise de lógica | v1.2 |
| Fonte da diff | `gh` a partir do link da PR (substitui `git diff base...HEAD`) | v2.0 |
| gh | Adotado, só leitura, allowlist fechada no código (substitui "descartado") | v2.0 |
| Coleta | Scripts Node, 2 turnos, chamadas em paralelo | v2.0 |
| TYPECHECK | Removido | v2.0 |
| ANALYZE workers | Removidos; agente único em duas passadas | v2.0 |
| PR fechada/mergeada/draft | Para e pede confirmação (`--force`) | v2.0 |
| Ações na PR | Proibidas, mesmo a pedido do usuário | v2.0 |
| Regressão | `tests/check-recipes.js` (fixture + receitas extraídas do texto) | v1.2 |

## Canonical Rules (must not contradict)

These rules are law. Reference files must align; if conflict, SPEC wins.

1. **Somente leitura:** nenhuma ação na PR nem no GitHub (comentar, review, reagir, editar, ready/draft, fechar, reabrir, merge, checkout, workflows), mesmo a pedido do usuário.
2. **Allowlist:** o modelo só roda `scripts/fetch-pr.mjs` e `scripts/fetch-context.mjs` e lê/grepa `<dir>`; nunca chama `gh` ou `git`. Os scripts só usam `gh pr view`, `gh pr diff` e `gh api` GET em três endpoints, via `runGh`.
3. **Entrada:** link da PR; PR fechada/mergeada/draft → para e pede confirmação (`--force`).
4. **Diff:** lido um arquivo por vez de `<dir>/diffs/`; nunca a diff inteira no contexto; contagem de linhas só sobre arquivos não ignorados.
5. **Peers:** por módulo, a partir do espelho em `<dir>/head/`; 3 trechos de base; máx 5; nunca arquivos inteiros.
6. **RC:** obrigatório em todo achado; template fixo; idioma do usuário.
7. **Over-engineering:** checklist em todo arquivo; severidade graduada; sem evidência, sem achado; export público sem referência no espelho → no máximo Sugestão `[Incerto]`.
8. **Review:** sem early exit — todos os arquivos relevantes analisados nas duas passadas.
9. **Bloqueante:** só impacto funcional, de segurança ou de build — nunca OE só de estilo.
10. **IMPORT-CHECK:** sempre ligado, determinístico, no `fetch-context.mjs`; import/export quebrado ou arquivo removido ainda importado → Bloqueante; ambiguidade → `[Incerto]`.
11. **Autovalidação:** todo achado relido e confirmado (existe, ocorre como escrito, é novo) antes do relatório.
12. **Linhas:** sempre calculadas do `@@` ou do arquivo em `<dir>/head/`, nunca estimadas.
13. **Relatório:** sempre com as linhas `Cobertura` e `Limites`.

## File Structure

```
diffs-reviewer/
├── SKILL.md
├── SPEC.md
├── README.md
├── .skill-meta.json
├── scripts/
│   ├── fetch-pr.mjs          (fase 1)
│   ├── fetch-context.mjs     (fase 3 + IMPORT-CHECK)
│   └── lib/                  (gh, workdir, diff, filter, imports, resolve, exports, select)
├── references/
│   ├── fetch.md
│   ├── analyze.md
│   ├── standards.md
│   └── report.md             (VERDICT + REPORT)
├── tests/                    (node --test "tests/*.test.mjs")
└── docs/superpowers/         (spec e plano da v2)
```

## Verdict Model

| Veredito | Condição |
| -------- | -------- |
| Aprovado | 0 bloqueantes, 0 ressalvas importantes |
| Aprovado com ressalvas | 0 bloqueantes, 1+ ressalvas |
| Reprovado | 1+ bloqueantes |

## Out of Scope

- Qualquer escrita no GitHub (comentários, reviews, edição da PR)
- Review sem PR (diff local / pré-PR)
- TYPECHECK e ESLint
- Workers / revisores paralelos (`--deep` fica para o futuro)
- Regras de domínio
- Cache de padrões entre execuções

## Roadmap

- `--deep`: revisores paralelos + validação por subagente para PR crítica
- IMPORT-CHECK para outras linguagens
- Regras de domínio inline ou via spec file
- Eixo Spec (issue/PRD vs código)

## Testing Checklist

- [ ] `node --test "tests/*.test.mjs"` → todos passam
- [ ] PR aberta → coleta; PR mergeada/fechada/draft → para com código 2; `--force` continua
- [ ] Link inválido ou `gh` sem auth → mensagem curta, código 1
- [ ] Tentativa de `gh pr comment` / `review` / `merge` → bloqueada por `runGh`
- [ ] Pedido do usuário para comentar/aprovar durante a review → recusado
- [ ] Lockfile, i18n JSON e `.md` não entram na contagem nem na análise
- [ ] Arquivo sem `patch` na API → vem do `gh pr diff`; se falhar, aparece em `Não alcançados`
- [ ] Import relativo inexistente → Bloqueante com evidência
- [ ] Alias de `tsconfig.paths` (com `extends`) resolvido
- [ ] Convenção ESM `./x.js` resolve para `x.ts`
- [ ] Export nomeado inexistente → Bloqueante; `export *` / CommonJS → `[Incerto]`
- [ ] Arquivo removido ainda importado (diff ou espelho) → Bloqueante
- [ ] Pacote externo não declarado → Ressalva (`[Incerto]` em monorepo)
- [ ] Import escrito dentro de string não vira achado
- [ ] Docs de padrões e espelho do módulo baixados para `<dir>/head/`
- [ ] Over-engineering: plugin duplicado → Ressalva com trecho da base
- [ ] Achado que falha a autovalidação → descartado
- [ ] RC presente em bloqueantes, ressalvas e sugestões
- [ ] Bloqueante → Reprovado (nunca ressalvas)
- [ ] Relatório com `Cobertura` e `Limites`
- [ ] Progresso por fases; idioma segue o usuário
