// ═══════════════════════════════════════════════════════════════════
// config/setup-wizard.ts — Guided setup wizard for new environments
// ═══════════════════════════════════════════════════════════════════

import { S, esc, toast, invoke, azdoInvoke } from '../state';
import { renderConfig } from '../config';
// Install site uses invoke directly — no need for the separate showInstallWizard

// ── State ──
interface WizState {
  step: number;
  org: string;
  pat: string;
  patValid: boolean;
  projects: string[];
  project: string;
  repos: string[];
  repo: string;
  repoMeta: string;
  branches: string[];
  featureBranch: string;
  targetBranch: string;
  workitemId: string;
  workitemTitle: string;
  sitePath: string;
  siteUser: string;
  sitePassword: string;
  devPassword: string;
  dbUser: string;
  dbPassword: string;
  parentSite: string;
  version: string;
  packages: string[];
  availablePackages: string[];
  detectedSites: { path: string; name: string; instance: string }[];
  envName: string;
  loading: boolean;
  // Install sub-flow
  installMode: boolean;
  installStep: number; // 0=select ENA, 1=select instance+name
  enaPath: string;
  instances: { path: string; name: string; has_wiz_manager: boolean }[];
  installInstancePath: string;
  installSiteName: string;
}

const STEPS = [
  { title: 'Connection', icon: '1' },
  { title: 'Project & Repository', icon: '2' },
  { title: 'Local Site', icon: '3' },
  { title: 'Work Item & Branches', icon: '4' },
  { title: 'Packages & Review', icon: '5' },
];

let ws: WizState;
let wizEl: HTMLElement | null = null;

function defaults(): WizState {
  return {
    step: 0, org: '', pat: '', patValid: false,
    projects: [], project: '', repos: [], repo: '', repoMeta: 'Test.Package.Metadata.GitObjectDB',
    branches: [], featureBranch: '', targetBranch: 'master',
    workitemId: '', workitemTitle: '',
    sitePath: '', siteUser: 'adminci', sitePassword: 'enablon', devPassword: '', dbUser: 'sa', dbPassword: 'enablon',
    parentSite: '', version: '', packages: [], availablePackages: [],
    detectedSites: [], envName: '', loading: false,
    installMode: false, installStep: 0, enaPath: '', instances: [], installInstancePath: '', installSiteName: '',
  };
}

// ── Helpers ──
function tip(text: string): string {
  return `<span class="cfg-tip" title="${esc(text)}">?</span>`;
}

let _pwdCounter = 0;
function pwdField(label: string, value: string, field: string, placeholder = '', tooltip = ''): string {
  const id = `sw-pwd-${++_pwdCounter}`;
  return `<div class="swiz-field"><label>${label}${tooltip ? tip(tooltip) : ''}</label><div class="swiz-input-row"><input autocomplete="off"id="${id}" type="password" value="${esc(value)}" placeholder="${esc(placeholder)}" oninput="swizUpdate('${field}', this.value)"><button type="button" class="swiz-eye-btn" onclick="const i=document.getElementById('${id}');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'\uD83D\uDC41':'\u2715'" title="Show/hide">\uD83D\uDC41</button></div></div>`;
}

// ── Public API ──

export function openSetupWizard(): void {
  // Clean up any leftover wizard
  if (wizEl) { wizEl.remove(); wizEl = null; }
  document.querySelector('.swiz-overlay')?.remove();
  _pwdCounter = 0;
  ws = defaults();
  // Pre-fill from existing config if available
  if (S.envConfig?.azdo?.organization) ws.org = S.envConfig.azdo.organization;
  if (S.envConfig?.azdo?.token) ws.pat = S.envConfig.azdo.token;
  renderWizard();
}

export function closeSetupWizard(): void {
  if (wizEl) { wizEl.remove(); wizEl = null; }
  // Also clean up any orphaned overlay
  document.querySelector('.swiz-overlay')?.remove();
}

// ── Render ──

function renderWizard(): void {
  // First render: create the full structure
  if (!wizEl) {
    wizEl = document.createElement('div');
    wizEl.className = 'swiz-overlay';
    document.body.appendChild(wizEl);
    wizEl.innerHTML = `
      <div class="swiz-modal">
        <div class="swiz-header">
          <span class="swiz-title">New Environment</span>
          <div class="swiz-steps" id="swizSteps"></div>
          <button class="swiz-close" onclick="closeSetupWizard()">&times;</button>
        </div>
        <div class="swiz-body" id="swizBody"></div>
        <div class="swiz-footer">
          <button class="swiz-btn secondary" onclick="closeSetupWizard()">Cancel</button>
          <div class="swiz-footer-right" id="swizFooterRight"></div>
        </div>
      </div>`;
  }
  // Partial update: only refresh steps, body, and footer buttons
  refreshWizardParts();
}

