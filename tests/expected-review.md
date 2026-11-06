# Expected review of the fixture

Manual smoke test: `node tests/check-recipes.js --keep`, open the printed fixture folder (branch `feat`, base `main`, no remote), and run `/diffs-reviewer` there. The review should match this.

**Header**

- `[Fase 1/5]` shows 2 files analyzed (`src/new.ts`, `src/old.ts` deleted) and 1 ignored (`pnpm-lock.yaml`); scope **Small** even though the lockfile adds 300 lines; the note "sem remoto: usando base local" appears.
- `Veredito: Reprovado`
- `IMPORT-CHECK: 5 achados (4 bloqueantes, 1 ressalvas, 0 incertos)`
- `TYPECHECK: não solicitado`

**Bloqueantes (4, all IMPORT-CHECK, each with evidence and RC)**

| Where | Finding |
| ----- | ------- |
| `src/new.ts:1` | `nope` is not exported by `src/a.ts` (C1, C2, C3 miss) |
| `src/new.ts:2` | `./missing` does not resolve (no same-stem entry in `src/`) |
| `src/new.ts:11` | `store` is not exported by `src/a.ts` (`$store` must not count) |
| `src/user.ts:1` | imports `./old`, deleted in this PR (importer outside the diff) |

**Ressalvas**

| Where | Finding |
| ----- | ------- |
| `src/new.ts:9` | `dayjs` is not declared in `package.json` (IMPORT-CHECK Step E) |
| `src/new.ts` | new file with no references at HEAD — dead code, reported once for the file (§2.6) |

**Must not be reported:** `foo`, `$store`, `T9` (type re-export), the default import `main`, `./esm.js` (ESM → `esm.ts`), `./style.css`, `multi` (multi-line export confirmed after C2 + reading the file), `lodash`, `node:fs`, anything in `pnpm-lock.yaml`.

**Context hygiene:** no unfiltered `git ls-tree -r` output, and IMPORT-CHECK runs as a handful of batched commands, not one per import.
