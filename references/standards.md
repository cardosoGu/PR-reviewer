# STANDARDS — Repo Patterns

**Goal:** Build a rule set from documented sources first, then conservative inference by module. Use it during ANALYZE to flag consistency issues — never invent rules.

**Completion criterion:** Compact standards snapshot produced (documented + inferred + skipped dimensions).

---

## Priority Chain

```
1. Documented standards (explicit rules)
2. Conservative inference (same module, 3+ occurrences)
3. No clear pattern → skip pattern check for that dimension
```

**Documented always wins** over inference when they conflict.

---

## Step 1: Load Documented Standards

Search and read (if they exist):

| Source | Path patterns |
| ------ | ------------- |
| Cursor rules | `.cursor/rules/**`, `AGENTS.md`, `.cursorrules` |
| Contributing | `CONTRIBUTING.md`, `docs/CONTRIBUTING.md` |
| Coding standards | `CODING_STANDARDS.md`, `docs/coding-standards.md`, `STYLEGUIDE.md` |
| Lint config intent | `eslint.config.*`, `.eslintrc*` (rules sections only — do not run ESLint) |

Extract **actionable rules**: naming, imports, error handling, validation libraries, folder structure, API response shapes, test requirements.

If none exist, proceed to Step 2 with an empty documented set.

---

## Step 2: Conservative Inference (by module)

Group modified files by **module** (same directory or clear package boundary). For each module, infer conventions from peers — **not** per modified file.

### Baseline peer read

| Scope  | Initial peers per module |
| ------ | ------------------------ |
| Small  | 1 representative peer |
| Medium | 2 peers |
| Large  | 2 peers |

Pick peers in the same directory/module that represent typical code (not tests unless only tests exist in module).

### Adaptive expansion

If a dimension is **mixed/inconsistent** after baseline read AND total peers read for that module < 7:

1. Read **+2 additional peers** from the same module
2. Re-evaluate that dimension only
3. Repeat until consistent (3+ same pattern), max peers reached, or dimension marked **Skipped**

**Hard cap:** 7 peers per module total.

**Dimensions to infer:**

| Dimension | How to detect | Valid when |
| --------- | ------------- | ---------- |
| Import style | `@/` vs `../` vs relative | 3+ peers same style |
| Naming | camelCase, PascalCase, kebab files | 3+ peers consistent |
| Error handling | try/catch, Result types, error middleware | 3+ peers same pattern |
| Validation | Zod, Yup, class-validator, manual | 3+ peers same library |
| Layer structure | controller → service → repository | 3+ files follow same layers |
| Typing | explicit return types, strict null | 3+ peers consistent |

**Confidence rules:**

- **3+ occurrences** of the same pattern → valid inferred convention
- **1–2 occurrences** → ignore (may be exception)
- **Mixed after max peers** → Skipped for that dimension
- **Never infer** from files outside the same module unless imports clearly tie them together

Also read files **imported by** modified files when needed to understand flow (endpoint → handler → service).

---

## Step 3: Build Standards Snapshot

Produce a compact internal list (~30 lines max):

```markdown
## Documented
- [rule] (source: CONTRIBUTING.md)

## Inferred (3+ peers)
- [convention] (module: src/services/, seen in: order.ts, user.ts, payment.ts)

## Skipped
- [dimension]: mixed after N peers (file1, file2, ...)
```

Do not include this snapshot in the final report unless the user asks — pass it to ANALYZE and sub-agent workers.

---

## How Violations Are Classified

| Violation type | Typical classification |
| -------------- | ---------------------- |
| Documented rule + causes bug/wrong behavior | **Bloqueante** |
| Documented rule + style/consistency only | **Ressalva** |
| Inferred convention + style only | **Ressalva** or **Sugestão** |
| Inferred convention + likely bug (e.g. missing error handling that peers always have) | **Ressalva** (rarely bloqueante unless impact is clear) |

**Default:** pattern violations are **not blockers** unless they cause functional or security impact.

---

## Progress Message

```
[Fase 2/5] STANDARDS — <D> regras documentadas, <I> convenções inferidas (<M> módulos)
```

If both are zero:

```
[Fase 2/5] STANDARDS — nenhum padrão claro detectado; análise focará em lógica, segurança e over-engineering
```
