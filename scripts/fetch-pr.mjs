#!/usr/bin/env node
// Fase 1 do diffs-reviewer: coleta metadados, diff por arquivo e árvore de uma PR via gh (só leitura).
// Uso: node fetch-pr.mjs <link-da-pr> [--force]
// Saída: 0 ok · 1 erro · 2 PR fechada/mergeada/draft (pedir confirmação) · 3 nenhum arquivo relevante
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLink, runGh, ghError } from './lib/gh.mjs';
import { splitUnifiedDiff } from './lib/diff.mjs';
import { ignoreReason, classifyScope } from './lib/filter.mjs';
import { workDir, diffPath, isMain } from './lib/workdir.mjs';

const VIEW_FIELDS =
  'title,body,state,isDraft,baseRefName,headRefOid,headRepository,headRepositoryOwner,commits,url,number';
const STATUS = { added: 'A', modified: 'M', changed: 'M', unchanged: 'M', removed: 'D', renamed: 'R', copied: 'C' };

function intent(view) {
  const body = String(view.body ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (body.length) return [...body.slice(0, 8), ...(body.length > 8 ? ['…'] : [])];
  const commits = (view.commits ?? []).map((c) => `- ${c.messageHeadline}`).filter((l) => l.length > 2);
  return commits.length ? commits.slice(0, 10) : ['(sem descrição nem commits)'];
}

export async function run(argv, { exec, tmpRoot = os.tmpdir(), log = console.log } = {}) {
  const force = argv.includes('--force');
  const link = argv.find((a) => !a.startsWith('--'));
  let pr;
  try {
    pr = parseLink(link);
  } catch (e) {
    log(e.message);
    return 1;
  }
  const gh = (args) => runGh(args, exec);

  let view;
  let pages;
  try {
    [view, pages] = await Promise.all([
      gh(['pr', 'view', pr.url, '--json', VIEW_FIELDS]).then(JSON.parse),
      gh(['api', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/files?per_page=100`, '--paginate', '--slurp']).then(JSON.parse),
    ]);
  } catch (e) {
    log(ghError(e));
    return 1;
  }

  const stateLabel = view.state === 'OPEN' && view.isDraft ? 'DRAFT' : view.state;
  if (!force && stateLabel !== 'OPEN') {
    log(`Aviso: a PR #${pr.number} está ${stateLabel}. Nada foi coletado.`);
    log('Pergunte ao usuário se deve continuar; só com confirmação rode de novo com --force.');
    return 2;
  }

  const headSha = view.headRefOid;
  const headOwner = view.headRepositoryOwner?.login ?? pr.owner;
  const headRepo = view.headRepository?.name ?? pr.repo;
  let tree;
  try {
    tree = JSON.parse(await gh(['api', `repos/${headOwner}/${headRepo}/git/trees/${headSha}?recursive=1`]));
  } catch (e) {
    log(ghError(e));
    return 1;
  }

  const files = pages.flat().map((f) => ({
    path: f.filename,
    status: STATUS[f.status] ?? 'M',
    previous: f.previous_filename ?? null,
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    patch: f.patch ?? null,
    ignored: ignoreReason(f.filename),
  }));

  const needFull = files.filter((f) => !f.ignored && f.patch === null && f.additions + f.deletions > 0);
  if (needFull.length) {
    try {
      const split = splitUnifiedDiff(await gh(['pr', 'diff', pr.url]));
      for (const f of needFull) f.patch = split.get(f.path) || null;
    } catch {
      // continuam sem patch e aparecem em "Não alcançados"
    }
  }

  const dir = workDir(tmpRoot, pr);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const relevant = files.filter((f) => !f.ignored);
  for (const f of relevant) {
    if (!f.patch) continue;
    const out = diffPath(dir, f.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, f.patch.endsWith('\n') ? f.patch : `${f.patch}\n`);
  }

  const blobs = (tree.tree ?? []).filter((e) => e.type === 'blob');
  fs.writeFileSync(path.join(dir, 'tree.txt'), blobs.map((e) => `${e.path}\t${e.size ?? 0}`).join('\n') + '\n');
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        owner: pr.owner, repo: pr.repo, number: pr.number, url: pr.url, title: view.title, state: stateLabel,
        baseRefName: view.baseRefName, headSha, headOwner, headRepo, treeTruncated: Boolean(tree.truncated),
        files: files.map(({ patch, ...rest }) => ({ ...rest, diff: Boolean(patch) && !rest.ignored })),
      },
      null,
      2,
    ),
  );

  if (!relevant.length) {
    log('Nenhum arquivo relevante na PR.');
    return 3;
  }

  const diffLines = relevant.reduce((s, f) => s + f.additions + f.deletions, 0);
  const ignoredByReason = {};
  for (const f of files) if (f.ignored) ignoredByReason[f.ignored] = (ignoredByReason[f.ignored] ?? 0) + 1;
  const ignoredTotal = files.length - relevant.length;
  const unreached = relevant.filter((f) => !f.patch && f.additions + f.deletions > 0).map((f) => f.path);

  log(`PR #${pr.number} ${view.title} — ${stateLabel} — base ${view.baseRefName} ← head ${headSha.slice(0, 7)}`);
  log('Intent:');
  for (const l of intent(view)) log(`  ${l}`);
  log(`Arquivos (${relevant.length} analisados, ${ignoredTotal} ignorados, ${diffLines} linhas, escopo ${classifyScope(relevant.length, diffLines)}):`);
  for (const f of relevant) {
    const counts = f.status === 'D' ? '' : ` +${f.additions} -${f.deletions}`;
    log(`  ${f.status} ${f.path}${f.previous ? ` ← ${f.previous}` : ''}${counts}`);
  }
  log(`Ignorados: ${Object.entries(ignoredByReason).map(([r, n]) => `${r} ${n}`).join(', ') || 'nenhum'}`);
  log(`Não alcançados: ${unreached.join(', ') || 'nenhum'}`);
  if (tree.truncated) log('Aviso: árvore do repositório truncada pelo GitHub; o IMPORT-CHECK pode marcar [Incerto].');
  log(`Dir: ${dir}`);
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
