// ═══════════════════════════════════════════════════════════════════
// config.ts — Config tab, wizard, form helpers, packages, work items
// ═══════════════════════════════════════════════════════════════════

import type { EnvConfig, WorkItem } from './types';
import { S, esc, toast, invoke, azdoInvoke, getOrg, getProject } from './state';
import { renderSelectedInfo, showInstallWizard } from './scripts';
import { renderInstancesSection } from './instances';
import {
  field, fieldVersion, fieldBrowse, fieldWorkItem,
  nativeSelectInline, ssInputInline, ssFieldWithCreate,
  wizStep, wizClosed, CFG_ICO,
} from './config/form-fields';

// ── Config ──
interface TemplateInfo { name: string; description: string; filename: string; }

// ── Delegated click handler for cfgEnvs sidebar (attached once) ──
{
  const el = document.getElementById('cfgEnvs');
  if (el) el.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const envEl = target.closest('[data-env]') as HTMLElement | null;
    if (envEl) {
      const sel = document.getElementById('envSel') as HTMLSelectElement;
      sel.value = envEl.dataset.env!;
      (window as any).loadEnv();
      return;
    }
    const btn = target.closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'new': createNewEnv(); break;
      case 'clone': cloneCurrentEnv(); break;
      case 'rename': renameCurrentEnv(); break;
      case 'export': exportEnv(); break;
      case 'import': importEnv(); break;
      case 'delete': deleteCurrentEnv(); break;
      case 'save': saveConfig(); break;
    }
  });
}

export async function createNewEnv(): Promise<void> {
  // Fetch available templates
  let templates: TemplateInfo[] = [];
  try { templates = await invoke<TemplateInfo[]>('list_templates'); } catch { /* no templates */ }

  // If templates exist, let user choose
  let selectedTemplate: string | null = null;
  if (templates.length > 0) {
    const choices = ['Blank', ...templates.map(t => t.name)];
    const picked = await (window as any).showPrompt(
      'New environment',
      'Choose a template:\n' + choices.map((c, i) => `  ${i}. ${c}`).join('\n') + '\n\nEnter number (0 for blank)',
    );
    if (picked === null || picked === undefined) return;
    const idx = parseInt(picked, 10);
    if (!isNaN(idx) && idx > 0 && idx <= templates.length) {
      selectedTemplate = templates[idx - 1].filename;
    }
  }

  const name = await (window as any).showPrompt('Environment name', 'e.g. myproject');
  if (!name) return;
  try {
    if (selectedTemplate) {
      await invoke('create_env_from_template', { name, template: selectedTemplate });
    } else {
      await invoke('create_env', { name });
    }
    toast('Created: ' + name, 'success');
    await refreshEnvList(name);
  } catch(e) { toast('Create env: '+e, 'error'); }
}

export async function cloneCurrentEnv(): Promise<void> {
  if (!S.currentEnv) return;
  const name = await (window as any).showPrompt('Clone environment', 'e.g. myproject-copy');
  if (!name) return;
  try {
    await invoke('clone_env', { source: S.currentEnv, newName: name });
    toast('Cloned as ' + name, 'success');
    await refreshEnvList(name);
  } catch(e) { toast('Clone: '+e, 'error'); }
}

export async function deleteCurrentEnv(): Promise<void> {
  if (!S.currentEnv) return;
  const ok = await (window as any).showConfirm('Delete environment', `Delete ${S.currentEnv}? This cannot be undone.`);
  if (!ok) return;
  try {
    await invoke('delete_env', { name: S.currentEnv });
    toast('Deleted: ' + S.currentEnv, 'success');
    const envs: string[] = await invoke('list_envs');
    const sel = document.getElementById('envSel') as HTMLSelectElement;
    sel.innerHTML = envs.map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join('');
    if (envs.length) { S.currentEnv = envs[0]; sel.value = S.currentEnv; (window as any).loadEnv(); }
    else { S.currentEnv = ''; S.envConfig = {} as EnvConfig; renderConfig(); }
  } catch(e) { toast('Delete: '+e, 'error'); }
}

export async function renameCurrentEnv(): Promise<void> {
  if (!S.currentEnv) return;
  const currentLabel = S.currentEnv.replace(/^\.env-?/, '').replace(/\.json$/, '') || S.currentEnv;
  const name = await (window as any).showPrompt('Rename environment', 'New name', currentLabel);
  if (!name) return;
  try {
    const newFilename: string = await invoke('rename_env', { oldName: S.currentEnv, newName: name });
    toast('Renamed to ' + newFilename, 'success');
    await refreshEnvList(name);
  } catch(e) { toast('Rename: '+e, 'error'); }
}

// ── Export / Import environments ──

