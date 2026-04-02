// =====================================================================
// diff-viewer.ts -- PR Diff overlay (types, state, rendering)
// =====================================================================

import { esc, toast, invoke, ICO, S, getOrg, getProject } from '../state';
import { getToken, getRepo } from '../config';

// ── Diff types ──
interface PrFile { path: string; original_path: string | null; change_type: string; size: number; }
interface FileDiffContent { original: string; modified: string; is_binary: boolean; size_kb: number; formatted: string; }
interface DiffLine { type: 'same' | 'add' | 'del' | 'info'; oldNum?: number; newNum?: number; text: string; }

// ── Package name mapping (GUID → friendly name) for .enzp files ──
let pkgMap: Record<string, string> | null = null;

async function ensurePkgMap(): Promise<Record<string, string>> {
  if (pkgMap) return pkgMap;
  try {
    pkgMap = await invoke<Record<string, string>>('get_package_mapping');
  } catch {
    pkgMap = {};
  }
  return pkgMap;
}

/** Parse an .enzp filename into package prefix, GUID, and resolved name */
function parseEnzp(filename: string, map: Record<string, string>): { prefix: string; guid: string; name: string } | null {
  // Pattern: PREFIX.GUID.enzp  (GUID may have dashes)
  const m = filename.match(/^([A-Za-z_]+[A-Za-z0-9_]*)\.([0-9a-fA-F-]+)\.enzp$/);
  if (!m) return null;
  const prefix = m[1];
  const guid = m[2];
  const normalized = guid.toLowerCase().replace(/-/g, '');
  const name = map[normalized] || prefix;
  return { prefix, guid, name };
}

let diffState = {
  prId: 0,
  prTitle: '',
  sourceBranch: '',
  targetBranch: '',
  files: [] as PrFile[],
  selectedFile: '',
  mode: 'structured' as 'structured' | 'split' | 'unified',
  lines: [] as DiffLine[],
  loading: false,
  fileLoading: false,
  isBinary: false,
  binarySizeKb: 0,
  enzpContent: '',
};

export async function viewPrDiff(prId: number, title: string, source: string, target: string): Promise<void> {
  diffState.prId = prId;
  diffState.prTitle = title;
  diffState.sourceBranch = source;
  diffState.targetBranch = target;
  diffState.files = [];
  diffState.selectedFile = '';
  diffState.lines = [];
  diffState.loading = true;

  renderDiffOverlay();

  const token = getToken();
  const repo = getRepo();
  try {
    // Load PR files and package mapping in parallel
    const [files] = await Promise.all([
      invoke<PrFile[]>('get_pr_files', {
        token, project: getProject(), repository: repo, prId, organization: getOrg(),
      }),
      ensurePkgMap(),
    ]);
    diffState.files = files;
    diffState.loading = false;
    // Auto-select first file
    if (diffState.files.length > 0) {
      await selectDiffFile(diffState.files[0].path);
    } else {
      renderDiffOverlay();
    }
  } catch (e) {
    diffState.loading = false;
    toast('Failed to load PR files: ' + e, 'error');
    renderDiffOverlay();
  }
}

async function selectDiffFile(path: string): Promise<void> {
  diffState.selectedFile = path;
  diffState.fileLoading = true;
  diffState.lines = [];
  renderDiffOverlay();

  const token = getToken();
  const repo = getRepo();
  try {
    const content = await invoke<FileDiffContent>('get_file_diff', {
      token, project: getProject(), repository: repo, prId: diffState.prId, filePath: path, organization: getOrg(),
    });
    diffState.isBinary = content.is_binary;
    diffState.binarySizeKb = content.size_kb;
    // For .enzp files, store raw content for structured view
    // Use backend-formatted content for structured view, raw for diff views
    diffState.enzpContent = content.formatted || '';
    if (diffState.enzpContent) diffState.mode = 'structured';
    if (content.is_binary) {
      diffState.lines = [];
    } else if (!content.original && !content.modified) {
      diffState.lines = [{ type: 'info', text: 'No content available for this file.' }];
    } else {
      diffState.lines = computeDiff(content.original, content.modified);
    }
    diffState.fileLoading = false;
    renderDiffOverlay();
  } catch (e) {
    diffState.fileLoading = false;
    diffState.lines = [{ type: 'info', text: 'Error loading file: ' + String(e) }];
    renderDiffOverlay();
  }
}

