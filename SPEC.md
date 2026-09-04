# Spec: diffs-reviewer v1

## Problem Statement

Desenvolvedores precisam revisar código localmente antes de subir para o GitHub, com uma ferramenta segura (read-only), sem integração GitHub, focada em problemas de alta relevância — com comentários PR-ready (RC) e detecção sistemática de over-engineering.

## Solution (v1)

Skill modular com execução adaptativa:

- Orquestrador `SKILL.md` + referências por fase em `references/`
- 5 fases: FETCH → STANDARDS → ANALYZE → VERDICT → REPORT
- **Trigger** composto para workers (TYPECHECK auto; ANALYZE workers com confirmação)
- **Auto-sizing com dentes** — comportamento muda por Small/Medium/Large
- Padrões: docs primeiro + inferência por módulo (peers adaptativos, máx 7)
- **TYPECHECK** — script do projeto → `tsc -p` / `tsc -b` por package; skip se ausente
- **RC obrigatório** em todo achado (template fixo, idioma do usuário)
- **Over-engineering** — checklist obrigatório em todo arquivo (severidade graduada)
- Veredito: bloqueantes = Reprovado; ressalvas = melhorias não-bloqueantes
- **Sem early exit** — review completa mesmo após bloqueantes
- Workers ativos quando trigger ON (contrato platform-agnostic)

## Decisions Log

| Decisão | Escolha | Versão |
| ------- | ------- | ------ |
| Diff scope | `git diff base...HEAD` (commits da branch) | v1 |
| Base branch | Auto-detect + override soft se usuário mencionar | v1 |
| Git | Read-only apenas | v1 |
| TYPECHECK | Script do projeto → `tsc -p` / `tsc -b` por package; skip se ausente | v1 |
| TYPECHECK worker | Auto quando trigger ON + typecheck path detectado | v1 |
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

## Canonical Rules (must not contradict)

These rules are law. Reference files must align; if conflict, SPEC wins.

1. **TYPECHECK:** script do projeto first; then `tsc -p` (single package) or `tsc -b` (monorepo package); never `tsc -- file1 file2`; never build as automatic fallback.
2. **Diff:** Large PR → hunks per file; never STANDARDS + full diff simultaneously.
3. **TYPECHECK worker:** auto only when trigger ON + typecheck path; compact return (no raw log).
4. **ANALYZE workers:** never auto — always offer-then-confirm; platform-agnostic contract.
5. **Peers:** per module; baseline 1–2; max 7; expand only if dimension ambiguous.
6. **RC:** mandatory on every finding; strict template; user's language.
7. **Over-engineering:** checklist on every file; graduated severity (see verdict.md).
8. **Review:** no early exit — all diff files analyzed.
9. **Bloqueante:** functional/security/typecheck impact only — never style-only OE.

## File Structure

```
diffs-reviewer/
├── SKILL.md
├── SPEC.md
├── .skill-meta.json
└── references/
    ├── fetch-diff.md
    ├── standards.md
    ├── analyze.md
    ├── verdict.md
    ├── report.md
    └── sub-agents.md
```

## Verdict Model

| Veredito | Condição |
| -------- | -------- |
| Aprovado | 0 bloqueantes, 0 ressalvas importantes |
| Aprovado com ressalvas | 0 bloqueantes, 1+ ressalvas |
| Reprovado | 1+ bloqueantes |

## Out of Scope

- Integração GitHub
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
- [ ] TYPECHECK via script do projeto (ex.: `npm run typecheck`)
- [ ] TYPECHECK monorepo via `tsc -b` no package afetado
- [ ] TYPECHECK skip quando sem tsconfig/script
- [ ] Trigger ON em PR 14 arquivos / 620 linhas → TYPECHECK worker auto
- [ ] Trigger OFF em PR 2 arquivos → sem worker
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