function exportEnv(): void {
  if (!S.currentEnv) return;
  // Clone config and strip sensitive fields
  const config = JSON.parse(JSON.stringify(S.envConfig)) as EnvConfig;
  if (config.azdo) delete (config.azdo as any).token;
  if (config.local) {
    delete (config.local as any).password;
    delete (config.local as any).developer_password;
    delete (config.local as any).db_password;
  }
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const label = S.currentEnv.replace(/\.json$/, '');
  a.download = `${label}.env.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Environment exported (without secrets)', 'success');
}

async function importEnv(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const config = JSON.parse(text) as EnvConfig;
      // Derive env name from filename
      let name = file.name.replace(/\.env\.json$/, '').replace(/\.json$/, '');
      if (!name) name = 'imported';
      // Create the env
      await invoke('create_env', { name });
      // Save the config into it
      const envs: string[] = await invoke('list_envs');
      const match = envs.find(e => e.includes(name));
      if (match) {
        await invoke('save_env', { name: match, config });
        toast(`Imported: ${match} — fill in secrets (PAT, passwords)`, 'success');
        await refreshEnvList(name);
      }
    } catch (e) { toast('Import failed: ' + e, 'error'); }
  };
  input.click();
}

async function refreshEnvList(selectName: string): Promise<void> {
  const envs: string[] = await invoke('list_envs');
  const sel = document.getElementById('envSel') as HTMLSelectElement;
  sel.innerHTML = envs.map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join('');
  const newName = envs.find(e => e.includes(selectName));
  if (newName) { sel.value = newName; (window as any).loadEnv(); }
}

export function renderConfig(): void {
  const cfgEnvs = document.getElementById('cfgEnvs');
  const cfgForm = document.getElementById('cfgForm');
  if (!cfgEnvs || !cfgForm) return;

  invoke<string[]>('list_envs').then(envs => {
    const el = document.getElementById('cfgEnvs');
    if (!el) return;
    el.innerHTML = envs.map(e =>
      `<div class="cfg-env${e===S.currentEnv?' active':''}" data-env="${esc(e)}">${esc(e)}</div>`
    ).join('') + `<div class="cfg-env-actions"><button class="cfg-env-btn" data-action="new" title="New environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button><button class="cfg-env-btn" data-action="clone" title="Clone environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button><button class="cfg-env-btn" data-action="rename" title="Rename environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button><button class="cfg-env-btn" data-action="export" title="Export environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button><button class="cfg-env-btn" data-action="import" title="Import environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button><button class="cfg-env-btn del" data-action="delete" title="Delete environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button></div>`
    + `<div class="cfg-save-sidebar"><button class="save-btn" data-action="save">SAVE</button><span class="msg" id="cfgMsg2"></span></div>`;
  });

  const c = S.envConfig;
  const ver = getVersion(c);
  const token = c.azdo?.token || '';
  const proj = c.azdo?.project || '';
  const repo = c.azdo?.repository || '';
  const sitePath = c.local?.site_path || '';
  // Status flags for green indicators
  const okToken = !!token && S.cachedProjects.length > 0;
  const okProj = okToken && !!proj;
  const okRepo = okProj && !!repo;
  const okBranches = okRepo && S.cachedBranches.length > 0;
  const okFb = okBranches && !!c.feature_branch;
  const okTb = okBranches && !!c.target_branch;
  const pkgCount = (c.packages || []).length;

  // Config summary banner
  const summaryItems: string[] = [];
  if (sitePath) summaryItems.push(`<span class="cfg-sum-item ok" title="${esc(sitePath)}">&#9679; ${esc(sitePath.split(/[\\\/]/).pop() || sitePath)}</span>`);
  else summaryItems.push('<span class="cfg-sum-item miss">&#9675; no site</span>');
  if (c.feature_branch) summaryItems.push(`<span class="cfg-sum-item ok">&#9679; ${esc(c.feature_branch)}</span>`);
  else summaryItems.push('<span class="cfg-sum-item miss">&#9675; no branch</span>');
  if (c.target_branch) summaryItems.push(`<span class="cfg-sum-item dim">\u2192 ${esc(c.target_branch)}</span>`);
  if (repo) summaryItems.push(`<span class="cfg-sum-item ok">&#9679; ${esc(repo)}</span>`);
  else summaryItems.push('<span class="cfg-sum-item miss">&#9675; no repo</span>');
  if (pkgCount) summaryItems.push(`<span class="cfg-sum-item ok">${pkgCount} pkg${pkgCount > 1 ? 's' : ''}</span>`);
  if (okToken) summaryItems.push('<span class="cfg-sum-item ok" title="PAT valid">&#9679; PAT</span>');
  else if (token) summaryItems.push('<span class="cfg-sum-item miss" title="PAT not validated">&#9675; PAT?</span>');

  cfgForm.innerHTML = `
    <div class="cfg-summary">${summaryItems.join('<span class="cfg-sum-sep">\u00B7</span>')}</div>
    ${wizStep(0, 'Instances', true, true, '', `
      <div id="instancesContainer">${renderInstancesSection()}</div>
    `)}
    ${wizStep(1, 'Local Site & Packages', true, !!sitePath, sitePath ? esc(sitePath) : '', `
      <div class="cfg-fields">
        ${fieldBrowse('c-sp','site path',c.local?.site_path,'full','Full path to the local IIS site (e.g. C:\\MySite\\10.7\\WizRisk.MyProject)',`<button class="cfg-action-btn" onclick="launchInstallSite()" title="Install new site">${CFG_ICO.download}</button>`)}
        ${field('c-ps','parent site',c.local?.parent_site||'','full','text','Parent site used to download master packages. Local: relative path (e.g. /WizRisk.10.13). Remote: full URL (e.g. https://myserver/10.13/WizRisk.10.13/)')}
        ${fieldVersion('c-ver','version',ver,'Platform version (e.g. 10.7, 10.11)')}
        ${field('c-usr','site user',c.local?.user||'admin','','text','Site admin username')}
        ${field('c-spw','site password',c.local?.password||'','','password','Site admin password')}
        ${field('c-devpw','developer password',c.local?.developer_password||'','','password','Builder developer password (used by Setup Local Auth)')}
        ${field('c-dbu','DB user',c.local?.db_user||'sa','','text','SQL Server login (default: sa)')}
        ${field('c-dbpw','DB password',c.local?.db_password||'','','password','SQL Server password for DB user')}<span id="credBadgeSql" class="cred-badge" style="display:none"></span>
        <div class="cfg-field full"><label>packages ${S.cachedPackages.length ? `<span class="pkg-count" id="pkgCount">${(c.packages||[]).length}/${S.cachedPackages.length} selected</span>` : '<button class="cfg-action-btn pkg-load-btn" onclick="loadPackages()">${CFG_ICO.db} load from DB</button>'}</label>${S.cachedPackages.length ? `<div class="pkg-filter"><input class="pkg-filter-input" type="text" placeholder="filter packages..." oninput="filterPackages(this.value)" autocomplete="off"><button class="cfg-action-btn" onclick="selectAllPkgs()">${CFG_ICO.check} all</button><button class="cfg-action-btn" onclick="deselectAllPkgs()">${CFG_ICO.x} none</button></div><div class="pkg-grid" id="pkgGrid">${S.cachedPackages.slice().sort().map(p => `<label class="pkg-chip${(c.packages||[]).includes(p)?' selected':''}" data-pkg="${esc(p)}" onclick="this.classList.toggle('selected');updatePkgCount();autoSave()"><span>${esc(p)}</span></label>`).join('')}</div>` : `<input id="c-pkg" type="text" value="${esc((c.packages||[]).join(', '))}" placeholder="comma separated, or click 'load from DB'">`}</div>
      </div>
    `)}
    ${wizStep(2, 'Azure DevOps — Connection', true, okToken, okToken ? `${S.cachedProjects.length} projects` : '', `
      <div class="cfg-fields">
        ${field('c-org','organization',c.azdo?.organization||'','full','text','Azure DevOps organization name — appears in the URL: dev.azure.com/{organization}')}
        ${field('c-pat','personal access token (PAT)',token,'full','password','Personal Access Token — create one at Azure DevOps > User Settings > Personal Access Tokens. Required scopes: Code (Read & Write), Work Items (Read & Write)')}
      </div>
      <div class="cfg-btn-row">
        <button class="cfg-action-btn" onclick="wizValidatePat()">${CFG_ICO.check} test PAT & load projects</button>
        <button class="cfg-action-btn" onclick="openUrl('https://dev.azure.com/' + (getOrg() || '_') + '/_usersSettings/tokens')">${CFG_ICO.link} create a PAT</button>
        <span id="credBadgePat" class="cred-badge" style="display:none"></span>
      </div>
    `)}
    ${wizStep(3, 'Project & Repository', okToken, okRepo, okRepo ? `${proj} / ${repo}` : (okProj ? proj : ''), `
      <div class="cfg-fields">
        <div class="cfg-field"><label>project</label><div class="cfg-input-row">${nativeSelectInline('c-proj',proj,S.cachedProjects,'onProjectChange')}<button class="cfg-action-btn" onclick="wizValidatePat()" title="Refresh projects">${CFG_ICO.refresh}</button></div></div>
        <div class="cfg-field ss-wrap"><label>repository</label><div class="cfg-input-row">${ssInputInline('c-repo',repo,S.cachedRepos,'onRepoChange')}<button class="cfg-action-btn" onclick="refreshRepos()" title="Refresh repos">${CFG_ICO.refresh}</button></div></div>
        <div class="cfg-field full ss-wrap"><label>metadata repository<span class="cfg-tip" title="Repository containing the metadata/version database (git4inno). Default: Test.Package.Metadata.GitObjectDB">?</span></label><div class="cfg-input-row">${ssInputInline('c-rdm',c.azdo?.repository_metadata||'Test.Package.Metadata.GitObjectDB',S.cachedRepos,'')}<button class="cfg-action-btn" onclick="refreshRepos()" title="Refresh repos">${CFG_ICO.refresh}</button></div></div>
      </div>
    `)}
    ${wizStep(4, 'Branches', okRepo, okFb && okTb, okFb ? `${c.feature_branch} → ${c.target_branch||'?'}` : '', `
      <div class="cfg-fields">
        ${ssFieldWithCreate('c-fb','feature branch',c.feature_branch,S.cachedBranches,'Your working branch where changes are committed')}
        <div class="cfg-field ss-wrap"><label>target branch<span class="cfg-tip" title="The branch your feature will be merged into (e.g. main, develop)">?</span></label><div class="cfg-input-row">${ssInputInline('c-tb',c.target_branch||'',S.cachedBranches,'')}<button class="cfg-action-btn" onclick="refreshBranches()" title="Refresh branches">${CFG_ICO.refresh}</button></div></div>
        <div class="cfg-field full"><label><input type="checkbox" id="c-md" ${c.deactivate_metadata_conversion ? '' : 'checked'}> Enable metadata conversion (view-diff)</label><p class="wiz-desc">Disable if the metadata repository is not set up for this project.</p></div>
      </div>
    `)}
    ${wizStep(5, 'Work Item', okToken, !!c.workitem_id, c.workitem_id || '', `
      <div class="cfg-fields">
        ${fieldWorkItem('c-wi','work item',c.workitem_id,'Link a User Story or Bug to auto-generate branch name')}
      </div>
    `)}
  `;
  // Auto-load cascade (preserve form values across async re-renders)
  if (token && !S.cachedProjects.length) {
    azdoInvoke<string[]>('list_azdo_projects', { token }).then(p => {
      if (p.length) { S.cachedProjects = p; const s = getFormValues(); renderConfig(); setFormValues(s); captureFormSnapshot(); }
    }).catch(() => {});
  }
  if (okProj && !S.cachedRepos.length) {
    azdoInvoke<string[]>('list_azdo_repos', { token, project: proj }).then(r => {
      if (r.length) { S.cachedRepos = r; const s = getFormValues(); renderConfig(); setFormValues(s); captureFormSnapshot(); }
    }).catch(() => {});
  }
  if (okRepo && !S.cachedBranches.length) {
    azdoInvoke<string[]>('list_azdo_branches', { token, project: proj, repository: repo }).then(b => {
      if (b.length) { S.cachedBranches = b; const s = getFormValues(); renderConfig(); setFormValues(s); captureFormSnapshot(); }
    }).catch(() => {});
  }
  captureFormSnapshot();
}