function closeDiffOverlay(): void {
  const el = document.getElementById('diffOverlay');
  if (el) el.remove();
}

function toggleDiffMode(): void {
  diffState.mode = diffState.mode === 'split' ? 'unified' : 'split';
  renderDiffOverlay();
}

// ── LCS-based diff (Myers-like, with context collapsing) ──
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // For very large files, use a simpler approach
  const m = oldLines.length, n = newLines.length;
  if (m + n > 20000) {
    return simpleDiff(oldLines, newLines);
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Traceback
  const ops: Array<{ type: 'same' | 'add' | 'del'; oldIdx?: number; newIdx?: number }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'same', oldIdx: i - 1, newIdx: j - 1 });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', newIdx: j - 1 });
      j--;
    } else {
      ops.push({ type: 'del', oldIdx: i - 1 });
      i--;
    }
  }
  ops.reverse();

  // Build full line array with line numbers
  const allLines: DiffLine[] = [];
  let oldNum = 0, newNum = 0;
  for (const op of ops) {
    if (op.type === 'same') {
      oldNum++; newNum++;
      allLines.push({ type: 'same', oldNum, newNum, text: oldLines[op.oldIdx!] });
    } else if (op.type === 'del') {
      oldNum++;
      allLines.push({ type: 'del', oldNum, text: oldLines[op.oldIdx!] });
    } else {
      newNum++;
      allLines.push({ type: 'add', newNum, text: newLines[op.newIdx!] });
    }
  }

  // If file is small (<100 lines total), show everything
  if (allLines.length < 100) return allLines;

  // Context collapsing: show 3 lines of context around changes
  const CONTEXT = 3;
  const visible = new Set<number>();
  allLines.forEach((line, idx) => {
    if (line.type !== 'same') {
      for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(allLines.length - 1, idx + CONTEXT); k++) {
        visible.add(k);
      }
    }
  });

  // If everything is visible (all changes), return as-is
  if (visible.size === allLines.length) return allLines;

  // Build collapsed result
  const result: DiffLine[] = [];
  let lastShown = -1;
  for (let idx = 0; idx < allLines.length; idx++) {
    if (visible.has(idx)) {
      if (lastShown >= 0 && idx - lastShown > 1) {
        const skipped = idx - lastShown - 1;
        result.push({ type: 'info', text: `··· ${skipped} unchanged lines ···` });
      }
      result.push(allLines[idx]);
      lastShown = idx;
    }
  }
  // Trailing collapse
  if (lastShown < allLines.length - 1) {
    const skipped = allLines.length - 1 - lastShown;
    result.push({ type: 'info', text: `··· ${skipped} unchanged lines ···` });
  }

  return result;
}

function simpleDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  let oldNum = 0, newNum = 0;
  // Simple line-by-line: show all old as deleted, all new as added (for very large files)
  result.push({ type: 'info', text: `File too large for inline diff (${oldLines.length + newLines.length} lines). Showing full replacement.` });
  for (const l of oldLines) { oldNum++; result.push({ type: 'del', oldNum, text: l }); }
  for (const l of newLines) { newNum++; result.push({ type: 'add', newNum, text: l }); }
  return result;
}

