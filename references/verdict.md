# VERDICT — Classify Findings

**Goal:** Separate blocking issues from reservations and optional suggestions. Assign the final verdict.

**Completion criterion:** Every finding classified; duplicates merged; verdict assigned per rules below.

---

## Severity Levels

### Bloqueante (blocks approval → Reprovado)

- Type/typecheck errors in diff files that break build
- Logic bugs with clear functional impact
- Serious security vulnerabilities
- Data loss or state corruption risk
- Documented standard violation that **causes incorrect behavior**
- Over-engineering with **proven functional impact** (e.g. double-applied plugin causing runtime error)

**Never bloqueante:** style-only over-engineering, naming, or pattern mismatch without functional impact.

### Ressalva (non-blocking — drives "Aprovado com ressalvas")

Important improvements worth addressing before or soon after merge:

- Refactoring opportunities (duplication, long functions)
- Inferred pattern mismatches (imports, naming) without functional impact
- Documented style violations without bug impact
- Missing tests for risky logic (suggestion level, not hard blocker)
- Performance concerns that are not O(n²) on hot paths
- **Over-engineering:** duplicated infra, unnecessary abstraction layer, middle man with maintenance cost

### Sugestão (optional — does not change verdict alone)

Minor nice-to-haves:

- Readability tweaks
- Alternative idioms
- Optional extractions
- Low-impact performance notes
- **Over-engineering:** future-only params, minor wrapper, `[Incerto]` on OE signal

---

## Over-engineering Classification

| Signal | Typical severity |
| ------ | ---------------- |
| Duplicated plugin/middleware (e.g. on schema extending base that already applies it) | **Ressalva** |
| Abstraction layer unused in module | **Ressalva** |
| Middle man / unnecessary wrapper | **Ressalva** or **Sugestão** |
| Future-only flag or param | **Sugestão** |
| `[Incerto]` on OE | **Sugestão** |
| OE with proven runtime/build break | **Bloqueante** |

---

## Verdict Rules

| Condition | Verdict |
| --------- | ------- |
| 0 bloqueantes, 0 ressalvas importantes | **Aprovado** |
| 0 bloqueantes, 1+ ressalvas | **Aprovado com ressalvas** |
| 1+ bloqueantes | **Reprovado** |

**Hard rule:** If any bloqueante exists, verdict is **Reprovado** — never "Aprovado com ressalvas".

Suggestions alone never change the verdict from Aprovado.

---

## Dedup and Rank

Before reporting:

1. Merge duplicate findings on the same line/root cause
2. Sort bloqueantes by severity (security > data loss > logic > types)
3. Sort ressalvas by impact (consistency > over-engineering > readability)
4. Preserve one RC per merged finding (combine if same root cause)

---

## Progress Message

```
[Fase 4/5] VERDICT — <veredito>: <N> bloqueantes, <R> ressalvas, <S> sugestões
```