// ── Wizard helpers ──
export function toggleWizStep(num: number): void {
  wizClosed[num] = !wizClosed[num];
  const step = document.querySelector(`.wiz-step[data-step="${num}"]`);
  if (!step) return;
  const isOpen = !wizClosed[num];
  step.classList.toggle('active', isOpen);
  const chevron = step.querySelector('.wiz-chevron');
  if (chevron) chevron.textContent = isOpen ? '\u25BE' : '\u25B8';
  const summary = step.querySelector('.wiz-summary') as HTMLElement | null;
  if (summary) summary.style.display = isOpen ? 'none' : '';
}

export function ssOpen(id: string): void {
  document.querySelectorAll('.ss-results.open').forEach(el => { el.classList.remove('open'); });
  const input = document.getElementById(id) as HTMLElement | null;
  const list = document.getElementById(id+'-list') as HTMLElement | null;
  if (!input || !list) return;
  positionDropdown(input, list);
  list.classList.add('open');
  ssFilter(id);
}

function positionDropdown(anchor: HTMLElement, dropdown: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const maxH = 200;
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = rect.width + 'px';
  if (spaceBelow >= 100 || spaceBelow >= spaceAbove) {
    // Open below
    dropdown.style.top = rect.bottom + 2 + 'px';
    dropdown.style.bottom = '';
    dropdown.style.maxHeight = Math.min(maxH, Math.max(60, spaceBelow)) + 'px';
  } else {
    // Open above
    dropdown.style.top = '';
    dropdown.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
    dropdown.style.maxHeight = Math.min(maxH, Math.max(60, spaceAbove)) + 'px';
  }
}
export function ssFilter(id: string): void {
  const q = (document.getElementById(id) as HTMLInputElement)?.value?.toLowerCase() || '';
  const list = document.getElementById(id+'-list');
  if (!list) return;
  let visible = 0;
  list.querySelectorAll('.ss-item').forEach(el => {
    const match = el.textContent!.toLowerCase().includes(q);
    (el as HTMLElement).style.display = match ? '' : 'none';
    if (match) visible++;
  });
  const empty = list.querySelector('.ss-empty') as HTMLElement | null;
  if (empty) empty.style.display = visible ? 'none' : '';
}
export function ssSelect(id: string, value: string, onChange?: string): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (input) input.value = value;
  document.getElementById(id+'-list')?.classList.remove('open');
  if (onChange && (window as any)[onChange]) (window as any)[onChange](value);
  autoSave();
}
document.addEventListener('click', (e: MouseEvent) => {
  if (!(e.target as HTMLElement).closest('.ss-wrap')) document.querySelectorAll('.ss-results.open').forEach(el => el.classList.remove('open'));
});
// Close dropdowns on scroll to prevent position desync
// Close dropdowns when clicking outside
document.querySelector('.panel')?.addEventListener('scroll', () => {
  document.querySelectorAll('.ss-results.open').forEach(el => el.classList.remove('open'));
  document.getElementById('wiResults')?.classList.remove('open');
}, { passive: true });

