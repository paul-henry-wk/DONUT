// ═══════════════════════════════════════════════════════════════════
// terminal.ts — Terminal rendering, diff, search, all terminal functions
// ═══════════════════════════════════════════════════════════════════

import { S } from './state';
import { SCRIPTS, esc, time, toast, invoke } from './state';

// ── Sub-module imports ──
import { syntaxHL, xmlHL, jsonHL } from './terminal/syntax';
import {
  _diffTotalAdds, _diffTotalDels, _diffTotalFiles,
  _diffBlocks, _diffCurrentNav, _lastDiffGroup, _diffSummary,
  resetDiffState, setDiffTotalAdds, setDiffTotalDels, setDiffTotalFiles,
  incrDiffTotalAdds, incrDiffTotalDels, incrDiffTotalFiles,
  setDiffCurrentNav, setLastDiffGroup, pushDiffBlock,
  closeDiffBlock as _closeDiffBlockImpl,
  diffObjectName, updateDiffSummary,
  expandAllDiff, collapseAllDiff, toggleMetadataBlocks,
  navigateDiffBlock,
} from './terminal/diff-nav';
import {
  startSpinner, stopSpinner,
  startRunTimer, stopRunTimer, formatDuration,
  startProgress, stopProgress,
  startPatienceMessages as _startPatienceMessagesImpl,
  stopPatienceMessages,
  addRunHistory,
  showPRLink as _showPRLinkImpl,
} from './terminal/controls';

// ── Re-exports from sub-modules ──
export { syntaxHL, xmlHL, jsonHL } from './terminal/syntax';
export {
  expandAllDiff, collapseAllDiff, toggleMetadataBlocks,
  navigateDiffBlock,
} from './terminal/diff-nav';
export {
  startSpinner, stopSpinner,
  startRunTimer, stopRunTimer, formatDuration,
  startProgress, stopProgress,
  stopPatienceMessages,
  addRunHistory,
  setEstimate,
} from './terminal/controls';

// ── Wrappers for sub-module functions that need local references ──
export function closeDiffBlock(): void {
  _closeDiffBlockImpl(_currentDiffBlock, _currentDiffBody, _currentDiffAdds, _currentDiffDels);
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

export function showPRLink(): void {
  _showPRLinkImpl(termScrollToBottom);
}

export function startPatienceMessages(): void {
  _startPatienceMessagesImpl(appendLog);
}

// ── Floating error badge ──
let _unseenErrors = 0;

function updateErrorBadge(): void {
  if (!_termUserScrolled || !S.isRunning) { _unseenErrors = 0; return; }
  _unseenErrors++;
  let badge = document.getElementById('termErrorBadge');
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'termErrorBadge';
    badge.className = 'term-error-badge';
    badge.onclick = () => {
      navigateErrors(0); // jump to current
      _unseenErrors = 0;
      badge!.classList.remove('visible');
    };
    document.getElementById('terminal')!.appendChild(badge);
  }
  badge.innerHTML = `\u26A0 ${_unseenErrors} new error${_unseenErrors > 1 ? 's' : ''} \u2193`;
  badge.classList.add('visible');
}

function clearErrorBadge(): void {
  _unseenErrors = 0;
  const badge = document.getElementById('termErrorBadge');
  if (badge) badge.classList.remove('visible');
}

