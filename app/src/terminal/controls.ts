// ═══════════════════════════════════════════════════════════════════
// terminal/controls.ts — Terminal controls (spinner, timer, progress, patience)
// ═══════════════════════════════════════════════════════════════════

import { S, esc } from '../state';

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
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
}

let _currentEstimate: number | null = null;

export function startRunTimer(): void {
  S.runStartTime = Date.now();
  stopRunTimer();
  const el = document.getElementById('termTimer');
  if (el) { el.textContent = '0s'; el.style.display = 'inline'; }
  S.runTimerInterval = setInterval(() => {
    const el = document.getElementById('termTimer');
    if (!el) return;
    const elapsed = Date.now() - S.runStartTime;
    let text = formatDuration(elapsed);
    if (_currentEstimate && _currentEstimate > 0) {
      const remaining = Math.max(0, _currentEstimate - elapsed);
      if (remaining > 0) {
        text += ` / ~${formatDuration(_currentEstimate)}`;
      }
    }
    el.textContent = text;
  }, 1000);
}

export function setEstimate(scriptId: string): void {
  _currentEstimate = getEstimatedDuration(scriptId);
}

export function stopRunTimer(): string {
  if (S.runTimerInterval) { clearInterval(S.runTimerInterval); S.runTimerInterval = null; }
  const dur = S.runStartTime ? formatDuration(Date.now() - S.runStartTime) : '0s';
  const el = document.getElementById('termTimer');
  if (el) el.style.display = 'none';
  _currentEstimate = null;
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
export function showPRLink(termScrollToBottom: () => void): void {
  const out = document.getElementById('termOutput');
  if (!out) return;
  // Find PR URL in terminal output (first = main repo PR)
  const lines = out.querySelectorAll('.line');
  let prUrl: string | null = null;
  let viewDiffUrl: string | null = null;
  for (const line of lines) {
    const match = (line.textContent || '').match(/(https:\/\/dev\.azure\.com\/[^\s]+\/pullrequest\/\d+)/);
    if (match) {
      if (!prUrl) prUrl = match[1];
      else if (!viewDiffUrl) viewDiffUrl = match[1];
    }
  }
  if (prUrl) {
    // Detect if PR was updated or created
    const allText = Array.from(lines).map(l => l.textContent || '').join('\n');
    const isUpdate = allText.includes('Pull Request #') && allText.includes('updated');
    // Count packages from output
    const pkgMatch = allText.match(/Packages:\s*(.+)/);
    const pkgs = pkgMatch ? pkgMatch[1].split(',').length : 0;

    const banner = document.createElement('div');
    banner.className = 'pr-link-banner';
    let html = `<div class="pr-banner-header"><span class="pr-banner-status ${isUpdate ? 'update' : 'create'}">${isUpdate ? '\u21BB PR updated' : '\u2714 PR created'}</span></div>`;
    html += `<div class="pr-banner-actions">`;
    html += `<button onclick="openUrl('${esc(prUrl)}')">Open PR \u2192</button>`;
    if (viewDiffUrl) html += `<button class="secondary" onclick="openUrl('${esc(viewDiffUrl)}')">View Diff \u2192</button>`;
    html += `<button class="secondary" onclick="navigator.clipboard.writeText('${esc(prUrl)}')">\u2398 Copy URL</button>`;
    html += `</div>`;
    if (pkgs > 0) html += `<div class="pr-banner-meta">${pkgs} package${pkgs > 1 ? 's' : ''} committed</div>`;
    banner.innerHTML = html;
    out.appendChild(banner);
    termScrollToBottom();
  }
}

// ── Script card system ──
// Generic card renderer: finds [CARD:type]{json}[/CARD] in terminal output and renders a rich card.
// Shared by: status, health-check, cleanup, init

function extractCard(out: HTMLElement): { type: string; data: any } | null {
  const lines = out.querySelectorAll('.line');
  for (const line of lines) {
    const text = line.textContent || '';
    const match = text.match(/\[CARD:(\w+)\](.*)\[\/CARD\]/);
    if (match) {
      line.remove();
      try { return { type: match[1], data: JSON.parse(match[2]) }; } catch { return null; }
    }
  }
  return null;
}

const dot = (ok: boolean) => `<span class="sc-dot ${ok ? 'ok' : 'fail'}"></span>`;
const badge = (text: string, cls: string) => `<span class="sc-badge ${cls}">${esc(text)}</span>`;

function renderStatusCard(d: any): string {
  const gitAhead = d.git?.ahead || 0;
  const gitBehind = d.git?.behind || 0;
  const gitDirty = d.git?.dirty;
  let h = '';

  // Site + Repository
  h += `<div class="sc-row">`;
  h += `<div class="sc-block"><div class="sc-label">${dot(d.site?.ok)}Local Site</div><div class="sc-value">${esc(d.site?.id || '?')} ${badge(d.site?.status || '?', d.site?.ok ? 'ok' : 'fail')}</div>`;
  if (d.site?.path) h += `<div class="sc-sub">${esc(d.site.path)}</div>`;
  h += `</div>`;
  h += `<div class="sc-block"><div class="sc-label">${dot(d.azdo?.ok)}Repository</div><div class="sc-value">${esc(d.repo?.name || '?')}</div>`;
  if (d.repo?.org) h += `<div class="sc-sub">${esc(d.repo.org)}</div>`;
  h += `</div></div>`;

  // Branch
  h += `<div class="sc-row"><div class="sc-block wide"><div class="sc-label">Branch</div><div class="sc-value sc-branch">${esc(d.git?.branch || '?')} <span class="sc-arrow">\u2192</span> ${esc(d.git?.target || '?')}`;
  if (gitAhead > 0) h += ` ${badge(gitAhead + ' ahead', 'info')}`;
  if (gitBehind > 0) h += ` ${badge(gitBehind + ' behind', 'warn')}`;
  if (gitDirty) h += ` ${badge('dirty', 'warn')}`;
  if (gitAhead === 0 && gitBehind === 0 && !gitDirty) h += ` ${badge('clean', 'ok')}`;
  h += `</div></div></div>`;

  // Work item
  if (d.workitem?.id) {
    h += `<div class="sc-row"><div class="sc-block wide"><div class="sc-label">Work Item</div><div class="sc-value">#${esc(d.workitem.id)}`;
    if (d.workitem.title) h += ` \u2014 ${esc(d.workitem.title)}`;
    h += `</div></div></div>`;
  }

  // Packages
  const cfgPkgs = d.packages?.config || [];
  const masterPkgs = d.packages?.master || [];
  if (cfgPkgs.length > 0 || masterPkgs.length > 0) {
    h += `<div class="sc-row">`;
    h += `<div class="sc-block"><div class="sc-label">Config Packages <span class="sc-count">${cfgPkgs.length}</span></div><div class="sc-chips">${cfgPkgs.map((p: string) => `<span class="sc-chip">${esc(p)}</span>`).join('')}</div></div>`;
    h += `<div class="sc-block"><div class="sc-label">Master on Site <span class="sc-count">${masterPkgs.length}</span></div><div class="sc-chips">${masterPkgs.length ? masterPkgs.map((p: string) => `<span class="sc-chip master">${esc(p)}</span>`).join('') : '<span class="sc-dim">unknown</span>'}</div></div>`;
    h += `</div>`;
  }

  // PRs
  const prs = d.prs || [];
  h += `<div class="sc-row"><div class="sc-block wide"><div class="sc-label">Pull Requests ${prs.length > 0 ? `<span class="sc-count">${prs.length}</span>` : ''}</div>`;
  if (prs.length === 0) {
    h += `<div class="sc-dim">No active PRs</div>`;
  } else {
    prs.forEach((pr: any) => {
      h += `<div class="sc-pr"><span class="sc-pr-id">#${pr.id}</span><span class="sc-pr-title">${esc(pr.title || '')}</span>`;
      if (pr.url) h += `<button class="sc-pr-btn" onclick="openUrl('${esc(pr.url)}')">\u2192 Open</button>`;
      h += `</div>`;
    });
  }
  h += `</div></div>`;
  return h;
}

function renderHealthCard(d: any): string {
  const checks: { name: string; ok: boolean; detail: string }[] = d.checks || [];
  const passed = d.passed || 0;
  const failed = d.failed || 0;
  const allOk = failed === 0;
  let h = '';

  // Header
  h += `<div class="sc-row"><div class="sc-block wide"><div class="sc-value" style="font-size:13px; gap:10px;">${dot(allOk)}<span>Health Check</span>${badge(passed + ' passed', allOk ? 'ok' : 'warn')}`;
  if (failed > 0) h += badge(failed + ' failed', 'fail');
  h += `</div></div></div>`;

  // Checks — two per row
  for (let i = 0; i < checks.length; i += 2) {
    h += `<div class="sc-row">`;
    for (let j = i; j < Math.min(i + 2, checks.length); j++) {
      const c = checks[j];
      h += `<div class="sc-block"><div class="sc-label">${dot(c.ok)}${esc(c.name)}</div><div class="sc-value">${esc(c.detail)}</div></div>`;
    }
    h += `</div>`;
  }
  return h;
}

function renderCleanupCard(d: any): string {
  let h = '';
  const isDry = d.dryRun;
  h += `<div class="sc-row"><div class="sc-block wide"><div class="sc-value" style="font-size:13px; gap:10px;">${isDry ? '\uD83D\uDD0D' : '\u2714'} ${isDry ? 'Dry Run — Preview' : 'Cleanup Complete'}</div></div></div>`;
  h += `<div class="sc-row">`;
  h += `<div class="sc-block"><div class="sc-label">Files</div><div class="sc-value">${d.fileCount || 0} file${(d.fileCount || 0) !== 1 ? 's' : ''}</div></div>`;
  h += `<div class="sc-block"><div class="sc-label">Space ${isDry ? 'Reclaimable' : 'Freed'}</div><div class="sc-value">${esc(d.sizeFormatted || '0 KB')}</div></div>`;
  h += `</div>`;
  if (d.categories && d.categories.length > 0) {
    h += `<div class="sc-row"><div class="sc-block wide"><div class="sc-label">Categories</div><div class="sc-chips">${d.categories.map((c: any) => `<span class="sc-chip">${esc(c.name)} <span class="sc-count">${c.count}</span></span>`).join('')}</div></div></div>`;
  }
  return h;
}

function renderInitCard(d: any): string {
  let h = '';
  h += `<div class="sc-row"><div class="sc-block wide"><div class="sc-value" style="font-size:13px; gap:10px;">\u2714 Environment Initialized${d.envName ? ` \u2014 ${esc(d.envName)}` : ''}</div></div></div>`;
  h += `<div class="sc-row">`;
  if (d.branch) h += `<div class="sc-block"><div class="sc-label">Branch</div><div class="sc-value sc-branch">${esc(d.branch)}${d.target ? ` <span class="sc-arrow">\u2192</span> ${esc(d.target)}` : ''}</div></div>`;
  if (d.repository) h += `<div class="sc-block"><div class="sc-label">Repository</div><div class="sc-value">${esc(d.repository)}</div></div>`;
  h += `</div>`;
  if (d.sitePath) {
    h += `<div class="sc-row"><div class="sc-block wide"><div class="sc-label">Site Path</div><div class="sc-value">${esc(d.sitePath)}</div></div></div>`;
  }
  if (d.packages && d.packages.length > 0) {
    h += `<div class="sc-row"><div class="sc-block wide"><div class="sc-label">Packages <span class="sc-count">${d.packages.length}</span></div><div class="sc-chips">${d.packages.map((p: string) => `<span class="sc-chip">${esc(p)}</span>`).join('')}</div></div></div>`;
  }
  return h;
}

const CARD_RENDERERS: Record<string, (d: any) => string> = {
  status: renderStatusCard,
  health: renderHealthCard,
  cleanup: renderCleanupCard,
  init: renderInitCard,
};

export function showScriptCard(termScrollToBottom: () => void): void {
  const out = document.getElementById('termOutput');
  if (!out) return;
  const result = extractCard(out);
  if (!result) return;
  const renderer = CARD_RENDERERS[result.type];
  if (!renderer) return;
  const card = document.createElement('div');
  card.className = 'status-card';
  card.innerHTML = renderer(result.data);
  out.appendChild(card);
  termScrollToBottom();
}

// ── Error classification (pattern → cause + suggested fixes) ──
// Matched against the full terminal output of the failed run, so a hint can fire
// even when the trigger phrase lives on an info line rather than an error line.
interface FixHint {
  test: RegExp;
  title: string;
  steps: string[];
}

const FIX_HINTS: FixHint[] = [
  {
    test: /update these products\/packages|Product\s+"[^"]+"\s*-\s*Version|version dependenc/i,
    title: 'Missing product versions',
    steps: [
      'Some packages require other products to be at a newer version first.',
      'Update the listed products from the Pick & Choose page, then run the operation again.',
    ],
  },
  {
    test: /JSON Authentication|unauthorized|authentication failed|access denied|not allowed|\b401\b|force ssl/i,
    title: 'Authentication rejected',
    steps: [
      'Run the "Setup Auth" command (or full Setup) so the site password matches Config \u2192 local.password.',
      'Check local.user / local.password in the Config tab.',
      'In WizManager, make sure "Force SSL" is unchecked for this site.',
    ],
  },
  {
    test: /An error has occurred|contact the system administrator|internal Enablon error/i,
    title: 'Internal Enablon error',
    steps: [
      'Recycle the site app pool (iisreset) and retry \u2014 these errors are often transient.',
      'Check Config \u2192 local.parent_site points to a valid, reachable parent site.',
      'Use the Trace id / Ref shown above to find the exact error in the Enablon logs.',
    ],
  },
  {
    test: /parent site|WsdlLocation|invalid value for parameter/i,
    title: 'Parent site configuration',
    steps: [
      'Check Config \u2192 local.parent_site points to a valid parent site.',
      'Open the parent site URL in a browser to confirm it responds.',
    ],
  },
  {
    test: /unreachable|Unable to connect|No connection|connection was refused/i,
    title: 'Site unreachable',
    steps: [
      'Confirm IIS is running (iisreset /start) and the site/app pool are started.',
      'Check the site exists in IIS Manager.',
      'If a remote host is involved, confirm your VPN is connected.',
    ],
  },
  {
    test: /Artifactory|nuget feed token|git4inno/i,
    title: 'git4inno / Artifactory token',
    steps: [
      'The Artifactory NuGet feed token is likely expired.',
      'Update it as described in the "Getting Started" section of the README.',
    ],
  },
  {
    test: /PAT (is )?expired|token.*expired|expired.*token/i,
    title: 'Azure DevOps PAT expired',
    steps: [
      'Update your Personal Access Token in Config \u2192 azdo.token.',
      'Make sure the PAT has Code (read/write) scope.',
    ],
  },
];

