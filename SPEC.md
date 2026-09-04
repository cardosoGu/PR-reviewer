# Spec: diffs-reviewer v2

## Problem Statement

Desenvolvedores precisam revisar código localmente antes de subir para o GitHub, com uma ferramenta segura (read-only), sem integração GitHub, focada em problemas de alta relevância.

## Solution (v2)

Skill modular:

- Orquestrador `SKILL.md` + referências por fase em `references/`
- 5 fases: FETCH → STANDARDS → ANALYZE → VERDICT → REPORT
- Padrões: docs primeiro + inferência conservadora (3+ ocorrências)
- TSC opcional, filtrado aos arquivos do diff; sem ESLint
- Veredito: bloqueantes = Reprovado; ressalvas = melhorias não-bloqueantes
- v1: agente único; v2: sub-agentes documentados em `references/sub-agents.md`

## Decisions Log

| Decisão | Escolha | Versão |
| ------- | ------- | ------ |
| Diff scope | `git diff base...HEAD` (commits da branch) | v2 |
| Base branch | Auto-detect + override soft se usuário mencionar | v2 |
| Git | Read-only apenas | v2 |
| TSC | Só erros em arquivos do diff | v2 |
| ESLint | Não roda | v2 |
| Padrões | Docs + inferência conservadora | v2 |
| Regras de domínio | Fora de escopo | v1 |
| Idioma output | Idioma do usuário | v2 |
| Progresso | Por fases (1/5 … 5/5) | v2 |
| Sub-agentes | Documentado, inativo v1 | v2 planned |
| Local | `~/.cursor/skills/diffs-reviewer/` | v2 |

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

## Out of Scope (v1)

- Integração GitHub
- ESLint automático
- Regras de domínio
- Sub-agentes ativos
- Cache de padrões entre execuções
- `.reviewrc` config file
- Diff uncommitted (staged/unstaged)

## v2 Roadmap

- Sub-agentes paralelos para PRs grandes (offer-then-confirm)
- Modo diff uncommitted / full
- Detecção de linguagem (ruff, go vet, etc.)
- Regras de domínio inline ou via spec file

## Testing Checklist

- [ ] Auto-detect base em repo com main
- [ ] Override soft `base=develop`
- [ ] Branch main vs main → aviso correto
- [ ] TSC filtra só arquivos do diff
- [ ] Docs em `.cursor/rules/` detectados
- [ ] Inferência 3+ ocorrências funciona
- [ ] Bloqueante → Reprovado (nunca ressalvas)
- [ ] Progresso por fases exibido
- [ ] Idioma segue usuário
