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
export function showPRLink(termScrollToBottom: () => void): void {
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
