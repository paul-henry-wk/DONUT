// ═══════════════════════════════════════════════════════════════════
// scripts.ts — Script grid rendering, selection, run bar
// ═══════════════════════════════════════════════════════════════════

import { SCRIPTS, SCRIPT_GROUPS, SETUP_STEPS, ICONS, ICO, WF_ALWAYS, esc, toast, invoke, getThemeMsgs, pickRandom, S } from './state';
import { getRecommended, getWorkflow, getScriptsForState, renderWorkflowBar, _wfHighlight } from './workflow';
import { appendLog } from './terminal';

export function renderScripts(): void {
  const fav = localStorage.getItem('donut-fav') || '';
  const recommended = getRecommended(S.currentEnv);
  const hasRec = recommended.length > 0;
  const wfDone = S.currentEnv ? getWorkflow(S.currentEnv).steps.map(s => s.script) : [];
  const noEnv = !S.currentEnv;
  const noEnvBanner = noEnv
    ? `<div class="no-env-banner"><span class="no-env-label">No environment configured</span><button onclick="openSetupWizard()">+ New environment</button></div>`
    : '';
  const gridEl = document.getElementById('scriptsGrid')!;
  gridEl.classList.toggle('no-env', noEnv);
  gridEl.innerHTML = noEnvBanner + SCRIPT_GROUPS.map(g => {
    const cards = g.scripts.map(s => {
      const sel = S.selectedScript===s.id ? ' active' : '';
      const dis = (S.isRunning || S.setupRunning) ? ' disabled' : '';
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
      const pipBtn = !S.isRunning && !s.danger && s.id !== 'setup' ? `<button class="pip-add-btn" onclick="event.stopPropagation();addToPipeline('${s.id}')" title="Add to pipeline">+</button>` : '';
      return `<div class="s-card${sel}${dis}${dng}${s.id===fav?' fav':''}${isNext?' wf-next':''}${dimmed}${highlighted}" role="button" aria-pressed="${S.selectedScript===s.id}" aria-label="${esc(s.name)}: ${esc(s.desc)}" onclick="selectScript('${s.id}')" ondblclick="toggleFav('${s.id}')">
        <div class="s-card-icon">${icon}</div>
        <div class="s-card-body">
          <div class="s-name">${esc(s.name)}${star}${s.admin ? '<span class="s-admin" title="Requires administrator">&#9881;</span>' : ''}</div>
          <div class="s-desc">${esc(s.desc)}</div>
        </div>
        ${badge}${pipBtn}${tooltip}
      </div>`;
    }).join('');
    return `<div class="s-group-label">${esc(g.label)}</div>${cards}`;
  }).join('');

  // Parallax tilt on script cards
  requestAnimationFrame(() => {
    document.querySelectorAll<HTMLElement>('.s-card').forEach(card => {
      card.addEventListener('mousemove', (e: MouseEvent) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;  // -0.5 to 0.5
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(600px) rotateY(${x * 3}deg) rotateX(${-y * 2}deg) translateY(-1px)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
      });
    });
  });
}

export function toggleFav(id: string): void {
  const current = localStorage.getItem('donut-fav');
  if (current === id) { localStorage.removeItem('donut-fav'); }
  else { localStorage.setItem('donut-fav', id); }
  renderScripts();
}

export function selectScript(id: string): void {
  if (S.isRunning || S.setupRunning) return;
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
  if (!S.currentEnv) { el.innerHTML=''; return; }
  const c = S.envConfig;
  const siteName = (c.local?.site_path || '').split(/[\\\/]/).pop() || '';
  const fb = c.feature_branch || '';
  const tb = c.target_branch || '';
  const repo = c.azdo?.repository || '';
  const pkgs = (c.packages || []);
  const org = c.azdo?.organization || '';
  const items: string[] = [];
  if (siteName) items.push(`<span class="si-item" title="${esc(c.local?.site_path || '')}"><span class="si-label">site</span><span class="si-val">${esc(siteName)}</span></span>`);
  if (fb) items.push(`<span class="si-item si-branch" title="${esc(fb)}"><span class="si-label">branch</span><span class="si-val">${esc(fb)}${tb ? ` \u2192 ${esc(tb)}` : ''}</span></span>`);
  if (repo) items.push(`<span class="si-item" title="${org ? esc(org) + ' / ' : ''}${esc(repo)}"><span class="si-label">repo</span><span class="si-val">${esc(repo)}</span></span>`);
  if (pkgs.length) items.push(`<span class="si-item" title="${esc(pkgs.join(', '))}"><span class="si-label">pkgs</span><span class="si-val">${esc(pkgs.join(', '))}</span></span>`);
  el.innerHTML = items.join('<span class="si-sep"></span>');
}