// Turn http(s) URLs inside a plain string into clickable links (same delegation as terminal).
function linkifyText(text: string): string {
  return esc(text).replace(/(https?:\/\/[^\s)]+)/g, (m) => `<a href="#" class="url-link" data-url="${m}">${m}</a>`);
}

export interface ErrorCardContext {
  script?: string;
  env?: string;
  code?: number;
  duration?: string;
}

let _lastErrorCardCtx: ErrorCardContext = {};

// ── Error card (shown at the end of a failed run to surface error messages prominently) ──
export function showErrorCard(termScrollToBottom: () => void, ctx: ErrorCardContext = {}): void {
  const out = document.getElementById('termOutput');
  if (!out) return;
  // Don't render twice for the same run.
  if (out.querySelector('.error-card')) return;
  _lastErrorCardCtx = ctx;

  // Collect the content of each error line, preserving any url/file links (which are
  // handled via document-level click delegation, so they stay clickable inside the card).
  const errLines = Array.from(out.querySelectorAll('.line.err'));
  const items: string[] = [];
  const seen = new Set<string>();
  for (const el of errLines) {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelector('.t')?.remove();          // drop the timestamp span
    clone.querySelector('.section-dur')?.remove();
    const html = clone.innerHTML.trim();
    const plain = (clone.textContent || '').trim();
    if (!plain) continue;
    if (seen.has(plain)) continue;                // de-duplicate identical lines
    seen.add(plain);
    items.push(html);
  }
  if (!items.length) return;

  // Full output is used for classification + trace-id extraction.
  const fullText = Array.from(out.querySelectorAll('.line'))
    .map(el => (el as HTMLElement).textContent || '')
    .join('\n');

  // ── Trace id / Ref extraction (Enablon error identifiers) ──
  const refMatch = fullText.match(/\(\s*Ref:\s*([^)]+?)\s*\)/i);
  const traceMatch = fullText.match(/\(\s*Trace id:\s*([^)]+?)\s*\)/i);
  let refBlock = '';
  if (refMatch || traceMatch) {
    const rows: string[] = [];
    if (traceMatch) rows.push(`<div class="ec-ref-row"><span class="ec-ref-label">Trace id</span><code class="ec-ref-val">${esc(traceMatch[1])}</code></div>`);
    if (refMatch) rows.push(`<div class="ec-ref-row"><span class="ec-ref-label">Ref</span><code class="ec-ref-val">${esc(refMatch[1])}</code></div>`);
    refBlock =
      `<div class="ec-ref">` +
      `<div class="ec-section-title">Enablon reference</div>` +
      rows.join('') +
      `<div class="ec-ref-hint">Search these identifiers in the Enablon application logs to locate the server-side stack trace.</div>` +
      `</div>`;
  }

  // ── Suggested fixes (classification) ──
  const matched = FIX_HINTS.filter(h => h.test.test(fullText));
  let hintsBlock = '';
  if (matched.length) {
    // For the version-dependency hint, append the Pick & Choose link if we know the site id.
    const siteId = (S.envConfig?.local?.site_path || '').split(/[\\/]/).filter(Boolean).pop();
    const hintHtml = matched.map(h => {
      const steps = h.steps.slice();
      if (/Missing product versions/.test(h.title) && siteId) {
        steps.push(`Pick & Choose: http://localhost/${siteId}/go.aspx?v=/dlv/PickAndChoose`);
      }
      return `<div class="ec-hint">` +
        `<div class="ec-hint-title">${esc(h.title)}</div>` +
        `<ul class="ec-hint-steps">` +
        steps.map(s => `<li>${linkifyText(s)}</li>`).join('') +
        `</ul></div>`;
    }).join('');
    hintsBlock =
      `<div class="ec-fixes">` +
      `<div class="ec-section-title">Suggested fixes</div>` +
      hintHtml +
      `</div>`;
  }

  const card = document.createElement('div');
  card.className = 'error-card';
  card.innerHTML =
    `<div class="ec-header"><span class="ec-icon">\u26A0</span>` +
    `<span class="ec-title">${items.length > 1 ? `${items.length} errors` : 'Error'}</span>` +
    `<button class="ec-copy-btn" title="Copy a diagnostic report to the clipboard">Copy diagnostic report</button></div>` +
    `<div class="ec-body">` +
    items.map(i => `<div class="ec-item">${i}</div>`).join('') +
    `</div>` +
    refBlock +
    hintsBlock;

  // Wire the copy button (event listener — no global needed).
  const copyBtn = card.querySelector('.ec-copy-btn') as HTMLButtonElement | null;
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const report = buildDiagnosticReport(_lastErrorCardCtx);
      navigator.clipboard.writeText(report).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = 'Copied \u2713';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = orig; copyBtn.classList.remove('copied'); }, 1800);
      });
    });
  }

  out.appendChild(card);
  termScrollToBottom();
}