// ── Wizard cascade triggers ──
export async function wizValidatePat(): Promise<void> {
  const org = (document.getElementById('c-org') as HTMLInputElement)?.value || '';
  if (org) { if (!S.envConfig.azdo) S.envConfig.azdo = {}; S.envConfig.azdo.organization = org; }
  const token = (document.getElementById('c-pat') as HTMLInputElement)?.value || '';
  if (!token) { toast('Enter a PAT first', 'warn'); return; }
  if (!org) { toast('Enter an organization first', 'warn'); return; }
  toast('Validating PAT & loading projects...', 'info');
  try {
    S.cachedProjects = await invoke('list_azdo_projects', { token, organization: org });
    if (S.cachedProjects.length) {
      autoSave();
      const snap = getFormValues(); renderConfig(); setFormValues(snap);
      // Toast after re-render so it stays visible
      toast('\u2705 PAT valid — ' + S.cachedProjects.length + ' projects loaded', 'success');
    } else {
      toast('PAT valid but no projects found', 'warn');
    }
  } catch(e) { toast('\u274C PAT failed: ' + e, 'error'); }
}
export async function onProjectChange(proj: string): Promise<void> {
  if (!proj) return;
  // Update envConfig so getProject() returns the new value
  if (!S.envConfig.azdo) S.envConfig.azdo = {};
  S.envConfig.azdo.project = proj;
  toast('Loading repos for ' + proj + '...', 'info');
  const token = getToken();
  try {
    S.cachedRepos = await azdoInvoke('list_azdo_repos', { token, project: proj });
    S.cachedBranches = [];
    toast(S.cachedRepos.length + ' repos loaded', 'success');
    const snap = getFormValues(); snap['c-proj'] = proj; renderConfig(); setFormValues(snap);
  } catch(e) { toast('Repos: ' + e, 'error'); }
}
export async function refreshRepos(): Promise<void> {
  const token = getToken();
  const proj = getProject();
  if (!token || !proj) { toast('Need PAT & project first', 'warn'); return; }
  toast('Refreshing repos...', 'info');
  try {
    S.cachedRepos = await azdoInvoke('list_azdo_repos', { token, project: proj });
    toast(S.cachedRepos.length + ' repos loaded', 'success');
    const snap = getFormValues(); renderConfig(); setFormValues(snap);
  } catch(e) { toast('Repos: ' + e, 'error'); }
}
export async function refreshBranches(): Promise<void> {
  const token = getToken();
  const repo = getRepo();
  if (!token || !repo) { toast('Need PAT & repository first', 'warn'); return; }
  toast('Refreshing branches...', 'info');
  try {
    S.cachedBranches = await azdoInvoke('list_azdo_branches', { token, project: getProject(), repository: repo });
    toast(S.cachedBranches.length + ' branches loaded', 'success');
    const snap = getFormValues(); renderConfig(); setFormValues(snap);
  } catch(e) { toast('Branches: ' + e, 'error'); }
}
export async function onRepoChange(repo: string): Promise<void> {
  if (!repo) return;
  if (!S.envConfig.azdo) S.envConfig.azdo = {};
  S.envConfig.azdo.repository = repo;
  toast('Loading branches...', 'info');
  const token = getToken();
  try {
    S.cachedBranches = await azdoInvoke('list_azdo_branches', { token, project: getProject(), repository: repo });
    toast(S.cachedBranches.length + ' branches loaded', 'success');
    const snap = getFormValues(); snap['c-repo'] = repo; renderConfig(); setFormValues(snap);
  } catch(e) { toast('Branches: ' + e, 'error'); }
}

