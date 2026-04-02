// =====================================================================
// app.ts -- Init, event listeners, theme, main glue, modals
// =====================================================================

import type { EnvConfig, ModalOptions, PrereqCheck, ScriptEvent, UpdateInfo, VersionInfo, WorkItem } from './types';
import { esc, invoke, listen, S, SCRIPTS, getThemeMsgs, pickRandom, toast } from './state';
import {
  appendLog, closeDiffBlock, setIndicator, showStopBtn, hideRerunBtn,
  startSpinner, stopSpinner, startRunTimer, stopRunTimer,
  startPatienceMessages, stopPatienceMessages, startProgress, stopProgress,
  expandTerminal, showPRLink, showRerunBtn, addRunHistory,
  setTermFontSize, navigateErrors, resetTerminalState,
} from './terminal';
import { renderScripts, renderRunBar, doRun, selectScript } from './scripts';
import { advanceWorkflow, renderWorkflowBar, recalcWorkflow } from './workflow';
import { startHealthPolling } from './health';
import { renderConfig } from './config';
import { renderDevops } from './devops';

// ── Theme constants (module-private) ──
interface ThemeDef {
  id: string;
  label: string;
}

const THEMES: ThemeDef[] = [
  { id: 'dark',       label: 'Dark' },
  { id: 'light',      label: 'Light' },
  { id: 'dark-choco', label: 'Dark Choco' },
  { id: 'chocolate',  label: 'Chocolate' },
  { id: 'strawberry', label: 'Strawberry' },
  { id: 'rainbow',    label: 'Rainbow' },
  { id: 'win95',      label: 'Windows 95' },
  { id: 'winxp',      label: 'Windows XP' },
  { id: 'aqua',       label: 'Mac OS X' },
];

const THEME_WELCOME: Record<string, string[]> = {
  dark: [
    '      .:::::.          ',
    '   .::       ::.       ',
    '  ::   .:::.   ::   ',
    '  ::   :   :   ::   ',
    '  ::   \':::\'   ::      ',
    '   \'::       ::\'       ',
    '      \':::::\' ',
  ],
  light: [
    '       .-"""-.         ',
    '      /       \\        ',
    '     |  O   O  |    ',
    '     |    (_)   |    ',
    '     |  \\___/  |       ',
    '      \\_______/        ',
    '         |||  ',
  ],
  'dark-choco': [
    '      ________         ',
    '    /%%%%%%%%%%\\       ',
    '   |%%%%%.%%%%%|    ',
    '   |%%%%.%%..%%|    ',
    '   |%%%%%.%%%%%|       ',
    '    \\%%%%%%%%%%/       ',
    '      --------  ',
  ],
  chocolate: [
    '    ~~~~~~~~~~~~~~     ',
    '   ~~~  CHOCO  ~~~     ',
    '  {  .-\"\"\"\"\"-.   }  ',
    '  { /  ,._,.  \\  }  ',
    '  { |  (o)(o) |  }     ',
    '   {  \\_____/   }      ',
    '    ~~~~~~~~~~~~ ',
  ],
  strawberry: [
    '        \\\\|//          ',
    '         .--.          ',
    '    .--./    \\.--. ',
    '   /   \'.*  *.\'   \\ ',
    '   |  .*  \\/  *.  |    ',
    '    \\  \'*.  .*\'  /     ',
    '     \'--\'----\'--\' ',
  ],
  rainbow: [
    '   *  .  *  .  *  .   ',
    '  .  * . PARTY . *    ',
    '    .o0O DONUT O0o. ',
    '   0  *  MODE  *  0 ',
    '    \'o0O  !!! O0o\'     ',
    '  *  .  *  .  *  .    ',
    '   .  *  .  *  .  * ',
  ],
  win95: [
    ' _________________________ ',
    '|  _   _ _           ___  |',
    '| | \\ / (_)_ __  ___/ _ \\ |',
    '| |  V  | | \'_ \\(_-<\\_, / |',
    '| |_/ \\_|_|_||_/__/ /_/  |',
    '|     DONUT for Win95     |',
    '|_________________________|',
  ],
  winxp: [
    '  \\\\    //  ____           ',
    '   \\\\  //  |  _ \\          ',
    '    \\\\//   | |_) |         ',
    '    //\\\\   |  __/          ',
    '   //  \\\\  | |             ',
    '  //    \\\\ |_|   DONUT     ',
    '  ~ experience the donut ~',
  ],
  aqua: [
    '       .\'\'\'\'\'\'\'\'\'.',
    '     .\'           \'.',
    '    :   .\'\'\'\'\'\'-.   :',
    '    :  : DONUT  :  :',
    '    :   \'......\'   :',
    '     \'.           .\'',
    '       \'.........\' ',
  ],
};

