#!/usr/bin/env node
// Fase 3 do diffs-reviewer: baixa contexto em lote (pedidos, docs, espelho do módulo) e roda o IMPORT-CHECK.
// Uso: node fetch-context.mjs <Dir impresso por fetch-pr.mjs> [arquivo ...]   (até 10 arquivos)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGh, encodePath, RAW } from './lib/gh.mjs';
import { assertWorkDir, safeJoin, diffPath, mapLimit, isMain } from './lib/workdir.mjs';
import { JS_EXT, extractFromPatch, extractFromSource } from './lib/imports.mjs';
import {
  classify, findInTree, candidatePaths, nearMiss, parseJsonc, aliasFromChain, nearestConfig, extendsPath, dirOf,
} from './lib/resolve.mjs';
import { analyzeExports, checkName, NAMED_CHECKABLE } from './lib/exports.mjs';
import { selectDocs, selectMirror, ancestors } from './lib/select.mjs';

const P = path.posix;
const MAX_REQUESTED = 10;
const MAX_TARGETS = 30;
const SEV_ORDER = { Bloqueante: 0, Ressalva: 1, Incerto: 2 };

function makeFetcher({ exec, meta, headDir }) {
  const cache = new Map();
  const failed = [];
  async function fetchMany(paths) {
    const todo = [...new Set(paths)].filter((p) => !cache.has(p));
    await mapLimit(todo, 8, async (p) => {
      try {
        const endpoint = `repos/${meta.headOwner}/${meta.headRepo}/contents/${encodePath(p)}?ref=${meta.headSha}`;
        const body = await runGh(['api', endpoint, '-H', RAW], exec);
        cache.set(p, body);
        const out = safeJoin(headDir, p);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, body);
      } catch {
        cache.set(p, null);
        failed.push(p);
      }
    });
  }
  return { fetchMany, get: (p) => cache.get(p) ?? null, has: (p) => cache.has(p), failed };
}

