import path from 'node:path';

export const ROOT_NAME = 'diffs-reviewer';

export function workDir(tmpRoot, pr) {
  return path.join(tmpRoot, ROOT_NAME, `${pr.owner}__${pr.repo}__pr-${pr.number}`);
}

export function assertWorkDir(tmpRoot, dir) {
  const root = path.resolve(tmpRoot, ROOT_NAME) + path.sep;
  const abs = path.resolve(String(dir ?? ''));
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (!dir || !norm(abs).startsWith(norm(root))) {
    throw new Error(`Diretório fora da área da skill: "${dir ?? ''}". Use o Dir impresso por fetch-pr.mjs.`);
  }
  return abs;
}

export function safeJoin(base, rel) {
  const absBase = path.resolve(base);
  const p = path.resolve(absBase, ...rel.split('/'));
  if (!p.startsWith(absBase + path.sep)) throw new Error(`Caminho inválido: ${rel}`);
  return p;
}

export function diffPath(dir, file) {
  return safeJoin(path.join(dir, 'diffs'), file) + '.diff';
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  const self = new URL(metaUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const norm = (p) => path.resolve(decodeURIComponent(p)).toLowerCase();
  return norm(self) === norm(process.argv[1]);
}