export function togglePwd(id: string): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}
function getVersion(c: EnvConfig): string {
  const sp = c.local?.site_path || '';
  const m = sp.match(/(\d+\.\d+)/);
  if (m) return m[1];
  const ps = c.local?.parent_site || '';
  const m2 = ps.match(/(\d+\.\d+)/);
  return m2 ? m2[1] : '10.7';
}
function buildParentSite(ver: string): string {
  const fromField = (document.getElementById('c-ps') as HTMLInputElement)?.value;
  if (fromField) return fromField;
  return `/${ver}/WizRisk.${ver}`;
}
export function onVersionChange(_ver: string): void {
  autoSave();
}
export async function loadPackages(): Promise<void> {
  const snap = getFormValues();
  const sitePath = snap['c-sp'] || '';
  if (!sitePath) { toast('Set a site path first', 'warn'); return; }
  toast('Fetching packages...', 'info');
  try {
    S.cachedPackages = await invoke('list_sql_packages', { sitePath, password: snap['c-spw'] || S.envConfig.local?.password || null });
    toast('Found ' + S.cachedPackages.length + ' packages', S.cachedPackages.length ? 'success' : 'warn');
    renderConfig();
    setFormValues(snap);
  } catch(e) { toast('Packages: '+e, 'error'); }
}
function getSelectedPackages(): string[] {
  return Array.from(document.querySelectorAll('.pkg-chip.selected')).map(el => (el as HTMLElement).dataset.pkg!);
}
let wiDebounce: ReturnType<typeof setTimeout> | null = null;
function renderWIResults(items: WorkItem[]): void {
  const el = document.getElementById('wiResults') as HTMLElement | null;
  if (!el) return;
  if (!items.length) { el.classList.remove('open'); return; }
  const input = document.getElementById('c-wi');
  if (input) positionDropdown(input, el);
  el.innerHTML = items.map(wi =>
    `<div class="wi-item" onclick="selectWI(${wi.id})">
      <span class="wi-id">${wi.id}</span>
      <span class="wi-type">${esc(wi.type || '')}</span>
      <span class="wi-title">${esc(wi.title || '')}</span>
      <span class="wi-state">${esc(wi.state || '')}</span>
    </div>`
  ).join('');
  el.classList.add('open');
}
export function showWIResultsCached(): void {
  if (S.cachedWorkItems.length) showWIResults(S.cachedWorkItems);
}
export function showWIResults(items: WorkItem[]): void {
  const query = (document.getElementById('c-wi') as HTMLInputElement)?.value?.toLowerCase() || '';
  if (!query) { renderWIResults(items); return; }
  const filtered = items.filter(wi => String(wi.id).includes(query) || (wi.title || '').toLowerCase().includes(query));
  renderWIResults(filtered);
}
export async function loadWorkItems(): Promise<void> {
  const token = getToken();
  if (!token) { toast('Fill PAT & save config first', 'warn'); return; }
  toast('Loading recent work items...', 'info');
  try {
    S.cachedWorkItems = await azdoInvoke('search_work_items', { token, project: getProject(), query: '' });
    if (S.cachedWorkItems.length) {
      toast(S.cachedWorkItems.length + ' work items loaded', 'success');
      renderWIResults(S.cachedWorkItems);
    } else {
      toast('No work items found. Check PAT scope: Work Items (Read)', 'warn');
    }
  } catch(e) { toast('Work items failed: ' + e, 'error'); }
}
export async function loadMyWorkItems(): Promise<void> {
  const token = getToken();
  if (!token) { toast('Fill PAT & save config first', 'warn'); return; }
  toast('Loading my work items...', 'info');
  try {
    S.cachedWorkItems = await azdoInvoke('search_work_items', { token, project: getProject(), query: '@me' });
    if (S.cachedWorkItems.length) {
      toast(S.cachedWorkItems.length + ' items assigned to you', 'success');
      renderWIResults(S.cachedWorkItems);
    } else {
      toast('No items assigned to you. PAT needs Identity (Read) scope for @Me', 'warn');
    }
  } catch(e) { toast('Work items failed: ' + e, 'error'); }
}
export function searchWI(query: string): void {
  clearTimeout(wiDebounce!);
  if (S.cachedWorkItems.length) {
    showWIResults(S.cachedWorkItems);
    return;
  }
  if (!query || query.length < 2) { document.getElementById('wiResults')?.classList.remove('open'); return; }
  wiDebounce = setTimeout(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const items: WorkItem[] = await azdoInvoke('search_work_items', { token, project: getProject(), query });
      renderWIResults(items);
    } catch(e) { toast('Search: '+e, 'error'); }
  }, 400);
}
export async function selectWI(id: number): Promise<void> {
  const wiInput = document.getElementById('c-wi') as HTMLInputElement;
  const wi = S.cachedWorkItems.find(w => w.id === id);
  // Show ID + title in the field
  wiInput.value = wi ? `#${id} — ${wi.title}` : String(id);
  document.getElementById('wiResults')?.classList.remove('open');
  if (wi) {
    const slug = (wi.title || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50);
    const prefix = wi.type === 'Bug' ? 'fix' : 'feature';
    // Derive user initials from git username (fallback to empty)
    const gitUser = S.envConfig.git?.username || '';
    const initials = gitUser ? gitUser.split(/[\s.]+/).map(p => p[0]?.toUpperCase() || '').join('') : '';
    const branch = initials ? `${prefix}/${initials}/${slug}` : `${prefix}/${slug}`;
    const fbEl = document.getElementById('c-fb') as HTMLInputElement | null;
    const shouldReplace = !fbEl?.value || await (window as any).showModal({ title: 'Replace branch?', message: `Set feature branch to:\n${branch}`, confirmLabel: 'Replace' });
    if (fbEl && shouldReplace) {
      fbEl.value = branch;
    }
    toast(`Selected: #${id} ${wi.title}`, 'success');
  }
}
document.addEventListener('click', (e: MouseEvent) => {
  if (!(e.target as HTMLElement).closest('.wi-search')) document.getElementById('wiResults')?.classList.remove('open');
});
export function handleDrop(e: DragEvent, id: string): void {
  e.preventDefault();
  (e.currentTarget as HTMLElement).classList.remove('drag-over');
  const item = e.dataTransfer?.items?.[0] || e.dataTransfer?.files?.[0];
  if (item) {
    // Try to get path from text data (works in some environments)
    const text = e.dataTransfer!.getData('text/plain') || e.dataTransfer!.getData('text/uri-list');
    if (text) {
      const path = text.replace('file:///', '').replace(/\//g, '\\');
      (document.getElementById(id) as HTMLInputElement).value = decodeURIComponent(path);
      toast('Dropped: ' + decodeURIComponent(path), 'success');
    }
  }
}
export async function createBranch(): Promise<void> {
  const token = getToken();
  const repository = getFormValues().repo || getRepo();
  if (!token || !repository) { toast('Fill PAT & repository first', 'warn'); return; }

  // Get source branch (target branch = base for the new branch)
  const sourceBranch = getFormValues().tb || S.envConfig.target_branch;
  if (!sourceBranch) { toast('Select a target branch first (used as source)', 'warn'); return; }

  const result = await (window as any).showModal({
    title: 'Create new branch',
    message: `New branch from "${sourceBranch}" on ${repository}`,
    inputPlaceholder: 'feature/DNT/US-123-my-feature',
    inputValue: getFormValues().fb || '',
    confirmLabel: 'Create',
  });
  if (!result) return;
  const branchName = result.trim();
  if (!branchName) { toast('Branch name cannot be empty', 'warn'); return; }

  toast('Creating branch...', 'info');
  try {
    await azdoInvoke('create_azdo_branch', { token, project: getProject(), repository, branchName, sourceBranch });
    toast('Branch "' + branchName + '" created!', 'success');
    // Refresh branches and select the new one
    S.cachedBranches = await azdoInvoke('list_azdo_branches', { token, project: getProject(), repository });
    const snap = getFormValues();
    snap['c-fb'] = branchName;
    renderConfig();
    setFormValues(snap);
  } catch(e) { toast('Create branch failed: ' + e, 'error'); }
}
export async function doBrowse(id: string): Promise<void> {
  try {
    const current = (document.getElementById(id) as HTMLInputElement)?.value || '';
    const path: string = await invoke('browse_folder', { defaultPath: current || 'C:\\' });
    if (path) {
      (document.getElementById(id) as HTMLInputElement).value = path;
      toast('Selected: ' + path, 'success');
    }
  } catch(e) { toast('Browse failed: '+e, 'error'); }
}
export async function doBrowseFile(id: string, filter?: string): Promise<void> {
  try {
    const current = (document.getElementById(id) as HTMLInputElement)?.value || '';
    const defaultDir = current ? current.replace(/\\[^\\]+$/, '') : 'C:\\';
    const path: string = await invoke('browse_file', { defaultPath: defaultDir, filter: filter || null });
    if (path) {
      (document.getElementById(id) as HTMLInputElement).value = path;
      toast('Selected: ' + path, 'success');
    }
  } catch(e) { toast('Browse failed: '+e, 'error'); }
}

export async function launchInstallSite(): Promise<void> {
  const result = await showInstallWizard();
  if (!result) return;
  const el = document.getElementById('c-sp') as HTMLInputElement | null;
  if (el) { el.value = result.sitePath; }
  autoSave();
  renderConfig();
}

// ── Inline validation ──
export function validatePath(id: string): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const badge = document.getElementById(id + '-valid');
  if (!el || !badge) return;
  const path = el.value.trim();
  if (!path) { badge.innerHTML = ''; return; }
  const looksValid = /^[a-zA-Z]:[\\\/]/.test(path) && path.length > 5;
  badge.innerHTML = looksValid
    ? '<span class="cfg-valid-ok" title="Path looks valid">\u2714</span>'
    : '<span class="cfg-valid-err" title="Invalid path format">\u2718</span>';
}