const THEME_TAGLINES: Record<string, string> = {
  dark:        'DevOps Nabsic Unified Tool',
  light:       'DevOps Nabsic Unified Tool',
  'dark-choco': '90% cacao, no compromise',
  chocolate:   'Fueled by cocoa & caramel',
  strawberry:  'Freshly picked, berry sweet',
  rainbow:     'Sprinkles included, fun guaranteed',
  win95:       'Where do you want to go today?',
  winxp:       'It just works. Like your donut.',
  aqua:        'Think different. Think donut.',
};

// ── Module-private state ──
let _loadEnvVersion = 0;

// ── Modal system ──
export function showModal(opts: ModalOptions): Promise<string | boolean | null> {
  const { title, message, inputPlaceholder, inputValue, confirmLabel, cancelLabel, danger } = opts;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    // Title
    const titleEl = document.createElement('div');
    titleEl.className = 'modal-title' + (danger ? ' danger' : '');
    titleEl.textContent = title || '';
    box.appendChild(titleEl);

    // Message
    if (message) {
      const msgEl = document.createElement('div');
      msgEl.className = 'modal-msg';
      msgEl.textContent = message;
      box.appendChild(msgEl);
    }

    // Input (for prompt-style modals)
    let input: HTMLInputElement | null = null;
    if (inputPlaceholder !== undefined) {
      input = document.createElement('input');
      input.className = 'modal-input';
      input.type = 'text';
      input.placeholder = inputPlaceholder || '';
      input.value = inputValue || '';
      input.autocomplete = 'off';
      box.appendChild(input);
    }

    // Buttons
    const btns = document.createElement('div');
    btns.className = 'modal-btns';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn cancel';
    cancelBtn.textContent = cancelLabel || 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.className = 'modal-btn' + (danger ? ' danger' : ' primary');
    okBtn.textContent = confirmLabel || (danger ? 'Confirm' : 'OK');
    btns.appendChild(cancelBtn);
    btns.appendChild(okBtn);
    box.appendChild(btns);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Focus input or confirm button
    setTimeout(() => { if (input) input.focus(); else okBtn.focus(); }, 50);

    // Enter key submits
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
      if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
    };
    overlay.addEventListener('keydown', onKey);

    function doConfirm(): void {
      overlay.remove();
      resolve(input ? input.value : true);
    }
    function doCancel(): void {
      overlay.remove();
      resolve(input ? null : false);
    }

    okBtn.onclick = doConfirm;
    cancelBtn.onclick = doCancel;
    overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === overlay) doCancel(); });
  });
}

// ── Convenience wrappers ──
export function showConfirm(title: string, msg: string): Promise<string | boolean | null> {
  return showModal({ title, message: msg, danger: true });
}

export function showPrompt(title: string, placeholder: string, defaultValue?: string): Promise<string | boolean | null> {
  return showModal({ title, inputPlaceholder: placeholder, inputValue: defaultValue });
}