export async function run(argv, { exec, tmpRoot = os.tmpdir(), log = console.log } = {}) {
  const [dirArg, ...requested] = argv;
  let dir;
  try {
    dir = assertWorkDir(tmpRoot, dirArg);
  } catch (e) {
    log(e.message);
    return 1;
  }
  if (!fs.existsSync(path.join(dir, 'meta.json'))) {
    log(`meta.json não encontrado em ${dir}. Rode fetch-pr.mjs antes.`);
    return 1;
  }
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const treeEntries = fs
    .readFileSync(path.join(dir, 'tree.txt'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [p, s] = l.split('\t');
      return { path: p, size: Number(s) || 0 };
    });
  const treeList = treeEntries.map((e) => e.path);
  const tree = new Set(treeList);
  const headDir = path.join(dir, 'head');
  const fetcher = makeFetcher({ exec, meta, headDir });

  const findings = [];
  const seen = new Set();
  const add = (sev, file, line, msg) => {
    const key = `${file}:${line}:${msg}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ sev, file, line, msg });
  };

  const changed = meta.files.filter((f) => !f.ignored);
  const removedOld = new Set(
    meta.files.flatMap((f) => (f.status === 'D' ? [f.path] : f.status === 'R' && f.previous ? [f.previous] : [])),
  );

  // Pedidos do modelo (até 10) e docs de padrões.
  const reqMissing = requested.filter((p) => !tree.has(p));
  const reqValid = [...new Set(requested.filter((p) => tree.has(p)))];
  const reqTake = reqValid.slice(0, MAX_REQUESTED);
  const overCap = reqValid.slice(MAX_REQUESTED);
  const docs = selectDocs(changed, treeList);

  // IMPORT-CHECK A: specifiers das linhas adicionadas.
  const refsByFile = changed
    .filter((f) => f.status !== 'D' && f.diff && JS_EXT.test(f.path))
    .map((f) => ({ file: f.path, refs: extractFromPatch(fs.readFileSync(diffPath(dir, f.path), 'utf8')) }))
    .filter((x) => x.refs.length);

  // Aliases: tsconfig/jsconfig mais próximo + extends relativos.
  await fetcher.fetchMany([...new Set(refsByFile.map((x) => nearestConfig(x.file, tree)).filter(Boolean))]);
  const aliasCache = new Map();
  async function aliasFor(file) {
    const cfg = nearestConfig(file, tree);
    if (!cfg) return null;
    if (aliasCache.has(cfg)) return aliasCache.get(cfg);
    const chain = [];
    let cur = cfg;
    for (let i = 0; cur && i < 4; i++) {
      await fetcher.fetchMany([cur]);
      const text = fetcher.get(cur);
      if (text === null) break;
      let json;
      try {
        json = parseJsonc(text);
      } catch {
        break;
      }
      chain.push({ dir: dirOf(cur), json });
      cur = extendsPath(cur, json);
    }
    const alias = aliasFromChain(chain);
    aliasCache.set(cfg, alias);
    return alias;
  }

  function missFinding(file, ref, bases) {
    const removedHit = bases.flatMap(candidatePaths).find((p) => removedOld.has(p));
    if (removedHit) return add('Bloqueante', file, ref.line, `"${ref.spec}" aponta para ${removedHit}, removido/renomeado nesta PR`);
    if (bases.some((b) => /generated|\.gen\./.test(b))) return add('Incerto', file, ref.line, `"${ref.spec}": caminho gerado — não verificável no head`);
    if (bases.some((b) => nearMiss(b, treeList))) return add('Incerto', file, ref.line, `"${ref.spec}": existe arquivo com o mesmo nome e extensão não reconhecida — verificar`);
    if (meta.treeTruncated) return add('Incerto', file, ref.line, `"${ref.spec}": não encontrado, mas a árvore do repositório veio truncada`);
    return add('Bloqueante', file, ref.line, `"${ref.spec}" não existe no head (testado: ${bases[0]} + extensões .ts/.tsx/.js/.jsx/.mjs/.cjs/.json/… e /index.*)`);
  }

  // IMPORT-CHECK B: existência.
  const namedTargets = new Map();
  const externals = [];
  let importCount = 0;
  for (const { file, refs } of refsByFile) {
    const alias = await aliasFor(file);
    for (const ref of refs) {
      importCount++;
      let c = classify(file, ref.spec, alias);
      if (c.kind === 'external' && alias?.baseUrlDir != null) {
        const viaBase = P.normalize(P.join(alias.baseUrlDir, ref.spec));
        if (findInTree(viaBase, tree)) c = { kind: 'path', bases: [viaBase] };
      }
      if (c.kind === 'builtin' || c.kind === 'unsupported') continue;
      if (c.kind === 'external') {
        externals.push({ file, line: ref.line, pkg: c.pkg });
        continue;
      }
      if (c.kind === 'unknownAlias') {
        add('Incerto', file, ref.line, `"${ref.spec}": alias não resolvido (tsconfig/jsconfig)`);
        continue;
      }
      if (c.kind === 'outside') {
        add('Incerto', file, ref.line, `"${ref.spec}" aponta para fora da raiz do repositório`);
        continue;
      }
      const target = c.bases.map((b) => findInTree(b, tree)).find(Boolean);
      if (!target) {
        missFinding(file, ref, c.bases);
        continue;
      }
      if (ref.partial) {
        add('Incerto', file, ref.line, `"${ref.spec}": import multi-linha com nomes em linhas não alteradas — nomes não verificados`);
        continue;
      }
      if (ref.names.length && NAMED_CHECKABLE.test(target)) {
        if (!namedTargets.has(target)) namedTargets.set(target, []);
        namedTargets.get(target).push({ file, names: ref.names });
      }
    }
  }

  // IMPORT-CHECK C: exports nomeados (até 30 alvos, seguindo export * até 2 níveis).
  const targetList = [...namedTargets.keys()];
  const targetTake = targetList.slice(0, MAX_TARGETS);
  const targetOver = new Set(targetList.slice(MAX_TARGETS));
  await fetcher.fetchMany(targetTake);
  const infoCache = new Map();
  const info = (p) => {
    if (!infoCache.has(p)) {
      const s = fetcher.get(p);
      infoCache.set(p, s === null ? null : analyzeExports(s));
    }
    return infoCache.get(p);
  };
  const resolveStar = (from, spec) =>
    spec.startsWith('.') ? findInTree(P.normalize(P.join(dirOf(from), spec)), tree) : null;
  let frontier = targetTake;
  let budget = MAX_TARGETS - targetTake.length;
  for (let depth = 0; depth < 2 && budget > 0; depth++) {
    const next = new Set();
    for (const p of frontier) {
      for (const s of info(p)?.starFrom ?? []) {
        const t = resolveStar(p, s);
        if (t && !fetcher.has(t)) next.add(t);
      }
    }
    const batch = [...next].slice(0, budget);
    if (!batch.length) break;
    budget -= batch.length;
    await fetcher.fetchMany(batch);
    frontier = batch;
  }
  const quote = (ns) => ns.map((n) => `"${n.name}"`).join(', ');
  for (const [target, uses] of namedTargets) {
    for (const u of uses) {
      if (targetOver.has(target)) {
        add('Incerto', u.file, u.names[0].line, `${quote(u.names)}: export não verificado em ${target} (fora do teto de contexto)`);
        continue;
      }
      const missing = [];
      const unknown = [];
      for (const n of u.names) {
        const st = checkName(target, n.name, { info, resolve: resolveStar });
        if (st === 'no') missing.push(n);
        else if (st === 'unknown') unknown.push(n);
      }
      if (missing.length) add('Bloqueante', u.file, missing[0].line, `${quote(missing)} não exportado(s) por ${target}`);
      if (unknown.length) add('Incerto', u.file, unknown[0].line, `${quote(unknown)}: export não confirmado em ${target} (export *, CommonJS ou destructuring)`);
    }
  }

  // IMPORT-CHECK E: pacotes externos declarados em algum package.json relevante.
  if (externals.length) {
    const manifests = new Set();
    for (const e of externals) {
      for (const d of ancestors(dirOf(e.file))) {
        const m = d ? `${d}/package.json` : 'package.json';
        if (tree.has(m)) manifests.add(m);
      }
    }
    if (manifests.size) {
      await fetcher.fetchMany([...manifests]);
      const declared = new Set();
      let workspaces = false;
      for (const m of manifests) {
        const s = fetcher.get(m);
        if (!s) continue;
        try {
          const j = JSON.parse(s);
          for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            Object.keys(j[k] ?? {}).forEach((n) => declared.add(n));
          }
          if (m === 'package.json' && j.workspaces) workspaces = true;
        } catch {
          // package.json inválido: ignora
        }
      }
      const once = new Set();
      for (const e of externals) {
        if (declared.has(e.pkg) || once.has(`${e.file}:${e.pkg}`)) continue;
        once.add(`${e.file}:${e.pkg}`);
        add(
          workspaces ? 'Incerto' : 'Ressalva',
          e.file,
          e.line,
          `pacote "${e.pkg}" não declarado em package.json${workspaces ? ' (monorepo: pode vir do workspace)' : ''}`,
        );
      }
    }
  }

  // Contexto: pedidos, docs e espelho do módulo.
  const mirror = selectMirror(changed, treeEntries);
  await fetcher.fetchMany([...reqTake, ...docs, ...mirror.files]);

  // IMPORT-CHECK D: arquivos do espelho que ainda importam caminhos removidos/renomeados.
  if (removedOld.size) {
    for (const p of mirror.files.filter((f) => JS_EXT.test(f))) {
      const src = fetcher.get(p);
      if (src === null) continue;
      for (const ref of extractFromSource(src)) {
        if (!ref.spec.startsWith('.')) continue;
        const base = P.normalize(P.join(dirOf(p), ref.spec));
        if (findInTree(base, tree)) continue;
        const hit = candidatePaths(base).find((c) => removedOld.has(c));
        if (hit) add('Bloqueante', p, ref.line, `"${ref.spec}" aponta para ${hit}, removido/renomeado nesta PR`);
      }
    }
  }

  // Saída.
  const got = (list) => list.filter((p) => fetcher.get(p) !== null).length;
  const totalFetched = [...new Set([...reqTake, ...docs, ...mirror.files, ...targetTake])].filter((p) => fetcher.get(p) !== null).length;
  const over = [...overCap, ...targetOver];
  findings.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || a.file.localeCompare(b.file) || a.line - b.line);
  const count = (s) => findings.filter((f) => f.sev === s).length;

  log(
    `Contexto: ${totalFetched} arquivos baixados (${got(reqTake)} pedidos, ${got(docs)} docs, ${got(mirror.files)} espelho), ` +
      `${over.length} fora do teto${over.length ? `: ${over.slice(0, 10).join(', ')}${over.length > 10 ? ', …' : ''}` : ''}`,
  );
  if (mirror.skipped) log(`Espelho truncado: ${mirror.skipped} arquivos dos diretórios tocados não baixados (teto 60 arquivos / 2 MB)`);
  if (reqMissing.length) log(`Não existem no head: ${reqMissing.join(', ')}`);
  log(
    `IMPORT-CHECK: ${importCount} imports em ${refsByFile.length} arquivos — ` +
      `${count('Bloqueante')} bloqueantes, ${count('Ressalva')} ressalvas, ${count('Incerto')} incertos`,
  );
  for (const f of findings) log(`  [${f.sev}]${' '.repeat(10 - f.sev.length)} ${f.file}:${f.line} — ${f.msg}`);
  if (fetcher.failed.length) log(`Falhas de leitura: ${fetcher.failed.join(', ')}`);
  log(`Dir: ${headDir}`);
  return 0;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
