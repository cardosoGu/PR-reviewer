

# diffs-reviewer

**Review de PR local no Cursor — read-only, focado no que importa.**

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Cursor](https://img.shields.io/badge/Cursor-Agent%20Skill-000000?logo=cursor&logoColor=white)
![Git](https://img.shields.io/badge/git-read--only-F05032?logo=git&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-TSC%20no%20diff-3178C6?logo=typescript&logoColor=white)

[Instalar](#instalar) · [Usar](#usar) · [Veredito](#veredito) · [Spec](SPEC.md)



## Descrição

O **diffs-reviewer** é uma skill para o Cursor Agent que realiza **revisão de Pull Request local** com base no diff Git entre a branch atual e a branch base (`git diff base...HEAD`).

A execução é **estritamente read-only**: não altera arquivos do repositório, não possui integração com GitHub e utiliza apenas comandos Git de leitura (`diff`, `log`, `show`, `status`, `branch`, `remote`).

Ao concluir a análise, a skill emite um **veredito final** — **Aprovado**, **Reprovado** ou **Aprovado com ressalvas** — e, em seguida, apresenta um relatório estruturado com:

- **Problemas bloqueantes** — itens que impedem o merge
- **Ressalvas** — melhorias relevantes, sem caráter bloqueante
- **Sugestões** — recomendações opcionais de refinamento

Cada achado inclui referência ao arquivo, trecho de código, justificativa e sugestão de correção.

```mermaid
flowchart LR
    A["FETCH<br/>obter diff"] --> B["STANDARDS<br/>padrões do repo"]
    B --> C["ANALYZE<br/>lógica · TS · segurança"]
    C --> D["VERDICT<br/>classificar achados"]
    D --> E["REPORT<br/>veredito + relatório"]
```



O progresso é exibido por fases: `[Fase 1/5]` … `[Fase 5/5]`.

## Instalar

```bash
git clone https://github.com/cardo/diffs-reviewer.git ~/.cursor/skills/diffs-reviewer
```

No Windows, substitua o caminho por `$env:USERPROFILE\.cursor\skills\diffs-reviewer`.

Abra o **repositório a ser revisado** no Cursor. A skill é invocada manualmente — não executa automaticamente.

## Usar

No chat do Cursor:

```
/diffs-reviewer
/diffs-reviewer base=develop
```

Gatilhos equivalentes: `Revisar PR` · `review de código` · `analisar diff` · `Revisar só segurança` · `Revisar padrões`

A branch base é detectada automaticamente (`main` → `master` → default do `origin/HEAD`). Use `base=<branch>` para sobrescrever.

## Veredito


|     | Resultado                  | Condição                                |
| --- | -------------------------- | --------------------------------------- |
| ✅   | **Aprovado**               | Nenhum problema bloqueante              |
| ⚠️  | **Aprovado com ressalvas** | Sem bloqueantes; ressalvas recomendadas |
| ❌   | **Reprovado**              | Um ou mais problemas bloqueantes        |


**Regra:** na presença de qualquer bloqueante, o veredito é sempre **Reprovado** — nunca *Aprovado com ressalvas*.

### O que entra no relatório


| Seção                     | Descrição                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| **Problemas bloqueantes** | Erros de TypeScript no diff, bugs de lógica, vulnerabilidades graves, risco de perda de dados   |
| **Ressalvas**             | Inconsistências de padrão, refatorações recomendadas, melhorias relevantes sem impacto imediato |
| **Sugestões**             | Ajustes opcionais de legibilidade, organização ou performance                                   |


## O que analisa

- **TypeScript** — `tsc --noEmit`, filtrado aos arquivos do diff
- **Lógica** — condições incorretas, null unsafe, validações bypassáveis, condições de corrida
- **Segurança** — injection, XSS, secrets expostos, ausência de autorização
- **Padrões** — regras documentadas (`.cursor/rules/`, `CONTRIBUTING.md`) e convenções inferidas do módulo (3+ ocorrências)

Em PRs de grande porte (11+ arquivos ou 500+ linhas no diff), a skill pode oferecer **sub-agentes paralelos** para acelerar a análise — somente mediante confirmação explícita.

**Limites e escopo**

- Não altera o repositório sob revisão
- Considera apenas commits da branch atual (sem mudanças uncommitted/staged)
- Sem integração com GitHub (comentários, checks, API)
- Sem ESLint ou linters automáticos
- Detalhes completos em [SPEC.md](SPEC.md)



---

Feito por **cardosoGu**