// Assemble a structured, copy-pasteable diagnostic report for a failed run.
function buildDiagnosticReport(ctx: ErrorCardContext): string {
  const out = document.getElementById('termOutput');
  const fullText = out
    ? Array.from(out.querySelectorAll('.line')).map(el => (el as HTMLElement).textContent || '')
    : [];

  const version = document.getElementById('termVer')?.textContent?.trim()
    || document.getElementById('ver')?.textContent?.trim()
    || 'unknown';
  const cfg = S.envConfig || {};

  const L: string[] = [];
  L.push('=== DONUT diagnostic report ===');
  L.push(`Generated: ${new Date().toISOString()}`);
  L.push(`DONUT: ${version}`);
  L.push('');
  L.push(`Script: ${ctx.script || S.lastRunResult?.script || S.selectedScript || 'unknown'}`);
  L.push(`Environment: ${ctx.env || S.currentEnv || 'none'}`);
  L.push(`Exit code: ${ctx.code !== undefined ? ctx.code : 'unknown'}`);
  L.push(`Duration: ${ctx.duration || S.lastRunResult?.duration || 'unknown'}`);
  L.push('');
  L.push(`Feature branch: ${cfg.feature_branch || 'none'}`);
  L.push(`Target branch: ${cfg.target_branch || 'none'}`);
  L.push(`Repository: ${cfg.azdo?.repository || 'none'}`);
  L.push(`Site path: ${cfg.local?.site_path || 'none'}`);
  L.push(`Parent site: ${cfg.local?.parent_site || 'none'}`);
  L.push(`Packages: ${(cfg.packages || []).join(', ') || 'none'}`);

  // Enablon error identifiers, if present.
  const joined = fullText.join('\n');
  const refMatch = joined.match(/\(\s*Ref:\s*([^)]+?)\s*\)/i);
  const traceMatch = joined.match(/\(\s*Trace id:\s*([^)]+?)\s*\)/i);
  if (refMatch || traceMatch) {
    L.push('');
    L.push('--- Enablon reference ---');
    if (traceMatch) L.push(`Trace id: ${traceMatch[1]}`);
    if (refMatch) L.push(`Ref: ${refMatch[1]}`);
  }

  // Error lines.
  const errLines = out
    ? Array.from(out.querySelectorAll('.line.err'))
        .map(el => { const c = el.cloneNode(true) as HTMLElement; c.querySelector('.t')?.remove(); return (c.textContent || '').trim(); })
        .filter(Boolean)
    : [];
  if (errLines.length) {
    L.push('');
    L.push('--- Errors ---');
    Array.from(new Set(errLines)).forEach(e => L.push(e));
  }

  // Last 40 lines of terminal output for context.
  const tail = fullText.map(t => t.trim()).filter(Boolean).slice(-40);
  if (tail.length) {
    L.push('');
    L.push('--- Last terminal output ---');
    tail.forEach(t => L.push(t));
  }

  return L.join('\n');
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

export function startPatienceMessages(appendLog: (text: string, cls: string) => void): void {
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
