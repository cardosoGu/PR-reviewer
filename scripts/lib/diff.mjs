const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Linhas adicionadas de um patch, com o número da linha no arquivo novo.
export function addedLines(patch) {
  const out = [];
  let line = 0;
  let hunk = -1;
  for (const r of String(patch ?? '').split('\n')) {
    const raw = r.replace(/\r$/, '');
    const m = HUNK_RE.exec(raw);
    if (m) {
      line = Number(m[1]);
      hunk++;
      continue;
    }
    if (hunk < 0) continue;
    if (raw.startsWith('+')) {
      out.push({ line, text: raw.slice(1), hunk });
      line++;
    } else if (raw.startsWith('-') || raw.startsWith('\\')) {
      // lado antigo ou "\ No newline at end of file"
    } else {
      line++;
    }
  }
  return out;
}

// Divide a saída de `gh pr diff` em Map(caminho novo -> patch a partir do primeiro @@).
export function splitUnifiedDiff(text) {
  const files = new Map();
  for (const chunk of String(text ?? '').split(/^diff --git /m).slice(1)) {
    const lines = chunk.split('\n');
    const start = lines.findIndex((l) => l.startsWith('@@'));
    const header = start === -1 ? lines : lines.slice(0, start);
    let file = null;
    const plus = header.find((l) => l.startsWith('+++ '));
    if (plus && plus.slice(4).trim() !== '/dev/null') file = plus.slice(4).trim().replace(/^b\//, '');
    if (!file) {
      const minus = header.find((l) => l.startsWith('--- '));
      if (minus && minus.slice(4).trim() !== '/dev/null') file = minus.slice(4).trim().replace(/^a\//, '');
    }
    if (!file) {
      const m = /^a\/(\S+) b\/(\S+)/.exec(lines[0]);
      if (m) file = m[2];
    }
    if (file) files.set(file, start === -1 ? '' : lines.slice(start).join('\n').replace(/\n+$/, ''));
  }
  return files;
}
