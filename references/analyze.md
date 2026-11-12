# ANALYZE — Two passes and self-validation

**Goal:** Review **every** relevant file in the PR for broken imports, logic bugs, security issues, standards violations and over-engineering, with as few false positives as possible.

**Completion criterion:** Every relevant file reviewed in both passes; every finding self-validated (§3) and carrying file:line, snippet, impact, fix and RC draft.

**No early exit** — continue through all files even after blockers are found.

Paths: `<dir>` is the `Dir:` printed by `fetch-pr.mjs`. Diffs are in `<dir>/diffs/<path>.diff`; head content downloaded by `fetch-context.mjs` is in `<dir>/head/<path>`.

---

## 1. PASSADA 1 — diff only (no extra context)

Read the diff files one at a time, in **risk order**:

1. routes, controllers, handlers, webhooks
2. auth, permissions, crypto, signatures
3. persistence, queues, jobs, migrations
4. services and domain logic
5. utilities and helpers
6. UI components
7. tests last (only: does the risky change have tests?)

Look only at what the diff itself proves. Line numbers come from the hunk header: in `@@ -a,b +c,d @@` the first non-`-` line is line `c` of the new file; count `+` and context lines, never `-` lines. **Never estimate a line number.**

### 1.1 Logic and business rules

- Inverted or missing conditions (`if (x = 5)` vs `===`); off-by-one, wrong operator, dead branches
- Null/undefined accessed without guard
- Bypassable validation; inconsistent state updates
- Race conditions (async without await, shared mutable state)
- Side effects inside ternaries or pure-looking functions
- **Intent mismatch:** the code does not do what the PR intent (`Intent:` from FETCH) states. Report only with the concrete line that contradicts it; a vague description is not evidence.

### 1.2 Security

- SQL/command injection (string concatenation in queries/shell); XSS (unsanitized input in HTML/DOM)
- Hardcoded secrets (API keys, passwords, tokens)
- Empty catch blocks swallowing errors silently
- Missing authorization checks on sensitive operations
- Dangerous APIs (`eval`, `Function`, unsafe deserialization); path traversal in file operations
- Webhook/signature handling: signature verified over the raw body, constant-time comparison, replay protection

### 1.3 Typing (manual — no typecheck runs)

- Types clearly incompatible with their usage inside the diff; missing required props
- Incorrect function signatures visible in the diff
- Unsafe casts hiding real errors (`as any`, `@ts-ignore` without justification)

### 1.4 Context list

While reading, note what you **cannot** confirm from the diff alone (a called function, a base class, a schema, a consumer). At the end of the pass, pick **at most 10** files for `fetch-context.mjs` (fetch.md §2), most important first. Keep the open questions; PASSADA 2 answers them.

Progress:

```
[Fase 2/5] PASSADA 1 — <N> arquivos lidos, <C> candidatos, <K> arquivos de contexto pedidos
```

---

## 2. PASSADA 2 — with context

### 2.1 IMPORT-CHECK (from `fetch-context.mjs`)

The script already resolved every import added by the PR against the head commit. Take its lines as findings:

| Script line | Severity |
| ----------- | -------- |
| `[Bloqueante]` — path does not exist, named export missing, file removed/renamed in the PR still imported | **Bloqueante** |
| `[Ressalva]` — external package not declared in `package.json` | **Ressalva** |
| `[Incerto]` — alias not resolved, `export *` / CommonJS ambiguity, generated path, truncated tree, outside the cap | `[Incerto]` → **Sugestão** |

Evidence for the finding is the script line itself (e.g. "`./missing` não existe no head; testados: … e /index.*"). Still run §3 on each one: reread the diff line it points to.

Status line for the report: `IMPORT-CHECK: ok` or `IMPORT-CHECK: <N> achados (<B> bloqueantes, <R> ressalvas, <I> incertos)` — counted after dedup (all missing names of one import = 1 finding), `N = B + R + I`.

### 2.2 Standards (from STANDARDS)

- Documented rule violations
- Inferred convention mismatches (classification in standards.md)

### 2.3 Over-engineering (mandatory — every file)

