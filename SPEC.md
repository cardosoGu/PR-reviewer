# Spec: diffs-reviewer v1.2

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
| Regressão | `tests/check-recipes.js` (fixture + receitas extraídas do texto) | v1.2 |

## Canonical Rules (must not contradict)

These rules are law. Reference files must align; if conflict, SPEC wins.

1. **TYPECHECK:** never automatic; on request only, background, 120s timeout; script do projeto first, then `tsc -p` / `tsc -b`; never `tsc -- file1 file2`; never build as automatic fallback.
2. **Diff:** Large PR → hunks per file; never STANDARDS + full diff simultaneously; diff content and line counts only over filtered files.
3. **TYPECHECK execution:** background shell command, filtered output (no raw log), no worker; `typecheck.md` loaded only on request.
4. **ANALYZE workers:** never auto — offer-then-confirm at ≥25 files or >1500 diff lines; IMPORT-CHECK and Bloqueante re-verification stay with the orchestrator; platform-agnostic contract.
5. **Peers:** per module; 3 excerpts baseline; max 5; expand only if dimension ambiguous; never whole files.
6. **RC:** mandatory on every finding; strict template; user's language.
7. **Over-engineering:** checklist on every file; graduated severity (see report.md).
8. **Review:** no early exit — all diff files analyzed.
9. **Bloqueante:** functional/security/typecheck impact only — never style-only OE.
10. **IMPORT-CHECK:** always on, all scopes, no checkout; broken import/export/orphan importer → Bloqueante; ambiguity → `[Incerto]`.
11. **Git:** only network command is `git fetch --no-tags origin <base>`; comparison uses `origin/<base>` when it exists.
12. **Over-engineering:** no finding without verification evidence.
13. **Context:** never an unfiltered `git ls-tree -r`; IMPORT-CHECK batched per step, not per import.

## File Structure

```
diffs-reviewer/
├── SKILL.md
├── SPEC.md
├── .skill-meta.json
├── references/
│   ├── fetch-diff.md
│   ├── standards.md
│   ├── analyze.md
│   ├── typecheck.md      (só sob pedido)
│   ├── report.md         (VERDICT + REPORT)
│   └── sub-agents.md     (só PRs muito grandes)
└── tests/
    ├── check-recipes.js
    └── expected-review.md
```

## Verdict Model

| Veredito | Condição |
| -------- | -------- |
| Aprovado | 0 bloqueantes, 0 ressalvas importantes |
| Aprovado com ressalvas | 0 bloqueantes, 1+ ressalvas |
| Reprovado | 1+ bloqueantes |

## Out of Scope

- Integração GitHub
- Integração gh (descartada em v1.1)
- ESLint automático
- Regras de domínio
- Cache de padrões entre execuções
- `.reviewrc` config file
- Diff uncommitted (staged/unstaged)

## v2 Roadmap

- Modo diff uncommitted / full
- TYPECHECK multi-stack (Go, Rust, Python)
- Regras de domínio inline ou via spec file
- Eixo Spec (issue/PRD vs código)

## Testing Checklist

- [ ] Auto-detect base em repo com main
- [ ] Override soft `base=develop`
- [ ] Branch main vs main → aviso correto
- [ ] TYPECHECK via script do projeto (ex.: `npm run typecheck`) (sob pedido)
- [ ] TYPECHECK monorepo via `tsc -b` no package afetado (sob pedido)
- [ ] TYPECHECK skip quando sem tsconfig/script (sob pedido)
- [ ] PR com 30 arquivos → oferta de ANALYZE workers (avisa custo); PR com 14 arquivos → sem oferta
- [ ] Lockfile grande no diff não muda o escopo
- [ ] `node tests/check-recipes.js` → ALL PASS
- [ ] Large PR → hunks por arquivo, não diff completo em STANDARDS
- [ ] Docs em `.cursor/rules/` detectados
- [ ] Inferência por módulo; expansão peers se ambíguo
- [ ] Over-engineering: plugin duplicado → Ressalva + RC
- [ ] Import inexistente → Bloqueante + RC template
- [ ] RC presente em bloqueantes, ressalvas e sugestões
- [ ] Bloqueante → Reprovado (nunca ressalvas)
- [ ] Review completa com bloqueante no 1º arquivo (sem early exit)
- [ ] Progresso por fases exibido
- [ ] Idioma segue usuário (RC PT ou EN)
- [ ] ANALYZE workers: pergunta antes; declina → sequencial
- [ ] Import relativo inexistente → Bloqueante + RC com evidência
- [ ] Import com alias de `tsconfig.paths` resolvido corretamente (existente e inexistente)
- [ ] Convenção ESM `./x.js` resolve para `x.ts`
- [ ] Export nomeado inexistente em módulo local → Bloqueante
- [ ] `export *` encadeado / resolução ambígua → `[Incerto]`, não Bloqueante
- [ ] Arquivo deletado ainda importado → Reprovado com lista de importadores
- [ ] Pacote externo novo ausente do `package.json` → achado
- [ ] Monorepo: alias e `package.json` do package correto
- [ ] TYPECHECK não roda por padrão; relatório mostra `não solicitado`
- [ ] TYPECHECK solicitado: roda em background; estouro de 120s gera aviso e review continua
- [ ] `origin/<base>` usada quando existe; fallback para base local sem remoto
- [ ] Fetch falha (offline) → aviso de ref possivelmente velha, review prossegue
- [ ] Nenhum `pull`/`checkout`/`fetch` fora de `git fetch --no-tags origin <base>`
- [ ] Dead code: export novo sem referências → Ressalva com grep no RC
- [ ] Duplicated infra: plugin já na base → Ressalva com trecho da base
- [ ] Sinal de OE sem confirmação → não reportado
- [ ] Repo grande: greps restritos ao módulo, review conclui em tempo razoável
- [ ] Monorepo: nenhuma listagem completa de arquivos aparece no contexto
