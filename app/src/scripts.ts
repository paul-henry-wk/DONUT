// ═══════════════════════════════════════════════════════════════════
// scripts.ts — Script grid rendering, selection, run bar
// ═══════════════════════════════════════════════════════════════════

import { SCRIPTS, SCRIPT_GROUPS, ICONS, ICO, WF_ALWAYS, esc, toast, invoke, getThemeMsgs, pickRandom, S } from './state';
import { getRecommended, getWorkflow, getScriptsForState, renderWorkflowBar, _wfHighlight } from './workflow';
import { appendLog } from './terminal';

export function renderScripts(): void {
  const fav = localStorage.getItem('donut-fav') || '';
  const recommended = getRecommended(S.currentEnv);
  const hasRec = recommended.length > 0;
  const wfDone = S.currentEnv ? getWorkflow(S.currentEnv).steps.map(s => s.script) : [];
  document.getElementById('scriptsGrid')!.innerHTML = SCRIPT_GROUPS.map(g => {
    const cards = g.scripts.map(s => {
      const sel = S.selectedScript===s.id ? ' active' : '';
      const dis = S.isRunning ? ' disabled' : '';
      const dng = s.danger ? ' danger' : '';
      const star = s.id===fav ? '<span class="s-fav" title="favorite (auto-selected at startup)">&#127849;</span>' : '';
      const isNext = recommended.includes(s.id);
      const isDone = wfDone.includes(s.id);
      const isDiag = WF_ALWAYS.includes(s.id);
      // Dim cards that aren't recommended (but not diagnostics, active, or danger)
      const dimmed = hasRec && !isNext && !isDiag && !sel && !dng ? ' wf-dimmed' : '';
      // Highlight from workflow step click
      const wfHL = _wfHighlight && typeof getScriptsForState === 'function' ? getScriptsForState(_wfHighlight) : [];
      const highlighted = wfHL.includes(s.id) ? ' wf-highlighted' : '';
      // Badge
      let badge = '';
      if (isNext) badge = '<div class="wf-badge next">&#9654; next</div>';
      else if (isDone) badge = '<div class="wf-badge done">&#10003;</div>';
      else if (s.id===fav) badge = '<div class="s-fav-badge">default</div>';
      const icon = ICONS[s.id] || '';
      // Tooltip with prerequisites (only show if config is loaded)
      let tooltip = '';
      if (s.requires && s.requires.length && S.currentEnv && S.envConfig.local) {
        let tips = s.requires.map(r => {
          let ok = false, label = r;
          switch(r) {
            case 'site_path': ok = !!S.envConfig.local?.site_path; label = 'Site path'; break;
            case 'feature_branch': ok = !!S.envConfig.feature_branch; label = 'Feature branch'; break;
            case 'target_branch': ok = !!S.envConfig.target_branch; label = 'Target branch'; break;
            case 'repository': ok = !!S.envConfig.azdo?.repository; label = 'Repository'; break;
            case 'token': ok = !!S.envConfig.azdo?.token; label = 'PAT token'; break;
          }
          return `<span class="${ok?'s-tooltip-ok':'s-tooltip-miss'}">${ok?'\u2714':'\u2718'} ${label}</span>`;
        }).join(' ');
        // Show packages in tooltip for set-master-packages
        if (s.id === 'set-master-packages') {
          const pkgs = S.envConfig.packages || [];
          if (pkgs.length > 0) {
            tips += ` <span class="s-tooltip-ok">\u2714 Packages: ${esc(pkgs.join(', '))}</span>`;
          } else {
            tips += ' <span class="s-tooltip-miss">\u2718 No packages configured</span>';
          }
        }
        tooltip = `<div class="s-tooltip">${tips}</div>`;
      }
      return `<div class="s-card${sel}${dis}${dng}${s.id===fav?' fav':''}${isNext?' wf-next':''}${dimmed}${highlighted}" role="button" aria-pressed="${S.selectedScript===s.id}" aria-label="${esc(s.name)}: ${esc(s.desc)}" onclick="selectScript('${s.id}')" ondblclick="toggleFav('${s.id}')">
        <div class="s-card-icon">${icon}</div>
        <div class="s-card-body">
          <div class="s-name">${esc(s.name)}${star}</div>
          <div class="s-desc">${esc(s.desc)}</div>
        </div>
        ${badge}${tooltip}
      </div>`;
    }).join('');
    return `<div class="s-group-label">${esc(g.label)}</div>${cards}`;
  }).join('');
}