// ── Render ──
function renderDiffOverlay(): void {
  let overlay = document.getElementById('diffOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'diffOverlay';
    overlay.className = 'diff-overlay';
    document.body.appendChild(overlay);
  }

  const fileIcon = (ct: string) => ct === 'add' ? '+' : ct === 'delete' || ct === 'delete, sourceRename' ? '\u2212' : ct.includes('rename') ? '\u2192' : '~';
  const fileCls = (ct: string) => ct === 'add' ? 'add' : ct.includes('delete') ? 'del' : ct.includes('rename') ? 'rename' : 'edit';

  const hasEnzp = diffState.enzpContent.length > 0;
  const adds = diffState.lines.filter(l => l.type === 'add').length;
  const dels = diffState.lines.filter(l => l.type === 'del').length;

  let html = `<div class="diff-header">
    <div class="diff-header-left">
      <span class="diff-header-title">PR #${diffState.prId}</span>
      <span class="diff-header-subtitle">${esc(diffState.prTitle)}</span>
      <span class="diff-header-branches">${esc(diffState.sourceBranch)} \u2192 ${esc(diffState.targetBranch)}</span>
    </div>
    <div class="diff-header-right">
      <span class="diff-stat-adds">+${adds}</span>
      <span class="diff-stat-dels">\u2212${dels}</span>
      <button class="diff-azdo-btn" onclick="openPrInAzdo()" title="Open in Azure DevOps">\u2197 AzDO</button>
      ${!hasEnzp ? `
      <button class="diff-mode-btn ${diffState.mode === 'split' ? 'active' : ''}" onclick="setDiffMode('split')" title="Side-by-side"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg></button>
      <button class="diff-mode-btn ${diffState.mode === 'unified' ? 'active' : ''}" onclick="setDiffMode('unified')" title="Unified"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>` : ''}
      <button class="diff-close-btn" onclick="closeDiffOverlay()">\u2715</button>
    </div>
  </div>
  <div class="diff-body">
    <div class="diff-sidebar">
      <div class="diff-sidebar-title">Files <span class="diff-file-count">${diffState.files.length}</span></div>`;

  if (diffState.loading) {
    html += '<div class="diff-sidebar-loading">Loading files...</div>';
  } else {
    diffState.files.forEach(f => {
      const parts = f.path.split('/').filter(Boolean);
      const name = parts.pop() || f.path;
      const dir = parts.join('/');
      // Truncate long GUID filenames for display
      const shortName = name.length > 24 ? name.substring(0, 10) + '\u2026' + name.substring(name.length - 10) : name;
      const selected = f.path === diffState.selectedFile ? ' selected' : '';
      html += `<div class="diff-file-item ${fileCls(f.change_type)}${selected}" onclick="selectDiffFile('${esc(f.path)}')" title="${esc(f.path)}">
        <span class="diff-file-icon">${fileIcon(f.change_type)}</span>
        <span class="diff-file-name">${esc(shortName)}</span>
        ${dir ? `<span class="diff-file-dir">/${esc(dir)}</span>` : ''}
      </div>`;
    });
  }

  html += `</div><div class="diff-content">`;

  if (diffState.fileLoading) {
    html += '<div class="diff-loading">Loading diff...</div>';
  } else if (!diffState.selectedFile) {
    html += renderChangeSummary();
  } else {
    // Show selected file path header
    html += `<div class="diff-file-header">${esc(diffState.selectedFile)}</div>`;
    if (diffState.isBinary) {
      html += renderChangeSummary();
    } else if (diffState.enzpContent) {
      html += renderEnzpView(diffState.enzpContent);
    } else if (diffState.mode === 'split') {
      html += renderSplitDiff();
    } else {
      html += renderUnifiedDiff();
    }
  }

  html += '</div></div>';
  overlay.innerHTML = html;
}

function toggleEnzpSection(el: HTMLElement): void {
  const section = el.closest('.enzp-section');
  if (section) section.classList.toggle('collapsed');
}

function toggleAllEnzpSections(collapse: boolean): void {
  document.querySelectorAll('.enzp-section').forEach(s => {
    s.classList.toggle('collapsed', collapse);
  });
}

function filterEnzpSections(query: string): void {
  const q = query.toLowerCase();
  document.querySelectorAll('.enzp-section').forEach(sec => {
    if (!q) { (sec as HTMLElement).style.display = ''; return; }
    const text = sec.textContent?.toLowerCase() || '';
    (sec as HTMLElement).style.display = text.includes(q) ? '' : 'none';
  });
}