// ── Easter egg: falling donuts ──
export function dropDonut(): void {
  const el = document.createElement('div');
  el.className = 'falling-donut';
  el.textContent = '\uD83C\uDF69';
  el.style.left = (Math.random() * (window.innerWidth - 40)) + 'px';
  el.style.animationDuration = (1.5 + Math.random() * 2) + 's';
  el.style.fontSize = (20 + Math.random() * 20) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Open external URLs (for PR links in terminal) ──
export async function openUrl(url: string): Promise<void> {
  try {
    await invoke('open_url', { url });
  } catch {
    window.open(url, '_blank');
  }
}

// ── Theme functions ──
function updateWelcomeArt(themeId: string): void {
  const out = document.getElementById('termOutput');
  if (!out) return;
  // Only update if terminal still has the initial welcome (not cleared or has script output)
  const lines = out.querySelectorAll('.line');
  if (lines.length > 15) return; // terminal has real output, don't touch
  const art = THEME_WELCOME[themeId] || THEME_WELCOME.dark;
  const tag = THEME_TAGLINES[themeId] || THEME_TAGLINES.dark;
  const verStr = document.getElementById('ver')?.textContent || '';
  out.innerHTML = art.map((line: string, i: number) => {
    if (i === 2) return `<div class="line dim">${esc(line)}<span class="sys" id="termVer">DONUT ${verStr}</span></div>`;
    if (i === 3) return `<div class="line dim">${esc(line)}<span class="sys">${esc(tag)}</span></div>`;
    return `<div class="line dim">${esc(line)}</div>`;
  }).join('') + '<div class="line sys"> </div><div class="line sys">Ready. Select a script and click RUN.</div>';
}

function renderThemeList(): void {
  const current = document.body.getAttribute('data-theme') || 'dark';
  const el = document.getElementById('themeList');
  if (!el) return;
  el.innerHTML = THEMES.map((t: ThemeDef) =>
    `<div class="theme-opt${t.id === current ? ' active' : ''}" onclick="setTheme('${t.id}');closeThemeList()">
      <span class="theme-dot dot-${t.id}"></span>${esc(t.label)}
    </div>`
  ).join('');
}

export function setTheme(id: string): void {
  const t = THEMES.find((th: ThemeDef) => th.id === id) || THEMES[0];
  // Smooth transition between themes
  document.body.classList.add('theme-transitioning');
  document.body.setAttribute('data-theme', t.id);
  localStorage.setItem('donut-theme', t.id);
  const label = document.getElementById('themeLabel');
  if (label) label.textContent = t.label;
  const dot = document.getElementById('themeDot');
  if (dot) dot.className = 'theme-dot dot-' + t.id;
  renderThemeList();
  updateWelcomeArt(t.id);
  // Remove transition class after animation completes
  setTimeout(() => document.body.classList.remove('theme-transitioning'), 450);
}

export function toggleThemeList(): void {
  document.getElementById('themeList')?.classList.toggle('open');
}

export function closeThemeList(): void {
  document.getElementById('themeList')?.classList.remove('open');
}

// ── Load environment ──
export async function loadEnv(): Promise<void> {
  S.currentEnv = (document.getElementById('envSel') as HTMLSelectElement)?.value || '';
  if (!S.currentEnv) return;
  const thisVersion = ++_loadEnvVersion;
  localStorage.setItem('donut-env', S.currentEnv);
  try {
    S.envConfig = await invoke<EnvConfig>('get_env', { name: S.currentEnv });
    if (thisVersion !== _loadEnvVersion) return; // Stale -- user switched env while loading
    const token = S.envConfig.azdo?.token || '';
    const proj = S.envConfig.azdo?.project || '';
    const repo = S.envConfig.azdo?.repository || '';
    const sp = S.envConfig.local?.site_path || '';
    const org = S.envConfig.azdo?.organization || '';
    // Cascade: PAT -> projects -> repos -> branches
    if (token) {
      invoke<string[]>('list_azdo_projects', { token, organization: org }).then((p: string[]) => {
        if (thisVersion === _loadEnvVersion) { S.cachedProjects = p; renderConfig(); }
      }).catch(() => {});
      if (proj) {
        invoke<string[]>('list_azdo_repos', { token, project: proj, organization: org }).then((r: string[]) => {
          if (thisVersion === _loadEnvVersion) { S.cachedRepos = r; renderConfig(); }
        }).catch(() => {});
        invoke<WorkItem[]>('search_work_items', { token, project: proj, query: '', organization: org }).then((w: WorkItem[]) => {
          if (thisVersion === _loadEnvVersion) { S.cachedWorkItems = w; }
        }).catch(() => {});
      }
      if (proj && repo) {
        invoke<string[]>('list_azdo_branches', { token, project: proj, repository: repo, organization: org }).then((b: string[]) => {
          if (thisVersion === _loadEnvVersion) { S.cachedBranches = b; renderConfig(); }
        }).catch(() => {});
      }
    }
    if (sp) {
      invoke<string[]>('list_sql_packages', { sitePath: sp, password: S.envConfig.local?.password || null }).then((p: string[]) => {
        if (thisVersion === _loadEnvVersion) { S.cachedPackages = p; renderConfig(); }
      }).catch(() => {});
    }
    renderConfig();
    recalcWorkflow(S.currentEnv);
    renderScripts();
    renderWorkflowBar();
    renderRunBar();
    startHealthPolling();
  } catch (e) {
    console.error('loadEnv failed:', e);
  }
}

// ── Init ──
export async function init(): Promise<void> {
  const [ver, envs] = await Promise.all([
    invoke<VersionInfo>('get_version'),
    invoke<string[]>('list_envs'),
  ]);

  const verStr = 'v' + (ver.version || '?');
  const verEl = document.getElementById('ver');
  if (verEl) verEl.textContent = verStr;
  const termVer = document.getElementById('termVer');
  if (termVer) termVer.textContent = 'DONUT ' + verStr;

  const sel = document.getElementById('envSel') as HTMLSelectElement;
  sel.innerHTML = envs.map((e: string) => `<option value="${esc(e)}">${esc(e)}</option>`).join('');

  // Restore last selected env from localStorage
  const savedEnv = localStorage.getItem('donut-env');
  if (savedEnv && envs.includes(savedEnv)) {
    sel.value = savedEnv;
  }

  // Restore script: favorite first, then last selected
  const favScript = localStorage.getItem('donut-fav');
  const savedScript = localStorage.getItem('donut-script');
  const restoreScript = (favScript && SCRIPTS.find(s => s.id === favScript)) ? favScript : savedScript;
  if (restoreScript && SCRIPTS.find(s => s.id === restoreScript)) {
    S.selectedScript = restoreScript;
  }

  // Splash step 2
  const lsEnv = document.getElementById('ls-env');
  const lsInit = document.getElementById('ls-init');
  if (lsInit) { lsInit.classList.remove('active'); lsInit.classList.add('done'); lsInit.textContent = '\u2713 Initialized'; }
  if (lsEnv) { lsEnv.classList.add('active'); }

  renderScripts();
  renderRunBar();

  if (envs.length) {
    S.currentEnv = sel.value || envs[0];
    await loadEnv();
  }

  // Splash step 3
  if (lsEnv) { lsEnv.classList.remove('active'); lsEnv.classList.add('done'); lsEnv.textContent = '\u2713 Environments loaded'; }
  const lsPrereqs = document.getElementById('ls-prereqs');
  if (lsPrereqs) lsPrereqs.classList.add('active');

  invoke<PrereqCheck[]>('check_prereqs').then(async (prereqs: PrereqCheck[]) => {
    const installCmds: Record<string, string> = {
      'PowerShell 7': 'winget install Microsoft.Powershell',
      '.NET 8': 'winget install Microsoft.DotNet.SDK.8',
      'Git': 'winget install Git.Git',
    };
    window._prereqs = prereqs;
    window._installCmds = installCmds;

    const missing = prereqs.filter(p => !p.ok);
    if (missing.length > 0) {
      // Show install screen instead of proceeding
      if (lsPrereqs) { lsPrereqs.classList.remove('active'); lsPrereqs.classList.add('done'); lsPrereqs.style.color = '#f59e0b'; lsPrereqs.textContent = '\u26A0 Missing prerequisites'; }
      const overlay = document.getElementById('loadingOverlay');
      const sub = document.getElementById('loadingSub');
      if (sub) sub.textContent = 'Some prerequisites are missing';
      const steps = document.getElementById('loadingSteps');
      if (steps) {
        steps.innerHTML = `
          <div class="prereq-install-screen">
            <div style="margin-bottom:12px;font-size:13px;opacity:0.8">The following software is required to run DONUT:</div>
            ${prereqs.map(p => `
              <div class="prereq-row" id="prereq-${p.name.replace(/[\s.]/g, '')}">
                <span class="prereq-led ${p.ok ? 'ok' : 'missing'}"></span>
                <span class="prereq-name">${esc(p.name)}</span>
                <span class="prereq-ver">${p.ok ? esc(p.version || 'installed') : 'not found'}</span>
                ${!p.ok ? `<button class="prereq-install-btn" onclick="installPrereq('${esc(p.name)}')">Install</button>` : ''}
              </div>
            `).join('')}
            <button class="prereq-install-all-btn" onclick="installAllPrereqs()">Install all missing</button>
            <div class="prereq-status" id="prereqStatus"></div>
            <div style="margin-top:16px"><button class="prereq-install-btn" onclick="document.getElementById('loadingOverlay')?.remove()" style="background:transparent;border-color:var(--text-dim);color:var(--text-dim);width:100%;padding:8px">Continue anyway</button></div>
            <div style="margin-top:8px;font-size:11px;opacity:0.5">After installation, close and reopen DONUT for changes to take effect.</div>
          </div>`;
      }
    } else {
      if (lsPrereqs) { lsPrereqs.classList.remove('active'); lsPrereqs.classList.add('done'); lsPrereqs.textContent = '\u2713 Prerequisites OK'; }
      // Remove overlay after prereqs
      setTimeout(() => {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) { overlay.classList.add('hidden'); setTimeout(() => overlay.remove(), 400); }
      }, 300);
    }
    const prereqsEl = document.getElementById('prereqs');
    if (prereqsEl) prereqsEl.innerHTML = '';
  }).catch(() => {});

  // -- Terminal init --
  const termOut = document.getElementById('termOutput');
  if (termOut) {
    if (S.termFontSize !== 12) termOut.style.fontSize = S.termFontSize + 'px';
    if (!S.termWordWrap) termOut.classList.add('nowrap');
  }

  // -- Check for updates in background --
  checkForUpdates();
}

