# Spec: diffs-reviewer v2.1

## Problem Statement

Desenvolvedores precisam revisar código localmente antes de subir para o GitHub, com uma ferramenta segura (read-only), sem integração GitHub, focada em problemas de alta relevância — com comentários PR-ready (RC) e detecção sistemática de over-engineering.

## Solution (v2.1)

Skill modular com execução adaptativa:

- Orquestrador `SKILL.md` + referências por fase em `references/`
- 5 fases: FETCH → STANDARDS → ANALYZE → VERDICT → REPORT
- **Trigger** composto para sub-agentes (TSC auto; ANALYZE workers com confirmação)
- **Auto-sizing com dentes** — comportamento muda por Small/Medium/Large
- Padrões: docs primeiro + inferência por módulo (peers adaptativos, máx 7)
- **TSC diff-scoped only** — nunca projeto inteiro como default
- **RC obrigatório** em todo achado (template fixo, idioma do usuário)
- **Over-engineering** — checklist obrigatório em todo arquivo (severidade graduada)
- Veredito: bloqueantes = Reprovado; ressalvas = melhorias não-bloqueantes
- **Sem early exit** — review completa mesmo após bloqueantes
- Sub-agentes ativos quando trigger ON

## Decisions Log

| Decisão | Escolha | Versão |
| ------- | ------- | ------ |
| Diff scope | `git diff base...HEAD` (commits da branch) | v2 |
| Base branch | Auto-detect + override soft se usuário mencionar | v2 |
| Git | Read-only apenas | v2 |
| TSC | Diff-scoped only (`tsc -p … -- file1 file2`) | v2.1 |
| TSC sub-agent | Auto quando trigger ON | v2.1 |
| ESLint | Não roda | v2 |
| Padrões | Docs + inferência por módulo (2 peers, expande até 7) | v2.1 |
| Diff handoff | Large = hunks; Small/Medium = diff compacto ok | v2.1 |
| Trigger | `(files>8 AND lines>400) OR files>12 OR lines>800` | v2.1 |
| ANALYZE workers | Offer-then-confirm, Large scope | v2.1 |
| RC | Template fixo PT/EN, todo achado | v2.1 |
| Over-engineering | Sempre detectar; severidade graduada | v2.1 |
| Early exit | Desligado — review até o final | v2.1 |
| Regras de domínio | Fora de escopo | v1 |
| Idioma output | Idioma do usuário | v2 |
| Progresso | Por fases (1/5 … 5/5) | v2 |
| Local | `~/.cursor/skills/diffs-reviewer/` | v2 |

## Canonical Rules (must not contradict)

These rules are law. Reference files must align; if conflict, SPEC wins.

1. **TSC:** always diff-scoped; never full-project `tsc` as default.
2. **Diff:** Large PR → hunks per file; never STANDARDS + full diff simultaneously.
3. **Sub-agent TSC:** auto only when trigger ON; compact return (no raw log).
4. **ANALYZE workers:** never auto — always offer-then-confirm.
5. **Peers:** per module; baseline 1–2; max 7; expand only if dimension ambiguous.
6. **RC:** mandatory on every finding; strict template; user's language.
7. **Over-engineering:** checklist on every file; graduated severity (see verdict.md).
8. **Review:** no early exit — all diff files analyzed.
9. **Bloqueante:** functional/security/TSC impact only — never style-only OE.

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

## v3 Roadmap

- Modo diff uncommitted / full
- Detecção de linguagem (ruff, go vet, etc.)
- Regras de domínio inline ou via spec file
- Eixo Spec (issue/PRD vs código)

## Testing Checklist

- [ ] Auto-detect base em repo com main
- [ ] Override soft `base=develop`
- [ ] Branch main vs main → aviso correto
- [ ] TSC diff-scoped (não projeto inteiro)
- [ ] Trigger ON em PR 14 arquivos / 620 linhas → TSC sub-agente auto
- [ ] Trigger OFF em PR 2 arquivos → sem sub-agente
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