Run the checklist on every file. **Each signal requires its verification** — even when the conclusion is "nothing found". Greps run over the module mirror in `<dir>/head/`, never over the whole repo (you do not have it).

| Signal | Como confirmar (cheap) | Evidência exigida |
| ------ | ---------------------- | ----------------- |
| Speculative generality | `grep -rnP '(?<![\w$])(<S1>\|<S2>)(?![\w$])' <dir>/head/<module>/`; count uses outside the definition | usage count and where |
| Duplicated infrastructure | Read the base class / parent schema / middleware chain in `<dir>/head/` and check whether it already applies the same plugin, helper or hook | quoted snippet of the base that already covers it |
| Middle man | Read the body: only delegates, no logic, no error handling, no transformation | summarized body |
| Unnecessary wrapper / Premature abstraction | Count implementations and call sites of the Factory/Builder/Strategy in the mirror (`grep -rn` for `implements`, `extends`, usages) | number of implementations (1 confirms) |
| Future-only config | `grep -rn` the flag/param in the mirror; does any call site pass a non-default value? | call sites found |
| Dead code in diff | `grep -rnP '(?<![\w$])(<E1>\|<E2>)(?![\w$])' <dir>/head/`; zero references outside its own file and tests | grep result |

(`\|` above is a table escape — the command uses a plain `|`.)

- **Batch the greps:** one command per module with all candidate symbols in the alternation, not one per symbol.
- **Mirror limit:** the mirror holds only the touched directories. Zero references for a **module-private** symbol is evidence; for a **public export** it is not (consumers may live elsewhere) → at most **Sugestão** `[Incerto]`.
- **Dead code exclusions:** default/framework exports of page, route or config files; files referenced by `package.json` `main`/`exports`/`bin`; ambient `.d.ts`; exports of files that are themselves new and unreferenced (report the file once). Uncertain → `[Incerto]`.
- Bound names with `(?<![\w$])…(?![\w$])`, not `\b` (names with `$` must match; escape `$` as `\$`). A zero result from a `\b` grep on a `$` name is not evidence.

**Sem evidência, sem achado.** A signal without confirmation is not reported. Strong hint but incomplete confirmation → `[Incerto]` (→ Sugestão). At most one verification per candidate symbol.

Classify per the over-engineering table in [report.md](report.md).

### 2.4 Context tracing

Answer the open questions from PASSADA 1 with `<dir>/head/`. For API/handler changes, trace `route/endpoint → controller/handler → service → repository/data layer` as far as the downloaded files allow. What you still cannot confirm stays `[Incerto]` or is dropped — never assumed.

---

## 3. Self-validation (mandatory, before the report)

For **every** candidate finding, reread the exact lines (the diff, or `<dir>/head/<path>`) and check:

1. **It exists:** the quoted code is at the cited file and line (line computed from `@@`, or counted in `<dir>/head/<path>`).
2. **It happens as written:** the problem occurs with the code as it is, not "depending on the input" or "if someone later…".
3. **It is new:** the line was added or changed by this PR (a `+` line, or behavior the PR changed).

Failed 1 or 3 → **drop it**. Failed 2 → `[Incerto]` (→ Sugestão) or drop it.

**Do not report:**

- Pre-existing problems outside the PR's changes
- What a linter or formatter catches
- Style, naming or pattern nitpicks without a documented rule
- Hypothetical edge cases with no plausible trigger
- A `CLAUDE.md` rule that the code explicitly silences (e.g. lint-ignore comment with a reason)
- Lockfile or generated-only changes (already excluded by FETCH)
- Over-engineering as **Bloqueante** unless functional/security impact is clear

---

## Finding Quality Rules

Each finding includes: **file and line**; **code snippet**; **why it matters** (impact, not preference); **suggested fix** (concrete, minimal); **RC draft** per [report.md](report.md).

If uncertain: prefix with `[Incerto]`; the RC uses "Parece que… poderia confirmar…?" / "It looks like… could you confirm…?".

---

## Progress Message

```
[Fase 4/5] PASSADA 2 — concluído (<B> bloqueantes, <R> ressalvas, <S> sugestões após autovalidação; <D> descartados)
```
