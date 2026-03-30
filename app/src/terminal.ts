// ═══════════════════════════════════════════════════════════════════
// terminal.ts — Terminal rendering, diff, search, all terminal functions
// ═══════════════════════════════════════════════════════════════════

import { S } from './state';
import { SCRIPTS, esc, time, toast, invoke } from './state';

// ── Reset terminal module state (called from app.ts on run-start) ──
export function resetTerminalState(): void {
  _lastTitleTime = null;
  _currentErrorIdx = -1;
  _termUserScrolled = false;
  _diffTotalAdds = 0;
  _diffTotalDels = 0;
  _diffTotalFiles = 0;
  _diffBlocks = [];
  _diffCurrentNav = -1;
  _lastDiffGroup = '';
  _diffSummary = { objects: 0, newCount: 0, modCount: 0, delCount: 0 };
}

// ── Terminal scroll ──
let _termScrollRaf: number | null = null;
let _termUserScrolled = false;

function termScrollToBottom(): void {
  if (_termScrollRaf || _termUserScrolled) return;
  _termScrollRaf = requestAnimationFrame(() => {
    const out = document.getElementById('termOutput');
    if (out) out.scrollTop = out.scrollHeight;
    _termScrollRaf = null;
  });
}

// Detect manual scroll: if user scrolls up, stop auto-scroll; if at bottom, resume
// Also show/hide "scroll to bottom" button
{
  const out = document.getElementById('termOutput');
  if (out) {
    let _scrollThrottle: number | null = null;
    out.addEventListener('scroll', () => {
      if (_scrollThrottle) return;
      _scrollThrottle = requestAnimationFrame(() => {
        const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
        _termUserScrolled = !atBottom;
        const btn = document.getElementById('termScrollBtn');
        if (btn) btn.classList.toggle('visible', !atBottom);
        _scrollThrottle = null;
      });
    });
  }
}

export function scrollTermToBottom(): void {
  _termUserScrolled = false;
  const out = document.getElementById('termOutput');
  if (out) out.scrollTop = out.scrollHeight;
  const btn = document.getElementById('termScrollBtn');
  if (btn) btn.classList.remove('visible');
}

// ── DOM batch system ──
let _pendingLines: string[] = [];
let _pendingNeedsMinimapUpdate = false;
let _pendingNeedsErrorUpdate = false;
let _flushRaf: number | null = null;

function _scheduleFlush(): void {
  if (_flushRaf) return;
  _flushRaf = requestAnimationFrame(_flushLines);
}

function _flushLines(): void {
  _flushRaf = null;
  if (!_pendingLines.length) return;
  const out = document.getElementById('termOutput');
  if (!out) return;
  out.insertAdjacentHTML('beforeend', _pendingLines.join(''));
  _pendingLines = [];
  if (_pendingNeedsMinimapUpdate) { scheduleMinimapUpdate(); _pendingNeedsMinimapUpdate = false; }
  if (_pendingNeedsErrorUpdate) { updateErrorSummary(); _pendingNeedsErrorUpdate = false; }
  termScrollToBottom();
  const search = (document.getElementById('termSearch') as HTMLInputElement)?.value || '';
  if (search) filterTerm(search);
  if (S.termFilterType !== 'all') applyTypeFilter();
}

// ── Section duration tracking ──
let _lastTitleTime: number | null = null;
let _inDiffBlock = false;
let _currentDiffBlock: HTMLElement | null = null;
let _currentDiffBody: HTMLElement | null = null;
let _currentDiffAdds = 0;
let _currentDiffDels = 0;
let _currentDiffHunkIndex = 0;
let _diffTotalAdds = 0;
let _diffTotalDels = 0;
let _diffTotalFiles = 0;
let _diffOldLine = 0;
let _diffNewLine = 0;
let _diffBlocks: HTMLElement[] = [];
let _diffCurrentNav = -1;
let _currentDiffObjectName = '';
let _lastDiffGroup = '';
let _diffSummary = { objects: 0, newCount: 0, modCount: 0, delCount: 0 };

export function closeDiffBlock(): void {
  if (_currentDiffBlock) {
    const adds = _currentDiffAdds;
    const dels = _currentDiffDels;

    // Hide block if no actual changes
    if (adds === 0 && dels === 0) {
      _currentDiffBlock.remove();
    } else {
      // Action badge: new / modified / deleted
      let actionBadge = '';
      if (adds > 0 && dels === 0) { actionBadge = '<span class="diff-action new">new</span>'; _diffSummary.newCount++; }
      else if (adds === 0 && dels > 0) { actionBadge = '<span class="diff-action del">del</span>'; _diffSummary.delCount++; }
      else { actionBadge = '<span class="diff-action mod">mod</span>'; _diffSummary.modCount++; }
      _diffSummary.objects++;

      // Check if metadata-only (yaml with only XmlInfo/Product/Path/Special lines, no meaningful content)
      const body = _currentDiffBody;
      const contentLines = body?.querySelectorAll('.diff-line.add, .diff-line.del') || [];
      let isMetadataOnly = contentLines.length > 0;
      contentLines.forEach(line => {
        const text = (line.querySelector('.dl-content') as HTMLElement)?.textContent?.trim() || '';
        if (!text.match(/^(XmlInfo:|Id:|Product:|Path:|Special:|ReturnType:|Parameters:|!.*|)$/)) {
          isMetadataOnly = false;
        }
      });

      if (isMetadataOnly && contentLines.length > 0) {
        _currentDiffBlock.classList.add('metadata-only');
      }

      // Update count + badge
      const countEl = _currentDiffBlock.querySelector('.diff-count');
      if (countEl) {
        const parts: string[] = [actionBadge];
        if (adds) parts.push(`<span style="color:var(--success)">+${adds}</span>`);
        if (dels) parts.push(`<span style="color:var(--danger)">\u2212${dels}</span>`);
        countEl.innerHTML = parts.join(' ');
      }

      // Update summary bar
      updateDiffSummary();
    }
  }
  _inDiffBlock = false;
  _currentDiffBlock = null;
  _currentDiffBody = null;
  _currentDiffObjectName = '';
  _currentDiffAdds = 0;
  _currentDiffDels = 0;
  _currentDiffHunkIndex = 0;
  _diffOldLine = 0;
  _diffNewLine = 0;
}