function renderEnzpView(content: string): string {
  const lines = content.split('\n');
  const file = diffState.files.find(f => f.path === diffState.selectedFile);
  const isAdded = file?.change_type === 'add';
  const isDeleted = file?.change_type.includes('delete');

  // Parse into structured sections
  interface EnzpEntry { type: 'add' | 'mod' | 'code' | 'info'; label: string; lines: string[]; }
  interface EnzpSection { header: string; icon: string; entries: EnzpEntry[]; }
  const sections: EnzpSection[] = [];
  let curSection: EnzpSection | null = null;
  let curEntry: EnzpEntry | null = null;

  const flushEntry = () => { if (curEntry && curSection) { curSection.entries.push(curEntry); curEntry = null; } };
  const flushSection = () => { flushEntry(); if (curSection) sections.push(curSection); curSection = null; };

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    // Skip noise: file headers, raw version lines, header.xml
    if (t.startsWith('\u{2501}') || t.startsWith('\u{2500}\u{2500}')) continue;
    if (/^\d+\.\d+.*\u00A4/.test(t)) continue; // raw 6.01771¤£¤... lines

    // Package version — becomes primary header
    if (t.startsWith('Package:')) {
      flushSection();
      curSection = { header: t.replace('Package: ', ''), icon: '\uD83D\uDCE6', entries: [] };
      continue;
    }
    // [PAGES] section
    if (t.startsWith('[PAGES]')) {
      flushSection();
      curSection = { header: t.replace('[PAGES] ', ''), icon: '\uD83D\uDCC1', entries: [] };
      continue;
    }

    if (!curSection) { curSection = { header: 'Changes', icon: '\uD83D\uDCCB', entries: [] }; }

    // [ADD] entry — extract XMLInfo name if available
    if (t.startsWith('[ADD]')) {
      flushEntry();
      const raw = t.substring(6);
      curEntry = { type: 'add', label: raw, lines: [] };
      continue;
    }
    // [MOD] entry
    if (t.startsWith('[MOD]')) {
      flushEntry();
      const raw = t.substring(6);
      curEntry = { type: 'mod', label: raw, lines: [] };
      continue;
    }

    if (curEntry) {
      curEntry.lines.push(line);
    }
  }
  flushSection();

  // Merge sections with the same header (Rust parser can emit duplicates)
  const merged: EnzpSection[] = [];
  const seen = new Map<string, number>();
  for (const s of sections) {
    const key = s.icon + s.header;
    if (seen.has(key)) {
      merged[seen.get(key)!].entries.push(...s.entries);
    } else {
      seen.set(key, merged.length);
      merged.push({ ...s, entries: [...s.entries] });
    }
  }
  sections.length = 0;
  sections.push(...merged);

  // Compute global stats
  let totalAdds = 0, totalMods = 0, totalTables = 0;
  for (const s of sections) {
    if (s.entries.length === 0) continue;
    if (s.icon === '\uD83D\uDCC1') totalTables++;
    totalAdds += s.entries.filter(e => e.type === 'add').length;
    totalMods += s.entries.filter(e => e.type === 'mod').length;
  }

  // Render
  const icoSearch = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const icoExpand = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  const icoCollapse = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  let html = `<div class="enzp-view">`;

  // Global stats bar
  html += `<div class="enzp-toolbar">
    <div class="enzp-global-stats">
      <span class="enzp-gs">${totalTables} table${totalTables > 1 ? 's' : ''}</span>
      <span class="enzp-gs enzp-stat-add">+${totalAdds} added</span>
      <span class="enzp-gs enzp-stat-mod">\u270F${totalMods} modified</span>
    </div>
    <div class="enzp-toolbar-actions">
      <div class="enzp-search-box">
        ${icoSearch}
        <input class="enzp-search" type="text" placeholder="Filter..." oninput="filterEnzpSections(this.value)" />
      </div>
      <button class="enzp-tool-btn" onclick="toggleAllEnzpSections(false)" title="Expand all">${icoExpand}</button>
      <button class="enzp-tool-btn" onclick="toggleAllEnzpSections(true)" title="Collapse all">${icoCollapse}</button>
    </div>
  </div>`;

  // Lucide SVG icons
  const icoFolder = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';
  const icoPackage = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>';
  const icoFile = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

  for (let si = 0; si < sections.length; si++) {
    const s = sections[si];
    // Skip sections with no entries (empty [PAGES])
    if (s.entries.length === 0) continue;

    const addCount = s.entries.filter(e => e.type === 'add').length;
    const modCount = s.entries.filter(e => e.type === 'mod').length;

    let stats = '';
    if (addCount) stats += `<span class="enzp-stat-add">+${addCount}</span>`;
    if (modCount) stats += `<span class="enzp-stat-mod">\u{270F}${modCount}</span>`;

    const icon = s.icon === '\uD83D\uDCE6' ? icoPackage : s.icon === '\uD83D\uDCC1' ? icoFolder : icoFile;

    html += `<div class="enzp-section">`;
    html += `<div class="enzp-section-header" onclick="toggleEnzpSection(this)">`;
    html += `<span class="enzp-chevron">\u25BE</span>`;
    html += `<span class="enzp-icon">${icon}</span>`;
    html += `<span class="enzp-title">${esc(s.header)}</span>`;
    html += `<span class="enzp-stats">${stats}</span>`;
    html += `</div>`;
    html += `<div class="enzp-section-body">`;

    for (const entry of s.entries) {
      if (entry.type === 'info') {
        html += `<div class="enzp-entry enzp-entry-info"><div class="enzp-entry-content"><code>${esc(entry.label)}</code></div></div>`;
        continue;
      }

      const cls = entry.type === 'add' ? 'enzp-entry-add' : 'enzp-entry-mod';
      const tagIcon = entry.type === 'add'
        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
        : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      const tagCls = entry.type === 'add' ? 'enzp-tag-add' : 'enzp-tag-mod';

      // Parse entry label: "table.field: value1 | value2 | ..."
      const colonIdx = entry.label.indexOf(':');
      const path = colonIdx > 0 ? entry.label.substring(0, colonIdx).trim() : entry.label.trim();
      const valuesStr = colonIdx > 0 ? entry.label.substring(colonIdx + 1).trim() : '';
      const values = valuesStr ? valuesStr.split(' | ').map(v => v.trim()).filter(v => v) : [];

      // Extract XMLInfo from code lines (most meaningful name)
      let xmlInfo = '';
      for (const cl of entry.lines) {
        const xm = cl.match(/@XMLInfo:\s*(\S+)/);
        if (xm) { xmlInfo = xm[1]; break; }
      }
      // First non-formula, non-numeric value = display name
      let displayName = '';
      for (const v of values) {
        if (!v.startsWith('=') && !v.startsWith(':') && !v.startsWith(',')
            && !v.startsWith('<') && v.length < 60 && !v.includes('\u00A7')
            && !/^\d+$/.test(v) && !v.includes('#')) {
          displayName = v; break;
        }
      }
      const mainName = xmlInfo || displayName || path.split('.').pop() || path;
      const context = path.includes('.') ? path.substring(0, path.lastIndexOf('.')) : '';

      // Filter noise from code lines
      const cleanLines = entry.lines.filter(l => {
        const lt = l.trim();
        if (!lt) return false;
        if (/^ra_[A-Za-z]*#/.test(lt)) return false; // internal refs like ra_CoInPl#PCiPla#0#0¤
        if (/^\d+;/.test(lt) && lt.includes(',') && lt.length > 80) return false; // long config strings
        return true;
      });

      html += `<div class="enzp-entry ${cls}">`;
      html += `<div class="enzp-entry-header"><span class="${tagCls}">${tagIcon}</span>`;
      html += `<span class="enzp-entry-name">${esc(mainName)}</span>`;
      if (context) html += `<span class="enzp-entry-ctx">${esc(context)}</span>`;
      if (displayName && displayName !== mainName) html += `<span class="enzp-entry-desc">${esc(displayName)}</span>`;
      html += `</div>`;

      if (cleanLines.length > 0) {
        html += `<div class="enzp-code">`;
        for (const l of cleanLines) {
          const lt = l.trimStart();
          if (lt.startsWith('+ ') || lt.startsWith('+\t')) {
            html += `<div class="enzp-code-add"><span class="enzp-code-sign">+</span>${esc(lt.substring(2))}</div>`;
          } else if (lt.startsWith('- ') || lt.startsWith('-\t')) {
            html += `<div class="enzp-code-del"><span class="enzp-code-sign">\u2212</span>${esc(lt.substring(2))}</div>`;
          } else if (lt.includes(' -> ')) {
            const [before, after] = lt.split(' -> ');
            html += `<div class="enzp-code-mod"><span class="enzp-code-sign">\u270F</span><span class="enzp-code-old">${esc(before.trim())}</span> <span class="enzp-arrow">\u2192</span> <span class="enzp-code-new">${esc(after.trim())}</span></div>`;
          } else {
            html += `<div class="enzp-code-line">${esc(l)}</div>`;
          }
        }
        html += `</div>`;
      }
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}

function renderChangeSummary(): string {
  const files = diffState.files;
  const map = pkgMap || {};
  const adds = files.filter(f => f.change_type === 'add');
  const dels = files.filter(f => f.change_type.includes('delete'));
  const edits = files.filter(f => f.change_type === 'edit');
  const renames = files.filter(f => f.change_type === 'rename');

  const fmtSize = (b: number) => b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB'
    : b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';

  const iconFor = (ct: string) => ct === 'add' ? '+' : ct.includes('delete') ? '\u2212' : ct.includes('rename') ? '\u2192' : '~';
  const labelFor = (ct: string) => ct === 'add' ? 'Added' : ct.includes('delete') ? 'Deleted' : ct.includes('rename') ? 'Renamed' : 'Modified';
  const clsFor = (ct: string) => ct === 'add' ? 'add' : ct.includes('delete') ? 'del' : ct.includes('rename') ? 'rename' : 'edit';

  // Split files into .enzp packages and regular files
  const enzpFiles: Array<{ file: PrFile; parsed: { prefix: string; guid: string; name: string } }> = [];
  const regularFiles: PrFile[] = [];
  for (const f of files) {
    const filename = f.path.split('/').pop() || '';
    const parsed = parseEnzp(filename, map);
    if (parsed) {
      enzpFiles.push({ file: f, parsed });
    } else {
      regularFiles.push(f);
    }
  }

  let html = `<div class="diff-summary">
    <div class="diff-summary-header">
      <span class="diff-summary-title">PR Change Summary</span>
      <span class="diff-summary-stats">`;
  if (adds.length) html += `<span class="diff-stat-adds">+${adds.length} added</span> `;
  if (dels.length) html += `<span class="diff-stat-dels">\u2212${dels.length} deleted</span> `;
  if (edits.length) html += `<span style="color:var(--text-dim)">${edits.length} modified</span> `;
  if (renames.length) html += `<span style="color:var(--text-dim)">${renames.length} renamed</span>`;
  html += `</span></div>`;

  // ── Enablon packages section ──
  if (enzpFiles.length > 0) {
    html += `<div class="diff-pkg-section">
      <div class="diff-pkg-title">\uD83D\uDCE6 Enablon Packages</div>
      <table class="diff-summary-table"><tbody>`;
    for (const { file: f, parsed: p } of enzpFiles) {
      const cls = clsFor(f.change_type);
      const shortGuid = p.guid.replace(/-/g, '').substring(0, 8) + '\u2026';
      html += `<tr class="diff-summary-row ${cls}">
        <td class="diff-summary-icon">${iconFor(f.change_type)}</td>
        <td class="diff-summary-label">${labelFor(f.change_type)}</td>
        <td class="diff-pkg-prefix">${esc(p.prefix)}</td>
        <td class="diff-pkg-name">${esc(p.name !== p.prefix ? p.name : '')}</td>
        <td class="diff-pkg-guid">${esc(shortGuid)}</td>
        <td class="diff-summary-size">${f.size ? fmtSize(f.size) : ''}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ── Regular files section ──
  if (regularFiles.length > 0) {
    if (enzpFiles.length > 0) html += `<div class="diff-pkg-title" style="margin-top:12px">\uD83D\uDCC4 Other Files</div>`;
    html += `<table class="diff-summary-table"><tbody>`;
    for (const f of regularFiles) {
      const parts = f.path.split('/').filter(Boolean);
      const name = parts.pop() || f.path;
      const dir = parts.length ? '/' + parts.join('/') : '';
      const cls = clsFor(f.change_type);
      const selected = f.path === diffState.selectedFile ? ' selected' : '';
      html += `<tr class="diff-summary-row ${cls}${selected}" onclick="selectDiffFile('${esc(f.path)}')">
        <td class="diff-summary-icon">${iconFor(f.change_type)}</td>
        <td class="diff-summary-label">${labelFor(f.change_type)}</td>
        <td class="diff-summary-name">${esc(name)}</td>
        <td class="diff-summary-dir">${esc(dir)}</td>
        <td class="diff-summary-size">${f.size ? fmtSize(f.size) : ''}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  html += `<div class="diff-summary-footer">
      <button class="diff-binary-btn" onclick="openPrInAzdo()">Open in Azure DevOps \u2197</button>
    </div>
  </div>`;
  return html;
}

function renderSplitDiff(): string {
  const lines = diffState.lines;
  let html = `<div class="diff-split-container"><table class="diff-table diff-split">
    <colgroup><col class="diff-ln-col"><col class="diff-code-col"><col class="diff-ln-col"><col class="diff-code-col"></colgroup>
    <thead><tr><th colspan="2">${esc(diffState.targetBranch)} (original)</th><th colspan="2">${esc(diffState.sourceBranch)} (modified)</th></tr></thead><tbody>`;

  // Pair up del/add lines for side-by-side display
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'same') {
      html += `<tr class="diff-row-same">
        <td class="diff-ln">${line.oldNum ?? ''}</td><td class="diff-code">${escLine(line.text)}</td>
        <td class="diff-ln">${line.newNum ?? ''}</td><td class="diff-code">${escLine(line.text)}</td>
      </tr>`;
      i++;
    } else if (line.type === 'info') {
      html += `<tr class="diff-row-info"><td colspan="4" class="diff-info">${esc(line.text)}</td></tr>`;
      i++;
    } else {
      // Collect consecutive del + add blocks
      const dels: DiffLine[] = [], adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'del') { dels.push(lines[i]); i++; }
      while (i < lines.length && lines[i].type === 'add') { adds.push(lines[i]); i++; }
      const maxLen = Math.max(dels.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        const d = dels[j], a = adds[j];
        html += `<tr class="diff-row-change">
          <td class="diff-ln diff-ln-del">${d?.oldNum ?? ''}</td>
          <td class="diff-code diff-code-del">${d ? escLine(d.text) : ''}</td>
          <td class="diff-ln diff-ln-add">${a?.newNum ?? ''}</td>
          <td class="diff-code diff-code-add">${a ? escLine(a.text) : ''}</td>
        </tr>`;
      }
    }
  }

  html += '</tbody></table></div>';
  return html;
}

function renderUnifiedDiff(): string {
  let html = `<div class="diff-unified-container"><table class="diff-table diff-unified">
    <colgroup><col class="diff-ln-col"><col class="diff-ln-col"><col class="diff-code-col"></colgroup><tbody>`;

  for (const line of diffState.lines) {
    if (line.type === 'info') {
      html += `<tr class="diff-row-info"><td colspan="3" class="diff-info">${esc(line.text)}</td></tr>`;
    } else {
      const cls = line.type === 'add' ? 'diff-row-add' : line.type === 'del' ? 'diff-row-del' : 'diff-row-same';
      const prefix = line.type === 'add' ? '+': line.type === 'del' ? '-' : ' ';
      html += `<tr class="${cls}">
        <td class="diff-ln">${line.oldNum ?? ''}</td>
        <td class="diff-ln">${line.newNum ?? ''}</td>
        <td class="diff-code"><span class="diff-prefix">${prefix}</span>${escLine(line.text)}</td>
      </tr>`;
    }
  }

  html += '</tbody></table></div>';
  return html;
}

function escLine(text: string): string {
  if (!text) return '\u00A0';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\t/g, '  ') || '\u00A0';
}