// ── Config health check (LEDs) ──
interface HealthStatus { iis: boolean; sql: boolean; site: boolean; vpn: boolean; iis_detail: string; sql_detail: string; site_detail: string; vpn_detail: string; }

export async function runConfigHealthCheck(): Promise<void> {
  const sp = (document.getElementById('c-sp') as HTMLInputElement)?.value || S.envConfig.local?.site_path || '';
  const ps = (document.getElementById('c-ps') as HTMLInputElement)?.value || S.envConfig.local?.parent_site || '';
  const dbu = (document.getElementById('c-dbu') as HTMLInputElement)?.value || 'sa';
  const dbpw = (document.getElementById('c-dbpw') as HTMLInputElement)?.value || S.envConfig.local?.db_password || '';
  const siteId = sp ? sp.replace(/\\/g, '/').split('/').pop() || '' : '';

  const setLed = (id: string, state: string, detail: string) => {
    const el = document.getElementById('led-' + id);
    if (!el) return;
    el.className = 'cfg-led ' + state;
    el.title = detail;
  };

  if (!sp) return;

  // Set all to checking
  ['iis','sql','site','vpn'].forEach(id => setLed(id, 'checking', 'Checking...'));

  try {
    const h = await invoke<HealthStatus>('quick_health', { sitePath: sp, siteId, dbUser: dbu, dbPassword: dbpw, parentSite: ps });
    setLed('iis', h.iis ? 'ok' : 'fail', 'IIS: ' + h.iis_detail);
    setLed('sql', h.sql ? 'ok' : 'fail', 'SQL: ' + h.sql_detail);
    setLed('site', h.site ? 'ok' : 'fail', 'Site: ' + h.site_detail);
    setLed('vpn', h.vpn ? 'ok' : 'fail', 'Parent: ' + h.vpn_detail);
  } catch {
    ['iis','sql','site','vpn'].forEach(id => setLed(id, 'fail', 'check failed'));
  }
}

