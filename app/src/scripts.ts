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
            case 'ena_path': ok = !!S.envConfig.local?.ena_path; label = 'ENA archive'; break;
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
    ? `<button class="run-btn watch-btn ${S.isWatching ? 'active' : ''}" onclick="toggleWatch()">${S.isWatching ? '&#9632; STOP WATCH' : '&#9673; WATCH'}</button>`
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
      case 'ena_path':       if (!S.envConfig.local?.ena_path) missing.push('ENA archive path'); break;
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
  if (S.isWatching) {
    try {
      await invoke('stop_watch');
      S.isWatching = false;
      toast('Watch stopped', 'info');
      appendLog('[STATUS] Watch mode stopped', 'status');
    } catch (e) { toast('Stop watch: ' + e, 'error'); }
  } else {
    if (!S.currentEnv) { toast('Select an environment first', 'error'); return; }
    try {
      await invoke('start_watch', { envFile: S.currentEnv });
      S.isWatching = true;
      toast('Watching for changes...', 'success');
    } catch (e) { toast('Start watch: ' + e, 'error'); }
  }
  renderRunBar();
}

// ── Install Site Wizard ─────────────────────────────────────────
interface WizardResult { enaPath: string; sitePath: string; }

function showInstallWizard(): Promise<WizardResult | null> {
  return new Promise(async (resolve) => {
    let enaPath = '';
    let siteName = '';
    let instancePath = '';
    let step = 1;
    const isAdmin = await invoke<boolean>('is_admin').catch(() => false);

    // Scan Enablon instances (directories with Binary\WizManager.exe or Sites\)
    let instances: Array<{path: string; name: string; has_wiz_manager: boolean}> = [];
    try {
      instances = await invoke<typeof instances>('scan_enablon_instances');
    } catch { /* no instances found */ }

    function render(): void {
      const overlay = document.getElementById('installWizOverlay') || document.createElement('div');
      overlay.id = 'installWizOverlay';
      overlay.className = 'modal-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } };

      const adminWarning = !isAdmin ? `<div class="wiz-warning">\u26A0 DONUT is not running as Administrator. Installation may fail. Please restart DONUT as Administrator.</div>` : '';

      const closeWiz = `document.getElementById('installWizOverlay')?.remove()`;

      if (step === 1) {
        overlay.innerHTML = `<div class="modal-box wiz-box">
          <div class="wiz-header">
            <span class="wiz-title">Install Site</span>
            <span class="wiz-steps-ind"><span class="wiz-dot active">1</span><span class="wiz-dot-line"></span><span class="wiz-dot">2</span></span>
            <button class="wiz-close" onclick="${closeWiz}">\u2715</button>
          </div>
          ${adminWarning}
          <div class="wiz-body">
            <div class="wiz-label">Select the .ENA archive to install</div>
            <div class="wiz-drop-zone" onclick="wizBrowseEna()">
              ${enaPath
                ? `<div class="wiz-file-ok"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> <b>${esc(enaPath.split('\\').pop() || enaPath)}</b></div>
                    <div class="wiz-file-path">${esc(enaPath)}</div>`
                : `<div class="wiz-file-empty"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Click to browse for .ENA file</span></div>`
              }
            </div>
          </div>
          <div class="wiz-footer">
            <button class="modal-btn" onclick="${closeWiz}">Cancel</button>
            <button class="modal-btn primary" ${!enaPath ? 'disabled' : ''} onclick="wizGoStep2()">Next \u2192</button>
          </div>
        </div>`;
      } else {
        const computed = instancePath && siteName ? `${instancePath}\\Sites\\${siteName}` : '';
        const canInstall = enaPath && instancePath && siteName;

        // Instance selector: dropdown if instances found, else browse button
        let instanceHtml = '';
        if (instances.length > 0) {
          const opts = instances.map(i =>
            `<option value="${esc(i.path)}" ${i.path === instancePath ? 'selected' : ''}>${esc(i.name)}${i.has_wiz_manager ? '' : ' (no WizManager)'} \u2014 ${esc(i.path)}</option>`
          ).join('');
          instanceHtml = `<select onchange="wizUpdateInstance(this.value)">${opts}</select>
            <button class="wiz-browse-btn" onclick="wizBrowseInstance()" title="Browse...">...</button>`;
        } else {
          instanceHtml = `<div class="wiz-input-row">
            <input type="text" placeholder="C:\\Enablon\\Instance" value="${esc(instancePath)}" oninput="wizUpdateInstance(this.value)"/>
            <button class="wiz-browse-btn" onclick="wizBrowseInstance()">Browse</button>
          </div>`;
        }

        overlay.innerHTML = `<div class="modal-box wiz-box">
          <div class="wiz-header">
            <span class="wiz-title">Install Site</span>
            <span class="wiz-steps-ind"><span class="wiz-dot done">\u2713</span><span class="wiz-dot-line"></span><span class="wiz-dot active">2</span></span>
            <button class="wiz-close" onclick="${closeWiz}">\u2715</button>
          </div>
          ${adminWarning}
          <div class="wiz-body">
            <div class="wiz-field">
              <label>Enablon Instance</label>
              <div class="wiz-input-row">${instanceHtml}</div>
            </div>
            <div class="wiz-field">
              <label>Site name</label>
              <input type="text" value="${esc(siteName)}" oninput="wizUpdateSiteName(this.value)" placeholder="WizGRC.10.13"/>
            </div>
            <div class="wiz-computed">${computed
              ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${esc(computed)}`
              : '<span style="opacity:.5">Select instance and enter site name</span>'}</div>
          </div>
          <div class="wiz-footer">
            <button class="modal-btn" onclick="wizGoStep1()">\u2190 Back</button>
            <button class="modal-btn primary" ${!canInstall ? 'disabled' : ''} onclick="wizDoInstall()">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Install
            </button>
          </div>
        </div>`;
        if (instances.length > 0 && !instancePath) { instancePath = instances[0].path; render(); }
      }

      if (!document.getElementById('installWizOverlay')) document.body.appendChild(overlay);
    }

    // Window globals for onclick
    (window as any).wizBrowseEna = async () => {
      const path = await invoke<string | null>('browse_file', { defaultPath: null, filter: 'ENA files (*.ena)|*.ena|All files (*.*)|*.*' });
      if (path) {
        enaPath = path;
        // Pre-fill site name from ENA filename
        const fname = path.split('\\').pop()?.replace(/\.ena$/i, '') || '';
        if (!siteName) siteName = fname;
        render();
      }
    };
    (window as any).wizBrowseInstance = async () => {
      const path = await invoke<string | null>('browse_folder', { defaultPath: instancePath || 'C:\\' });
      if (path) { instancePath = path; render(); }
    };
    (window as any).wizGoStep2 = () => { step = 2; render(); };
    (window as any).wizGoStep1 = () => { step = 1; render(); };
    (window as any).wizUpdateInstance = (v: string) => { instancePath = v; render(); };
    (window as any).wizUpdateSiteName = (v: string) => { siteName = v; render(); };
    (window as any).wizDoInstall = () => {
      const sitePath = `${instancePath}\\Sites\\${siteName}`;
      document.getElementById('installWizOverlay')?.remove();
      resolve({ enaPath, sitePath });
    };

    render();
  });
}

export async function doRun(): Promise<void> {
  if (!S.selectedScript || S.isRunning) return;
  const s = SCRIPTS.find(x=>x.id===S.selectedScript)!;

  if (!S.currentEnv) { toast('No environment selected', 'error'); return; }

  // Install Site → wizard instead of direct run
  if (S.selectedScript === 'install-site') {
    const result = await showInstallWizard();
    if (!result) return;
    appendLog(`> donut install-site ${S.currentEnv}`, 'prompt');
    appendLog(`  ENA: ${result.enaPath}`, 'dim');
    appendLog(`  Site: ${result.sitePath}`, 'dim');
    appendLog(pickRandom(getThemeMsgs().run), 'dim');
    try {
      await invoke('run_script', {
        script: 'install-site', envFile: S.currentEnv, message: null,
        overrides: { ena_path: result.enaPath, site_path: result.sitePath }
      });
    } catch(e) { appendLog('Failed to start: ' + e, 'err'); }
    return;
  }

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