// ── Reset terminal module state (called from app.ts on run-start) ──
export function resetTerminalState(): void {
  _lastTitleTime = null;
  _currentErrorIdx = -1;
  _termUserScrolled = false;
  _unseenErrors = 0;
  clearErrorBadge();
  resetDiffState();
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
        if (atBottom) clearErrorBadge();
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
  if (_pendingNeedsErrorUpdate) { updateErrorSummary(); updateErrorBadge(); _pendingNeedsErrorUpdate = false; }
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
let _diffOldLine = 0;
let _diffNewLine = 0;
let _currentDiffObjectName = '';

// ── Syntax highlighting current extension ──
let _currentDiffExt = '';

// ── Terminal ──
export function classifyLine(text: string): string {
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

// ── Collapsible sections ──
let _currentSection: HTMLElement | null = null;
let _currentSectionBody: HTMLElement | null = null;

function closeSection(): void {
  _currentSection = null;
  _currentSectionBody = null;
}

function _flushBeforeSection(): void {
  // Flush pending lines before modifying DOM for sections
  if (_pendingLines.length > 0) _flushLines();
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

  // ── Collapsible sections: [SECTION:title] ... [/SECTION] ──
  const sectionStart = text.match(/^\[SECTION(?::([^\]]*))?\]\s*(.*)/);
  if (sectionStart) {
    _flushBeforeSection();
    if (_currentSection) closeSection();
    const label = (sectionStart[1] || sectionStart[2] || 'Section').trim();
    const extra = sectionStart[2] && sectionStart[1] ? sectionStart[2].trim() : '';
    // Color OK/FAILED in the extra label
    let extraHtml = '';
    if (extra) {
      extraHtml = esc(extra)
        .replace(/\bOK\b/, '<span class="section-ok">OK</span>')
        .replace(/\bFAILED\b/, '<span class="section-fail">FAILED</span>');
    }
    const block = document.createElement('div');
    block.className = 'term-section collapsed';
    block.innerHTML = `<div class="term-section-header"><span class="term-section-toggle">&#9654;</span><span class="term-section-label">${esc(label)}</span>${extraHtml ? `<span class="term-section-extra">${extraHtml}</span>` : ''}</div><div class="term-section-body"></div>`;
    block.querySelector('.term-section-header')!.addEventListener('click', () => {
      block.classList.toggle('collapsed');
      block.querySelector('.term-section-toggle')!.innerHTML = block.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
    });
    out!.appendChild(block);
    _currentSection = block;
    _currentSectionBody = block.querySelector('.term-section-body');
    termScrollToBottom();
    return;
  }
  if (text === '[/SECTION]') {
    _flushBeforeSection();
    closeSection();
    return;
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
    setDiffTotalAdds(0); setDiffTotalDels(0); setDiffTotalFiles(0);
  }

  // Update current step in term-bar
  if (cls === 'title' || cls === 'status') {
    const stepEl = document.getElementById('termStep');
    if (stepEl && S.isRunning) stepEl.textContent = displayText;
  }

  // Section separator + duration before title lines (skip when inside a collapsible section)
  if (cls === 'title' && !_currentSectionBody) {
    const now = Date.now();
    if (_lastTitleTime) {
      const dur = ((now - _lastTitleTime) / 1000);
      const prevTitle = out!.querySelector('.line.title:last-of-type .section-dur') as HTMLElement | null;
      if (prevTitle) prevTitle.textContent = dur < 60 ? `${dur.toFixed(1)}s` : `${Math.floor(dur / 60)}m${Math.round(dur % 60)}s`;
    }
    _lastTitleTime = now;
    out!.insertAdjacentHTML('beforeend', `<div class="term-separator"><button class="section-copy-btn" onclick="copySection(this)" title="Copy this section">\u2398</button></div>`);
    escaped += ` <span class="section-dur"></span>`;
  }

  // ── Diff rendering (skip when inside a collapsible section) ──
  const isDiff = !_currentSectionBody && cls.startsWith('diff-');

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
      setLastDiffGroup(group);
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
    incrDiffTotalFiles();
    pushDiffBlock(block);
    setDiffCurrentNav(_diffBlocks.length - 1);
    _inDiffBlock = true;
    termScrollToBottom();
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

      if (cls === 'diff-add') { _currentDiffAdds++; incrDiffTotalAdds(); }
      else { _currentDiffDels++; incrDiffTotalDels(); }

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
          sbs.innerHTML = `<div class="sbs-del"><span class="dl-ln">${prevOldLn}</span><span class="dl-gutter">\u2212</span><span class="dl-content">${syntaxHL(hlOld, _currentDiffExt)}</span></div><div class="sbs-add"><span class="dl-ln">${newLn}</span><span class="dl-gutter">+</span><span class="dl-content">${syntaxHL(hlNew, _currentDiffExt)}</span></div>`;
          prevEl.replaceWith(sbs);
          termScrollToBottom();
          return;
        }
      }

      content = syntaxHL(content, _currentDiffExt);
      const lnDisplay = cls === 'diff-del' ? oldLn : newLn;
      const rawAttr = (cls === 'diff-del') ? ` data-raw="${esc(raw)}" data-ln="${oldLn}"` : '';
      _currentDiffBody.insertAdjacentHTML('beforeend', `<div class="diff-line ${cls === 'diff-add' ? 'add' : 'del'}"${rawAttr} onclick="copyLine(this)"><span class="dl-ln">${lnDisplay}</span><span class="dl-gutter">${prefix}</span><span class="dl-content">${content}</span></div>`);
    } else if (cls === 'diff-ctx') {
      const ctxLn = _diffOldLine || _diffNewLine;
      _diffOldLine++; _diffNewLine++;
      _currentDiffBody.insertAdjacentHTML('beforeend', `<div class="diff-line ctx" onclick="copyLine(this)"><span class="dl-ln">${ctxLn}</span><span class="dl-gutter"></span><span class="dl-content">${syntaxHL(esc(displayText), _currentDiffExt)}</span></div>`);
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

  // ── Regular lines ──
  const lineHtml = `<div class="line ${cls}" data-cls="${cls}" onclick="copyLine(this)"><span class="t">${getTimestamp()}</span> ${escaped}</div>`;

  // If inside a collapsible section, append directly to section body
  if (_currentSectionBody) {
    _currentSectionBody.insertAdjacentHTML('beforeend', lineHtml);
    termScrollToBottom();
    return;
  }

  _pendingLines.push(lineHtml);
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

// ── Copy section (between two separators) ──
export function copySection(btn: HTMLElement): void {
  const separator = btn.parentElement!;
  const lines: string[] = [];
  let el = separator.nextElementSibling;
  while (el) {
    if (el.classList.contains('term-separator')) break; // next section
    if (el.classList.contains('line') || el.classList.contains('diff-block') || el.classList.contains('diff-sbs')) {
      const text = el.textContent?.trim();
      if (text) lines.push(text);
    }
    el = el.nextElementSibling;
  }
  if (!lines.length) return;
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    btn.textContent = '\u2714';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '\u2398'; btn.classList.remove('copied'); }, 1000);
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
  navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
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
  // silent export
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
  // Visual feedback via button .active class is enough
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
    // "title" filter: show section titles, status, success, and error lines (summary view)
    if (S.termFilterType === 'title') {
      line.classList.toggle('type-hidden', cls !== 'title' && cls !== 'status' && cls !== 'success' && cls !== 'err');
      return;
    }
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

// ── Side-effect: Escape key exits fullscreen ──
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    const term = document.getElementById('terminal');
    if (term && term.classList.contains('fullscreen')) {
      term.classList.remove('fullscreen');
      e.preventDefault();
    }
  }
});

// ── Side-effect: Resize terminal ──
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
