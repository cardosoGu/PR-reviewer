import { execFile } from 'node:child_process';

const LINK_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:\/[^\s?#]*)?(?:[?#]\S*)?$/;

export function parseLink(link) {
  const m = LINK_RE.exec(String(link ?? '').trim());
  if (!m) {
    throw new Error(
      `Link inválido: "${link ?? ''}". Formato esperado: https://github.com/<owner>/<repo>/pull/<n>`,
    );
  }
  const [, owner, repo, num] = m;
  return { owner, repo, number: Number(num), url: `https://github.com/${owner}/${repo}/pull/${num}` };
}

export const RAW = 'Accept: application/vnd.github.raw';

const SEG = '[A-Za-z0-9_.-]+';
const SHA = '[0-9a-f]{40}';
const ENDPOINTS = [
  new RegExp(`^repos/${SEG}/${SEG}/pulls/\\d+/files\\?per_page=100$`),
  new RegExp(`^repos/${SEG}/${SEG}/git/trees/${SHA}\\?recursive=1$`),
  new RegExp(`^repos/${SEG}/${SEG}/contents/[^?\\s]+\\?ref=${SHA}$`),
];

function deny(args, why) {
  throw new Error(`Comando gh bloqueado (${why}): gh ${args.join(' ')}`);
}

// Única porta de saída para o gh. Tudo que não está aqui é proibido.
export function assertAllowed(args) {
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    deny([String(args)], 'argumentos inválidos');
  }
  const [cmd, sub, ...rest] = args;
  if (cmd === 'pr' && sub === 'view') {
    if (rest.length !== 3 || rest[1] !== '--json' || !/^[A-Za-z]+(,[A-Za-z]+)*$/.test(rest[2])) {
      deny(args, 'pr view só aceita <link> --json <campos>');
    }
    parseLink(rest[0]);
    return;
  }
  if (cmd === 'pr' && sub === 'diff') {
    if (rest.length !== 1) deny(args, 'pr diff só aceita <link>');
    parseLink(rest[0]);
    return;
  }
  if (cmd === 'api') {
    if (!ENDPOINTS.some((re) => re.test(sub ?? ''))) deny(args, 'endpoint fora da allowlist');
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--paginate' || a === '--slurp') continue;
      if (a === '-H' && rest[i + 1] === RAW) {
        i++;
        continue;
      }
      deny(args, `flag não permitida: ${a}`);
    }
    return;
  }
  deny(args, 'subcomando fora da allowlist');
}

function defaultExec(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
        } else resolve(stdout);
      },
    );
  });
}

export async function runGh(args, exec = defaultExec) {
  assertAllowed(args);
  return exec(args);
}

export function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

export function ghError(e) {
  if (String(e?.message ?? '').startsWith('Comando gh bloqueado')) return e.message;
  if (e?.code === 'ENOENT') return 'gh não encontrado. Instale o GitHub CLI e rode `gh auth login`.';
  const first = String(e?.stderr || e?.message || e).trim().split('\n')[0];
  return `Falha no gh: ${first}. Verifique \`gh auth status\` e o acesso ao repositório.`;
}