export function renderRunBar(): void {
  const bar = document.getElementById('runBar')!;
  if (!S.currentEnv) {
    bar.classList.remove('ready');
    bar.classList.add('no-env-hidden');
    return;
  }
  bar.classList.remove('no-env-hidden');
  if (!S.selectedScript) {
    bar.classList.remove('ready');
    const recommended = getRecommended(S.currentEnv);
    const hint = recommended.length
      ? `Next: <strong>${recommended.map(id => esc(SCRIPTS.find(x=>x.id===id)?.name||id)).join(' or ')}</strong>`
      : 'Select a script above';
    // Env summary chips
    const c = S.envConfig;
    const siteName = (c.local?.site_path || '').split(/[\\\/]/).pop() || '';
    const branch = c.feature_branch || '';
    const chips: string[] = [];
    if (siteName) chips.push(`<span class="rb-chip">${esc(siteName)}</span>`);
    if (branch) chips.push(`<span class="rb-chip">${esc(branch)}</span>`);
    const r = S.lastRunResult;
    if (r) chips.push(`<span class="rb-chip ${r.ok ? 'ok' : 'fail'}">${r.ok ? '&#10003;' : '&#10007;'} ${esc(r.script)} (${esc(r.duration)})</span>`);
    const chipsHtml = chips.length ? `<span class="rb-chips">${chips.join('')}</span>` : '';
    bar.innerHTML = `<span class="step-hint">${hint}</span>${chipsHtml}<span class="run-spacer"></span><span class="step-arrow">&uarr;</span>`;
    return;
  }
  bar.classList.add('ready');

  // ── Setup composite: show step strip ──
  if (S.selectedScript === 'setup') {
    const canInteract = !S.isRunning && !S.setupRunning;
    const focused = S.setupFocusedStep;
    const steps = SETUP_STEPS.map((step, i) => {
      const icon = ICONS[step.id] || '';
      let cls = 'setup-step';
      if (S.setupRunning && i < S.setupIdx) cls += ' done';
      else if (S.setupRunning && i === S.setupIdx && S.isRunning) cls += ' running';
      else if (S.setupRunning && i === S.setupIdx) cls += ' active';
      else if (canInteract && focused === step.id) cls += ' focused';
      const clickable = canInteract ? ` onclick="focusSetupStep('${step.id}')"` : '';
      return `<div class="${cls}"${clickable}>${icon}<span class="setup-step-name">${esc(step.name)}</span></div>`;
    });
    const arrows = '<span class="setup-arrow">&#9654;</span>';
    const stepsHtml = steps.join(arrows);
    let actionBtn: string;
    if (S.isRunning) {
      actionBtn = `<button class="run-btn danger" id="runBtn" onclick="doStop()">STOP</button>`;
    } else if (S.setupRunning) {
      actionBtn = `<button class="run-btn" id="runBtn" disabled>RUNNING...</button>`;
    } else if (focused) {
      const stepName = SETUP_STEPS.find(s => s.id === focused)?.name || '';
      actionBtn = `<button class="run-btn setup-single" id="runBtn" onclick="confirmSingleSetupStep()">${esc(stepName)}</button><button class="run-btn" onclick="doRun()">ALL</button>`;
    } else {
      actionBtn = `<button class="run-btn" id="runBtn" onclick="doRun()">SETUP</button>`;
    }
    bar.innerHTML = `
      <div class="setup-strip">${stepsHtml}</div>
      <span class="run-spacer"></span>
      ${actionBtn}
    `;
    return;
  }

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
      : `<span class="run-arrows">&#9654;&#9654;&#9654;</span><button class="${btnCls}" id="runBtn" onclick="doRun()">${btnLabel}</button>`
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


// ── Package picker (shown during Setup when packages not yet configured) ──
function showPackagePicker(packages: string[], preselected: string[] = []): Promise<string[] | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    let currentFilter = '';
    let selected = new Set<string>(preselected.filter(p => packages.includes(p)));

    const updateCount = () => {
      const el = overlay.querySelector('#pkg-pick-count') as HTMLElement | null;
      if (el) el.textContent = `${selected.size} selected`;
    };

    const render = () => {
      const q = currentFilter.toLowerCase();
      const visible = packages.filter(p => !q || p.toLowerCase().includes(q));
      overlay.innerHTML = `
        <div class="modal-box" style="max-width:600px;max-height:80vh;display:flex;flex-direction:column;gap:12px;padding:20px">
          <h3 style="margin:0;font-size:13px;font-weight:700;color:var(--accent)">SELECT MASTER PACKAGES</h3>
          <p style="margin:0;font-size:11px;color:var(--text-dim)">${packages.length} packages available. Choose which to open for development on this site.</p>
          <div style="display:flex;gap:6px;align-items:center">
            <input id="pkg-pick-filter" type="text" value="${esc(currentFilter)}" placeholder="Filter packages..."
              style="flex:1;background:var(--bg-input);border:1px solid var(--border);color:var(--text);font-family:inherit;font-size:12px;padding:7px 10px;border-radius:4px;outline:none"
              oninput="window._pkgPickFilter(this.value)" autofocus>
            <button class="cfg-action-btn" onclick="window._pkgPickAll()">All</button>
            <button class="cfg-action-btn" onclick="window._pkgPickNone()">None</button>
          </div>
          <div style="flex:1;overflow-y:auto;display:flex;flex-wrap:wrap;gap:5px;max-height:300px;padding:2px">
            ${visible.map(p => `<label class="pkg-chip${selected.has(p) ? ' selected' : ''}" data-pkg="${esc(p)}"
              onclick="window._pkgPickToggle(this,'${esc(p)}')">${esc(p)}</label>`).join('')}
            ${visible.length === 0 ? '<span style="font-size:11px;color:var(--text-dim)">No packages match the filter.</span>' : ''}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span id="pkg-pick-count" style="font-size:11px;color:var(--text-dim)">0 selected</span>
            <div style="display:flex;gap:8px">
              <button class="swiz-btn secondary" onclick="window._pkgPickCancel()">Skip</button>
              <button class="swiz-btn primary" onclick="window._pkgPickConfirm()">Confirm →</button>
            </div>
          </div>
        </div>`;
      updateCount();
    };

    const cleanup = () => {
      ['_pkgPickFilter','_pkgPickAll','_pkgPickNone','_pkgPickToggle','_pkgPickCancel','_pkgPickConfirm']
        .forEach(k => delete (window as any)[k]);
    };

    (window as any)._pkgPickFilter = (v: string) => { currentFilter = v; render(); };
    (window as any)._pkgPickAll = () => { packages.filter(p => !currentFilter || p.toLowerCase().includes(currentFilter.toLowerCase())).forEach(p => selected.add(p)); render(); };
    (window as any)._pkgPickNone = () => { packages.filter(p => !currentFilter || p.toLowerCase().includes(currentFilter.toLowerCase())).forEach(p => selected.delete(p)); render(); };
    (window as any)._pkgPickToggle = (el: HTMLElement, pkg: string) => { if (selected.has(pkg)) { selected.delete(pkg); el.classList.remove('selected'); } else { selected.add(pkg); el.classList.add('selected'); } updateCount(); };
    (window as any)._pkgPickCancel = () => { overlay.remove(); cleanup(); resolve(null); };
    (window as any)._pkgPickConfirm = () => { overlay.remove(); cleanup(); resolve(Array.from(selected)); };

    render();
    document.body.appendChild(overlay);
  });
}

