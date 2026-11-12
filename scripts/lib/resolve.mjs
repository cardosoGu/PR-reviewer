import path from 'node:path';

const P = path.posix;
const EXTS = ['d.ts', 'd.mts', 'd.cts', 'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'vue', 'svelte', 'astro'];
const INDEX_EXTS = ['ts', 'tsx', 'js', 'jsx'];
const BUILTINS = new Set([
  'fs', 'path', 'os', 'crypto', 'url', 'util', 'events', 'stream', 'child_process', 'http', 'https', 'zlib',
  'buffer', 'assert', 'querystring', 'readline', 'net', 'tls', 'dns', 'worker_threads', 'perf_hooks', 'process',
  'module', 'timers', 'v8', 'vm',
]);
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export const dirOf = (p) => (P.dirname(p) === '.' ? '' : P.dirname(p));

export function candidatePaths(base) {
  const c = [base, ...EXTS.map((e) => `${base}.${e}`), ...INDEX_EXTS.map((e) => `${base}/index.${e}`)];
  const esm = /^(.*)\.(js|jsx|mjs|cjs)$/.exec(base);
  if (esm) {
    const [, stem, ext] = esm;
    if (ext === 'mjs') c.push(`${stem}.mts`, `${stem}.d.mts`);
    else if (ext === 'cjs') c.push(`${stem}.cts`, `${stem}.d.cts`);
    else c.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`);
  }
  return c;
}

export function findInTree(base, tree) {
  return candidatePaths(base).find((p) => tree.has(p)) ?? null;
}

// Existe arquivo com o mesmo nome e outra extensão (loader/extensão não listada)?
export function nearMiss(base, treeList) {
  const stem = P.basename(base).replace(/\.(js|jsx|mjs|cjs)$/, '');
  const dir = dirOf(base);
  const prefix = dir ? `${dir}/${stem}` : stem;
  return treeList.some((p) => p.startsWith(`${prefix}.`) || p.startsWith(`${prefix}/`));
}

export function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function isBuiltin(spec) {
  return spec.startsWith('node:') || BUILTINS.has(packageName(spec));
}

export function matchAlias(spec, alias) {
  for (const [pattern, targets] of Object.entries(alias?.paths ?? {})) {
    const star = pattern.indexOf('*');
    let captured = null;
    if (star === -1) {
      if (spec === pattern) captured = '';
    } else {
      const pre = pattern.slice(0, star);
      const post = pattern.slice(star + 1);
      if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) {
        captured = spec.slice(pre.length, spec.length - post.length);
      }
    }
    if (captured !== null) {
      return targets.map((t) => P.normalize(P.join(alias.baseDir, t.replace('*', captured))));
    }
  }
  return null;
}

// Classifica um specifier importado por `importer`.
export function classify(importer, spec, alias) {
  if (spec.startsWith('.')) {
    const base = P.normalize(P.join(dirOf(importer), spec));
    if (base === '..' || base.startsWith('../')) return { kind: 'outside' };
    return { kind: 'path', bases: [base] };
  }
  if (spec.startsWith('/')) return { kind: 'unsupported' };
  const viaAlias = matchAlias(spec, alias);
  if (viaAlias) return { kind: 'path', bases: viaAlias };
  if (isBuiltin(spec)) return { kind: 'builtin' };
  const pkg = packageName(spec);
  if (!NPM_NAME.test(pkg)) return { kind: 'unknownAlias' };
  return { kind: 'external', pkg };
}

// JSON com comentários e vírgulas sobrando (tsconfig/jsconfig).
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  const s = String(text ?? '');
  while (i < s.length) {
    const ch = s[i];
    const nx = s[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\') {
        out += nx ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && nx === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && nx === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// chain: [{dir, json}] do tsconfig mais próximo para os que ele estende.
export function aliasFromChain(chain) {
  let paths = null;
  let pathsDir = null;
  let baseUrlDir = null;
  for (const { dir, json } of chain) {
    const co = json?.compilerOptions ?? {};
    if (paths === null && co.paths) {
      paths = co.paths;
      pathsDir = dir;
    }
    if (baseUrlDir === null && typeof co.baseUrl === 'string') baseUrlDir = P.normalize(P.join(dir, co.baseUrl));
  }
  if (!paths && baseUrlDir === null) return null;
  return { paths: paths ?? {}, baseDir: baseUrlDir ?? pathsDir, baseUrlDir };
}

// tsconfig.json ou jsconfig.json mais próximo subindo a partir do arquivo.
export function nearestConfig(file, tree) {
  let d = dirOf(file);
  for (;;) {
    for (const n of ['tsconfig.json', 'jsconfig.json']) {
      const p = d ? `${d}/${n}` : n;
      if (tree.has(p)) return p;
    }
    if (!d) return null;
    d = dirOf(d);
  }
}

export function extendsPath(configPath, json) {
  const ext = Array.isArray(json?.extends) ? json.extends[0] : json?.extends;
  if (typeof ext !== 'string' || !ext.startsWith('.')) return null;
  const p = P.normalize(P.join(dirOf(configPath), ext));
  return p.endsWith('.json') ? p : `${p}.json`;
}