// ── Terminal ──
function classifyLine(text: string): string {
  // 1. Tagged lines from Print module (reliable, preferred)
  if (text.startsWith('[TITLE] ') || text.startsWith('[SUB] ')) return 'title';
  if (text.startsWith('[STATUS] ')) return 'status';
  if (text.startsWith('[END] ')) return 'success';
  if (text.startsWith('[ERR] ')) return 'err';
  if (text.startsWith('[WARN] ')) return 'warn';

  const t = text.toLowerCase();

  // 2. Errors -- strict patterns only
  if (text.match(/\b(ERROR|CRITICAL|CONFLICT)\b/) || text.match(/\[FAIL\]/) || t.match(/\bfatal:/) || t.match(/\bexception:/) || (t.match(/\bfailed\b/) && !t.match(/\b0 failed/)) || t.match(/\bdenied\b/) || t.match(/\bunauthorized\b/)) return 'err';

  // 3. Warnings
  if (text.match(/\b(WARNING|WARN)\b/i) || t.match(/\bskipped\b/) || t.match(/\bdeprecated\b/)) return 'warn';

  // 4. Diff patterns
  if (text.match(/^DIFF /)) return 'diff-file';
  if (text.startsWith('@@HUNK')) return 'diff-hunk';
  if (text.match(/^\+[^+]/) || text.match(/^\+$/)) return 'diff-add';
  if (text.match(/^-[^-]/) || text.match(/^-$/)) return 'diff-del';

  // 5. Success -- only final completion messages, NOT intermediate steps
  if (t.match(/\b(completed|done!)\b/) && (t.includes('pull') || t.includes('commit') || t.includes('merge') || t.includes('push') || t.includes('diff') || t.includes('check'))) return 'success';
  if (t.match(/\b0 failed\b/) || text.match(/\bPASS\b/)) return 'success';

  return 'info';
}

// Strip [TAG] prefix for display
function stripTag(text: string): string {
  return text.replace(/^\[(TITLE|STATUS|END|ERR|WARN|SUB)\] /, '');
}

// Word-level diff highlight between two strings
function wordDiffHighlight(oldStr: string, newStr: string): [string, string] {
  const oldWords = oldStr.split(/(\s+)/);
  const newWords = newStr.split(/(\s+)/);
  let hlOld = '', hlNew = '';
  const maxLen = Math.max(oldWords.length, newWords.length);
  for (let i = 0; i < maxLen; i++) {
    const ow = oldWords[i] || '';
    const nw = newWords[i] || '';
    if (ow === nw) {
      hlOld += esc(ow);
      hlNew += esc(nw);
    } else {
      if (ow) hlOld += `<span class="diff-hl">${esc(ow)}</span>`;
      if (nw) hlNew += `<span class="diff-hl">${esc(nw)}</span>`;
    }
  }
  return [hlOld, hlNew];
}

// ── Extract object name from file path for grouping ──
function diffObjectName(filePath: string): string {
  const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
  const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
  const baseName = fileName.indexOf('.') > 0 ? fileName.substring(0, fileName.indexOf('.')) : fileName;
  return dir + baseName;
}

// ── Diff summary bar ──
function updateDiffSummary(): void {
  let bar = document.getElementById('diffSummaryBar');
  const out = document.getElementById('termOutput');
  if (!bar) {
    // Find the first diff block and insert summary before it
    const firstBlock = out!.querySelector('.diff-block, .diff-group-label');
    if (!firstBlock) return;
    bar = document.createElement('div');
    bar.id = 'diffSummaryBar';
    bar.className = 'diff-summary-bar';
    firstBlock.parentElement!.insertBefore(bar, firstBlock);
  }
  const s = _diffSummary;
  const metaCount = out!.querySelectorAll('.diff-block.metadata-only').length;
  let html = `<span class="dfs-count">${s.objects} object${s.objects > 1 ? 's' : ''}</span>`;
  if (s.newCount) html += `<span class="dfs-new">${s.newCount} new</span>`;
  if (s.modCount) html += `<span class="dfs-mod">${s.modCount} modified</span>`;
  if (s.delCount) html += `<span class="dfs-del">${s.delCount} deleted</span>`;
  html += `<span class="dfs-spacer"></span>`;
  if (metaCount) html += `<button class="dfs-btn" onclick="toggleMetadataBlocks()">${metaCount} metadata-only</button>`;
  html += `<button class="dfs-btn" onclick="expandAllDiff()">expand all</button>`;
  html += `<button class="dfs-btn" onclick="collapseAllDiff()">collapse all</button>`;
  bar.innerHTML = html;
}

export function expandAllDiff(): void {
  document.querySelectorAll('.diff-block.collapsed').forEach(b => {
    b.classList.remove('collapsed');
    b.querySelector('.diff-toggle')!.innerHTML = '&#9660;';
  });
}

export function collapseAllDiff(): void {
  document.querySelectorAll('.diff-block:not(.collapsed)').forEach(b => {
    b.classList.add('collapsed');
    b.querySelector('.diff-toggle')!.innerHTML = '&#9654;';
  });
}

export function toggleMetadataBlocks(): void {
  const blocks = document.querySelectorAll('.diff-block.metadata-only');
  const allHidden = blocks.length > 0 && blocks[0].classList.contains('meta-hidden');
  blocks.forEach(b => b.classList.toggle('meta-hidden', !allHidden));
  // Update button text
  const btn = document.querySelector('.dfs-btn');
}

