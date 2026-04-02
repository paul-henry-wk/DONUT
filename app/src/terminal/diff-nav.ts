// ═══════════════════════════════════════════════════════════════════
// terminal/diff-nav.ts — Diff block management and navigation
// ═══════════════════════════════════════════════════════════════════

import { esc } from '../state';

// ── Module-level diff state ──
export let _diffTotalAdds = 0;
export let _diffTotalDels = 0;
export let _diffTotalFiles = 0;
export let _diffBlocks: HTMLElement[] = [];
export let _diffCurrentNav = -1;
export let _lastDiffGroup = '';
export let _diffSummary = { objects: 0, newCount: 0, modCount: 0, delCount: 0 };

// Setters for resetting state from terminal.ts
export function resetDiffState(): void {
  _diffTotalAdds = 0;
  _diffTotalDels = 0;
  _diffTotalFiles = 0;
  _diffBlocks = [];
  _diffCurrentNav = -1;
  _lastDiffGroup = '';
  _diffSummary = { objects: 0, newCount: 0, modCount: 0, delCount: 0 };
}

export function setDiffTotalAdds(v: number): void { _diffTotalAdds = v; }
export function setDiffTotalDels(v: number): void { _diffTotalDels = v; }
export function setDiffTotalFiles(v: number): void { _diffTotalFiles = v; }
export function incrDiffTotalAdds(): void { _diffTotalAdds++; }
export function incrDiffTotalDels(): void { _diffTotalDels++; }
export function incrDiffTotalFiles(): void { _diffTotalFiles++; }
export function setDiffCurrentNav(v: number): void { _diffCurrentNav = v; }
export function setLastDiffGroup(v: string): void { _lastDiffGroup = v; }
export function pushDiffBlock(block: HTMLElement): void { _diffBlocks.push(block); }

export function closeDiffBlock(
  currentDiffBlock: HTMLElement | null,
  currentDiffBody: HTMLElement | null,
  currentDiffAdds: number,
  currentDiffDels: number,
): void {
  if (currentDiffBlock) {
    const adds = currentDiffAdds;
    const dels = currentDiffDels;

    // Hide block if no actual changes
    if (adds === 0 && dels === 0) {
      currentDiffBlock.remove();
    } else {
      // Action badge: new / modified / deleted
      let actionBadge = '';
      if (adds > 0 && dels === 0) { actionBadge = '<span class="diff-action new">new</span>'; _diffSummary.newCount++; }
      else if (adds === 0 && dels > 0) { actionBadge = '<span class="diff-action del">del</span>'; _diffSummary.delCount++; }
      else { actionBadge = '<span class="diff-action mod">mod</span>'; _diffSummary.modCount++; }
      _diffSummary.objects++;

      // Check if metadata-only (yaml with only XmlInfo/Product/Path/Special lines, no meaningful content)
      const body = currentDiffBody;
      const contentLines = body?.querySelectorAll('.diff-line.add, .diff-line.del') || [];
      let isMetadataOnly = contentLines.length > 0;
      contentLines.forEach(line => {
        const text = (line.querySelector('.dl-content') as HTMLElement)?.textContent?.trim() || '';
        if (!text.match(/^(XmlInfo:|Id:|Product:|Path:|Special:|ReturnType:|Parameters:|!.*|)$/)) {
          isMetadataOnly = false;
        }
      });

      if (isMetadataOnly && contentLines.length > 0) {
        currentDiffBlock.classList.add('metadata-only');
      }

      // Update count + badge
      const countEl = currentDiffBlock.querySelector('.diff-count');
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
}

// ── Extract object name from file path for grouping ──
export function diffObjectName(filePath: string): string {
  const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
  const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
  const baseName = fileName.indexOf('.') > 0 ? fileName.substring(0, fileName.indexOf('.')) : fileName;
  return dir + baseName;
}

// ── Diff summary bar ──
export function updateDiffSummary(): void {
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
