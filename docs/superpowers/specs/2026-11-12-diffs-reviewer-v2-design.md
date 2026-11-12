# diffs-reviewer v2.0 — Design

**Data:** 2026-11-12
**Status:** aprovado em conversa; aguardando revisão do arquivo
**Substitui:** fluxo git local da v1.2 (`git fetch` + `git diff <ref>...HEAD`)

## 1. Objetivo

Revisar uma **PR do GitHub a partir do link**, de forma padronizada, mais rápida e com menos tokens que a v1.2, sem alterar nada no repositório nem na PR.

Problemas da v1.2 que motivam a mudança:

- Coleta feita pelo modelo, comando a comando (10+ turnos só em FETCH + IMPORT-CHECK). Cada turno custa segundos e tokens.
- Depende de checkout local da branch e de `git fetch`.
- TYPECHECK e workers são lentos e caros.
- Execução varia entre rodadas porque o modelo interpreta receitas.

Medição que embasa o desenho (PR #1 deste repo, 13 arquivos, diff ~105 KB): cada chamada `gh` leva 0,8–1,6 s; 5 leituras `contents` levam ~3,8 s em série e ~1,0 s em paralelo. **O gargalo é o número de turnos do modelo, não a rede** — portanto a coleta determinística vai para scripts, em paralelo, num único turno cada.

## 2. Escopo

**Entra**

- Entrada única: `/diffs-reviewer <link da PR>`.
- Coleta 100% via `gh` (sem repo local, sem checkout, sem clone).
- Dois scripts Node: `scripts/fetch-pr.mjs` e `scripts/fetch-context.mjs`.
- IMPORT-CHECK determinístico dentro de `fetch-context.mjs`.
- Status de CI via `gh pr checks` (informativo).
- Análise por agente único em duas passadas + autovalidação.
- Relatório no formato atual (RC por achado, veredito) + linhas de CI, cobertura e limites.

**Sai**

- TYPECHECK (`references/typecheck.md`, gatilho "rodar typecheck").
- Workers (`references/sub-agents.md`, oferta na ANALYZE).
- `git fetch`, `git diff`, `git grep`, `git show`, `git ls-tree`, override `base=`.
- Review pré-PR (sem PR não há review).
- IMPORT-CHECK Step D determinístico (importadores fora da diff de arquivo apagado/renomeado).

**Fora de escopo (futuro)**

- `--deep`: revisores paralelos + validação por subagente para PR crítica.
- Postar comentários/review na PR.

## 3. Requisitos de ambiente

- `gh` instalado e autenticado com acesso de leitura ao repo da PR.
- Node ≥ 18 (sem dependências npm; só `node:` built-ins).
- Se faltar algum, a skill para com mensagem clara (`gh auth status` / `node --version` falham → parar).

## 4. Fluxo

```
PR-INFO+DIFF (script) → PASSADA 1 → CONTEXTO+IMPORT-CHECK (script) → PASSADA 2 → RELATÓRIO
```

Progresso exibido por fase, nunca por arquivo.

### 4.1 Fase 1 — `node scripts/fetch-pr.mjs <link> [--force]`

Um turno. Faz em paralelo:

| Chamada | Uso |
| --- | --- |
| `gh pr view <link> --json title,body,state,isDraft,baseRefName,headRefOid,headRepository,headRepositoryOwner,commits,url,number` | intent, estado, sha do head |
| `gh api repos/{o}/{r}/pulls/{n}/files --paginate` | lista, status (`added/modified/removed/renamed`), `previous_filename`, additions/deletions, `patch` por arquivo |
| `gh api repos/{o}/{r}/git/trees/{headSha}?recursive=1` | lista de caminhos do head (para IMPORT-CHECK e espelho) |
| `gh pr checks <link> --json name,state,bucket` | status de CI |

`{o}/{r}` é o repositório **base** da PR (o do link). Para PR de fork, tree e contents usam o repositório do head (`headRepositoryOwner/headRepository`) com `headRefOid`.

**Estado:** se `state` ≠ `OPEN` ou `isDraft`, o script imprime aviso e sai com **código 2** sem gravar nada. A skill mostra o aviso, **para e pede confirmação**; com "sim", roda de novo com `--force`.

**Diff por arquivo:** grava `<tmp>/pr-<n>/diffs/<caminho>.diff` a partir do `patch`. Se o GitHub omitir o `patch` (arquivo grande), faz um único `gh pr diff <link>` e extrai os blocos faltantes pelo cabeçalho `diff --git`. Se ainda faltar, o arquivo vai para "não alcançados".

**Exclusões fixas (regra, não julgamento):**

- Dependências: `node_modules/**`, `vendor/**`
- Lockfiles: `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `composer.lock`, `Cargo.lock`, `poetry.lock`, `Gemfile.lock`, `go.sum`
- Build/gerados: `dist/`, `build/`, `out/`, `coverage/`, `.next/`, `*.min.js`, `*.min.css`, `*.map`, `__snapshots__/`, `*.snap`
- Binários (sem `patch` e extensão binária)
- i18n: `**/locales/**/*.json`, `**/i18n/**/*.json`, `**/translations/**/*.json`
- Documentação: `*.md`, `*.mdx`

Testes (`*.test.*`, `*.spec.*`, `__tests__/`) **não são excluídos**: o diff é gravado, mas a análise só os usa para responder "a mudança tem teste?".

**Escopo** (sobre arquivos filtrados): Small ≤3 arquivos e ≤100 linhas; Large 11+ arquivos ou >500 linhas; Medium o resto. Escopo só altera a profundidade de STANDARDS e a ordem de leitura; não muda o número de agentes.

**Saída (stdout, compacta, sempre o mesmo formato):**

```
PR #<n> <title> — <state> — base <baseRef> ← head <sha7>
Intent: <body resumido em ≤8 linhas; se vazio, assuntos dos commits (≤10)>
CI: <passando X/Y | falhando: nomes | pendente | nenhum check>
Arquivos (<N> analisados, <X> ignorados, <L> linhas, escopo <S>):
  M src/a.ts +12 -3
  D src/old.ts
  R src/b.ts ← src/b-old.ts
Ignorados: <contagem por regra>
Não alcançados: <lista ou "nenhum">
Dir: <tmp>/pr-<n>
```

Nada de diff, tree ou JSON cru no stdout. A tree vai para `<tmp>/pr-<n>/tree.txt`; o metadado completo para `<tmp>/pr-<n>/meta.json`.

`<tmp>` = diretório temporário do SO (`os.tmpdir()`). O script nunca escreve fora de `<tmp>/pr-<n>`.

### 4.2 Fase 2 — Passada 1 (só diff)

O modelo lê os `.diff` por arquivo, em ordem de risco: rotas/controllers/handlers, auth/segurança, persistência/filas, serviços, utilitários, UI, testes por último. Foco: lógica, segurança, tratamento de erro, bordas, aderência ao intent. **Sem contexto extra.**

Ao fim da passada, o modelo monta **uma lista** de contexto necessário (arquivos que a diff chama/usa e que não estão na diff), com teto de 10.

### 4.3 Fase 3 — `node scripts/fetch-context.mjs <tmp>/pr-<n> [arquivo ...]`

Um turno. Busca em paralelo (concorrência 8) via `gh api repos/{o}/{r}/contents/<path>?ref=<headSha>` com `Accept: application/vnd.github.raw` e grava em `<tmp>/pr-<n>/head/<path>`:

1. Os arquivos pedidos pelo modelo (≤10).
2. `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` da raiz e de cada diretório tocado (só os que existem na tree).
3. **Espelho de módulo:** irmãos dos arquivos alterados (mesmo diretório), código-fonte apenas, teto de **60 arquivos / 2 MB** no total, priorizando diretórios com mais arquivos alterados. Serve para STANDARDS e para os greps de over-engineering, agora feitos com `grep -r` local sobre `head/`.
4. Arquivos necessários ao IMPORT-CHECK (abaixo).

**IMPORT-CHECK** (JS/TS: `.ts .tsx .js .jsx .mjs .cjs`), porta das receitas atuais de `analyze.md` §0:

- **A — Extração:** specifiers das **linhas adicionadas** de cada `.diff` (`from "x"`, `import "x"`, `export … from "x"`, `require("x")`, `import("x")`), com número de linha calculado pelo cabeçalho `@@ … +c,d @@`. Remove `?query`/`#hash`. Import multi-linha: nomes coletados das linhas `+` do mesmo hunk; se os nomes estão em linhas de contexto → `[Incerto]`.
- **B — Existência:** resolve relativo ao diretório do importador; aliases via `tsconfig.json`/`jsconfig.json` (seguindo `extends`, buscados via contents); testa extensões `d.ts|d.mts|d.cts|ts|tsx|mts|cts|js|jsx|mjs|cjs|json|vue|svelte|astro` e `/index.*`; convenção ESM `.js → .ts`. Confere contra `tree.txt`. Miss → rede de segurança (mesmo stem com outra extensão, caminho com `generated`/`.gen.`, alias não definido, tree truncada) → `[Incerto]`; senão **Bloqueante**.
- **C — Exports nomeados:** baixa cada arquivo-alvo (≤30; excedente → `[Incerto]`) e aplica as regras C1/C2/C3 atuais (declarações, `export { }`, `X as Y`, `export default`, re-export). `export *` é seguido até 2 níveis dentro do teto; além disso `[Incerto]`. Confirmado ausente nas três → **Bloqueante**.
- **D — Removidos/renomeados:** importadores **dentro da diff e do espelho** que ainda referenciam o caminho antigo → **Bloqueante**. Fora disso, não verificável → linha fixa em Limites.
- **E — Pacotes externos novos:** nome do pacote (sem subpath) procurado nos `package.json` do head (raiz e do pacote do importador, via contents). Ausente → **Ressalva**. Builtins `node:`/core → ignorar.

**Saída (stdout):**

```
Contexto: <K> arquivos baixados (<pedidos>/<docs>/<espelho>), <M> fora do teto
IMPORT-CHECK: <n> imports em <f> arquivos — <b> bloqueantes, <r> ressalvas, <i> incertos
  [Bloqueante] src/a.ts:14 — "./utils/fmt" não existe no head (testado: fmt.ts, fmt/index.ts, …)
  [Bloqueante] src/a.ts:15 — "calcTotal" não exportado por src/math.ts
  [Incerto]    src/b.ts:3 — "@/lib/x": alias não resolvido
Dir: <tmp>/pr-<n>/head
```

Só candidatos a problema aparecem; imports confirmados não são listados.

### 4.4 Fase 4 — Passada 2 (com contexto)

- Recebe os achados do IMPORT-CHECK como já validados (determinísticos).
- STANDARDS: regras documentadas (`CLAUDE.md` etc.) + inferência conservadora (3+ pares concordantes) usando `grep -r` sobre `head/`.
- Over-engineering (checklist atual de `analyze.md` §2.6): contagens de uso via `grep -r` sobre `head/` + diffs. Sinal que exigiria grep no repo inteiro (ex.: export público com 0 referências) → no máximo **Sugestão `[Incerto]`**.
- Revisita achados da passada 1 que dependiam de contexto.

**Autovalidação (obrigatória, antes do relatório):** para cada achado, reler o trecho exato (diff ou `head/`) e confirmar: (1) o código citado existe na linha citada; (2) o problema ocorre com o código como está, não "dependendo da entrada"; (3) não é pré-existente (linha não adicionada/alterada pela PR). Falhou (1) ou (3) → descartar. Falhou (2) → `[Incerto]` ou descartar.

**Não flagar:** problema pré-existente; o que linter/formatter pega; nitpick e estilo sem regra documentada; "pode dar problema dependendo da entrada"; regra do `CLAUDE.md` silenciada explicitamente no código.

**Número de linha:** sempre calculado do cabeçalho `@@` (ou de `head/<path>`), nunca estimado.

### 4.5 Fase 5 — Relatório

Formato atual de `report.md` (severidades, veredito, RC por achado, dedup/ranking), com estas mudanças:

- Remove referências a TYPECHECK.
- Cabeçalho inclui link da PR e `sha7` do head.
- Linhas fixas ao final:
  - `CI: …` (copiada da fase 1). Check falhando é citado, mas não vira Bloqueante sozinho (o CI do projeto não é confiável); o modelo pode promover se o nome/log indicar build quebrado.
  - `Cobertura: <analisados> analisados, <ignorados> ignorados por regra, <não alcançados> não alcançados (<lista>)`
  - `Limites: tipos não verificados (sem typecheck); importadores fora da diff/espelho de arquivos removidos não verificados` (+ `contexto truncado: …` quando houver teto atingido).

## 5. Segurança (contrato read-only)

Comandos permitidos, todos de leitura:

- `node <skill>/scripts/fetch-pr.mjs …`, `node <skill>/scripts/fetch-context.mjs …`
- Dentro dos scripts: `gh pr view`, `gh pr diff`, `gh pr checks`, `gh api` **somente GET** (sem `-X`, `-f`, `-F`, `--input`).
- Fora dos scripts: leitura de arquivos em `<tmp>/pr-<n>/` e `grep`/`Select-String` sobre eles.

Proibido: `gh pr comment|review|merge|edit|close|ready`, `gh api` com método diferente de GET, qualquer comando git que escreva, e escrita fora de `<tmp>/pr-<n>/`. Os scripts validam o link (`https://github.com/<o>/<r>/pull/<n>`) e recusam qualquer outro formato.

Os scripts não apagam o diretório ao final (permite releitura na mesma sessão); cada execução de `fetch-pr.mjs` recria `<tmp>/pr-<n>` do zero.

## 6. Tratamento de erros

| Situação | Comportamento |
| --- | --- |
| Link inválido | script sai código 1, mensagem com formato esperado |
| `gh` ausente / não autenticado / sem acesso | código 1, mensagem com `gh auth login` |
| PR fechada, mergeada ou draft | código 2; skill pede confirmação; `--force` continua |
| Tree `truncated: true` | IMPORT-CHECK B vira `[Incerto]` para caminhos não encontrados; aviso em Limites |
| `patch` ausente e `gh pr diff` falha (diff gigante) | arquivo em "não alcançados" |
| Falha de rede numa leitura de contexto | arquivo listado como fora do teto; achados dependentes viram `[Incerto]` |
| 0 arquivos após filtro | script imprime "Nenhum arquivo relevante na PR." e sai código 3; skill encerra |

## 7. Mudanças nos arquivos

| Arquivo | Mudança |
| --- | --- |
| `scripts/fetch-pr.mjs` | novo |
| `scripts/fetch-context.mjs` | novo (inclui IMPORT-CHECK) |
| `SKILL.md` | novo fluxo, entrada por link, contrato de segurança, versão 2.0.0, description atualizada |
| `references/fetch-diff.md` | reescrito como `references/fetch.md`: como rodar os scripts, ler a saída, estado/`--force` |
| `references/analyze.md` | §0 vira "ler saída do IMPORT-CHECK"; remove §1 TYPECHECK; duas passadas, autovalidação, não flagar; greps sobre `head/` |
| `references/standards.md` | peers e docs vêm de `head/` |
| `references/report.md` | remove TYPECHECK; linhas CI/Cobertura/Limites; link da PR |
| `references/typecheck.md`, `references/sub-agents.md` | removidos |
| `README.md`, `SPEC.md` | atualizados para v2; changelog 2.0.0 |
| `tests/check-recipes.js` | substituído por testes dos scripts com fixtures locais (diffs, tree e arquivos simulados; sem rede) |

## 8. Testes

- Unitários (Node, `node --test`, sem rede): parser de `@@`/linhas adicionadas, extração de specifiers, resolução de caminho/alias/extensão/ESM, regras de export C1–C3, filtro de exclusões, classificação de escopo, formato de saída.
- `gh` é chamado por uma função injetável, substituída por fixtures nos testes.
- Smoke manual: rodar os dois scripts contra uma PR real (ex.: PR #1 deste repo) e conferir saída e tempos.

## 9. Critérios de aceite

- Review completa com **2 turnos de coleta** (um por script) + leituras de diff/contexto.
- Nenhuma chamada que escreva no GitHub ou no repo; nada escrito fora de `<tmp>/pr-<n>`.
- PR fechada/mergeada/draft para e pede confirmação.
- Nenhum diff, tree ou JSON cru no contexto do modelo.
- Relatório sempre com CI, Cobertura e Limites.
- Testes dos scripts passando.
