const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'composer.lock', 'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'go.sum',
]);
const GENERATED_DIRS = new Set(['dist', 'build', 'out', 'coverage', '.next', '__snapshots__']);
const I18N_DIRS = new Set(['locales', 'i18n', 'translations']);
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|bmp|ico|avif|tiff?|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|rar|7z|jar|exe|dll|so|dylib|mp3|mp4|mov|avi|webm|wav|ogg)$/i;

// Motivo para ignorar o arquivo (regra fixa) ou null se deve ser analisado.
export function ignoreReason(file) {
  const segs = file.split('/');
  const base = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  if (segs.includes('node_modules') || dirs.includes('vendor')) return 'dependência';
  if (LOCKFILES.has(base)) return 'lockfile';
  if (dirs.some((d) => GENERATED_DIRS.has(d)) || /\.(min\.js|min\.css|map|snap)$/.test(base)) return 'gerado';
  if (BINARY_EXT.test(base)) return 'binário';
  if (/\.json$/i.test(base) && dirs.some((d) => I18N_DIRS.has(d))) return 'i18n';
  if (/\.mdx?$/i.test(base)) return 'docs';
  return null;
}

export function classifyScope(files, lines) {
  if (files <= 3 && lines <= 100) return 'Small';
  if (files >= 11 || lines > 500) return 'Large';
  return 'Medium';
}
