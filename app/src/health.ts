// =====================================================================
// health.ts -- Health dashboard widget & popup
// =====================================================================

import type { HealthStatus, PrereqCheck } from './types';
import { esc, toast, invoke, S } from './state';

// ── Module-private state ──
let _healthTimer: ReturnType<typeof setTimeout> | null = null;
let _lastHealth: HealthStatus | null = null;

// Adaptive polling intervals (ms)
const POLL_FAST = 6_000;   // when any check is failing
const POLL_SLOW = 30_000;  // when all checks pass
let _pollInterval = POLL_FAST; // start fast

export async function refreshHealth(): Promise<void> {
  const sp = S.envConfig.local?.site_path || '';
  if (!sp) { renderHealthWidget(null); return; }
  const siteId = sp.split(/[\\\/]/).pop() || '';
  try {
    const h = await invoke<HealthStatus>('quick_health', {
      sitePath: sp,
      siteId,
      dbUser: S.envConfig.local?.db_user || 'sa',
      dbPassword: S.envConfig.local?.db_password || S.envConfig.local?.password || '',
      parentSite: S.envConfig.local?.parent_site || '',
    });
    const allOk = h.iis && h.sql && h.site && h.vpn;
    _pollInterval = allOk ? POLL_SLOW : POLL_FAST;
    renderHealthWidget(h);
  } catch {
    _pollInterval = POLL_FAST;
    renderHealthWidget(null);
  }
}

export function renderHealthWidget(h: HealthStatus | null): void {
  const el = document.getElementById('healthWidget');
  if (!el) return;
  if (!h) { el.innerHTML = ''; return; }
  _lastHealth = h;
  const allOk = h.iis && h.sql && h.site && h.vpn;
  const hasError = !h.iis || !h.sql || !h.site;
  const cls = allOk ? 'ok' : hasError ? 'fail' : 'warn';
  el.innerHTML = `<span class="hw-led ${cls}"></span><span class="hw-label">health</span>`;
  el.onclick = toggleHealthPopup;
}

export function toggleHealthPopup(): void {
  let popup = document.getElementById('healthPopup');
  if (popup) { popup.remove(); return; }
  popup = document.createElement('div');
  popup.id = 'healthPopup';
  popup.className = 'hw-popup';

  let html = '<div class="hw-title">System Health</div>';

  // Services
  if (_lastHealth) {
    const h = _lastHealth;
    const row = (ok: boolean | undefined, label: string, detail: string | undefined): string =>
      `<div class="hw-row ${ok ? 'ok' : 'fail'}" ${!ok ? `onclick="autoFixHealth('${label}');document.getElementById('healthPopup')?.remove()"` : ''}><span class="hw-led ${ok ? 'ok' : 'fail'}"></span><span class="hw-name">${label}</span><span class="hw-detail">${esc(detail || '')}</span>${!ok ? '<span class="hw-fix">fix</span>' : ''}</div>`;
    html += row(h.iis, 'IIS', h.iis_detail) + row(h.sql, 'SQL', h.sql_detail) + row(h.site, 'Site', h.site_detail) + row(h.vpn, 'VPN', h.vpn_detail);
  } else {
    html += '<div class="hw-row"><span class="hw-detail">Loading...</span></div>';
  }

  // Prerequisites
  if (window._prereqs) {
    html += '<div class="hw-section">Prerequisites</div>';
    window._prereqs.forEach((p: PrereqCheck) => {
      const ver = p.version ? ` ${p.version}` : '';
      const clickAttr = !p.ok && window._installCmds?.[p.name]
        ? ` onclick="toast('Install: ${window._installCmds[p.name]}', 'warn');document.getElementById('healthPopup')?.remove()"`
        : '';
      html += `<div class="hw-row ${p.ok ? 'ok' : 'fail'}"${clickAttr}><span class="hw-led ${p.ok ? 'ok' : 'fail'}"></span><span class="hw-name">${esc(p.name)}</span><span class="hw-detail">${p.ok ? esc(ver || 'installed') : 'not found'}</span>${!p.ok ? '<span class="hw-fix">install</span>' : ''}</div>`;
    });
  }

  html += `<div class="hw-refresh" onclick="refreshHealth();document.getElementById('healthPopup')?.remove()">refresh</div>`;
  popup.innerHTML = html;
  document.getElementById('healthWidget')?.appendChild(popup);
  setTimeout(() => document.addEventListener('click', function cl(e: MouseEvent) {
    if (!popup!.contains(e.target as Node) && !document.getElementById('healthWidget')?.contains(e.target as Node)) {
      popup!.remove();
      document.removeEventListener('click', cl);
    }
  }), 0);
}

function _scheduleNextPoll(): void {
  if (_healthTimer) clearTimeout(_healthTimer);
  _healthTimer = setTimeout(async () => {
    await refreshHealth();
    _scheduleNextPoll();
  }, _pollInterval);
}

export function startHealthPolling(): void {
  if (_healthTimer) clearTimeout(_healthTimer);
  _pollInterval = POLL_FAST; // reset to fast on start
  refreshHealth();
  _scheduleNextPoll();
}

export async function autoFixHealth(service: string): Promise<void> {
  if (service === 'IIS') {
    toast('Restarting IIS...', 'info');
    try {
      await invoke('run_script', { script: 'health-check', envFile: S.currentEnv, message: null });
    } catch { /* ignore */ }
    toast('Run "iisreset /start" as administrator, or restart the AppPool in IIS Manager', 'warn');
    setTimeout(refreshHealth, 5000);
  } else if (service === 'SQL') {
    toast('Check SQL Server is running: services.msc \u2192 SQL Server \u2192 Start', 'warn');
  } else if (service === 'Site') {
    toast('Site unreachable. Check IIS AppPool is started and site_id is correct in config.', 'warn');
  } else if (service === 'VPN') {
    toast('VPN disconnected. Connect your VPN and retry.', 'warn');
  }
}