function refreshWizardParts(): void {
  const step = ws.step;
  const canBack = step > 0;
  const canNext = canAdvance();
  const isLast = step === STEPS.length - 1;

  const stepsEl = document.getElementById('swizSteps');
  if (stepsEl) {
    stepsEl.innerHTML = STEPS.map((s, i) => {
      const cls = i < step ? 'done' : i === step ? 'active' : '';
      const icon = i < step ? '\u2713' : s.icon;
      const label = i === step ? ` ${s.title}` : '';
      return `<div class="swiz-step-pill ${cls}"><span class="swiz-step-num">${icon}</span>${label}</div>`;
    }).join('');
  }

  const bodyEl = document.getElementById('swizBody');
  if (bodyEl) bodyEl.innerHTML = renderStep(step);

  const footerEl = document.getElementById('swizFooterRight');
  if (footerEl) {
    footerEl.innerHTML =
      (canBack ? '<button class="swiz-btn secondary" onclick="swizPrev()">\u2190 Back</button>' : '') +
      (isLast
        ? `<button class="swiz-btn primary" onclick="swizCreate()" ${canNext ? '' : 'disabled'}>Create Environment</button>`
        : `<button class="swiz-btn primary" onclick="swizNext()" ${canNext ? '' : 'disabled'}>Next \u2192</button>`);
  }
}

function renderStep(step: number): string {
  switch (step) {
    case 0: return renderStep0();
    case 1: return renderStep1();
    case 2: return renderStep2();
    case 3: return renderStep3();
    case 4: return renderStep4();
    default: return '';
  }
}

// ── Step 0: Connection ──
function renderStep0(): string {
  return `
    <div class="swiz-section">
      <h3>Azure DevOps Connection</h3>
      <p class="swiz-hint">Enter your Azure DevOps organization and Personal Access Token to get started.</p>
      <div class="swiz-fields">
        <div class="swiz-field">
          <label>Organization${tip('Azure DevOps organization name — appears in the URL: dev.azure.com/{organization}')}</label>
          <input autocomplete="off"id="sw-org" type="text" value="${esc(ws.org)}" placeholder="e.g. enablon" oninput="swizUpdate('org', this.value)">
          <span class="swiz-help">The name in dev.azure.com/<strong>your-org</strong></span>
        </div>
        <div class="swiz-field">
          <label>Personal Access Token (PAT)${tip('Create one at Azure DevOps > User Settings > Personal Access Tokens. Required scopes: Code (Read & Write), Work Items (Read & Write)')}</label>
          <div class="swiz-input-row">
            <input autocomplete="off" id="sw-pat" type="password" value="${esc(ws.pat)}" placeholder="Paste your PAT here" oninput="swizUpdate('pat', this.value)">
            <button type="button" class="swiz-eye-btn" onclick="const i=document.getElementById('sw-pat');i.type=i.type==='password'?'text':'password'" title="Show/hide">\uD83D\uDC41</button>
          </div>
          ${ws.patValid
            ? `<span class="swiz-ok">\u2713 PAT valid — ${ws.projects.length} projects loaded</span>`
            : ''
          }
        </div>
      </div>
      ${!ws.patValid ? `<div class="swiz-pat-actions">
        <button class="swiz-action-btn" onclick="swizTestPat()" ${ws.org && ws.pat ? '' : 'disabled'}>${ws.loading ? 'Connecting...' : '\u2192 Test connection'}</button>
        <button class="swiz-action-btn" onclick="openUrl('https://dev.azure.com/${esc(ws.org || '_')}/_usersSettings/tokens')">Create a PAT \u2197</button>
      </div>` : ''}
    </div>`;
}

// ── Step 1: Project & Repository ──
function renderStep1(): string {
  const repoFiltered = ws.repos;
  return `
    <div class="swiz-section">
      <h3>Project & Repository</h3>
      <p class="swiz-hint">Select your Azure DevOps project and the repository you'll work on.</p>
      <div class="swiz-fields">
        <div class="swiz-field">
          <label>Project${tip('The Azure DevOps project containing your repositories')}</label>
          <select id="sw-proj" onchange="swizSelectProject(this.value)">
            <option value="">— select —</option>
            ${ws.projects.map(p => `<option value="${esc(p)}" ${p === ws.project ? 'selected' : ''}>${esc(p)}</option>`).join('')}
          </select>
        </div>
        <div class="swiz-field">
          <label>Repository${tip('The Package.* repository you will commit changes to')}</label>
          <select id="sw-repo" onchange="swizSelectRepo(this.value)" ${ws.project ? '' : 'disabled'}>
            ${ws.project ? '<option value="">— select —</option>' : '<option value="">Select a project first</option>'}
            ${repoFiltered.map(r => `<option value="${esc(r)}" ${r === ws.repo ? 'selected' : ''}>${esc(r)}</option>`).join('')}
          </select>
          ${ws.repos.length ? `<span class="swiz-help">${ws.repos.length} repositories available</span>` : ''}
        </div>
        <div class="swiz-field">
          <label>Metadata Repository${tip('Repository containing the metadata/version database (git4inno). Default: Test.Package.Metadata.GitObjectDB')}</label>
          <input autocomplete="off"id="sw-repometa" type="text" value="${esc(ws.repoMeta)}" oninput="swizUpdate('repoMeta', this.value)" ${ws.repo ? '' : 'disabled'}>
          <span class="swiz-help">Default: Test.Package.Metadata.GitObjectDB</span>
        </div>
      </div>
    </div>`;
}