// ── Install Site Wizard ─────────────────────────────────────────
interface WizardResult { enaPath: string; sitePath: string; }

export function showInstallWizard(): Promise<WizardResult | null> {
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

      (window as any)._cancelInstallWiz = () => { overlay.remove(); resolve(null); };
      const closeWiz = `window._cancelInstallWiz()`;

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
    (window as any).wizUpdateInstance = (v: string) => { instancePath = v; updateWizComputed(); };
    (window as any).wizUpdateSiteName = (v: string) => { siteName = v; updateWizComputed(); };

    // Update only the computed path and install button without re-rendering the whole modal
    function updateWizComputed(): void {
      const computed = instancePath && siteName ? `${instancePath}\\Sites\\${siteName}` : '';
      const canInstall = enaPath && instancePath && siteName;
      const computedEl = document.querySelector('.wiz-computed');
      if (computedEl) {
        computedEl.innerHTML = computed
          ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${esc(computed)}`
          : '<span style="opacity:.5">Select instance and enter site name</span>';
      }
      const installBtn = document.querySelector('.wiz-footer .modal-btn.primary') as HTMLButtonElement | null;
      if (installBtn) {
        installBtn.disabled = !canInstall;
      }
    }

    (window as any).wizDoInstall = () => {
      const sitePath = `${instancePath}\\Sites\\${siteName}`;
      document.getElementById('installWizOverlay')?.remove();
      resolve({ enaPath, sitePath });
    };

    render();
  });
}

// ── Setup composite runner ──────────────────────────────────────
async function runNextSetupStep(): Promise<void> {
  if (S.setupIdx >= SETUP_STEPS.length) {
    S.setupRunning = false;
    S.selectedScript = 'setup';
    toast('Setup complete!', 'success');
    renderRunBar();
    renderScripts();
    return;
  }
  const step = SETUP_STEPS[S.setupIdx];
  S.selectedScript = step.id; // So run-end handler identifies the script
  renderRunBar();

  // Install Site → use pre-filled data from New Environment wizard if available, else show wizard
  if (step.id === 'install-site') {
    let result: WizardResult | null;
    const preEna = (window as any)._pendingEnaPath as string | undefined;
    const preSite = (window as any)._pendingInstallSitePath as string | undefined;
    if (preEna && preSite) {
      result = { enaPath: preEna, sitePath: preSite };
      (window as any)._pendingEnaPath = null;
      (window as any)._pendingInstallSitePath = null;
    } else {
      result = await showInstallWizard();
    }
    if (!result) {
      // User cancelled wizard → abort setup
      S.setupRunning = false;
      S.selectedScript = 'setup';
      renderRunBar();
      renderScripts();
      return;
    }
    appendLog(`> donut install-site ${S.currentEnv}`, 'prompt');
    appendLog(`  ENA: ${result.enaPath}`, 'dim');
    appendLog(`  Site: ${result.sitePath}`, 'dim');
    appendLog(pickRandom(getThemeMsgs().run), 'dim');
    S._pendingInstallSitePath = result.sitePath;
    try {
      await invoke('run_script', {
        script: 'install-site', envFile: S.currentEnv, message: null,
        overrides: { ena_path: result.enaPath, site_path: result.sitePath }
      });
    } catch(e) {
      appendLog('Failed to start: ' + e, 'err');
      S.setupRunning = false;
      S.selectedScript = 'setup';
      renderRunBar();
    }
    return;
  }

  // set-master-packages: if no packages configured yet, prompt user to select from DB
  if (step.id === 'set-master-packages' && (!S.envConfig.packages || S.envConfig.packages.length === 0)) {
    const sitePath = S.envConfig.local?.site_path || '';
    const dbPwd = S.envConfig.local?.db_password || 'enablon';
    appendLog('No packages configured — loading from DB...', 'dim');
    let available: string[] = [];
    try {
      available = await invoke<string[]>('list_sql_packages', { sitePath, password: dbPwd });
    } catch (e) {
      appendLog('Could not load packages from DB: ' + e, 'warn');
    }
    if (available.length > 0) {
      const picked = await showPackagePicker(available);
      if (picked !== null && picked.length > 0) {
        S.envConfig.packages = picked;
        try { await invoke('save_env', { name: S.currentEnv, config: S.envConfig }); } catch { /* best effort */ }
        appendLog(`${picked.length} packages selected.`, 'dim');
      } else {
        appendLog('No packages selected — skipping.', 'warn');
        S.setupIdx++;
        setTimeout(() => runNextSetupStep(), 300);
        return;
      }
    } else {
      appendLog('No packages found in DB — skipping.', 'warn');
      S.setupIdx++;
      setTimeout(() => runNextSetupStep(), 300);
      return;
    }
  }

  // Other sub-steps: validate required fields then run
  const missing = validateEnvForScript(step.id);
  if (missing) {
    appendLog(`Skipping ${step.name}: missing ${missing.join(', ')}`, 'warn');
    S.setupIdx++;
    setTimeout(() => runNextSetupStep(), 500);
    return;
  }

  appendLog(`> donut ${step.id} ${S.currentEnv}`, 'prompt');
  appendLog(pickRandom(getThemeMsgs().run), 'dim');
  try {
    await invoke('run_script', { script: step.id, envFile: S.currentEnv, message: null });
  } catch(e) {
    appendLog('Failed to start: ' + e, 'err');
    S.setupRunning = false;
    S.selectedScript = 'setup';
    renderRunBar();
  }
}

// After a single setup sub-step finishes, restore selectedScript to 'setup'
export function restoreSetupAfterSingleStep(scriptId: string): void {
  if (S.setupRunning) return; // Handled by onSetupRunEnd
  const isSubStep = SETUP_STEPS.some(s => s.id === scriptId);
  if (isSubStep) {
    S.selectedScript = 'setup';
    S.setupFocusedStep = null;
    renderRunBar();
    renderScripts();
  }
}

export function onSetupRunEnd(ok: boolean): void {
  if (!S.setupRunning) return;
  if (!ok) {
    const step = SETUP_STEPS[S.setupIdx];
    toast(`Setup stopped: ${step?.name || 'step'} failed`, 'error');
    S.setupRunning = false;
    S.selectedScript = 'setup';
    renderRunBar();
    renderScripts();
    return;
  }
  S.setupIdx++;
  // Brief delay before next step
  setTimeout(() => runNextSetupStep(), 1500);
}

export function focusSetupStep(stepId: string): void {
  // Toggle: click again to deselect
  S.setupFocusedStep = S.setupFocusedStep === stepId ? null : stepId;
  renderRunBar();
}

export function confirmSingleSetupStep(): void {
  if (!S.setupFocusedStep) return;
  runSingleSetupStep(S.setupFocusedStep);
  S.setupFocusedStep = null;
}

export async function runSingleSetupStep(stepId: string): Promise<void> {
  if (S.isRunning || S.setupRunning) return;
  if (!S.currentEnv) { toast('No environment selected', 'error'); return; }
  const step = SETUP_STEPS.find(s => s.id === stepId);
  if (!step) return;

  // Admin check
  if (step.admin) {
    try {
      const isAdmin = await invoke<boolean>('is_admin');
      if (!isAdmin) {
        toast(`${step.name} requires administrator privileges. Right-click DONUT → "Run as Administrator"`, 'error');
        return;
      }
    } catch { /* let the script handle it */ }
  }

  S.selectedScript = stepId;

  if (stepId === 'install-site') {
    const result = await showInstallWizard();
    if (!result) { S.selectedScript = 'setup'; return; }
    appendLog(`> donut install-site ${S.currentEnv}`, 'prompt');
    appendLog(`  ENA: ${result.enaPath}`, 'dim');
    appendLog(`  Site: ${result.sitePath}`, 'dim');
    appendLog(pickRandom(getThemeMsgs().run), 'dim');
    S._pendingInstallSitePath = result.sitePath;
    try {
      await invoke('run_script', {
        script: 'install-site', envFile: S.currentEnv, message: null,
        overrides: { ena_path: result.enaPath, site_path: result.sitePath }
      });
    } catch(e) { appendLog('Failed to start: ' + e, 'err'); S.selectedScript = 'setup'; }
    return;
  }

  // set-master-packages: always show the picker (pre-selected with the current config)
  // so the user can confirm / add / remove packages before applying them.
  if (stepId === 'set-master-packages') {
    const picked = await pickMasterPackages();
    if (picked === null) {
      // User skipped/cancelled → abort, restore Setup view
      S.selectedScript = 'setup';
      renderRunBar();
      renderScripts();
      return;
    }
  }

  const missing = validateEnvForScript(stepId);
  if (missing) { toast(`Missing: ${missing.join(', ')}`, 'error'); S.selectedScript = 'setup'; return; }

  appendLog(`> donut ${stepId} ${S.currentEnv}`, 'prompt');
  appendLog(pickRandom(getThemeMsgs().run), 'dim');
  try {
    await invoke('run_script', { script: stepId, envFile: S.currentEnv, message: null });
  } catch(e) { appendLog('Failed to start: ' + e, 'err'); S.selectedScript = 'setup'; }
}

// Load packages from the site DB and let the user pick which are open for dev.
// Pre-selects the packages currently saved in the env config and persists the
// new selection. Returns the picked list, or null if the user skipped/cancelled.
async function pickMasterPackages(): Promise<string[] | null> {
  const sitePath = S.envConfig.local?.site_path || '';
  const dbPwd = S.envConfig.local?.db_password || 'enablon';
  appendLog('Loading packages from DB...', 'dim');
  let available: string[] = [];
  try {
    available = await invoke<string[]>('list_sql_packages', { sitePath, password: dbPwd });
  } catch (e) {
    appendLog('Could not load packages from DB: ' + e, 'warn');
  }
  const current = S.envConfig.packages || [];
  // Build the choice list: DB packages if available, otherwise fall back to the
  // currently configured ones so the user can still review/deselect them.
  const merged = Array.from(new Set([...available, ...current])).sort((a, b) => a.localeCompare(b));
  if (merged.length === 0) {
    appendLog('No packages available to choose from.', 'warn');
    toast('No packages found in the site DB', 'warn');
    return null;
  }
  const picked = await showPackagePicker(merged, current);
  if (picked === null) { appendLog('Package selection skipped.', 'warn'); return null; }
  S.envConfig.packages = picked;
  try { await invoke('save_env', { name: S.currentEnv, config: S.envConfig }); } catch { /* best effort */ }
  appendLog(`${picked.length} packages selected.`, 'dim');
  return picked;
}

export async function doRun(): Promise<void> {
  if (!S.selectedScript || S.isRunning) return;

  if (!S.currentEnv) { toast('No environment selected', 'error'); return; }

  // ── Setup composite: launch guided setup sequence ──
  if (S.selectedScript === 'setup') {
    if (S.setupRunning) return;
    // Admin check (install-site and setup-local-auth need admin)
    try {
      const isAdmin = await invoke<boolean>('is_admin');
      if (!isAdmin) {
        toast('Setup requires administrator privileges. Right-click DONUT → "Run as Administrator"', 'error');
        return;
      }
    } catch { /* check failed, let the script handle it */ }
    // If a site is already installed, skip the install-site step (start at auth).
    // A real deployed site has a web.config — a bare/leftover folder must NOT count
    // as installed, otherwise install-site is skipped and auth/packages fail.
    if (!S.setupStartIdx) {
      const sitePath = S.envConfig.local?.site_path || '';
      if (sitePath) {
        let installed = false;
        try {
          const sep = sitePath.includes('/') && !sitePath.includes('\\') ? '/' : '\\';
          installed = await invoke<boolean>('path_exists', { path: `${sitePath}${sep}web.config` });
        } catch { /* ignore */ }
        if (installed) S.setupStartIdx = 1;
      }
    }
    S.setupRunning = true;
    S.setupIdx = S.setupStartIdx || 0;
    S.setupStartIdx = 0;
    renderRunBar();
    runNextSetupStep();
    return;
  }

  // ── Independent setup sub-steps (Setup Auth / Set Packages) ──
  // Run them standalone through the guided single-step runner so Set Packages
  // still shows the package picker and both keep their admin checks.
  if (S.selectedScript === 'setup-local-auth' || S.selectedScript === 'set-master-packages') {
    runSingleSetupStep(S.selectedScript);
    return;
  }

  const s = SCRIPTS.find(x=>x.id===S.selectedScript)!;

  // Admin check for scripts that require elevation
  if (s.admin) {
    try {
      const isAdmin = await invoke<boolean>('is_admin');
      if (!isAdmin) {
        toast(`${s.name} requires administrator privileges. Right-click DONUT → "Run as Administrator"`, 'error');
        return;
      }
    } catch { /* check failed, let the script handle it */ }
  }

  // Install Site → wizard instead of direct run
  if (S.selectedScript === 'install-site') {
    const result = await showInstallWizard();
    if (!result) return;
    appendLog(`> donut install-site ${S.currentEnv}`, 'prompt');
    appendLog(`  ENA: ${result.enaPath}`, 'dim');
    appendLog(`  Site: ${result.sitePath}`, 'dim');
    appendLog(pickRandom(getThemeMsgs().run), 'dim');
    S._pendingInstallSitePath = result.sitePath;
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
    // Fetch git preview for context-aware confirmation
    let previewHtml = '';
    const sitePath = S.envConfig.local?.site_path || '';
    if (sitePath) {
      try {
        const preview = await invoke<{ uncommitted: string[]; recent_commits: string[]; branch: string }>('git_preview', { sitePath });
        const parts: string[] = [];
        if (preview.branch) parts.push(`<div class="drp-section"><strong>Branch :</strong> ${esc(preview.branch)}</div>`);
        if (preview.uncommitted.length) {
          parts.push(`<div class="drp-section"><strong>${preview.uncommitted.length} fichier(s) non commit\u00e9(s) :</strong><div class="drp-list">${preview.uncommitted.slice(0, 10).map(f => `<div class="drp-file">${esc(f)}</div>`).join('')}${preview.uncommitted.length > 10 ? `<div class="drp-more">... et ${preview.uncommitted.length - 10} de plus</div>` : ''}</div></div>`);
        }
        if (s.id === 'rollback' && preview.recent_commits.length) {
          parts.push(`<div class="drp-section"><strong>Commits r\u00e9cents (seront revert\u00e9s) :</strong><div class="drp-list">${preview.recent_commits.map(c => `<div class="drp-commit">${esc(c)}</div>`).join('')}</div></div>`);
        }
        if (parts.length) previewHtml = `<div class="drp-preview">${parts.join('')}</div>`;
      } catch { /* git not available, show basic message */ }
    }
    const dangerMsgs: Record<string, string> = {
      'pull-force': 'This will reset the local site and apply all commits from the repository. Uncommitted local changes will be lost.',
      'reset': 'This will wipe the local site and rebuild from scratch. All local changes and commit history will be lost.',
      'rollback': 'This will undo commits by creating a revert. Previous history is preserved but changes will be reverted.',
      'cleanup': 'This will delete old commit files (.enzp), temp files, session cookies, and old logs (keeping the 10 most recent).',
    };
    const message = (dangerMsgs[s.id] || 'This is a destructive operation. Are you sure?') + previewHtml;
    const ok = await (window as any).showModal({ title: s.name, message, danger: true, html: !!previewHtml, confirmLabel: 'Confirm', cancelLabel: 'Cancel' });
    if (!ok) return;
  }

  const body: { script: string; envFile: string; message?: string } = { script: S.selectedScript, envFile: S.currentEnv };

  if (s.needsMsg) {
    const input = document.getElementById('commitMsg') as HTMLInputElement | null;
    if (!input?.value?.trim()) { toast('Commit message is required', 'error'); return; }
    let msg = input.value.trim();

    // Auto-prefix with work item ID (extract numeric ID from "#123 — title" format)
    const wiRaw = S.envConfig.workitem_id || '';
    const wiNumMatch = wiRaw.match(/(\d+)/);
    const wiNum = wiNumMatch ? wiNumMatch[1] : '';
    if (wiNum && !msg.includes(`AB#${wiNum}`) && !msg.includes(`#${wiNum}`)) {
      msg = `AB#${wiNum} - ${msg}`;
    }

    // Show donut spinner while loading data
    const spinnerOverlay = document.createElement('div');
    spinnerOverlay.className = 'modal-overlay';
    spinnerOverlay.innerHTML = `<div class="cc-spinner"><div class="cc-donut-spin"></div><div class="cc-spin-text">Loading commit preview...</div></div>`;
    document.body.appendChild(spinnerOverlay);

    // Gather data in parallel
    const fbLabel = S.envConfig.feature_branch || '?';
    const tbLabel = S.envConfig.target_branch || '?';
    const repoLabel = S.envConfig.azdo?.repository || '?';
    const pkgList = (S.envConfig.packages || []);
    const wiTitle = wiRaw.replace(/^#?\d+\s*[\u2014\-]\s*/, '').trim();
    const sitePath = S.envConfig.local?.site_path || '';
    const token = S.envConfig.azdo?.token;
    const repo = S.envConfig.azdo?.repository;
    const fb = S.envConfig.feature_branch;
    const tb = S.envConfig.target_branch;
    const org = S.envConfig.azdo?.organization;
    const proj = S.envConfig.azdo?.project;
    const convertMd = S.envConfig.deactivate_metadata_conversion !== true;

    // Parallel fetches
    const [gitResult, diffResult, branchResult] = await Promise.allSettled([
      sitePath ? invoke<{ uncommitted: string[]; recent_commits: string[]; branch: string }>('git_preview', { sitePath }) : Promise.resolve(null),
      (token && repo && fb && tb) ? invoke<{ ahead: number; behind: number; changes: Array<{ path: string; change_type: string }> }>('compare_branches', { token, project: proj, repository: repo, sourceBranch: fb, targetBranch: tb, organization: org }) : Promise.resolve(null),
      (token && repo && fb) ? invoke<string[]>('list_azdo_branches', { token, project: proj, repository: repo, organization: org }) : Promise.resolve([]),
    ]);

    const gitPreview = gitResult.status === 'fulfilled' ? gitResult.value : null;
    const remoteDiff = diffResult.status === 'fulfilled' ? diffResult.value : null;
    const remoteBranches = branchResult.status === 'fulfilled' ? (branchResult.value as string[]) : [];
    const branchExistsOnRemote = !fb || remoteBranches.length === 0 || remoteBranches.includes(fb);

    // Remove spinner
    spinnerOverlay.remove();

    // Build commit panel (slide-in from right)
    const confirmed = await new Promise<boolean>((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'cc-overlay';
      const panel = document.createElement('div');
      panel.className = 'cc-panel';

      // Warnings
      let warns = '';
      if (!branchExistsOnRemote) warns += `<div class="cc-warn err">Branch <b>${esc(fb)}</b> not found on remote — commit will fail.</div>`;
      if (remoteDiff && remoteDiff.behind > 0) warns += `<div class="cc-warn">${remoteDiff.behind} commit${remoteDiff.behind !== 1 ? 's' : ''} behind <b>${esc(tbLabel)}</b> — consider pulling first.</div>`;

      // Changes section
      let changesHtml = '';
      if (remoteDiff && remoteDiff.changes.length > 0) {
        const adds = remoteDiff.changes.filter(c => c.change_type === 'add').length;
        const edits = remoteDiff.changes.filter(c => c.change_type !== 'add' && c.change_type !== 'delete').length;
        const dels = remoteDiff.changes.filter(c => c.change_type === 'delete').length;
        const total = adds + edits + dels;
        const addPct = Math.round((adds / total) * 100);
        const editPct = Math.round((edits / total) * 100);

        changesHtml += `<div class="cc-section">`;
        changesHtml += `<div class="cc-section-title">Changes</div>`;
        changesHtml += `<div class="cc-diffbar"><div class="cc-diffbar-add" style="width:${addPct}%"></div><div class="cc-diffbar-edit" style="width:${editPct}%"></div><div class="cc-diffbar-del" style="width:${100 - addPct - editPct}%"></div></div>`;
        changesHtml += `<div class="cc-change-stats">`;
        changesHtml += `<span>${remoteDiff.ahead} commit${remoteDiff.ahead !== 1 ? 's' : ''}</span>`;
        changesHtml += `<span>\u00B7</span>`;
        changesHtml += `<span>${remoteDiff.changes.length} file${remoteDiff.changes.length !== 1 ? 's' : ''}</span>`;
        if (adds) changesHtml += `<span class="cc-c-add">+${adds}</span>`;
        if (edits) changesHtml += `<span class="cc-c-edit">~${edits}</span>`;
        if (dels) changesHtml += `<span class="cc-c-del">\u2212${dels}</span>`;
        changesHtml += `</div>`;

        // File list (we have the space now)
        changesHtml += `<div class="cc-filelist">`;
        remoteDiff.changes.slice(0, 30).forEach(c => {
          const name = c.path.split('/').pop() || c.path;
          const dir = c.path.substring(0, c.path.length - name.length).replace(/^\//, '');
          const cls = c.change_type === 'add' ? 'add' : c.change_type === 'delete' ? 'del' : 'edit';
          const icon = c.change_type === 'add' ? '+' : c.change_type === 'delete' ? '\u2212' : '~';
          changesHtml += `<div class="cc-fl ${cls}"><span class="cc-fl-icon">${icon}</span><span class="cc-fl-dir">${esc(dir)}</span><span class="cc-fl-name">${esc(name)}</span></div>`;
        });
        if (remoteDiff.changes.length > 30) changesHtml += `<div class="cc-fl-more">+${remoteDiff.changes.length - 30} more files</div>`;
        changesHtml += `</div>`;
        changesHtml += `</div>`;
      }


      panel.innerHTML = `
        <div class="cc-header">
          <span class="cc-title">Commit & Push</span>
          <button class="cc-close" id="ccClose">\u2715</button>
        </div>
        <div class="cc-body">
          ${warns}
          <div class="cc-section">
            <div class="cc-section-title">Message</div>
            <textarea class="cc-msg" id="ccMsgEdit" placeholder="Describe your changes...">${esc(msg)}</textarea>
          </div>
          <div class="cc-section">
            <div class="cc-section-title">Target</div>
            <div class="cc-route">
              <span class="cc-from">${esc(fbLabel)}</span>
              <span class="cc-arrow">\u2192</span>
              <span class="cc-to">${esc(tbLabel)}</span>
            </div>
            <div class="cc-props">
              <div class="cc-prop"><span class="cc-prop-k">Repo</span><span class="cc-prop-v">${esc(repoLabel)}</span></div>
              <div class="cc-prop"><span class="cc-prop-k">Packages</span><span class="cc-prop-v">${esc(pkgList.join(', ') || 'none')}</span></div>
              ${wiNum ? `<div class="cc-prop"><span class="cc-prop-k">Work Item</span><span class="cc-prop-v">AB#${esc(wiNum)}${wiTitle ? ` \u2014 ${esc(wiTitle)}` : ''}</span></div>` : ''}
            </div>
          </div>
          <div class="cc-section">
            <div class="cc-opt"><label><input type="checkbox" id="ccMetadata" ${convertMd ? 'checked' : ''}> Generate metadata view-diff</label></div>
          </div>
          ${changesHtml}
        </div>
        <div class="cc-footer">
          <button class="cc-btn-cancel" id="ccCancel">Cancel</button>
          <button class="cc-btn-go" id="ccGo">Commit & Push \u2192</button>
        </div>`;

      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => { overlay.classList.add('open'); panel.querySelector<HTMLTextAreaElement>('#ccMsgEdit')?.focus(); });


      const close = (val: boolean) => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); resolve(val); };
      panel.querySelector('#ccClose')!.addEventListener('click', () => close(false));
      panel.querySelector('#ccCancel')!.addEventListener('click', () => close(false));
      panel.querySelector('#ccGo')!.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      overlay.addEventListener('keydown', (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') close(false); });
    });
    if (!confirmed) return;

    // Read back edited message from popup
    const editedMsg = (document.getElementById('ccMsgEdit') as HTMLTextAreaElement)?.value?.trim();
    if (editedMsg) msg = editedMsg;
    if (!msg) { toast('Commit message is required', 'error'); return; }

    // Apply metadata toggle
    const mdCheckbox = document.getElementById('ccMetadata') as HTMLInputElement | null;
    if (mdCheckbox) {
      S.envConfig.deactivate_metadata_conversion = !mdCheckbox.checked;
    }

    body.message = msg;

  }

  appendLog(`> donut ${S.selectedScript} ${S.currentEnv}`, 'prompt');
  appendLog(pickRandom(getThemeMsgs().run), 'dim');
  try { await invoke('run_script', { script: S.selectedScript, envFile: S.currentEnv, message: body.message || null }); }
  catch(e) { appendLog('Failed to start: '+e, 'err'); }
}


export function toggleCommitHistory(): void {
  const dd = document.getElementById('commitHistDropdown');
  if (dd) dd.classList.toggle('visible');
}

export function pickCommitMsg(el: HTMLElement): void {
  const input = document.getElementById('commitMsg') as HTMLInputElement | null;
  if (input) {
    input.value = el.title || el.textContent || '';
    input.focus();
    validateCommitMsg(input);
  }
  const dd = document.getElementById('commitHistDropdown');
  if (dd) dd.classList.remove('visible');
}

// ── Commit message validation (#4) ──

export function validateCommitMsg(input: HTMLInputElement): void {
  const el = document.getElementById('commitValidation');
  if (!el) return;
  const val = input.value.trim();
  const len = val.length;
  if (len === 0) { el.textContent = ''; el.className = 'commit-validation'; return; }
  if (len < 5) { el.textContent = 'too short'; el.className = 'commit-validation warn'; return; }
  if (len > 200) { el.textContent = `${len}/200`; el.className = 'commit-validation warn'; return; }
  const wiId = S.envConfig.workitem_id;
  if (!wiId) { el.textContent = 'no work item linked'; el.className = 'commit-validation dim'; return; }
  el.textContent = `${len} chars`; el.className = 'commit-validation ok';
}

// ── Pipeline (script queue) ──

export function addToPipeline(id: string): void {
  if (S.pipelineRunning) return;
  S.pipeline.push(id);
  renderPipeline();
}

export function removeFromPipeline(idx: number): void {
  if (S.pipelineRunning) return;
  S.pipeline.splice(idx, 1);
  renderPipeline();
}

export function clearPipeline(): void {
  if (S.pipelineRunning) return;
  S.pipeline = [];
  renderPipeline();
}

export function movePipelineItem(from: number, to: number): void {
  if (S.pipelineRunning || to < 0 || to >= S.pipeline.length) return;
  const [item] = S.pipeline.splice(from, 1);
  S.pipeline.splice(to, 0, item);
  renderPipeline();
}

export function renderPipeline(): void {
  const el = document.getElementById('pipelineBar');
  if (!el) return;
  if (!S.pipeline.length) {
    el.classList.remove('visible');
    el.innerHTML = '';
    return;
  }
  el.classList.add('visible');
  const items = S.pipeline.map((id, i) => {
    const s = SCRIPTS.find(x => x.id === id);
    const name = s?.name || id;
    const icon = ICONS[id] || '';
    const running = S.pipelineRunning && i === S.pipelineIdx;
    const done = S.pipelineRunning && i < S.pipelineIdx;
    const cls = running ? 'pip-item running' : done ? 'pip-item done' : 'pip-item';
    const status = done ? '<span class="pip-done">\u2714</span>' : running ? '<span class="pip-running">\u25B6</span>' : '';
    const movebtns = !S.pipelineRunning ? `<span class="pip-move" onclick="event.stopPropagation();movePipelineItem(${i},${i - 1})" title="Move up">\u25B2</span><span class="pip-move" onclick="event.stopPropagation();movePipelineItem(${i},${i + 1})" title="Move down">\u25BC</span>` : '';
    const removebtn = !S.pipelineRunning ? `<span class="pip-remove" onclick="event.stopPropagation();removeFromPipeline(${i})" title="Remove">\u2715</span>` : '';
    return `<div class="${cls}" draggable="${!S.pipelineRunning}" data-pip-idx="${i}">${status}<span class="pip-icon">${icon}</span><span class="pip-name">${esc(name)}</span>${movebtns}${removebtn}</div>`;
  }).join('<span class="pip-arrow">\u25B6</span>');

  const actions = S.pipelineRunning
    ? `<button class="pip-btn danger" onclick="cancelPipeline()">cancel</button>`
    : `<button class="pip-btn primary" onclick="runPipeline()">run pipeline</button><button class="pip-btn" onclick="clearPipeline()">clear</button>`;
  el.innerHTML = `<div class="pip-label">Pipeline (${S.pipeline.length})</div><div class="pip-items">${items}</div><div class="pip-actions">${actions}</div>`;

  // Drag & drop reordering
  if (!S.pipelineRunning) setupPipelineDragDrop();
}

function setupPipelineDragDrop(): void {
  const items = document.querySelectorAll('.pip-item[draggable="true"]');
  items.forEach(el => {
    el.addEventListener('dragstart', (e: Event) => {
      const de = e as DragEvent;
      de.dataTransfer!.setData('text/plain', (el as HTMLElement).dataset.pipIdx || '');
      (el as HTMLElement).classList.add('dragging');
    });
    el.addEventListener('dragend', () => (el as HTMLElement).classList.remove('dragging'));
    el.addEventListener('dragover', (e: Event) => { e.preventDefault(); (el as HTMLElement).classList.add('drag-over'); });
    el.addEventListener('dragleave', () => (el as HTMLElement).classList.remove('drag-over'));
    el.addEventListener('drop', (e: Event) => {
      e.preventDefault();
      const de = e as DragEvent;
      (el as HTMLElement).classList.remove('drag-over');
      const from = parseInt(de.dataTransfer!.getData('text/plain'));
      const to = parseInt((el as HTMLElement).dataset.pipIdx || '0');
      if (!isNaN(from) && !isNaN(to) && from !== to) movePipelineItem(from, to);
    });
  });
}

export async function runPipeline(): Promise<void> {
  if (!S.pipeline.length || S.isRunning || S.pipelineRunning) return;
  if (!S.currentEnv) { toast('No environment selected', 'error'); return; }
  S.pipelineRunning = true;
  S.pipelineIdx = 0;
  renderPipeline();
  runPipelineStep();
}

function runPipelineStep(): void {
  if (S.pipelineIdx >= S.pipeline.length) {
    // Pipeline complete
    S.pipelineRunning = false;
    toast(`Pipeline complete (${S.pipeline.length} steps)`, 'success');
    renderPipeline();
    return;
  }
  const scriptId = S.pipeline[S.pipelineIdx];
  S.selectedScript = scriptId;
  renderScripts();
  renderRunBar();
  renderPipeline();
  // Defer to doRun (skip danger confirm in pipeline mode)
  appendLog(`\u2500\u2500 Pipeline step ${S.pipelineIdx + 1}/${S.pipeline.length} \u2500\u2500`, 'title');
  invoke('run_script', { script: scriptId, envFile: S.currentEnv, message: null }).catch(e => {
    appendLog('Pipeline step failed to start: ' + e, 'err');
    S.pipelineRunning = false;
    renderPipeline();
  });
}

// Called from app.ts on run-end when pipeline is active
export function onPipelineRunEnd(ok: boolean): void {
  if (!S.pipelineRunning) return;
  if (!ok) {
    // Stop pipeline on failure
    const failed = S.pipeline[S.pipelineIdx];
    const name = SCRIPTS.find(x => x.id === failed)?.name || failed;
    toast(`Pipeline stopped: ${name} failed`, 'error');
    S.pipelineRunning = false;
    renderPipeline();
    return;
  }
  S.pipelineIdx++;
  // Small delay before next step to let UI settle
  setTimeout(() => runPipelineStep(), 1000);
}

export function cancelPipeline(): void {
  S.pipelineRunning = false;
  renderPipeline();
  toast('Pipeline cancelled', 'warn');
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
