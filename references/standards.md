# STANDARDS — Repo Patterns

**Goal:** Build a rule set from documented sources first, then conservative inference by module. Used in ANALYZE to flag consistency issues — never invent rules.

**Completion criterion:** Compact standards snapshot produced (documented + inferred + skipped dimensions).

---

## Priority Chain

```
1. Documented standards (explicit rules)       → always win on conflict
2. Conservative inference (same module, 3+ peers agreeing)
3. No clear pattern → skip that dimension
```

---

## Step 1: Load Documented Standards

`fetch-context.mjs` already downloaded the documents that exist into `<dir>/head/` (root docs, `.cursor/rules/*` up to 5, and `CLAUDE.md` / `AGENTS.md` of every touched directory and its ancestors). Read them from there, extracting only **actionable rules** (naming, imports, error handling, validation, folder structure, API response shapes, test requirements):

| Source | Path patterns |
| ------ | ------------- |
| Agent / editor rules | `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/**`, `.cursorrules`, `.github/copilot-instructions.md` |
| Contributing | `CONTRIBUTING.md`, `docs/CONTRIBUTING.md` |
| Coding standards | `CODING_STANDARDS.md`, `docs/coding-standards.md`, `STYLEGUIDE.md` |
| Lint config intent | `eslint.config.*`, `.eslintrc*`, `biome.json` — only if you requested it in `fetch-context.mjs` (counts toward the 10 files); rules sections only, never run linters |

Long documents: read the headings first and then only the sections relevant to the file types in the diff.

---

## Step 2: Conservative Inference (by module)

Group modified files by **module** (same directory or clear package boundary). Infer per module, not per file. **Large:** infer for at most 6 modules (those with the most changed lines); the rest use documented standards only. Peers come from the module mirror in `<dir>/head/<module>/` (capped at 60 files / 2 MB for the whole PR); a module with fewer than 3 files in the mirror infers nothing.

### Read peers as excerpts, never whole

For each peer, read only what the dimension needs:

- the **first ~60 lines** (imports, exports, main declarations) — use the Read tool with a line limit (never a full-file read of a peer);
- plus **targeted greps** for a dimension across the module's peers in one command (e.g. `grep -rnE 'catch *\(|Result<|throw new' <dir>/head/<module>/`).

### Peer budget

| Scope | Peers per module | Expansion |
| ----- | ---------------- | --------- |
| Small | 3 (excerpts) | none |
| Medium / Large | 3 (excerpts) | +2 if a dimension is mixed |

**Hard cap:** 5 peers per module. A convention needs **3+ peers agreeing**, so a module with fewer than 3 peers infers nothing (documented standards only). Pick typical code from the same directory (tests only if the module has nothing else).

**Dimensions:**

| Dimension | How to detect |
| --------- | ------------- |
| Import style | `@/` vs `../` vs relative |
| Naming | camelCase, PascalCase, kebab files |
| Error handling | try/catch, Result types, error middleware |
| Validation | Zod, Yup, class-validator, manual |
| Layer structure | controller → service → repository |
| Typing | explicit return types, strict null |

**Confidence:** 3+ peers same pattern → valid convention; 1–2 → ignore (may be an exception); mixed after the cap → **Skipped**. Never infer from outside the module unless imports clearly tie the files together. Files **imported by** modified files may be read to understand flow (endpoint → handler → service).

---

## Step 3: Standards Snapshot

Compact internal list (~30 lines max), passed to PASSADA 2; not shown in the report unless asked:

```markdown
## Documented
- [rule] (source: CONTRIBUTING.md)

## Inferred (3+ peers)
- [convention] (module: src/services/, seen in: order.ts, user.ts, payment.ts)

## Skipped
- [dimension]: mixed after N peers (file1, file2, ...)
```

---

## How Violations Are Classified

| Violation type | Classification |
| -------------- | -------------- |
| Documented rule + causes bug/wrong behavior | **Bloqueante** |
| Documented rule + style/consistency only | **Ressalva** |
| Inferred convention + style only | **Ressalva** or **Sugestão** |
| Inferred convention + likely bug (e.g. missing error handling peers always have) | **Ressalva** (bloqueante only with clear impact) |

Pattern violations are **not blockers** unless they cause functional or security impact.

---

## Progress Message

```
[Fase 3/5] CONTEXTO — <D> regras documentadas, <I> convenções inferidas (<M> módulos)
```

If both are zero: `[Fase 3/5] CONTEXTO — nenhum padrão claro detectado; análise focará em lógica, segurança e over-engineering`