// ── Step 2: Local Site ──
function renderStep2(): string {
  // If in install mode, render the install sub-flow
  if (ws.installMode) return renderInstallSubStep();

  const hasSites = ws.detectedSites.length > 0;
  // Parse version from sitePath
  const verMatch = ws.sitePath.match(/(\d+\.\d+)/);
  const ver = verMatch ? verMatch[1] : ws.version;

  return `
    <div class="swiz-section">
      <h3>Local Site</h3>
      <p class="swiz-hint">Select an existing site, browse to one, or install a new one from an .ENA archive.</p>
      <div class="swiz-choices">
        <button class="swiz-action-btn" onclick="swizDetectSites()">${ws.loading ? 'Scanning...' : 'Detect existing sites'}</button>
        <button class="swiz-action-btn swiz-install-btn" onclick="swizInstallSite()">+ Install new site from .ENA</button>
      </div>
      ${hasSites ? `
        <div class="swiz-sites">
          <label>Detected sites</label>
          <div class="swiz-site-list">
            ${ws.detectedSites.map(s => `
              <div class="swiz-site-item ${s.path === ws.sitePath ? 'selected' : ''}" onclick="swizPickSite('${esc(s.path).replace(/\\/g, '\\\\')}')">
                <span class="swiz-site-name">${esc(s.name)}</span>
                <span class="swiz-site-path">${esc(s.instance)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      <div class="swiz-fields">
        <div class="swiz-field full">
          <label>Site Path${tip('Full path to the local IIS site (e.g. C:\\Enablon\\Instance1013\\Sites\\WizRisk.10.13)')}</label>
          <div class="swiz-input-row">
            <input autocomplete="off"id="sw-sitepath" type="text" value="${esc(ws.sitePath)}" placeholder="C:\\Enablon\\Instance1013\\Sites\\WizRisk.10.13" oninput="swizUpdateSitePath(this.value)">
            <button class="swiz-action-btn" onclick="swizBrowseSite()">Browse</button>
          </div>
        </div>
        <div class="swiz-field">
          <label>Version${tip('Platform version — auto-detected from WizManager.exe binary')}</label>
          <div class="swiz-chips-row">
            ${['10.7', '10.11', '10.13', '10.14'].map(v => `<button class="swiz-chip ${ver === v ? 'active' : ''}" onclick="swizSetVersion('${v}')">${v}</button>`).join('')}
          </div>
        </div>
        <div class="swiz-field">
          <label>Parent Site${tip('Parent site used to download master packages. Local: relative path (e.g. /WizRisk.10.13). Remote: full URL')}</label>
          <input autocomplete="off"type="text" value="${esc(ws.parentSite)}" placeholder="https://inno.dev.enablon.io/${ver || '10.13'}/WizRisk.${ver || '10.13'}/" oninput="swizUpdate('parentSite', this.value)">
        </div>
      </div>
      <div class="swiz-fields">
        <div class="swiz-field"><label>Site User${tip('Site admin username (default: adminci)')}</label><input autocomplete="off"type="text" value="${esc(ws.siteUser)}" oninput="swizUpdate('siteUser', this.value)"></div>
        ${pwdField('Site Password', ws.sitePassword, 'sitePassword', '', 'Site admin password (default: enablon)')}
        <div class="swiz-field"><label>DB User${tip('SQL Server login (default: sa)')}</label><input autocomplete="off"type="text" value="${esc(ws.dbUser)}" oninput="swizUpdate('dbUser', this.value)"></div>
        ${pwdField('DB Password', ws.dbPassword, 'dbPassword', '', 'SQL Server password for DB user (default: enablon)')}
      </div>
      <div class="swiz-section" style="margin-top:12px">
        <h3>Packages</h3>
        <p class="swiz-hint">Select the packages you'll work on. ${!ws.availablePackages.length && ws.sitePath ? 'Click to load from the site database.' : ''}</p>
        ${ws.availablePackages.length > 0 ? `
          <div class="swiz-pkg-grid">
            ${ws.availablePackages.map(p => `<label class="swiz-pkg ${ws.packages.includes(p) ? 'selected' : ''}" onclick="swizTogglePkg('${esc(p)}')"><span>${esc(p)}</span></label>`).join('')}
          </div>
        ` : `<button class="swiz-action-btn" onclick="swizLoadPackages()" ${ws.sitePath ? '' : 'disabled'}>${ws.loading ? 'Loading...' : 'Load packages from DB'}</button>`}
      </div>
    </div>`;
}

// ── Step 3: Work Item & Branches ──
function renderStep3(): string {
  return `
    <div class="swiz-section">
      <h3>Work Item & Branches</h3>
      <p class="swiz-hint">Link a work item to auto-generate your branch name, then set target branch.</p>
      <div class="swiz-fields">
        <div class="swiz-field full">
          <label>Work Item (optional)${tip('Link a User Story or Bug to auto-generate the feature branch name')}</label>
          <div class="swiz-input-row">
            <input autocomplete="off"id="sw-wi" type="text" value="${esc(ws.workitemId ? '#' + ws.workitemId + (ws.workitemTitle ? ' — ' + ws.workitemTitle : '') : '')}" placeholder="Search by ID or title..." oninput="swizSearchWI(this.value)">
            <button class="swiz-action-btn" onclick="swizLoadMyWI()">@me</button>
          </div>
          <div id="sw-wi-results" class="swiz-wi-results" style="display:none"></div>
        </div>
        <div class="swiz-field">
          <label>Target Branch${tip('The branch your feature will be merged into (e.g. master, main, fix/...)')}</label>
          <select onchange="swizUpdate('targetBranch', this.value)">
            ${ws.branches.map(b => `<option value="${esc(b)}" ${b === ws.targetBranch ? 'selected' : ''}>${esc(b)}</option>`).join('')}
            ${ws.branches.length === 0 ? '<option value="master" selected>master</option>' : ''}
          </select>
        </div>
        <div class="swiz-field">
          <label>Feature Branch${tip('Your working branch where changes are committed. Auto-generated from work item if selected')}</label>
          <input autocomplete="off"type="text" value="${esc(ws.featureBranch)}" placeholder="feature/PHE/BUG-123-description" oninput="swizUpdate('featureBranch', this.value)">
          <span class="swiz-help">${ws.featureBranch && !ws.branches.includes(ws.featureBranch) ? '\u26A0 Branch will be created' : ws.featureBranch ? '\u2713 Branch exists' : 'Auto-generated from work item'}</span>
        </div>
      </div>
    </div>`;
}

// ── Install site (inline sub-flow) ──

function renderInstallSubStep(): string {
  if (ws.installStep === 0) {
    // Step A: Select .ENA file
    return `
      <div class="swiz-section">
        <h3>Install New Site</h3>
        <p class="swiz-hint">Select the .ENA archive to install on your machine.</p>
        <div class="swiz-field full">
          <label>.ENA Archive</label>
          <div class="swiz-input-row">
            <input autocomplete="off"type="text" value="${esc(ws.enaPath)}" placeholder="Click Browse to select an .ENA file..." readonly>
            <button class="swiz-action-btn" onclick="swizBrowseEna()">Browse</button>
          </div>
          ${ws.enaPath ? `<span class="swiz-ok">\u2713 ${esc(ws.enaPath.split('\\\\').pop() || ws.enaPath.split('\\').pop() || ws.enaPath)}</span>` : ''}
        </div>
        <div class="swiz-choices" style="margin-top:12px">
          <button class="swiz-btn secondary" onclick="swizInstallBack()">\u2190 Back to site selection</button>
          <button class="swiz-btn primary" onclick="swizInstallNext()" ${ws.enaPath ? '' : 'disabled'}>Next \u2192</button>
        </div>
      </div>`;
  } else {
    // Step B: Select instance + site name
    const computed = ws.installInstancePath && ws.installSiteName ? `${ws.installInstancePath}\\Sites\\${ws.installSiteName}` : '';
    let instanceHtml = '';
    if (ws.instances.length > 0) {
      instanceHtml = `<select onchange="swizUpdate('installInstancePath', this.value)">
        ${ws.instances.map(i => `<option value="${esc(i.path)}" ${i.path === ws.installInstancePath ? 'selected' : ''}>${esc(i.name)}${i.has_wiz_manager ? '' : ' (no WizManager)'} \u2014 ${esc(i.path)}</option>`).join('')}
      </select>`;
    } else {
      instanceHtml = `<input autocomplete="off"type="text" value="${esc(ws.installInstancePath)}" placeholder="C:\\Enablon\\Instance" oninput="swizUpdate('installInstancePath', this.value)">`;
    }

    return `
      <div class="swiz-section">
        <h3>Install New Site</h3>
        <p class="swiz-hint">Choose the Enablon instance and site name for the installation.</p>
        <div class="swiz-fields">
          <div class="swiz-field full">
            <label>Enablon Instance</label>
            ${instanceHtml}
          </div>
          <div class="swiz-field">
            <label>Site Name</label>
            <input autocomplete="off"type="text" value="${esc(ws.installSiteName)}" placeholder="WizRisk.10.13" oninput="swizUpdate('installSiteName', this.value)">
          </div>
          <div class="swiz-field">
            <label>Target Path</label>
            <span class="swiz-help" style="font-size:11px; padding-top:10px">${computed ? esc(computed) : 'Select instance and enter site name'}</span>
          </div>
        </div>
        <div class="swiz-choices" style="margin-top:12px">
          <button class="swiz-btn secondary" onclick="swizInstallStepBack()">\u2190 Back</button>
          <button class="swiz-btn primary" onclick="swizDoInstall()" ${computed ? '' : 'disabled'}>Install & Continue</button>
        </div>
      </div>`;
  }
}

export function swizInstallSite(): void {
  ws.installMode = true;
  ws.installStep = 0;
  ws.enaPath = '';
  // Reuse already-scanned instances if available
  if (ws.instances.length === 0 && ws.detectedSites.length > 0) {
    // Already have site data, instances might not be stored — re-scan
    invoke<{ path: string; name: string; has_wiz_manager: boolean }[]>('scan_enablon_instances')
      .then(inst => { ws.instances = inst; if (inst.length > 0 && !ws.installInstancePath) ws.installInstancePath = inst[0].path; refreshWizardParts(); })
      .catch(() => {});
  }
  refreshWizardParts();
}

export async function swizBrowseEna(): Promise<void> {
  try {
    const path = await invoke<string | null>('browse_file', { defaultPath: null, filter: 'ENA files (*.ena)|*.ena|All files (*.*)|*.*' });
    if (path) { ws.enaPath = path; refreshWizardParts(); }
  } catch { /* cancelled */ }
}

export function swizInstallNext(): void {
  ws.installStep = 1;
  // Scan instances if not done
  if (ws.instances.length === 0) {
    invoke<{ path: string; name: string; has_wiz_manager: boolean }[]>('scan_enablon_instances')
      .then(inst => { ws.instances = inst; if (inst.length > 0 && !ws.installInstancePath) ws.installInstancePath = inst[0].path; refreshWizardParts(); })
      .catch(() => {});
  }
  refreshWizardParts();
}

export function swizInstallStepBack(): void {
  ws.installStep = 0;
  refreshWizardParts();
}

export function swizInstallBack(): void {
  ws.installMode = false;
  refreshWizardParts();
}

export async function swizDoInstall(): Promise<void> {
  if (!ws.enaPath || !ws.installInstancePath || !ws.installSiteName) return;
  const sitePath = `${ws.installInstancePath}\\Sites\\${ws.installSiteName}`;
  // Close the install sub-flow and set the site path
  ws.installMode = false;
  ws.sitePath = sitePath;
  swizUpdateSitePath(sitePath);
  toast('Site path set to: ' + sitePath + ' — run Install Site script after wizard completes', 'info');
  // Store the ENA path for later use by the install-site script
  (window as any)._pendingEnaPath = ws.enaPath;
  (window as any)._pendingInstallSitePath = sitePath;
  refreshWizardParts();
}

// ── Step 4: Review ──
function renderStep4(): string {
  const siteId = ws.sitePath.replace(/\\/g, '/').split('/').pop() || '';
  const ok = (v: string) => v ? `<span class="swiz-rv-ok">\u2713</span>` : `<span class="swiz-rv-miss">\u2717</span>`;

  return `
    <div class="swiz-section">
      <h3>Review & Create</h3>
      <p class="swiz-hint">Verify your configuration and give your environment a name.</p>
      <div class="swiz-field" style="margin-bottom:16px">
        <label>Environment Name</label>
        <input autocomplete="off"id="sw-envname" type="text" value="${esc(ws.envName || siteId)}" placeholder="e.g. WizRisk.10.13" oninput="swizUpdate('envName', this.value)">
        <span class="swiz-help">Will be saved as: <strong>.env-${esc(ws.envName || siteId || '...')}.json</strong></span>
      </div>
      <div class="swiz-rv-card">
        <div class="swiz-rv-section">
          <div class="swiz-rv-title">Azure DevOps</div>
          <div class="swiz-rv-grid">
            <div class="swiz-rv-item">${ok(ws.org)}<span class="swiz-rv-label">Organization</span><span class="swiz-rv-val">${esc(ws.org)}</span></div>
            <div class="swiz-rv-item">${ok(ws.project)}<span class="swiz-rv-label">Project</span><span class="swiz-rv-val">${esc(ws.project)}</span></div>
            <div class="swiz-rv-item">${ok(ws.repo)}<span class="swiz-rv-label">Repository</span><span class="swiz-rv-val">${esc(ws.repo)}</span></div>
          </div>
        </div>
        <div class="swiz-rv-section">
          <div class="swiz-rv-title">Local Site</div>
          <div class="swiz-rv-grid">
            <div class="swiz-rv-item full">${ok(ws.sitePath)}<span class="swiz-rv-label">Path</span><span class="swiz-rv-val">${esc(ws.sitePath)}</span></div>
            <div class="swiz-rv-item">${ok(ws.siteUser)}<span class="swiz-rv-label">User</span><span class="swiz-rv-val">${esc(ws.siteUser)}</span></div>
            <div class="swiz-rv-item">${ok(ws.version)}<span class="swiz-rv-label">Version</span><span class="swiz-rv-val">${esc(ws.version || 'auto')}</span></div>
          </div>
        </div>
        <div class="swiz-rv-section">
          <div class="swiz-rv-title">Branches</div>
          <div class="swiz-rv-grid">
            <div class="swiz-rv-item full">${ok(ws.featureBranch)}<span class="swiz-rv-label">Feature</span><span class="swiz-rv-val">${esc(ws.featureBranch)}</span></div>
            <div class="swiz-rv-item">${ok(ws.targetBranch)}<span class="swiz-rv-label">Target</span><span class="swiz-rv-val">${esc(ws.targetBranch)}</span></div>
            ${ws.workitemId ? `<div class="swiz-rv-item"><span class="swiz-rv-ok">\u2713</span><span class="swiz-rv-label">Work Item</span><span class="swiz-rv-val">#${esc(ws.workitemId)}</span></div>` : ''}
          </div>
        </div>
        ${ws.packages.length > 0 ? `
        <div class="swiz-rv-section">
          <div class="swiz-rv-title">Packages <span class="swiz-rv-count">${ws.packages.length}</span></div>
          <div class="swiz-rv-chips">${ws.packages.map(p => `<span class="swiz-rv-chip">${esc(p)}</span>`).join('')}</div>
        </div>` : ''}
      </div>
    </div>`;
}

// ── Navigation ──

function canAdvance(): boolean {
  switch (ws.step) {
    case 0: return ws.patValid;
    case 1: return !!ws.project && !!ws.repo;
    case 2: return !!ws.sitePath;
    case 3: return !!ws.featureBranch && !!ws.targetBranch;
    case 4: return !!(ws.envName || ws.sitePath);
    default: return false;
  }
}

export function swizNext(): void {
  if (!canAdvance()) return;
  ws.step++;
  // Auto-actions on entering a step
  if (ws.step === 2 && ws.detectedSites.length === 0) swizDetectSites();
  if (ws.step === 3 && ws.branches.length === 0 && ws.repo) swizLoadBranches();
  renderWizard();
}

export function swizPrev(): void {
  if (ws.step > 0) { ws.step--; renderWizard(); }
}

// ── Field updates ──

export function swizUpdate(field: string, value: string): void {
  (ws as any)[field] = value;
  // Don't re-render the whole wizard on every keystroke — just update button states
  updateButtons();
}

function updateButtons(): void {
  const nextBtn = wizEl?.querySelector('.swiz-footer-right .primary') as HTMLButtonElement | null;
  if (nextBtn) nextBtn.disabled = !canAdvance();
}

export function swizUpdateSitePath(value: string): void {
  ws.sitePath = value;
  const normalized = value.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/');
  const siteId = parts.pop() || '';
  const sitesIdx = parts.findIndex(p => p.toLowerCase() === 'sites');
  const instancePath = sitesIdx > 0 ? parts.slice(0, sitesIdx).join('\\') : '';

  // Helper to build parent site URL from version + siteId
  const buildParentSite = (ver: string) => `https://inno.dev.enablon.io/${ver}/${siteId}/`;

  // Read version from instance WizManager.exe binary
  if (instancePath) {
    invoke<string | null>('get_as_version', { instancePath }).then(ver => {
      if (ver) {
        const m = ver.match(/^(\d+\.\d+)/);
        if (m) {
          ws.version = m[1];
          ws.parentSite = buildParentSite(ws.version);
          refreshWizardParts();
        }
      }
    }).catch(() => {});
  }

  // Fallback: try regex from path if no instance detected
  if (!instancePath) {
    const m = value.match(/(\d+\.\d+)/);
    if (m) {
      ws.version = m[1];
      ws.parentSite = buildParentSite(ws.version);
    }
  }
  updateButtons();
}

export function swizSetVersion(v: string): void {
  ws.version = v;
  const siteId = ws.sitePath.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || '';
  ws.parentSite = `https://inno.dev.enablon.io/${v}/${siteId || 'WizRisk.' + v}/`;
  refreshWizardParts();
}

// ── Azure DevOps actions ──

export async function swizTestPat(): Promise<void> {
  if (!ws.org || !ws.pat) return;
  ws.loading = true;
  renderWizard();
  try {
    const projects = await azdoInvoke<string[]>('list_azdo_projects', { token: ws.pat, org: ws.org });
    ws.projects = projects;
    ws.patValid = true;
    ws.loading = false;
    // Auto-select if only one project
    if (projects.length === 1) ws.project = projects[0];
    toast(`\u2705 PAT valid — ${projects.length} projects loaded`, 'success');
  } catch (e) {
    ws.patValid = false;
    ws.loading = false;
    toast('\u274C PAT failed: ' + e, 'error');
  }
  renderWizard();
}

export async function swizSelectProject(value: string): Promise<void> {
  ws.project = value;
  ws.repos = [];
  ws.repo = '';
  if (!value) { renderWizard(); return; }
  try {
    ws.repos = await azdoInvoke<string[]>('list_azdo_repos', { token: ws.pat, project: value, org: ws.org });
    // Auto-select if only one Package.* repo
    const pkgRepos = ws.repos.filter(r => r.startsWith('Package.'));
    if (pkgRepos.length === 1) ws.repo = pkgRepos[0];
  } catch (e) {
    toast('Failed to load repos: ' + e, 'error');
  }
  renderWizard();
}

export async function swizSelectRepo(value: string): Promise<void> {
  ws.repo = value;
  ws.branches = [];
  if (value) await swizLoadBranches();
  renderWizard();
}

function sortBranches(branches: string[]): string[] {
  return branches.slice().sort((a, b) => {
    const priority = (s: string) => {
      if (s === 'master' || s === 'main') return 0;
      if (s.startsWith('fix/') || s.startsWith('hotfix/')) return 1;
      if (s.startsWith('release/')) return 2;
      return 3;
    };
    const pa = priority(a), pb = priority(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

async function swizLoadBranches(): Promise<void> {
  if (!ws.repo) return;
  try {
    const raw = await azdoInvoke<string[]>('list_azdo_branches', { token: ws.pat, project: ws.project, repo: ws.repo, org: ws.org });
    ws.branches = sortBranches(raw);
    // Auto-select target branch
    if (ws.branches.includes('master')) ws.targetBranch = 'master';
    else if (ws.branches.includes('main')) ws.targetBranch = 'main';
    else if (ws.branches.length > 0) ws.targetBranch = ws.branches[0];
  } catch { /* ignore */ }
}

// ── Site detection ──

export async function swizDetectSites(): Promise<void> {
  ws.loading = true;
  renderWizard();
  try {
    const instances = await invoke<{ path: string; name: string; has_wiz_manager: boolean }[]>('scan_enablon_instances');
    const sites: WizState['detectedSites'] = [];
    for (const inst of instances) {
      try {
        const instSites = await invoke<{ name: string; path: string; size_mb: number }[]>('list_instance_sites', { instancePath: inst.path });
        for (const s of instSites) {
          sites.push({ path: s.path, name: s.name, instance: inst.name });
        }
      } catch { /* skip */ }
    }
    ws.detectedSites = sites;
    ws.loading = false;
    if (sites.length === 1) swizPickSite(sites[0].path);
  } catch {
    ws.loading = false;
  }
  renderWizard();
}

export function swizPickSite(path: string): void {
  ws.sitePath = path;
  swizUpdateSitePath(path);
  renderWizard();
  // Auto-load packages when site changes
  if (path && ws.availablePackages.length === 0) swizLoadPackages();
}

export async function swizBrowseSite(): Promise<void> {
  try {
    const path = await invoke<string | null>('browse_folder', { defaultPath: ws.sitePath || 'C:\\' });
    if (path) { ws.sitePath = path; swizUpdateSitePath(path); renderWizard(); }
  } catch { /* cancelled */ }
}

// ── Work Items ──

let _wiSearchTimeout: ReturnType<typeof setTimeout> | null = null;

export function swizSearchWI(value: string): void {
  // If user typed #12345, extract the ID
  const idMatch = value.match(/#?(\d{4,})/);
  if (idMatch) {
    ws.workitemId = idMatch[1];
  }
  if (_wiSearchTimeout) clearTimeout(_wiSearchTimeout);
  _wiSearchTimeout = setTimeout(() => _doSearchWI(value), 400);
}

async function _doSearchWI(query: string): Promise<void> {
  const el = document.getElementById('sw-wi-results');
  if (!el || query.length < 2) { if (el) el.style.display = 'none'; return; }
  try {
    const items = await azdoInvoke<any[]>('search_work_items', { token: ws.pat, project: ws.project, org: ws.org, query });
    if (items.length === 0) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = items.slice(0, 8).map((wi: any) =>
      `<div class="swiz-wi-item" onclick="swizSelectWI('${esc(String(wi.id))}', '${esc(wi.title).replace(/'/g, "\\'")}')">#${wi.id} — ${esc(wi.title)}<span class="swiz-wi-type">${esc(wi.type || '')}</span></div>`
    ).join('');
  } catch { el.style.display = 'none'; }
}

export async function swizLoadMyWI(): Promise<void> {
  try {
    const items = await azdoInvoke<any[]>('search_work_items', { token: ws.pat, project: ws.project, org: ws.org, query: '@me' });
    const el = document.getElementById('sw-wi-results');
    if (!el || items.length === 0) return;
    el.style.display = 'block';
    el.innerHTML = items.slice(0, 10).map((wi: any) =>
      `<div class="swiz-wi-item" onclick="swizSelectWI('${esc(String(wi.id))}', '${esc(wi.title).replace(/'/g, "\\'")}')">#${wi.id} — ${esc(wi.title)}<span class="swiz-wi-type">${esc(wi.type || '')}</span></div>`
    ).join('');
  } catch { /* ignore */ }
}

export function swizSelectWI(id: string, title: string): void {
  ws.workitemId = id;
  ws.workitemTitle = title;
  // Auto-generate branch name
  const slug = title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50);
  const typePrefix = title.match(/bug/i) ? 'BUG' : 'US';
  // Derive initials from existing env git config (if available)
  const gitUser = S.envConfig?.git?.username || '';
  const initials = gitUser ? gitUser.trim().split(/[\s.]+/).map((p: string) => p[0]?.toUpperCase() || '').join('') : '';
  ws.featureBranch = initials ? `feature/${initials}/${typePrefix}-${id}-${slug}` : `feature/${typePrefix}-${id}-${slug}`;
  // Hide results
  const el = document.getElementById('sw-wi-results');
  if (el) el.style.display = 'none';
  renderWizard();
}

// ── Packages ──

export async function swizLoadPackages(): Promise<void> {
  if (!ws.sitePath || ws.loading) return;
  ws.loading = true;
  refreshWizardParts();
  try {
    const pkgs = await invoke<string[]>('list_sql_packages', { sitePath: ws.sitePath, password: ws.dbPassword || 'enablon' });
    ws.availablePackages = pkgs;
    ws.loading = false;
    if (pkgs.length > 0) toast(`${pkgs.length} packages loaded`, 'success');
  } catch (e) {
    ws.loading = false;
    toast('Could not load packages: ' + e, 'error');
  }
  refreshWizardParts();
}

export function swizTogglePkg(pkg: string): void {
  if (ws.packages.includes(pkg)) ws.packages = ws.packages.filter(p => p !== pkg);
  else ws.packages.push(pkg);
  renderWizard();
}

// ── Create environment ──

export async function swizCreate(): Promise<void> {
  const siteId = ws.sitePath.replace(/\\/g, '/').split('/').pop() || '';
  const name = ws.envName || siteId || 'new';

  try {
    await invoke('create_env', { name });
    // Build config
    const config = {
      workitem_id: ws.workitemId,
      feature_branch: ws.featureBranch,
      target_branch: ws.targetBranch,
      packages: ws.packages,
      local: {
        site_path: ws.sitePath,
        parent_site: ws.parentSite,
        user: ws.siteUser,
        password: ws.sitePassword,
        developer_password: ws.devPassword,
        db_user: ws.dbUser,
        db_password: ws.dbPassword,
      },
      azdo: {
        organization: ws.org,
        project: ws.project,
        token: ws.pat,
        repository: ws.repo,
        repository_metadata: ws.repoMeta,
      },
    };
    // Find the actual filename
    const envs: string[] = await invoke('list_envs');
    const match = envs.find(e => e.includes(name));
    if (match) {
      await invoke('save_env', { name: match, config });
      S.currentEnv = match;
      S.envConfig = config as any;
    }
    // Update env selector and load the new env
    const sel = document.getElementById('envSel') as HTMLSelectElement;
    sel.innerHTML = envs.map((e: string) => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
    sel.value = match || '';
    localStorage.setItem('donut-env', S.currentEnv);

    toast(`\u2705 Environment "${name}" created!`, 'success');
    closeSetupWizard();
    renderConfig();
    // Refresh scripts tab (removes "no env" banner, re-enables scripts)
    (window as any).renderScripts?.();
    (window as any).renderRunBar?.();

    // Propose to launch Setup
    const run = await (window as any).showModal({
      title: 'Run Setup?',
      message: `Your environment <strong>${esc(name)}</strong> is configured.<br><br>Do you want to install the site, configure authentication, and set packages now?`,
      html: true,
      confirmLabel: 'Run Setup',
      cancelLabel: 'Later',
    });
    if (run) {
      // Switch to Scripts tab, select Setup, and run
      const scriptsBtn = document.querySelector('.tab[onclick*="scripts"]') as HTMLElement;
      if (scriptsBtn) (window as any).showTab('scripts', scriptsBtn);
      (window as any).selectScript('setup');
      setTimeout(() => (window as any).doRun(), 300);
    } else {
      toast('You can run Setup later from the Scripts tab', 'info');
    }
  } catch (e) {
    toast('Failed to create environment: ' + e, 'error');
  }
}