// All config form field IDs
const FORM_FIELDS = ['c-wi','c-org','c-repo','c-rdm','c-fb','c-tb','c-pkg','c-sp','c-ps','c-usr','c-spw','c-devpw','c-dbu','c-dbpw','c-pat','c-ver','c-proj'] as const;
type FormSnapshot = Record<string, string | null>;

function getFormValues(): FormSnapshot {
  const snap: FormSnapshot = {};
  for (const id of FORM_FIELDS) {
    snap[id] = (document.getElementById(id) as HTMLInputElement)?.value ?? null;
  }
  return snap;
}
function setFormValues(s: FormSnapshot): void {
  if (!s) return;
  for (const id of FORM_FIELDS) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el && s[id] !== null && s[id] !== undefined) el.value = s[id]!;
  }
}
export function getToken(): string { return (document.getElementById('c-pat') as HTMLInputElement)?.value || S.envConfig.azdo?.token || ''; }
export function getRepo(): string { return (document.getElementById('c-repo') as HTMLInputElement)?.value || S.envConfig.azdo?.repository || ''; }

export async function loadBranches(): Promise<void> {
  const snap = getFormValues();
  const token = getToken();
  const repository = snap['c-repo'] || getRepo();
  if (!token || !repository) { toast('Fill PAT & select a repository first', 'warn'); return; }
  toast('Loading branches...', 'info');
  try {
    S.cachedBranches = await azdoInvoke('list_azdo_branches', { token, project: getProject(), repository });
    toast(S.cachedBranches.length + ' branches loaded', 'success');
    renderConfig(); setFormValues(snap);
  } catch(e) { toast('Branches: '+e, 'error'); }
}
export async function loadRepos(): Promise<void> {
  const snap = getFormValues();
  const token = getToken();
  if (!token) { toast('Fill PAT first', 'warn'); return; }
  toast('Loading repos...', 'info');
  try {
    S.cachedRepos = await azdoInvoke('list_azdo_repos', { token, project: getProject() });
    toast(S.cachedRepos.length + ' repos loaded', 'success');
    renderConfig(); setFormValues(snap);
  } catch(e) { toast('Repos: '+e, 'error'); }
}

function buildConfig(): EnvConfig {
  const v = (id: string): string => (document.getElementById(id) as HTMLInputElement)?.value||'';
  const ver = v('c-ver') || getVersion(S.envConfig);
  const mdCheckbox = document.getElementById('c-md') as HTMLInputElement | null;
  return {
    workitem_id: v('c-wi'), feature_branch: v('c-fb'), target_branch: v('c-tb'),
    deactivate_metadata_conversion: mdCheckbox ? !mdCheckbox.checked : (S.envConfig.deactivate_metadata_conversion || false),
    packages: S.cachedPackages.length ? getSelectedPackages() : v('c-pkg').split(',').map(s=>s.trim()).filter(Boolean),
    local: { site_path: v('c-sp'), parent_site: v('c-ps') || buildParentSite(ver), user: v('c-usr') || 'admin', password: v('c-spw'),
             developer_password: v('c-devpw'), db_user: v('c-dbu') || 'sa', db_password: v('c-dbpw') },
    azdo: { organization: v('c-org') || getOrg(), project: v('c-proj') || getProject(), token: v('c-pat'), repository: v('c-repo'),
            repository_metadata: v('c-rdm') || 'Test.Package.Metadata.GitObjectDB' },
    git: S.envConfig.git,
  };
}

function validateConfig(config: EnvConfig): string[] {
  const warnings: string[] = [];
  // Site path
  if (!config.local?.site_path) {
    warnings.push('Site path is empty — set it in step 1 (e.g. C:\\Enablon\\Instance1013\\Sites\\WizRisk.10.13).');
  } else if (!/^[a-zA-Z]:[\\\/]/.test(config.local.site_path)) {
    warnings.push(`Site path "${config.local.site_path}" does not look like a valid Windows path.`);
  }
  // Parent site
  if (!config.local?.parent_site) {
    warnings.push('Parent site path is empty — set it in step 1. Use a relative path (e.g. /WizRisk.10.13) for local or a full URL for remote.');
  }
  // Password
  if (!config.local?.password) {
    warnings.push('Site password is empty — scripts will fail to authenticate. Set it in step 1.');
  }
  // DB password
  if (!config.local?.db_password) {
    warnings.push('DB password is empty — database operations will fail. Set it in step 1.');
  }
  // Azure DevOps
  if (!config.azdo?.organization) {
    warnings.push('Azure DevOps organization is empty — set it in step 2.');
  }
  if (!config.azdo?.token) {
    warnings.push('Azure DevOps PAT is empty — set it in step 2. Generate one at Azure DevOps > User Settings > Personal Access Tokens.');
  }
  if (!config.azdo?.project) {
    warnings.push('Azure DevOps project is empty — select one in step 3 (test PAT first).');
  }
  if (!config.azdo?.repository) {
    warnings.push('Repository is empty — select one in step 3.');
  }
  // Branches
  if (!config.feature_branch) {
    warnings.push('Feature branch is empty — set it in step 4.');
  }
  if (!config.target_branch) {
    warnings.push('Target branch is empty — set it in step 4 (e.g. master).');
  }
  return warnings;
}