// ── Prerequisite installation ──
export async function installPrereq(name: string): Promise<void> {
  const row = document.getElementById('prereq-' + name.replace(/[\s.]/g, ''));
  const btn = row?.querySelector('.prereq-install-btn') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Installing...'; }
  const status = document.getElementById('prereqStatus');
  if (status) status.textContent = `Installing ${name}... This may take a minute.`;
  try {
    await invoke('install_prereq', { name });
  } catch (e) {
    if (status) status.textContent = `Failed to start installation: ${e}`;
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
  }
}

export async function installAllPrereqs(): Promise<void> {
  const missing = (window._prereqs || []).filter(p => !p.ok);
  for (const p of missing) {
    await installPrereq(p.name);
    // Wait a bit between installs to avoid winget conflicts
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ── Self-update ──
export async function checkForUpdates(): Promise<void> {
  try {
    const info = await invoke<UpdateInfo>('check_for_updates');
    const btn = document.getElementById('updateBtn');
    if (!btn) return;
    if (info.available) {
      btn.classList.add('available');
      btn.title = `Mise à jour disponible : v${info.latest_version}`;
      btn.dataset.url = info.download_url;
      btn.dataset.version = info.latest_version;
      btn.dataset.notes = info.release_notes;
    } else {
      btn.classList.remove('available');
      btn.title = 'Aucune mise à jour';
    }
  } catch {
    // Silently ignore update check failures
  }
}

export async function applyUpdate(): Promise<void> {
  const btn = document.getElementById('updateBtn');
  if (!btn?.classList.contains('available')) {
    toast('Aucune mise à jour disponible.', 'info');
    return;
  }
  const url = btn.dataset.url;
  const version = btn.dataset.version || '?';
  if (!url) return;

  const ok = await showConfirm(
    `Mettre à jour vers v${version} ?`,
    'DONUT va se fermer, se mettre à jour, puis redémarrer automatiquement.'
  );
  if (!ok) return;

  try {
    toast('Téléchargement de la mise à jour...', 'info');
    await invoke('apply_update', { downloadUrl: url });
  } catch (e) {
    toast(`Échec de la mise à jour : ${e}`, 'error');
  }
}

// ── Setup all event listeners ──
export function setupEventListeners(): void {
  // -- Prereq install event listener --
  listen('prereq-event', (event: { payload: { name: string; status: string; message?: string } }) => {
    const data = event.payload;
    const row = document.getElementById('prereq-' + data.name.replace(/[\s.]/g, ''));
    const status = document.getElementById('prereqStatus');
    if (data.status === 'done') {
      if (row) {
        const led = row.querySelector('.prereq-led');
        if (led) { led.className = 'prereq-led ok'; }
        const ver = row.querySelector('.prereq-ver');
        if (ver) ver.textContent = 'installed';
        const btn = row.querySelector('.prereq-install-btn');
        if (btn) btn.remove();
      }
      if (status) status.textContent = `${data.name} installed successfully. Restart DONUT to apply.`;
    } else if (data.status === 'error') {
      if (row) {
        const btn = row.querySelector('.prereq-install-btn') as HTMLButtonElement | null;
        if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
      }
      if (status) status.textContent = `${data.name} installation failed: ${data.message || 'unknown error'}`;
    }
  });

  // -- Script event listener --
  listen('script-event', (event: { payload: ScriptEvent }) => {
    const msg = event.payload;
    if (msg.type === 'log') appendLog(msg.text || '', 'info');
    if (msg.type === 'error') appendLog(msg.text || '', 'info'); // let auto-detection handle color (stderr is not always an error)
    if (msg.type === 'run-start') {
      S.isRunning = true;
      S._lastRunScript = msg.script || null;
      S._termFirstLogTime = Date.now();
      // Reset terminal-private state
      resetTerminalState();
      // Clear terminal on new run
      const _out = document.getElementById('termOutput');
      if (_out) _out.innerHTML = '';
      closeDiffBlock();
      const _errBar = document.getElementById('termErrorBar') as HTMLElement | null;
      if (_errBar) _errBar.style.display = 'none';
      const _mm = document.getElementById('termMinimap');
      if (_mm) _mm.innerHTML = '';
      const _diffSum = document.getElementById('diffSummaryBar');
      if (_diffSum) _diffSum.remove();
      const _diffNav = document.getElementById('diffNav') as HTMLElement | null;
      if (_diffNav) _diffNav.style.display = 'none';
      S.lastRunResult = null;
      setIndicator('running');
      const termScript = document.getElementById('termScript');
      if (termScript) termScript.textContent = msg.script || '';
      const termStep = document.getElementById('termStep');
      if (termStep) termStep.textContent = '';
      showStopBtn(true);
      hideRerunBtn();
      startSpinner();
      startRunTimer();
      startPatienceMessages();
      startProgress(msg.script || '');
      expandTerminal(true);
      renderRunBar();
    }
    if (msg.type === 'run-end') {
      closeDiffBlock();
      S.isRunning = false;
      const ok = msg.code === 0;
      const duration = stopRunTimer();
      const scriptName = SCRIPTS.find(x => x.id === msg.script)?.name || msg.script || '';
      S.lastRunResult = { ok, script: scriptName, duration };
      stopPatienceMessages();
      stopProgress();
      setIndicator(ok ? 'success' : 'error');
      showStopBtn(false);
      stopSpinner();
      const termStep = document.getElementById('termStep');
      if (termStep) termStep.textContent = '';
      expandTerminal(false);
      const tm = getThemeMsgs();
      const endMsg = ok ? pickRandom(tm.success) : pickRandom(tm.fail);
      // End banner
      const endCls = ok ? 'run-end-ok' : 'run-end-fail';
      const endIcon = ok ? '\u2714' : '\u2718';
      const endLabel = ok ? 'SUCCESS' : `FAILED (exit ${msg.code})`;
      const out = document.getElementById('termOutput');
      if (out) {
        out.insertAdjacentHTML('beforeend',
          `<div class="run-end-banner ${endCls}">` +
          `<span class="run-end-icon">${endIcon}</span>` +
          `<span class="run-end-info"><strong>${esc(scriptName)}</strong> — ${endLabel} in ${esc(duration)}</span>` +
          `<span class="run-end-msg">${esc(endMsg)}</span>` +
          `</div>`);
        out.scrollTop = out.scrollHeight;
      }
      // Show PR link button after successful commit
      if (ok && msg.script === 'commit') { showPRLink(); }
      // Show re-run button on failure
      if (!ok) showRerunBtn();
      renderRunBar();
      renderScripts();
      // Save to history & advance workflow
      addRunHistory(msg.script || '', ok, duration);
      advanceWorkflow(S.currentEnv, msg.script || '', ok);
      renderWorkflowBar();
      // System notification when not focused OR long-running script
      const elapsed = S.runStartTime ? Date.now() - S.runStartTime : 0;
      if (!document.hasFocus() || elapsed > 30000) {
        if (!document.hasFocus()) {
          const orig = document.title;
          document.title = ok ? 'DONUT - Done!' : 'DONUT - Failed!';
          window.addEventListener('focus', () => { document.title = orig; }, { once: true });
        }
        if ('Notification' in window && Notification.permission === 'granted') {
          const scriptName = SCRIPTS.find(s => s.id === msg.script)?.name || msg.script;
          const notifBody = ok
            ? `${scriptName} completed in ${duration}`
            : `${scriptName} failed after ${duration} (exit code ${msg.code})`;
          new Notification(ok ? '\u2705 DONUT' : '\u274C DONUT', { body: notifBody });
        }
      }
      // Auto-refresh DevOps data after scripts that change remote state
      const devopsScripts = ['commit', 'merge', 'pull-force', 'pull', 'reset', 'rollback'];
      if (devopsScripts.includes(msg.script || '')) {
        setTimeout(() => { renderDevops(); }, 3000);
      }
    }
  });

  // -- Keyboard navigation --
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // Ctrl+F to focus terminal search
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      document.getElementById('termSearch')?.focus();
      return;
    }
    // F8 / Shift+F8 navigate errors
    if (e.key === 'F8') {
      e.preventDefault();
      navigateErrors(e.shiftKey ? -1 : 1);
      return;
    }
    // Ctrl+Plus / Ctrl+Minus terminal font size
    if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      setTermFontSize(S.termFontSize + 1);
      return;
    }
    if (e.ctrlKey && e.key === '-') {
      e.preventDefault();
      setTermFontSize(S.termFontSize - 1);
      return;
    }

    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
    if (S.isRunning) return;

    // Number keys 1-9, 0=10 to select scripts
    const num = e.key === '0' ? 10 : parseInt(e.key);
    if (num >= 1 && num <= SCRIPTS.length) {
      e.preventDefault();
      selectScript(SCRIPTS[num - 1].id);
      return;
    }

    const cols = 2;
    const curIdx = S.selectedScript ? SCRIPTS.findIndex(s => s.id === S.selectedScript) : -1;

    switch (e.key) {
      case 'ArrowRight': {
        e.preventDefault();
        const next = curIdx < 0 ? 0 : Math.min(curIdx + 1, SCRIPTS.length - 1);
        selectScript(SCRIPTS[next].id);
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const prev = curIdx < 0 ? 0 : Math.max(curIdx - 1, 0);
        selectScript(SCRIPTS[prev].id);
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        const down = curIdx < 0 ? 0 : Math.min(curIdx + cols, SCRIPTS.length - 1);
        selectScript(SCRIPTS[down].id);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const up = curIdx < 0 ? 0 : Math.max(curIdx - cols, 0);
        selectScript(SCRIPTS[up].id);
        break;
      }
      case 'Enter': {
        if (S.selectedScript) {
          e.preventDefault();
          const s = SCRIPTS.find(x => x.id === S.selectedScript);
          if (s?.needsMsg) {
            const input = document.getElementById('commitMsg');
            if (input) input.focus();
            else doRun();
          } else {
            doRun();
          }
        }
        break;
      }
    }
  });

  // -- Ctrl+Enter to run --
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter' && S.selectedScript && !S.isRunning) {
      e.preventDefault();
      doRun();
    }
  });

  // -- Theme picker close on outside click --
  document.addEventListener('click', (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.theme-picker')) closeThemeList();
  });

  // -- Timeout: remove overlay after 8s no matter what --
  setTimeout(() => {
    const o = document.getElementById('loadingOverlay');
    if (o) { o.classList.add('hidden'); setTimeout(() => o.remove(), 400); }
  }, 8000);
}