export function toggleFav(id: string): void {
  const current = localStorage.getItem('donut-fav');
  if (current === id) { localStorage.removeItem('donut-fav'); }
  else { localStorage.setItem('donut-fav', id); }
  renderScripts();
}

export function selectScript(id: string): void {
  if (S.isRunning) return;
  S.selectedScript = id;
  S.lastRunResult = null;
  localStorage.setItem('donut-script', id);
  renderScripts();
  renderRunBar();
  document.getElementById('runBar')?.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

export function renderSelectedInfo(): void {
  const el = document.getElementById('selectedInfo');
  if (!el) return;
  if (!S.currentEnv || !S.envConfig.feature_branch) { el.innerHTML=''; return; }
  el.innerHTML = `<span style="color:#7a7a7a">env:</span> ${esc(S.currentEnv)} <span style="color:#7a7a7a">branch:</span> ${esc(S.envConfig.feature_branch||'-')} <span style="color:#7a7a7a">-></span> ${esc(S.envConfig.target_branch||'-')} <span style="color:#7a7a7a">repo:</span> ${esc(S.envConfig.azdo?.repository||'-')} <span style="color:#7a7a7a">pkgs:</span> ${esc((S.envConfig.packages||[]).join(',')||'none')}`;
}

export function renderRunBar(): void {
  const bar = document.getElementById('runBar')!;
  if (!S.selectedScript) {
    bar.classList.remove('ready');
    const recommended = getRecommended(S.currentEnv);
    const hint = recommended.length
      ? `Next: <strong>${recommended.map(id => esc(SCRIPTS.find(x=>x.id===id)?.name||id)).join(' or ')}</strong>`
      : 'Select a script above to get started';
    bar.innerHTML = `<span class="step-hint">${hint}</span><span class="step-arrow">&uarr;</span>`;
    return;
  }
  bar.classList.add('ready');
  const s = SCRIPTS.find(x=>x.id===S.selectedScript)!;
  const icon = ICONS[s.id] || '';
  const msgInput = s.needsMsg ? `<input type="text" id="commitMsg" placeholder="commit message..." autocomplete="off">` : '';
  const btnCls = s.danger ? 'run-btn danger' : 'run-btn';
  const btnLabel = s.danger ? 'RESET' : 'RUN';

  // Workflow hint
  const recommended = getRecommended(S.currentEnv);
  const isDiag = WF_ALWAYS.includes(s.id);
  let wfHint = '';
  if (recommended.includes(s.id)) {
    wfHint = '<span class="wf-hint recommended">&#10003; recommended</span>';
  } else if (isDiag) {
    wfHint = '<span class="wf-hint diag">diagnostic</span>';
  }

  const watchBtn = s.id === 'diff' && !S.isRunning
    ? `<button class="run-btn watch-btn ${(S as any).isWatching ? 'active' : ''}" onclick="toggleWatch()">${(S as any).isWatching ? '&#9632; STOP WATCH' : '&#9673; WATCH'}</button>`
    : '';

  // Last run result badge
  const r = S.lastRunResult;
  const resultBadge = r && !S.isRunning
    ? `<span class="run-result ${r.ok ? 'ok' : 'fail'}">${r.ok
        ? ICO('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>')
        : ICO('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>')
      }<span>${esc(r.script)} — ${r.ok ? 'success' : 'failed'} (${esc(r.duration)})</span></span>`
    : '';

  bar.innerHTML = `
    <span class="run-label">${icon} ${esc(s.name)}</span>
    ${wfHint}
    ${resultBadge}
    <span class="run-spacer"></span>
    ${msgInput}
    ${S.isRunning
      ? `<button class="run-btn danger" id="runBtn" onclick="doStop()">STOP</button>`
      : `${watchBtn}<span class="run-arrows">&#9654;&#9654;&#9654;</span><button class="${btnCls}" id="runBtn" onclick="doRun()">${btnLabel}</button>`
    }
  `;
  if (s.needsMsg) {
    setTimeout(() => { const input = document.getElementById('commitMsg') as HTMLInputElement | null; if (input) input.focus(); }, 0);
  }
}

// ── Env validation before run ──
export function validateEnvForScript(scriptId: string): string[] | null {
  const s = SCRIPTS.find(x => x.id === scriptId);
  if (!s || !s.requires) return null;
  const missing: string[] = [];
  for (const req of s.requires) {
    switch (req) {
      case 'site_path':      if (!S.envConfig.local?.site_path) missing.push('Site path'); break;
      case 'feature_branch': if (!S.envConfig.feature_branch) missing.push('Feature branch'); break;
      case 'target_branch':  if (!S.envConfig.target_branch) missing.push('Target branch'); break;
      case 'repository':     if (!S.envConfig.azdo?.repository) missing.push('Repository'); break;
      case 'token':          if (!S.envConfig.azdo?.token) missing.push('PAT token'); break;
    }
  }
  return missing.length ? missing : null;
}

// ── Watch mode ──
export async function toggleWatch(): Promise<void> {
  if ((S as any).isWatching) {
    try {
      await invoke('stop_watch');
      (S as any).isWatching = false;
      toast('Watch stopped', 'info');
      appendLog('[STATUS] Watch mode stopped', 'status');
    } catch (e) { toast('Stop watch: ' + e, 'error'); }
  } else {
    if (!S.currentEnv) { toast('Select an environment first', 'error'); return; }
    try {
      await invoke('start_watch', { envFile: S.currentEnv });
      (S as any).isWatching = true;
      toast('Watching for changes...', 'success');
    } catch (e) { toast('Start watch: ' + e, 'error'); }
  }
  renderRunBar();
}

export async function doRun(): Promise<void> {
  if (!S.selectedScript || S.isRunning) return;
  const s = SCRIPTS.find(x=>x.id===S.selectedScript)!;

  if (!S.currentEnv) { toast('No environment selected', 'error'); return; }

  // Validate required fields
  const missing = validateEnvForScript(S.selectedScript);
  if (missing) {
    toast(`Missing: ${missing.join(', ')}`, 'error');
    return;
  }

  if (s.danger) {
    const dangerMsgs: Record<string, string> = {
      'reset': 'This will pull force from scratch with no history. All local changes will be lost.',
      'rollback': 'This will undo commits by creating a revert. Previous history is preserved but changes will be reverted.',
    };
    const ok = await (window as any).showConfirm(s.name, dangerMsgs[s.id] || 'This is a destructive operation. Are you sure?');
    if (!ok) return;
  }

  const body: { script: string; envFile: string; message?: string } = { script: S.selectedScript, envFile: S.currentEnv };

  if (s.needsMsg) {
    const input = document.getElementById('commitMsg') as HTMLInputElement | null;
    if (!input?.value?.trim()) { toast('Commit message is required', 'error'); return; }
    body.message = input.value.trim();
  }

  appendLog(`> donut ${S.selectedScript} ${S.currentEnv}`, 'prompt');
  appendLog(pickRandom(getThemeMsgs().run), 'dim');
  try { await invoke('run_script', { script: S.selectedScript, envFile: S.currentEnv, message: body.message || null }); }
  catch(e) { appendLog('Failed to start: '+e, 'err'); }
}

// ── Tabs ──
let _panelWasCollapsed = false;

export function showTab(id: string, btn: HTMLElement): void {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('tab-'+id)?.classList.add('active');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');

  const isScripts = id==='scripts';
  const term = document.getElementById('terminal');
  const panel = document.querySelector('.panel');

  // Exit fullscreen when leaving scripts tab
  if (!isScripts && term?.classList.contains('fullscreen')) {
    term.classList.remove('fullscreen');
  }

  // Restore panel when switching to non-scripts tabs, collapse back when returning
  if (!isScripts && panel?.classList.contains('collapsed')) {
    _panelWasCollapsed = true;
    panel.classList.remove('collapsed');
    term?.classList.remove('expanded');
  } else if (isScripts && _panelWasCollapsed) {
    _panelWasCollapsed = false;
    panel?.classList.add('collapsed');
    term?.classList.add('expanded');
  }

  // Show terminal/runbar/resizer only on scripts tab
  ['runBar','resizer','terminal'].forEach(eid => {
    const el = document.getElementById(eid);
    if (el) el.style.display = isScripts ? '' : 'none';
  });
  if (id==='config') (window as any).renderConfig();
  if (id==='devops') (window as any).renderDevops();
}