// ── Azure DevOps URL helpers ──
function buildAzdoPrUrl(): string {
  const org = encodeURIComponent(getOrg());
  const proj = encodeURIComponent(getProject());
  const repo = encodeURIComponent(getRepo());
  return `https://dev.azure.com/${org}/${proj}/_git/${repo}/pullrequest/${diffState.prId}?_a=files`;
}

function buildAzdoFileUrl(filePath: string): string {
  return buildAzdoPrUrl() + '&path=' + encodeURIComponent(filePath);
}

function openPrInAzdo(): void {
  const url = diffState.selectedFile ? buildAzdoFileUrl(diffState.selectedFile) : buildAzdoPrUrl();
  (window as any).openUrl(url);
}

// Expose functions to window for inline handlers
(window as any).viewPrDiff = viewPrDiff;
(window as any).selectDiffFile = (path: string) => selectDiffFile(path);
(window as any).closeDiffOverlay = closeDiffOverlay;
(window as any).setDiffMode = (mode: 'structured' | 'split' | 'unified') => { diffState.mode = mode; renderDiffOverlay(); };
(window as any).openPrInAzdo = openPrInAzdo;
(window as any).toggleEnzpSection = toggleEnzpSection;
(window as any).toggleAllEnzpSections = toggleAllEnzpSections;
(window as any).filterEnzpSections = filterEnzpSections;