export async function saveConfig(): Promise<void> {
  const config = buildConfig();
  const warnings = validateConfig(config);
  try {
    await invoke('save_env', { name: S.currentEnv, config });
    S.envConfig = config; renderSelectedInfo();
    const btn = document.querySelector('.save-btn'); if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 600); }
    const el = document.getElementById('cfgMsg2'); if (el) { el.textContent = 'saved'; el.className = 'msg ok'; setTimeout(() => { el.textContent = ''; }, 2000); }
    if (warnings.length > 0) {
      toast('Saved with ' + warnings.length + ' warning(s): ' + warnings[0] + (warnings.length > 1 ? ' (+' + (warnings.length - 1) + ' more)' : ''), 'warn');
    } else {
      toast('Configuration saved', 'success');
    }
    // Async credential validation (non-blocking, runs after save)
    validateCredentials(config);
  } catch(e) {
    const el = document.getElementById('cfgMsg2'); if (el) { el.textContent = String(e); el.className = 'msg err'; }
  }
}

// ── Async credential validation after save ──
async function validateCredentials(config: EnvConfig): Promise<void> {
  const results: string[] = [];
  // Test PAT
  if (config.azdo?.token && config.azdo?.organization) {
    try {
      const valid = await invoke<boolean>('validate_pat', { token: config.azdo.token, organization: config.azdo.organization });
      if (!valid) results.push('\u274C PAT Azure DevOps invalide');
    } catch { results.push('\u274C PAT Azure DevOps : connexion \u00e9chou\u00e9e'); }
  }
  // Test SQL (via quick_health, only the SQL part)
  const sitePath = config.local?.site_path || '';
  const dbPass = config.local?.db_password || '';
  const dbUser = config.local?.db_user || 'sa';
  if (sitePath && dbPass) {
    try {
      const siteId = sitePath.split(/[\\\/]/).pop() || '';
      const health = await invoke<{ sql: boolean; sql_detail: string }>('quick_health', {
        sitePath, siteId, dbUser, dbPassword: dbPass, parentSite: config.local?.parent_site || ''
      });
      if (!health.sql) results.push(`\u274C SQL Server : ${health.sql_detail}`);
    } catch { /* SQL check not critical */ }
  }
  // Show validation results
  if (results.length) {
    toast(results.join(' \u00B7 '), 'warn');
  }
  // Update credential status indicators in the form
  updateCredentialBadges(config, results);
}

function updateCredentialBadges(config: EnvConfig, errors: string[]): void {
  const patBadge = document.getElementById('credBadgePat');
  const sqlBadge = document.getElementById('credBadgeSql');
  const hasPat = config.azdo?.token && config.azdo?.organization;
  const hasSql = config.local?.site_path && config.local?.db_password;
  const patFailed = errors.some(e => e.includes('PAT'));
  const sqlFailed = errors.some(e => e.includes('SQL'));
  if (patBadge && hasPat) {
    patBadge.textContent = patFailed ? '\u274C' : '\u2705';
    patBadge.title = patFailed ? 'PAT invalid' : 'PAT valid';
    patBadge.style.display = 'inline';
  } else if (patBadge) { patBadge.style.display = 'none'; }
  if (sqlBadge && hasSql) {
    sqlBadge.textContent = sqlFailed ? '\u274C' : '\u2705';
    sqlBadge.title = sqlFailed ? 'SQL connection failed' : 'SQL connected';
    sqlBadge.style.display = 'inline';
  } else if (sqlBadge) { sqlBadge.style.display = 'none'; }
}

let _lastFormSnapshot: string = '';
export function captureFormSnapshot(): void {
  _lastFormSnapshot = JSON.stringify(getFormValues());
}
export function autoSave(): void {
  if (!S.currentEnv) return;
  const current = JSON.stringify(getFormValues());
  if (current === _lastFormSnapshot) return;
  _lastFormSnapshot = current;
  saveConfig();
}

let _pkgFilterDebounce: ReturnType<typeof setTimeout> | null = null;
export function filterPackages(q: string): void {
  clearTimeout(_pkgFilterDebounce!);
  _pkgFilterDebounce = setTimeout(() => {
    const grid = document.getElementById('pkgGrid');
    if (!grid) return;
    const lower = q.toLowerCase();
    grid.querySelectorAll('.pkg-chip').forEach(chip => {
      const name = (chip as HTMLElement).getAttribute('data-pkg')!.toLowerCase();
      chip.classList.toggle('hidden', !name.includes(lower));
    });
  }, 100);
}
export function selectAllPkgs(): void {
  document.querySelectorAll('#pkgGrid .pkg-chip:not(.hidden)').forEach(c => c.classList.add('selected'));
  updatePkgCount(); autoSave();
}
export function deselectAllPkgs(): void {
  document.querySelectorAll('#pkgGrid .pkg-chip:not(.hidden)').forEach(c => c.classList.remove('selected'));
  updatePkgCount(); autoSave();
}
export function updatePkgCount(): void {
  const el = document.getElementById('pkgCount');
  if (!el) return;
  const total = document.querySelectorAll('#pkgGrid .pkg-chip').length;
  const selected = document.querySelectorAll('#pkgGrid .pkg-chip.selected').length;
  el.textContent = `${selected}/${total} selected`;
}

export async function deleteBranch(): Promise<void> {
  const token = getToken();
  const repo = getRepo();
  if (!token || !repo) { toast('Configure PAT & repository first', 'warn'); return; }
  if (!S.cachedBranches.length) {
    try { S.cachedBranches = await azdoInvoke('list_azdo_branches', { token, project:getProject(), repository:repo }); } catch {}
  }
  const fb = S.envConfig.feature_branch || '';
  const result = await (window as any).showModal({
    title: 'Delete branch',
    message: 'Type the branch name to confirm deletion.',
    inputPlaceholder: fb,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!result) return;
  const branchName = result.trim();
  if (!branchName) return;
  toast('Deleting branch...', 'info');
  try {
    await azdoInvoke('delete_azdo_branch', { token, project:getProject(), repository:repo, branchName });
    toast('Branch "' + branchName + '" deleted', 'success');
    S.cachedBranches = S.cachedBranches.filter(b => b !== branchName);
    renderConfig();
  } catch(e) { toast('Delete failed: ' + e, 'error'); }
}
