# ANALYZE — Code Review

**Goal:** Review **every** file in the diff for TypeScript errors, logic bugs, security issues, standards violations, and over-engineering. Manual analysis is primary; TSC is a complement for TS projects.

**Completion criterion:** Every filtered file reviewed; each finding has file:line, snippet, impact, fix, and RC draft.

**No early exit** — continue through all files even after blockers are found.

---

## Process

### 1. TypeScript — diff-scoped only

Run only if `tsconfig.json` exists at repo root or in a relevant package.

**Small scope OR trigger OFF** — inline in orchestrator:

```bash
npx tsc -p tsconfig.json --noEmit --pretty false -- <file1> <file2> ...
```

List only files from the filtered diff list. Resolve `tsconfig.json` path per package if monorepo.

**Trigger ON** — delegate to TSC sub-agent (see [sub-agents.md](sub-agents.md)). Orchestrator receives compact error list only.

**Never** run full-project `npx tsc --noEmit` without file list as default.

If TSC fails to run (no TS project, broken config): note once and continue with manual analysis.

**Do not run ESLint.**

Merge TSC findings with manual typing review (§2.1).

### 2. Per-file manual review

For each file in the filtered diff list, read the hunk(s) and surrounding context. Cross-reference the standards snapshot from STANDARDS phase.

#### 2.1 TypeScript / typing (manual + TSC)

- Types incompatible with usage
- Missing required props (React/components)
- Incorrect function signatures
- Unsafe casts hiding real errors (`as any`, `@ts-ignore` without justification)
- Imports referencing symbols/paths that do not exist

#### 2.2 Logic and business rules

- Inverted or missing conditions (`if (x = 5)` vs `===`)
- Null/undefined accessed without guard
- Off-by-one, wrong operator, dead branches
- Bypassable validation
- Inconsistent state updates
- Race conditions (async without await, shared mutable state)
- Side effects inside ternary or pure-looking functions

#### 2.3 Security

- SQL/command injection (string concatenation in queries/shell)
- XSS (unsanitized user input in HTML/DOM)
- Hardcoded secrets (API keys, passwords, tokens)
- Empty catch blocks swallowing errors silently
- Missing authorization checks on sensitive operations
- Dangerous APIs (`eval`, `Function`, unsafe deserialization)
- Path traversal in file operations

#### 2.4 Standards (from STANDARDS phase)

- Documented rule violations
- Inferred convention mismatches (apply verdict rules from standards.md)

#### 2.5 Context tracing (when relevant)

For API/handler changes, trace flow when impact is unclear:

```
route/endpoint → controller/handler → service → repository/data layer
```

Read imported modules only as needed — do not load unrelated areas.

#### 2.6 Over-engineering (mandatory — every file)

Always check for:

| Signal | What to look for |
| ------ | ---------------- |
| Speculative generality | Abstraction/interface with no use in diff or module |
| Duplicated infrastructure | Plugin/middleware/helper already in base class or shared schema |
| Middle man | Class/function that only delegates without adding logic |
| Unnecessary wrapper | Factory/builder for a single code path |
| Future-only config | Flags or params with no requirement in this change |
| Premature abstraction | Strategy/Factory with one implementation |
| Dead code in diff | New export/function never referenced |

Classify severity per [verdict.md](verdict.md) over-engineering table. Always include RC.

**Examples:**

- Plugin `aggregatePaginate` applied again on schema that extends `baseSchema` where plugin is already applied → **Ressalva**
- New service layer wrapping a single direct call → **Sugestão** or **Ressalva**

---

## Finding Quality Rules

Each finding must include:

- **File and line** (from diff or read tool)
- **Code snippet** showing the issue
- **Why it matters** (impact, not preference)
- **Suggested fix** (concrete, minimal)
- **RC draft** — PR-ready comment per [report.md](report.md) (refine in REPORT phase)

If uncertain: prefix finding with `[Incerto]` and RC uses "Parece que…" / "It looks like…" with "poderia confirmar…?" / "could you confirm…?"

**Do not report:**

- Hypothetical edge cases with no plausible trigger
- Style/naming as blockers
- Pre-existing TSC errors outside the diff
- Lock file or dependency-only changes (already filtered)
- Over-engineering as **Bloqueante** unless functional/security impact is clear

---

## Progress Message

Emit once when ANALYZE starts and once when complete:

```
[Fase 3/5] ANALYZE — revisando <N> arquivos...
```

```
[Fase 3/5] ANALYZE — concluído (<B> bloqueantes candidatos, <R> ressalvas candidatas)
```

Do not emit per-file progress — phases only.
