# STANDARDS — Repo Patterns

**Goal:** Build a rule set from documented sources first, then conservative inference. Use it during ANALYZE to flag consistency issues — never invent rules.

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

## Step 2: Conservative Inference

For each modified file, read **2–5 peer files** in the same directory or module (not the whole repo).

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
- **Mixed/inconsistent peers** → no inferred rule for that dimension
- **Never infer** from files outside the same module unless imports clearly tie them together

Also read files **imported by** modified files when needed to understand flow (endpoint → handler → service).

---

## Step 3: Build Standards Snapshot

Produce a compact internal list:

```markdown
## Documented
- [rule] (source: CONTRIBUTING.md)

## Inferred (3+ peers)
- [convention] (module: src/services/, seen in: order.ts, user.ts, payment.ts)

## Skipped
- [dimension]: no clear pattern
```

Do not include this snapshot in the final report unless the user asks — use it during ANALYZE.

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
[Fase 2/5] STANDARDS — <D> regras documentadas, <I> convenções inferidas
```

If both are zero:

```
[Fase 2/5] STANDARDS — nenhum padrão claro detectado; análise focará em lógica e segurança
```
