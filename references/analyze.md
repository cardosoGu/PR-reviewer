# ANALYZE — Code Review

**Goal:** Review each file in the diff for TypeScript errors, logic bugs, security issues, and standards violations. Manual analysis is primary; TSC is a complement for TS projects.

---

## Process

### 1. Optional — TypeScript compiler (diff files only)

Run only if `tsconfig.json` exists at repo root or in a relevant package:

```bash
npx tsc --noEmit 2>&1
```

**Filter results:** report only errors in **files from the diff list**. Ignore pre-existing errors in unmodified files.

If TSC fails to run (no TS project, broken config): note once and continue with manual analysis.

**Do not run ESLint** in v1.

### 2. Per-file manual review

For each file in the filtered diff list, read the hunk(s) and surrounding context. Cross-reference the standards snapshot from STANDARDS phase.

#### 2.1 TypeScript / typing (manual + TSC)

- Types incompatible with usage
- Missing required props (React/components)
- Incorrect function signatures
- Unsafe casts hiding real errors (`as any`, `@ts-ignore` without justification)

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

---

## Finding Quality Rules

Each finding must include:

- **File and line** (from diff or read tool)
- **Code snippet** showing the issue
- **Why it matters** (impact, not preference)
- **Suggested fix** (concrete, minimal)

If uncertain: prefix with `[Incerto]` and explain what would confirm or refute.

**Do not report:**

- Hypothetical edge cases with no plausible trigger
- Style/naming as blockers
- Pre-existing TSC errors outside the diff
- Lock file or dependency-only changes (already filtered)

---

## Progress Message

Emit once when ANALYZE starts and once when complete:

```
[Fase 3/5] ANALYZE — revisando <N> arquivos...
```

```
[Fase 3/5] ANALYZE — concluído (<B> bloqueantes candidatos, <R> ressalvas candidatas)
```

Do not emit per-file progress in v1 — phases only.