// ── Syntax highlighting (nabsic + YAML + XML + JSON) ──
let _currentDiffExt = '';

function syntaxHL(html: string): string {
  const ext = _currentDiffExt.toLowerCase();
  if (ext === 'xml' || ext === 'config' || ext === 'csproj' || ext === 'xaml') return xmlHL(html);
  if (ext === 'json') return jsonHL(html);
  // YAML keys (word followed by colon at start or after spaces)
  if (html.match(/^\s*[\w.!$]+:/)) {
    html = html.replace(/^(\s*)([\w.!$]+)(:)/, '$1<span class="sh-key">$2</span>$3');
    return html;
  }
  // Nabsic keywords
  html = html.replace(/\b(Dim|If|Else|ElseIf|End If|Then|New|Set|For|Each|Next|While|Do|Loop|With|End With|WithTrans|Catch|Function|Sub|End Function|End Sub|Return|Not|And|Or|True|False|Nothing|Null|Call|Append|Get|Insert|Split|FillText)\b/g, '<span class="sh-kw">$1</span>');
  // Strings
  html = html.replace(/(&quot;[^&]*?&quot;)/g, '<span class="sh-str">$1</span>');
  // Comments (nabsic uses ')
  html = html.replace(/^(\s*&#39;.*)$/gm, '<span class="sh-cmt">$1</span>');
  // Variables (ending with @ # %)
  html = html.replace(/\b(\w+[@#%])\b/g, '<span class="sh-var">$1</span>');
  // Types/classes (PascalCase before . or #)
  html = html.replace(/\b([A-Z][a-zA-Z]+[#]?)\b(?=[\.(])/g, '<span class="sh-type">$1</span>');
  // Numbers
  html = html.replace(/\b(\d+)\b/g, '<span class="sh-num">$1</span>');
  return html;
}

function xmlHL(html: string): string {
  // Comments
  html = html.replace(/(&lt;!--.*?--&gt;)/g, '<span class="sh-cmt">$1</span>');
  // Tag names
  html = html.replace(/(&lt;\/?)([\w:.]+)/g, '$1<span class="sh-kw">$2</span>');
  // Attribute names
  html = html.replace(/\b([\w:.-]+)(=&quot;)/g, '<span class="sh-key">$1</span>$2');
  // Attribute values
  html = html.replace(/(=)(&quot;[^&]*?&quot;)/g, '$1<span class="sh-str">$2</span>');
  return html;
}

function jsonHL(html: string): string {
  // Keys
  html = html.replace(/(&quot;)([\w.$-]+)(&quot;)(\s*:)/g, '<span class="sh-key">$1$2$3</span>$4');
  // String values
  html = html.replace(/(:\s*)(&quot;[^&]*?&quot;)/g, '$1<span class="sh-str">$2</span>');
  // Booleans, null
  html = html.replace(/\b(true|false|null)\b/g, '<span class="sh-kw">$1</span>');
  // Numbers
  html = html.replace(/(:\s*)(-?\d+\.?\d*)/g, '$1<span class="sh-num">$2</span>');
  return html;
}

// ── Diff file navigator ──
export function navigateDiffBlock(dir: number): void {
  if (!_diffBlocks.length) return;
  _diffCurrentNav += dir;
  if (_diffCurrentNav >= _diffBlocks.length) _diffCurrentNav = 0;
  if (_diffCurrentNav < 0) _diffCurrentNav = _diffBlocks.length - 1;
  const block = _diffBlocks[_diffCurrentNav];
  if (block) {
    // Open it if collapsed
    if (block.classList.contains('collapsed')) {
      block.classList.remove('collapsed');
      block.querySelector('.diff-toggle')!.innerHTML = '&#9660;';
    }
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  updateDiffNav();
}

function updateDiffNav(): void {
  const el = document.getElementById('diffNav');
  if (!el) return;
  if (_diffBlocks.length > 0) {
    el.innerHTML = `<button class="diff-nav-btn" onclick="navigateDiffBlock(-1)">&#9650;</button><span class="diff-nav-count">${_diffCurrentNav + 1}/${_diffBlocks.length}</span><button class="diff-nav-btn" onclick="navigateDiffBlock(1)">&#9660;</button>`;
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}

// File path detection for clickable paths (using data attributes to avoid onclick injection)
function linkifyPaths(html: string): string {
  // Windows absolute paths: C:\foo\bar.txt or C:/foo/bar
  // Require whitespace, >, " or start-of-string before drive letter to avoid matching inside HTML attributes (e.g. data-url="http://")
  html = html.replace(/(^|[\s">])([A-Z]:[\\\/][^\s<:*?"<>|]+)/gi, (_, pre, p) => `${pre}<a href="#" class="file-link" data-path="${esc(p)}">${esc(p)}</a>`);
  // Relative paths: cli\foo\bar.ps1 or ./cli/foo
  html = html.replace(/(?<![\/\\A-Za-z])(\.\/?(?:cli|tests?|app|config)[\\\/][^\s<:*?"<>|]+)/g, (_, p) => `<a href="#" class="file-link" data-path="${esc(p)}">${esc(p)}</a>`);
  return html;
}

export async function openFilePath(p: string): Promise<void> {
  // Try to open in default app via Tauri
  try { await invoke('open_file', { path: p }); } catch { /* ignore */ }
}

// Delegated click handler for terminal links (URLs and file paths)
document.addEventListener('click', (e: MouseEvent) => {
  const urlLink = (e.target as HTMLElement).closest('.url-link[data-url]') as HTMLElement | null;
  if (urlLink) { e.preventDefault(); (window as any).openUrl(urlLink.dataset.url); return; }
  const fileLink = (e.target as HTMLElement).closest('.file-link[data-path]') as HTMLElement | null;
  if (fileLink) { e.preventDefault(); openFilePath(fileLink.dataset.path!); return; }
});

function getTimestamp(): string {
  if (!S.termRelativeTime || !S._termFirstLogTime) return time();
  const delta = ((Date.now() - S._termFirstLogTime) / 1000);
  return '+' + delta.toFixed(1) + 's';
}

export function appendLog(text: string, cls: string = 'info'): void {
  try { _appendLogInner(text, cls); }
  catch (e) {
    const out = document.getElementById('termOutput');
    if (out) out.insertAdjacentHTML('beforeend', `<div class="line err">[render error] ${esc(text)}</div>`);
    console.error('appendLog error:', e);
  }
}

function _appendLogInner(text: string, cls: string = 'info'): void {
  const out = document.getElementById('termOutput');
  if (!S._termFirstLogTime) S._termFirstLogTime = Date.now();

  // Inside a diff block: force diff classification, don't let content patterns (like "failed" in code) interfere
  if (_inDiffBlock) {
    if (text.startsWith('DIFF ')) cls = 'diff-file';
    else if (text.startsWith('@@HUNK')) cls = 'diff-hunk';
    else if (text.match(/^\+/)) cls = 'diff-add';
    else if (text.match(/^-/)) cls = 'diff-del';
    else if (text.startsWith('[TITLE] ') || text.startsWith('[STATUS] ') || text.startsWith('[END] ') || text.startsWith('[ERR] ') || text.startsWith('[SUB] ')) {
      closeDiffBlock();
      cls = classifyLine(text);
    }
    else cls = 'diff-ctx';
  } else {
    if (!cls || cls === 'info') cls = classifyLine(text);
  }

  // Open/close diff block tracking
  if (cls === 'diff-file') {
    // handled below in rendering
  } else if (!cls.startsWith('diff-') && _inDiffBlock) {
    closeDiffBlock();
  }

  // Strip tag prefix for display
  const displayText = stripTag(text);

  // Linkify URLs then file paths (using data attributes to avoid onclick injection)
  let escaped = esc(displayText).replace(/(https?:\/\/[^\s<]+)/g, (_, url) => `<a href="#" class="url-link" data-url="${esc(url)}">${esc(url)}</a>`);
  escaped = linkifyPaths(escaped);

  // Colorize diff stat lines: "file | 2 +-" -> green +, red -
  if (cls === 'info' && displayText.match(/\|\s+\d+\s+[+-]+\s*$/)) {
    escaped = escaped.replace(/(\++)([^+]*)$/, '<span style="color:var(--success)">$1</span>$2');
    escaped = escaped.replace(/(-+)(\s*)$/, '<span style="color:var(--danger)">$1</span>$2');
  }
  // Colorize total summary: "5 files changed, 15 insertions(+), 2 deletions(-)"
  if (cls === 'info' && displayText.match(/\d+ files? changed/)) {
    escaped = escaped.replace(/(\d+ insertions?\(\+\))/, '<span style="color:var(--success)">$1</span>');
    escaped = escaped.replace(/(\d+ deletions?\(-\))/, '<span style="color:var(--danger)">$1</span>');
    // Reset diff totals for this run
    _diffTotalAdds = 0; _diffTotalDels = 0; _diffTotalFiles = 0;
  }

  // Update current step in term-bar
  if (cls === 'title' || cls === 'status') {
    const stepEl = document.getElementById('termStep');
    if (stepEl && S.isRunning) stepEl.textContent = displayText;
  }

  // Section separator + duration before title lines
  if (cls === 'title') {
    const now = Date.now();
    if (_lastTitleTime) {
      const dur = ((now - _lastTitleTime) / 1000);
      const prevTitle = out!.querySelector('.line.title:last-of-type .section-dur') as HTMLElement | null;
      if (prevTitle) prevTitle.textContent = dur < 60 ? `${dur.toFixed(1)}s` : `${Math.floor(dur / 60)}m${Math.round(dur % 60)}s`;
    }
    _lastTitleTime = now;
    out!.insertAdjacentHTML('beforeend', `<div class="term-separator"></div>`);
    escaped += ` <span class="section-dur"></span>`;
  }

  // ── Diff rendering ──
  const isDiff = cls.startsWith('diff-');

  if (cls === 'diff-file') {
    const fileMatch = displayText.match(/DIFF\s+\[.*?\]\s+(.*)/);
    const path = fileMatch ? fileMatch[1] : displayText;
    const fullName = path.split('/').pop()!;
    const ext = fullName.match(/\.([^.]+)$/)?.[1] || '';
    _currentDiffExt = ext;
    const dir = path.substring(0, path.length - fullName.length);
    const objName = diffObjectName(path);

    // Group by object type (first path segment after package)
    const parts = path.split('/');
    const group = parts.length >= 2 ? parts[1] || parts[0] : parts[0];

    // Check if this file belongs to the same object as the current block
    if (_currentDiffBlock && _currentDiffObjectName === objName) {
      // Add a sub-file separator inside the existing block
      const subLabel = fullName.replace(/\.[^.]+$/, '').replace(objName.split('/').pop()!, '').replace(/^\./, '') || ext;
      const extBadge = ext ? `<span class="diff-ext">${esc(ext)}</span>` : '';
      _currentDiffBody!.insertAdjacentHTML('beforeend', `<div class="diff-subfile">${esc(subLabel || fullName)} ${extBadge}</div>`);
      _currentDiffHunkIndex = 0;
      _diffOldLine = 0; _diffNewLine = 0;
      _inDiffBlock = true;
      termScrollToBottom();
      return;
    }

    // New object -- close previous block
    closeDiffBlock();

    if (group !== _lastDiffGroup) {
      _lastDiffGroup = group;
      out!.insertAdjacentHTML('beforeend', `<div class="diff-group-label">${esc(group)}</div>`);
    }

    // Shortened path: keep last 2-3 meaningful segments
    const objDisplayName = objName.split('/').pop()!;
    const dirParts = dir.replace(/\/$/, '').split('/');
    // Skip package name (first), keep last 2 meaningful segments
    const shortDir = dirParts.length > 3 ? dirParts.slice(-2).join('/') + '/' : dirParts.slice(1).join('/') + (dirParts.length > 1 ? '/' : '');
    const extBadge = ext ? `<span class="diff-ext">${esc(ext)}</span>` : '';
    const block = document.createElement('div');
    block.className = 'diff-block collapsed';
    block.innerHTML = `<div class="diff-header"><span class="diff-toggle">&#9654;</span><span class="diff-path"><span class="diff-dir">${esc(shortDir)}</span>${esc(objDisplayName)}</span>${extBadge}<span class="diff-count"></span></div><div class="diff-body"></div>`;
    block.querySelector('.diff-header')!.addEventListener('click', () => {
      block.classList.toggle('collapsed');
      block.querySelector('.diff-toggle')!.innerHTML = block.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
    });
    out!.appendChild(block);
    _currentDiffBlock = block;
    _currentDiffBody = block.querySelector('.diff-body');
    _currentDiffObjectName = objName;
    _currentDiffAdds = 0;
    _currentDiffDels = 0;
    _currentDiffHunkIndex = 0;
    _diffTotalFiles++;
    _diffBlocks.push(block);
    _diffCurrentNav = _diffBlocks.length - 1;
    _inDiffBlock = true;
    termScrollToBottom();
    updateDiffNav();
    return;
  }

  // Close block if non-diff line while in block
  if (!isDiff && _inDiffBlock) closeDiffBlock();

  if (isDiff && _currentDiffBody) {
    if (cls === 'diff-hunk') {
      _currentDiffHunkIndex++;
      // Parse line numbers from @@HUNK oldStart newStart
      const hunkMatch = displayText.match(/^@@HUNK\s+(\d+)\s+(\d+)/);
      if (hunkMatch) { _diffOldLine = parseInt(hunkMatch[1]); _diffNewLine = parseInt(hunkMatch[2]); }
      if (_currentDiffHunkIndex > 1) {
        _currentDiffBody.insertAdjacentHTML('beforeend', `<div class="diff-sep"></div>`);
      }
    } else if (cls === 'diff-add' || cls === 'diff-del') {
      const raw = displayText.substring(1);

      // Skip empty lines (just "+" or "-" with nothing after)
      if (raw.trim() === '') {
        if (cls === 'diff-add') _diffNewLine++;
        else _diffOldLine++;
        return;
      }

      const prefix = cls === 'diff-add' ? '+' : '-';
      let content = esc(raw);

      if (cls === 'diff-add') { _currentDiffAdds++; _diffTotalAdds++; }
      else { _currentDiffDels++; _diffTotalDels++; }

      // Line numbers
      let oldLn: number | string = '';
      let newLn: number | string = '';
      if (cls === 'diff-del') { oldLn = _diffOldLine; _diffOldLine++; }
      else { newLn = _diffNewLine; _diffNewLine++; }

      // Side-by-side for -/+ pairs
      const prevEl = _currentDiffBody.querySelector('.diff-line:last-child, .diff-sbs:last-child') as HTMLElement | null;
      if (cls === 'diff-add' && prevEl && prevEl.classList.contains('del')) {
        const oldRaw = prevEl.getAttribute('data-raw') || '';
        if (oldRaw) {
          const [hlOld, hlNew] = wordDiffHighlight(oldRaw, raw);
          const prevOldLn = prevEl.getAttribute('data-ln') || '';
          const sbs = document.createElement('div');
          sbs.className = 'diff-sbs';
          sbs.onclick = function (this: HTMLElement) { copyLine(this); } as unknown as (ev: PointerEvent) => void;
          sbs.innerHTML = `<div class="sbs-del"><span class="dl-ln">${prevOldLn}</span><span class="dl-gutter">\u2212</span><span class="dl-content">${syntaxHL(hlOld)}</span></div><div class="sbs-add"><span class="dl-ln">${newLn}</span><span class="dl-gutter">+</span><span class="dl-content">${syntaxHL(hlNew)}</span></div>`;
          prevEl.replaceWith(sbs);
          termScrollToBottom();
          return;
        }
      }

      content = syntaxHL(content);
      const lnDisplay = cls === 'diff-del' ? oldLn : newLn;
      const rawAttr = (cls === 'diff-del') ? ` data-raw="${esc(raw)}" data-ln="${oldLn}"` : '';
      _currentDiffBody.insertAdjacentHTML('beforeend', `<div class="diff-line ${cls === 'diff-add' ? 'add' : 'del'}"${rawAttr} onclick="copyLine(this)"><span class="dl-ln">${lnDisplay}</span><span class="dl-gutter">${prefix}</span><span class="dl-content">${content}</span></div>`);
    } else if (cls === 'diff-ctx') {
      const ctxLn = _diffOldLine || _diffNewLine;
      _diffOldLine++; _diffNewLine++;
      _currentDiffBody.insertAdjacentHTML('beforeend', `<div class="diff-line ctx" onclick="copyLine(this)"><span class="dl-ln">${ctxLn}</span><span class="dl-gutter"></span><span class="dl-content">${syntaxHL(esc(displayText))}</span></div>`);
    }
    // Detect XmlInfo from YAML content to replace ID in header with readable name
    if (_currentDiffBlock && !(_currentDiffBlock as any)._hasLabel) {
      const rawLine = (cls === 'diff-ctx') ? displayText.trim() : displayText.substring(1).trim();
      const xmlMatch = rawLine.match(/^XmlInfo:\s*(.+)/);
      if (xmlMatch) {
        const label = xmlMatch[1].trim();
        if (label && label.length < 80) {
          // Replace the bold object name with XmlInfo, keep dir as-is
          const pathEl = _currentDiffBlock.querySelector('.diff-path');
          if (pathEl) {
            const dirEl = pathEl.querySelector('.diff-dir');
            const dirText = dirEl ? dirEl.outerHTML : '';
            pathEl.innerHTML = `${dirText}${esc(label)}`;
          }
          (_currentDiffBlock as any)._hasLabel = true;
        }
      }
    }
    termScrollToBottom();
    return;
  }

  // ── Regular lines (batched) ──
  _pendingLines.push(`<div class="line ${cls}" data-cls="${cls}" onclick="copyLine(this)"><span class="t">${getTimestamp()}</span> ${escaped}</div>`);
  if (cls === 'err' || cls === 'warn') _pendingNeedsMinimapUpdate = true;
  if (cls === 'err') _pendingNeedsErrorUpdate = true;
  _scheduleFlush();
}

// ── Click to copy line ──
export function copyLine(el: HTMLElement): void {
  // Don't copy if user is selecting text or clicking a link
  if (window.getSelection()?.toString()) return;
  if ((event as MouseEvent | undefined)?.target && ((event as MouseEvent).target as HTMLElement)?.tagName === 'A') return;
  const text = el.textContent?.trim() || '';
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('line-copied');
    setTimeout(() => el.classList.remove('line-copied'), 400);
  }).catch(() => { /* ignore */ });
}

// ── Error summary bar ──
function updateErrorSummary(): void {
  const out = document.getElementById('termOutput')!;
  const errors = out.querySelectorAll('.line.err');
  let bar = document.getElementById('termErrorBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'termErrorBar';
    bar.className = 'term-error-bar';
    out.parentElement!.insertBefore(bar, out);
  }
  const count = errors.length;
  bar.innerHTML = `<span class="err-count">${count} error${count > 1 ? 's' : ''}</span><button class="err-nav-btn" onclick="navigateErrors(-1)" title="Previous error (Shift+F8)">&#9650;</button><button class="err-nav-btn" onclick="navigateErrors(1)" title="Next error (F8)">&#9660;</button><button class="err-dismiss" onclick="this.parentElement.classList.add('hidden')">&times;</button>`;
  bar.classList.remove('hidden');
  bar.style.display = count > 0 ? 'flex' : 'none';
}

// ── Navigate errors (F8 / Shift+F8) ──
let _currentErrorIdx = -1;
export function navigateErrors(dir: number): void {
  const out = document.getElementById('termOutput')!;
  const errors = Array.from(out.querySelectorAll('.line.err'));
  if (!errors.length) return;
  _currentErrorIdx += dir;
  if (_currentErrorIdx >= errors.length) _currentErrorIdx = 0;
  if (_currentErrorIdx < 0) _currentErrorIdx = errors.length - 1;
  // Remove previous highlight
  out.querySelectorAll('.line.err-focus').forEach(e => e.classList.remove('err-focus'));
  const target = errors[_currentErrorIdx] as HTMLElement;
  target.classList.add('err-focus');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Minimap (scrollbar markers, debounced) ──
let _minimapTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMinimapUpdate(): void {
  if (_minimapTimer) return;
  _minimapTimer = setTimeout(() => { _minimapTimer = null; updateMinimap(); }, 500);
}

function updateMinimap(): void {
  const out = document.getElementById('termOutput')!;
  let map = document.getElementById('termMinimap');
  if (!map) {
    map = document.createElement('div');
    map.id = 'termMinimap';
    map.className = 'term-minimap';
    out.parentElement!.appendChild(map);
  }
  const lines = out.querySelectorAll('.line');
  const total = lines.length;
  if (!total) return;
  let markers = '';
  lines.forEach((line, i) => {
    const pct = (i / total) * 100;
    if (line.classList.contains('err')) markers += `<div class="mm-mark mm-err" style="top:${pct}%" title="Error line ${i + 1}"></div>`;
    else if (line.classList.contains('warn')) markers += `<div class="mm-mark mm-warn" style="top:${pct}%"></div>`;
  });
  map.innerHTML = markers;
}

export function copyTerm(): void {
  const out = document.getElementById('termOutput')!;
  const text = Array.from(out.querySelectorAll('.line:not(.search-hidden):not(.type-hidden)')).map(l => l.textContent).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    toast('Terminal copied to clipboard', 'success');
  }).catch(() => {
    toast('Failed to copy', 'error');
  });
}

export function clearTerm(): void {
  const out = document.getElementById('termOutput')!;
  out.innerHTML = '<div class="line sys">Terminal cleared.</div>';
  setIndicator('idle');
  document.getElementById('termScript')!.textContent = '';
  (document.getElementById('termSearch') as HTMLInputElement).value = '';
  S._termFirstLogTime = null;
  _lastTitleTime = null;
  _currentErrorIdx = -1;
  closeDiffBlock();
  // Remove error bar
  const errBar = document.getElementById('termErrorBar');
  if (errBar) errBar.style.display = 'none';
  // Clear minimap
  const mm = document.getElementById('termMinimap');
  if (mm) mm.innerHTML = '';
  // Reset type filter
  setTypeFilter('all');
}

// ── Export terminal log ──
export function exportTerm(): void {
  const out = document.getElementById('termOutput')!;
  const text = Array.from(out.querySelectorAll('.line')).map(l => l.textContent).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `donut-log-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Log exported', 'success');
}

// ── Font size (Ctrl+Plus / Ctrl+Minus) ──
export function setTermFontSize(size: number): void {
  S.termFontSize = Math.max(8, Math.min(20, size));
  document.getElementById('termOutput')!.style.fontSize = S.termFontSize + 'px';
  localStorage.setItem('donut-term-fontsize', String(S.termFontSize));
}

// ── Word wrap toggle ──
export function toggleWordWrap(): void {
  S.termWordWrap = !S.termWordWrap;
  const out = document.getElementById('termOutput')!;
  out.classList.toggle('nowrap', !S.termWordWrap);
  localStorage.setItem('donut-term-wrap', String(S.termWordWrap));
  const btn = document.querySelector('.term-wrap-btn');
  if (btn) btn.classList.toggle('active', S.termWordWrap);
}

// ── Relative time toggle ──
export function toggleRelativeTime(): void {
  S.termRelativeTime = !S.termRelativeTime;
  localStorage.setItem('donut-term-reltime', String(S.termRelativeTime));
  const btn = document.querySelector('.term-reltime-btn');
  if (btn) btn.classList.toggle('active', S.termRelativeTime);
  toast(S.termRelativeTime ? 'Relative timestamps' : 'Absolute timestamps', 'info');
}

// ── Re-run last failed script ──
export function reRunLast(): void {
  if (S._lastRunScript && !S.isRunning) {
    S.selectedScript = S._lastRunScript;
    (window as any).renderScripts();
    (window as any).renderRunBar();
    (window as any).doRun();
  }
}

export function setIndicator(state: string): void {
  const el = document.getElementById('termIndicator')!;
  el.className = 'indicator ' + state;
}

// ── Terminal search with highlight (debounced) ──
let _searchDebounce: ReturnType<typeof setTimeout> | null = null;
export function filterTerm(query: string): void {
  if (_searchDebounce) clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => _filterTermImpl(query), 150);
}

function _filterTermImpl(query: string): void {
  const lines = document.querySelectorAll('#termOutput .line');
  const q = query.toLowerCase();
  lines.forEach(line => {
    // Remove old highlights
    line.querySelectorAll('.search-hl').forEach(hl => {
      hl.replaceWith(document.createTextNode(hl.textContent || ''));
    });
    if (!q) {
      line.classList.remove('search-hidden');
      return;
    }
    const text = (line.textContent || '').toLowerCase();
    const match = text.includes(q);
    line.classList.toggle('search-hidden', !match);
    // Highlight matches in visible lines (skip timestamp span)
    if (match) highlightInNode(line as HTMLElement, q);
  });
}

function highlightInNode(el: HTMLElement, query: string): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach(node => {
    if ((node.parentElement as HTMLElement).classList.contains('t')) return; // skip timestamp
    if ((node.parentElement as HTMLElement).classList.contains('search-hl')) return;
    const text = node.textContent || '';
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);
    if (idx === -1) return;
    const before = text.substring(0, idx);
    const matchText = text.substring(idx, idx + query.length);
    const after = text.substring(idx + query.length);
    const span = document.createElement('span');
    span.className = 'search-hl';
    span.textContent = matchText;
    const parent = node.parentNode!;
    if (before) parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(span, node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);
  });
}

// ── Type filter (errors / warnings / all) ──
export function setTypeFilter(type: string): void {
  S.termFilterType = type;
  // Update button states
  document.querySelectorAll('.term-filter-btn').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.filter === type));
  applyTypeFilter();
}

function applyTypeFilter(): void {
  const lines = document.querySelectorAll('#termOutput .line');
  lines.forEach(line => {
    if (S.termFilterType === 'all') {
      line.classList.remove('type-hidden');
      return;
    }
    const cls = (line as HTMLElement).dataset.cls || '';
    if (line.classList.contains('term-section-header')) { line.classList.remove('type-hidden'); return; }
    line.classList.toggle('type-hidden', cls !== S.termFilterType);
  });
}

// ── Stop button ──
export function showStopBtn(visible: boolean): void {
  const btn = document.getElementById('stopBtn');
  if (btn) btn.classList.toggle('visible', visible);
}

// ── Re-run button ──
export function showRerunBtn(): void {
  const btn = document.getElementById('rerunBtn');
  if (btn) btn.classList.add('visible');
}

export function hideRerunBtn(): void {
  const btn = document.getElementById('rerunBtn');
  if (btn) btn.classList.remove('visible');
}

export async function doStop(): Promise<void> {
  if (!S.isRunning) return;
  appendLog('Stopping script...', 'warn');
  try {
    await invoke('kill_running_script');
    appendLog('Stop signal sent.', 'warn');
  } catch (e) { appendLog('Stop failed: ' + e, 'err'); }
}

// ── Terminal expand / collapse / fullscreen ──
export function expandTerminal(running: boolean): void {
  const term = document.getElementById('terminal')!;
  const panel = document.querySelector('.panel')!;
  if (term.classList.contains('fullscreen')) return;
  if (running) {
    _termUserScrolled = false;
    term.classList.add('expanded');
    panel.classList.add('collapsed');
  }
  // Don't auto-restore panel on end -- user can toggle it manually
}

export function togglePanel(): void {
  const panel = document.querySelector('.panel')!;
  const term = document.getElementById('terminal')!;
  panel.classList.toggle('collapsed');
  term.classList.toggle('expanded');
}

export function toggleFullscreen(): void {
  const term = document.getElementById('terminal')!;
  const isFs = term.classList.toggle('fullscreen');
  // When entering fullscreen, hide panel; when leaving, restore based on running state
  if (!isFs) {
    expandTerminal(S.isRunning);
  }
}

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    const term = document.getElementById('terminal');
    if (term && term.classList.contains('fullscreen')) {
      term.classList.remove('fullscreen');
      e.preventDefault();
    }
  }
});

// ── Spinner ──
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
const spinFrames = ['   ', '   .', '   ..', '   ...', '   ....', '   .....', '   ....', '   ...', '   ..', '   .'];
let spinIdx = 0;

export function startSpinner(): void {
  stopSpinner();
  const el = document.createElement('div');
  el.id = 'spinnerLine';
  el.className = 'line dim';
  el.textContent = spinFrames[0];
  document.getElementById('termOutput')!.appendChild(el);
  spinnerInterval = setInterval(() => {
    spinIdx = (spinIdx + 1) % spinFrames.length;
    const s = document.getElementById('spinnerLine');
    if (s) s.textContent = spinFrames[spinIdx];
  }, 150);
}

export function stopSpinner(): void {
  if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
  const s = document.getElementById('spinnerLine');
  if (s) s.remove();
}

// ── Run timer (chronometre) ──
function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
}

export function startRunTimer(): void {
  S.runStartTime = Date.now();
  stopRunTimer();
  const el = document.getElementById('termTimer');
  if (el) { el.textContent = '0s'; el.style.display = 'inline'; }
  S.runTimerInterval = setInterval(() => {
    const el = document.getElementById('termTimer');
    if (el) el.textContent = formatDuration(Date.now() - S.runStartTime);
  }, 1000);
}

export function stopRunTimer(): string {
  if (S.runTimerInterval) { clearInterval(S.runTimerInterval); S.runTimerInterval = null; }
  const dur = S.runStartTime ? formatDuration(Date.now() - S.runStartTime) : '0s';
  const el = document.getElementById('termTimer');
  if (el) el.style.display = 'none';
  return dur;
}

// ── Run history ──
export function addRunHistory(script: string, ok: boolean, duration: string): void {
  S.runHistory.unshift({ script, ok, duration, date: new Date().toLocaleString('fr') });
  if (S.runHistory.length > 20) S.runHistory.length = 20;
  localStorage.setItem('donut-history', JSON.stringify(S.runHistory));
}

// ── Progress bar (estimated based on history) ──
function getEstimatedDuration(scriptId: string): number | null {
  const hist = S.runHistory.filter(h => h.script === scriptId && h.ok);
  if (!hist.length) return null;
  // Parse duration string to ms
  const toMs = (d: string): number | null => {
    const m = d.match(/(\d+)m\s*(\d+)s/); if (m) return (parseInt(m[1]) * 60 + parseInt(m[2])) * 1000;
    const s = d.match(/(\d+)s/); if (s) return parseInt(s[1]) * 1000;
    return null;
  };
  const durations = hist.map(h => toMs(h.duration)).filter(Boolean) as number[];
  if (!durations.length) return null;
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
}

let _progressTimer: ReturnType<typeof setInterval> | null = null;

export function startProgress(scriptId: string): void {
  stopProgress();
  const est = getEstimatedDuration(scriptId);
  const bar = document.getElementById('progressBar');
  const fill = document.getElementById('progressFill') as HTMLElement | null;
  if (!bar || !fill) return;
  bar.classList.add('active');
  fill.style.width = '0%';
  if (!est) { fill.style.width = '100%'; fill.style.transition = 'none'; fill.style.opacity = '.3'; fill.style.animation = 'loadPulse 2s ease-in-out infinite'; return; }
  const start = Date.now();
  _progressTimer = setInterval(() => {
    const elapsed = Date.now() - start;
    const pct = Math.min(95, (elapsed / est) * 100); // never reach 100 until done
    fill.style.transition = 'width .5s ease';
    fill.style.opacity = '1';
    fill.style.animation = 'none';
    fill.style.width = pct + '%';
  }, 500);
}

export function stopProgress(): void {
  if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  const bar = document.getElementById('progressBar');
  const fill = document.getElementById('progressFill') as HTMLElement | null;
  if (fill) { fill.style.transition = 'width .3s ease'; fill.style.width = '100%'; fill.style.opacity = '1'; fill.style.animation = 'none'; }
  setTimeout(() => { if (bar) bar.classList.remove('active'); }, 500);
}

// ── PR link after commit ──
export function showPRLink(): void {
  const out = document.getElementById('termOutput');
  if (!out) return;
  // Find PR URL in terminal output
  const lines = out.querySelectorAll('.line');
  let prUrl: string | null = null;
  for (const line of lines) {
    const match = (line.textContent || '').match(/(https:\/\/dev\.azure\.com\/[^\s]+\/pullrequest\/\d+)/);
    if (match) prUrl = match[1];
  }
  if (prUrl) {
    const btn = document.createElement('div');
    btn.className = 'pr-link-banner';
    btn.innerHTML = `<span>Pull Request created!</span><button onclick="openUrl('${esc(prUrl)}')">Open PR in Azure DevOps \u2192</button>`;
    out.appendChild(btn);
    termScrollToBottom();
  }
}

// ── Patience messages (during long operations) ──
const PATIENCE_MSGS = [
  'Still baking... the dough needs time to rise',
  'Patience, the oven is doing its thing...',
  'Good donuts take time to make...',
  'Sprinkling magic dust... almost there',
  'The donut machine is warming up...',
  'Quality control in progress...',
  'Adding extra frosting while we wait...',
  'The baker is working hard...',
  'Flipping the donuts... hold on',
  'Checking the glaze consistency...',
  'Rolling out another batch...',
  'The secret ingredient is patience...',
  'Donut worry, be happy...',
  'Kneading the dough a bit more...',
  'The fryer is at the perfect temperature...',
];

let _patienceTimer: ReturnType<typeof setInterval> | null = null;

export function startPatienceMessages(): void {
  stopPatienceMessages();
  let idx = 0;
  _patienceTimer = setInterval(() => {
    appendLog(PATIENCE_MSGS[idx % PATIENCE_MSGS.length], 'dim');
    idx++;
  }, 30000);
}

export function stopPatienceMessages(): void {
  if (_patienceTimer) { clearInterval(_patienceTimer); _patienceTimer = null; }
}

// ── Resize terminal ──
{
  const resizer = document.getElementById('resizer');
  const terminal = document.getElementById('terminal');
  if (resizer && terminal) {
    let startY: number, startH: number;
    resizer.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      startY = e.clientY; startH = terminal.offsetHeight;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      const onMove = (e: MouseEvent) => {
        e.preventDefault();
        const newH = Math.max(80, startH - (e.clientY - startY));
        terminal.style.height = newH + 'px';
        // Auto show/hide panel based on terminal size
        const panel = document.querySelector('.panel') as HTMLElement;
        const available = window.innerHeight - 40; // minus topbar
        if (newH > available * 0.85) { panel.classList.add('collapsed'); }
        else { panel.classList.remove('collapsed'); }
      };
      const onUp = () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
