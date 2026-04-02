// ═══════════════════════════════════════════════════════════════════
// config.ts — Config tab, wizard, form helpers, packages, work items
// ═══════════════════════════════════════════════════════════════════

import type { EnvConfig, WorkItem } from './types';
import { S, esc, toast, invoke, getOrg, getProject } from './state';
import { renderSelectedInfo } from './scripts';

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
    ).join('') + `<div class="cfg-env-actions"><button class="cfg-env-btn" data-action="new" title="New environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button><button class="cfg-env-btn" data-action="clone" title="Clone environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button><button class="cfg-env-btn" data-action="rename" title="Rename environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button><button class="cfg-env-btn del" data-action="delete" title="Delete environment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button></div>`
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

  cfgForm.innerHTML = `
    ${wizStep(1, 'Local Site & Packages', true, !!sitePath, sitePath ? esc(sitePath) : '', `
      <div class="cfg-fields">
        ${fieldBrowse('c-sp','site path',c.local?.site_path,'full','Full path to the local IIS site (e.g. C:\\MySite\\10.7\\WizRisk.MyProject)')}
        ${field('c-ps','parent site URL',c.local?.parent_site||'','full','text','Full URL of the reference/parent site used to download packages (e.g. https://myserver/10.11/WizRisk.10.11/)')}
        ${fieldVersion('c-ver','version',ver,'Platform version (e.g. 10.7, 10.11)')}
        ${field('c-usr','site user',c.local?.user||'admin','','text','Site admin username')}
        ${field('c-spw','site password',c.local?.password||'','','password','Site admin password')}
        ${field('c-devpw','developer password',c.local?.developer_password||'','','password','Builder developer password (used by Setup Local Auth)')}
        ${field('c-dbu','DB user',c.local?.db_user||'sa','','text','SQL Server login (default: sa)')}
        ${field('c-dbpw','DB password',c.local?.db_password||'','','password','SQL Server password for DB user')}
        <div class="cfg-field full"><label>packages ${S.cachedPackages.length ? `<span class="pkg-count" id="pkgCount">${(c.packages||[]).length}/${S.cachedPackages.length} selected</span>` : '<button class="refresh-btn" onclick="loadPackages()" style="margin-left:8px">load from DB</button>'}</label>${S.cachedPackages.length ? `<div class="pkg-filter"><input class="pkg-filter-input" type="text" placeholder="filter packages..." oninput="filterPackages(this.value)" autocomplete="off"><button class="refresh-btn" onclick="selectAllPkgs()" style="font-size:9px">all</button><button class="refresh-btn" onclick="deselectAllPkgs()" style="font-size:9px">none</button></div><div class="pkg-grid" id="pkgGrid">${S.cachedPackages.slice().sort().map(p => `<label class="pkg-chip${(c.packages||[]).includes(p)?' selected':''}" data-pkg="${esc(p)}" onclick="this.classList.toggle('selected');updatePkgCount();autoSave()"><span>${esc(p)}</span></label>`).join('')}</div>` : `<input id="c-pkg" type="text" value="${esc((c.packages||[]).join(', '))}" placeholder="comma separated, or click 'load from DB'">`}</div>
      </div>
    `)}
    ${wizStep(2, 'Azure DevOps — Connection', true, okToken, okToken ? `${S.cachedProjects.length} projects` : '', `
      <div class="cfg-fields">
        ${field('c-org','organization',c.azdo?.organization||'','','text','Azure DevOps organization name — appears in the URL: dev.azure.com/{organization}')}
        ${field('c-pat','personal access token (PAT)',token,'full','password','Personal Access Token — create one at Azure DevOps > User Settings > Personal Access Tokens. Required scopes: Code (Read & Write), Work Items (Read & Write)')}
      </div>
      <div style="margin-top:8px">
        <button class="refresh-btn" onclick="wizValidatePat()">test PAT & load projects</button>
        <button class="refresh-btn" onclick="openUrl('https://dev.azure.com/' + (getOrg() || '_') + '/_usersSettings/tokens')">create a PAT ↗</button>
      </div>
    `)}
    ${wizStep(3, 'Project & Repository', okToken, okRepo, okRepo ? `${proj} / ${repo}` : (okProj ? proj : ''), `
      <p class="wiz-desc">A <strong>project</strong> groups repos, work items & pipelines. A <strong>repository</strong> is a git repo inside the project.</p>
      <div class="cfg-fields">
        <div class="cfg-field"><label>project <button class="refresh-mini" onclick="wizValidatePat()" title="Refresh projects">↻</button></label>${nativeSelectInline('c-proj',proj,S.cachedProjects,'onProjectChange')}</div>
        <div class="cfg-field ss-wrap"><label>repository <button class="refresh-mini" onclick="refreshRepos()" title="Refresh repos">↻</button></label>${ssInputInline('c-repo',repo,S.cachedRepos,'onRepoChange')}</div>
        ${field('c-rdm','metadata repository',c.azdo?.repository_metadata||'Test.Package.Metadata.GitObjectDB','full','text','Repository containing the metadata/version database (git4inno). Default: Test.Package.Metadata.GitObjectDB')}
      </div>
    `)}
    ${wizStep(4, 'Branches', okRepo, okFb && okTb, okFb ? `${c.feature_branch} → ${c.target_branch||'?'}` : '', `
      <p class="wiz-desc"><strong>Feature branch</strong> = your changes. <strong>Target branch</strong> = where you merge. <button class="refresh-mini" onclick="refreshBranches()" title="Refresh branches">↻</button></p>
      <div class="cfg-fields">
        ${ssFieldWithCreate('c-fb','feature branch',c.feature_branch,S.cachedBranches,'Your working branch where changes are committed')}
        ${ssField('c-tb','target branch',c.target_branch,S.cachedBranches,undefined,'The branch your feature will be merged into (e.g. main, develop)')}
        <div class="cfg-field full"><label><input type="checkbox" id="c-md" ${c.deactivate_metadata_conversion ? '' : 'checked'}> Enable metadata conversion (view-diff)</label><p class="wiz-desc" style="margin:4px 0 0">Disable if the metadata repository is not set up for this project.</p></div>
      </div>
    `)}
    ${wizStep(5, 'Work Item', okToken, !!c.workitem_id, c.workitem_id || '', `
      <div class="cfg-fields">
        ${fieldWorkItem('c-wi','work item',c.workitem_id,'Link a User Story or Bug to auto-generate branch name')}
      </div>
    `)}
  `;
  // Auto-load cascade
  if (token && !S.cachedProjects.length) {
    invoke<string[]>('list_azdo_projects', { token, organization: getOrg() }).then(p => {
      if (p.length) { S.cachedProjects = p; renderConfig(); }
    }).catch(() => {});
  }
  if (okProj && !S.cachedRepos.length) {
    invoke<string[]>('list_azdo_repos', { token, project: proj, organization: getOrg() }).then(r => {
      if (r.length) { S.cachedRepos = r; renderConfig(); }
    }).catch(() => {});
  }
  if (okRepo && !S.cachedBranches.length) {
    invoke<string[]>('list_azdo_branches', { token, project: proj, repository: repo, organization: getOrg() }).then(b => {
      if (b.length) { S.cachedBranches = b; renderConfig(); }
    }).catch(() => {});
  }
}

// ── Wizard helpers ──
let wizClosed: Record<number, boolean> = {};
function wizStep(num: number, title: string, unlocked: boolean, isOk: boolean, summary: string, content: string): string {
  if (!unlocked) return `<div class="wiz-step locked"><div class="wiz-step-header"><span class="wiz-num">${num}</span><span class="wiz-title">${esc(title)}</span><span class="wiz-lock">complete previous steps</span></div></div>`;
  const isOpen = !wizClosed[num];
  // 'done' class = green indicator, even when open
  const cls = (isOpen ? 'active' : '') + (isOk ? ' done' : '');
  return `<div class="wiz-step ${cls}">
    <div class="wiz-step-header" onclick="toggleWizStep(${num})">
      <span class="wiz-num">${isOk ? '✓' : num}</span>
      <span class="wiz-title">${esc(title)}</span>
      ${!isOpen && summary ? `<span class="wiz-summary">${esc(summary)}</span>` : ''}
      <span class="wiz-chevron">${isOpen ? '▾' : '▸'}</span>
    </div>
    <div class="wiz-body">${content}</div>
  </div>`;
}
export function toggleWizStep(num: number): void {
  wizClosed[num] = !wizClosed[num];
  const snap = getFormValues();
  renderConfig();
  setFormValues(snap);
}

// ── Native select (for small lists like projects) ──
function nativeSelectInline(id: string, value: string, options: string[], onChange?: string): string {
  const opts = (options||[]).map(o => `<option value="${esc(o)}" ${o===value?'selected':''}>${esc(o)}</option>`).join('');
  const onCh = onChange ? `onchange="if(window['${onChange}'])window['${onChange}'](this.value)"` : '';
  return `<select id="${id}" class="cfg-select" ${onCh}>${value && !options.includes(value) ? `<option value="${esc(value)}" selected>${esc(value)}</option>` : ''}${opts}</select>`;
}
function ssInputInline(id: string, value: string, options: string[], onChange?: string): string {
  const items = (options||[]).map(o => `<div class="ss-item${o===value?' selected':''}" onclick="ssSelect('${id}','${esc(o)}'${onChange?`,'${onChange}'`:''})">` + esc(o) + '</div>').join('');
  return `<input id="${id}" type="text" class="ss-input" value="${esc(value||'')}" placeholder="type to filter..." oninput="ssFilter('${id}')" onfocus="ssOpen('${id}')" autocomplete="off"><div class="ss-results" id="${id}-list">${items || '<div class="ss-empty">no data</div>'}</div>`;
}

// ── Searchable select (custom dropdown) ──
function ssField(id: string, label: string, value: string | undefined, options: string[], onChange?: string, tooltip?: string): string {
  const items = (options||[]).map(o => `<div class="ss-item${o===value?' selected':''}" onclick="ssSelect('${id}','${esc(o)}'${onChange?`,'${onChange}'`:''})">` + esc(o) + '</div>').join('');
  const tip = tooltip ? `<span class="cfg-tip" title="${esc(tooltip)}">?</span>` : '';
  return `<div class="cfg-field ss-wrap"><label>${esc(label)}${tip}</label><input id="${id}" type="text" class="ss-input" value="${esc(value||'')}" placeholder="type to filter..." oninput="ssFilter('${id}')" onfocus="ssOpen('${id}')" autocomplete="off"><div class="ss-results" id="${id}-list">${items || '<div class="ss-empty">no data — load first</div>'}</div></div>`;
}
function ssFieldWithCreate(id: string, label: string, value: string | undefined, options: string[], tooltip?: string): string {
  const items = (options||[]).map(o => `<div class="ss-item${o===value?' selected':''}" onclick="ssSelect('${id}','${esc(o)}')">` + esc(o) + '</div>').join('');
  const tip = tooltip ? `<span class="cfg-tip" title="${esc(tooltip)}">?</span>` : '';
  return `<div class="cfg-field ss-wrap"><label>${esc(label)}${tip}</label><div style="display:flex;gap:4px"><input id="${id}" type="text" class="ss-input" value="${esc(value||'')}" placeholder="type to filter..." oninput="ssFilter('${id}')" onfocus="ssOpen('${id}')" autocomplete="off" style="flex:1"><button class="browse-btn" onclick="createBranch()" title="Create new branch">+</button></div><div class="ss-results" id="${id}-list">${items || '<div class="ss-empty">no data</div>'}</div></div>`;
}
export function ssOpen(id: string): void {
  document.querySelectorAll('.ss-results.open').forEach(el => { el.classList.remove('open'); });
  const input = document.getElementById(id) as HTMLInputElement | null;
  const list = document.getElementById(id+'-list');
  if (!input || !list) return;
  // Position fixed dropdown below the input
  const rect = input.getBoundingClientRect();
  (list as HTMLElement).style.top = rect.bottom + 2 + 'px';
  (list as HTMLElement).style.left = rect.left + 'px';
  (list as HTMLElement).style.width = rect.width + 'px';
  list.classList.add('open');
  ssFilter(id);
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
    S.cachedRepos = await invoke('list_azdo_repos', { token, project: proj, organization: getOrg() });
    S.cachedBranches = [];
    toast(S.cachedRepos.length + ' repos loaded', 'success');
    const snap = getFormValues(); snap.proj = proj; renderConfig(); setFormValues(snap);
  } catch(e) { toast('Repos: ' + e, 'error'); }
}
export async function refreshRepos(): Promise<void> {
  const token = getToken();
  const proj = getProject();
  if (!token || !proj) { toast('Need PAT & project first', 'warn'); return; }
  toast('Refreshing repos...', 'info');
  try {
    S.cachedRepos = await invoke('list_azdo_repos', { token, project: proj, organization: getOrg() });
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
    S.cachedBranches = await invoke('list_azdo_branches', { token, project: getProject(), repository: repo, organization: getOrg() });
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
    S.cachedBranches = await invoke('list_azdo_branches', { token, project: getProject(), repository: repo, organization: getOrg() });
    toast(S.cachedBranches.length + ' branches loaded', 'success');
    const snap = getFormValues(); snap.repo = repo; renderConfig(); setFormValues(snap);
  } catch(e) { toast('Branches: ' + e, 'error'); }
}

function field(id: string, label: string, value: string, cls?: string, type?: string, tooltip?: string): string {
  const isPassword = type === 'password';
  const eye = isPassword ? `<button class="pwd-toggle" onclick="togglePwd('${id}')" title="Show/hide" type="button">👁</button>` : '';
  const tip = tooltip ? `<span class="cfg-tip" title="${esc(tooltip)}">?</span>` : '';
  return `<div class="cfg-field ${cls||''}"><label>${esc(label)}${tip}</label><div class="field-pwd-wrap"><input id="${id}" type="${type||'text'}" value="${esc(value||'')}" autocomplete="off" oninput="autoSave()">${eye}</div></div>`;
}
export function togglePwd(id: string): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}
function fieldVersion(id: string, label: string, value: string, tooltip?: string): string {
  const tip = tooltip ? `<span class="cfg-tip" title="${esc(tooltip)}">?</span>` : '';
  return `<div class="cfg-field"><label>${esc(label)}${tip}</label><input id="${id}" type="text" value="${esc(value||'')}" placeholder="ex: 10.7" oninput="onVersionChange(this.value)" autocomplete="off"></div>`;
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
  const sitePath = snap.sp || '';
  if (!sitePath) { toast('Set a site path first', 'warn'); return; }
  toast('Fetching packages...', 'info');
  try {
    S.cachedPackages = await invoke('list_sql_packages', { sitePath, password: snap.spw || S.envConfig.local?.password || null });
    toast('Found ' + S.cachedPackages.length + ' packages', S.cachedPackages.length ? 'success' : 'warn');
    renderConfig();
    setFormValues(snap);
  } catch(e) { toast('Packages: '+e, 'error'); }
}
function getSelectedPackages(): string[] {
  return Array.from(document.querySelectorAll('.pkg-chip.selected')).map(el => (el as HTMLElement).dataset.pkg!);
}
function fieldWorkItem(id: string, label: string, value: string | undefined, tooltip?: string): string {
  const tip = tooltip ? `<span class="cfg-tip" title="${esc(tooltip)}">?</span>` : '';
  return `<div class="cfg-field full wi-search">
    <label>${esc(label)}${tip}</label>
    <div style="display:flex;gap:4px">
      <input id="${id}" type="text" value="${esc(value||'')}" placeholder="search by ID or title..." oninput="searchWI(this.value)" onfocus="showWIResultsCached()" autocomplete="off" style="flex:1">
      <button class="browse-btn" onclick="loadWorkItems()" title="Load recent work items">load</button>
      <button class="browse-btn" onclick="loadMyWorkItems()" title="Load my assigned items">@me</button>
    </div>
    <div class="wi-results" id="wiResults"></div>
  </div>`;
}
let wiDebounce: ReturnType<typeof setTimeout> | null = null;
function renderWIResults(items: WorkItem[]): void {
  const el = document.getElementById('wiResults');
  if (!el) return;
  if (!items.length) { el.classList.remove('open'); return; }
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
    S.cachedWorkItems = await invoke('search_work_items', { token, project: getProject(), query: '', organization: getOrg() });
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
    S.cachedWorkItems = await invoke('search_work_items', { token, project: getProject(), query: '@me', organization: getOrg() });
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
      const items: WorkItem[] = await invoke('search_work_items', { token, project: getProject(), query, organization: getOrg() });
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
    const slug = (wi.title || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
    const prefix = wi.type === 'Bug' ? 'fix' : 'feature';
    const typePrefix = (wi.type || '').includes('User Story') ? 'US' : (wi.type || '').includes('Bug') ? 'BUG' : 'WI';
    // Derive user initials from git username (fallback to empty)
    const gitUser = S.envConfig.git?.username || '';
    const initials = gitUser ? gitUser.split(/[\s.]+/).map(p => p[0]?.toUpperCase() || '').join('') : '';
    const branch = initials ? `${prefix}/${initials}/${typePrefix}-${id}-${slug}` : `${prefix}/${typePrefix}-${id}-${slug}`;
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
function fieldBrowse(id: string, label: string, value: string | undefined, cls?: string, tooltip?: string): string {
  const tip = tooltip ? `<span class="cfg-tip" title="${esc(tooltip)}">?</span>` : '';
  return `<div class="cfg-field ${cls||''} drop-zone" style="position:relative" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDrop(event,'${id}')"><label>${esc(label)}${tip}<span class="drop-hint">drop folder here</span></label><div style="display:flex;gap:4px"><input id="${id}" type="text" value="${esc(value||'')}" style="flex:1" autocomplete="off" oninput="autoSave()"><button class="browse-btn" onclick="doBrowse('${id}')">...</button></div></div>`;
}
function fieldBrowseFile(id: string, label: string, value: string | undefined, cls?: string, tooltip?: string, filter?: string): string {
  const tip = tooltip ? `<span class="cfg-tip" title="${esc(tooltip)}">?</span>` : '';
  const f = filter ? esc(filter) : '';
  return `<div class="cfg-field ${cls||''} drop-zone" style="position:relative" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDrop(event,'${id}')"><label>${esc(label)}${tip}<span class="drop-hint">drop file here</span></label><div style="display:flex;gap:4px"><input id="${id}" type="text" value="${esc(value||'')}" style="flex:1" autocomplete="off" oninput="autoSave()"><button class="browse-btn" onclick="doBrowseFile('${id}','${f}')">...</button></div></div>`;
}
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
    await invoke('create_azdo_branch', { token, project: getProject(), repository, branchName, sourceBranch, organization: getOrg() });
    toast('Branch "' + branchName + '" created!', 'success');
    // Refresh branches and select the new one
    S.cachedBranches = await invoke('list_azdo_branches', { token, project: getProject(), repository, organization: getOrg() });
    const snap = getFormValues();
    snap.fb = branchName;
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

interface FormSnapshot {
  wi: string | null;
  org: string | null;
  repo: string | null;
  rdm: string | null;
  fb: string | null;
  tb: string | null;
  pkg: string | null;
  sp: string | null;
  ps: string | null;
  usr: string | null;
  spw: string | null;
  dbu: string | null;
  dbpw: string | null;
  pat: string | null;
  ver: string | null;
  proj: string | null;
}

function getFormValues(): FormSnapshot {
  const v = (id: string): string | null => (document.getElementById(id) as HTMLInputElement)?.value ?? null;
  return { wi:v('c-wi'), org:v('c-org'), repo:v('c-repo'), rdm:v('c-rdm'), fb:v('c-fb'), tb:v('c-tb'), pkg:v('c-pkg'),
    sp:v('c-sp'), ps:v('c-ps'), usr:v('c-usr'), spw:v('c-spw'), dbu:v('c-dbu'), dbpw:v('c-dbpw'), pat:v('c-pat'), ver:v('c-ver'), proj:v('c-proj') };
}
function setFormValues(s: FormSnapshot): void {
  if (!s) return;
  const set = (id: string, val: string | null): void => { const el = document.getElementById(id) as HTMLInputElement | null; if(el && val!==null) el.value=val; };
  set('c-wi',s.wi); set('c-org',s.org); set('c-repo',s.repo); set('c-rdm',s.rdm); set('c-fb',s.fb); set('c-tb',s.tb); set('c-pkg',s.pkg);
  set('c-sp',s.sp); set('c-ps',s.ps); set('c-usr',s.usr); set('c-spw',s.spw); set('c-dbu',s.dbu); set('c-dbpw',s.dbpw); set('c-pat',s.pat); set('c-ver',s.ver); set('c-proj',s.proj);
}
export function getToken(): string { return (document.getElementById('c-pat') as HTMLInputElement)?.value || S.envConfig.azdo?.token || ''; }
export function getRepo(): string { return (document.getElementById('c-repo') as HTMLInputElement)?.value || S.envConfig.azdo?.repository || ''; }

export async function loadBranches(): Promise<void> {
  const snap = getFormValues();
  const token = getToken();
  const repository = snap.repo || getRepo();
  if (!token || !repository) { toast('Fill PAT & select a repository first', 'warn'); return; }
  toast('Loading branches...', 'info');
  try {
    S.cachedBranches = await invoke('list_azdo_branches', { token, project: getProject(), repository, organization: getOrg() });
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
    S.cachedRepos = await invoke('list_azdo_repos', { token, project: getProject(), organization: getOrg() });
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

export async function saveConfig(): Promise<void> {
  const config = buildConfig();
  try {
    await invoke('save_env', { name: S.currentEnv, config });
    S.envConfig = config; renderSelectedInfo();
    const btn = document.querySelector('.save-btn'); if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 600); }
    const el = document.getElementById('cfgMsg2'); if (el) { el.textContent = 'saved'; el.className = 'msg ok'; setTimeout(() => { el.textContent = ''; }, 2000); }
    toast('Configuration saved', 'success');
  } catch(e) {
    const el = document.getElementById('cfgMsg2'); if (el) { el.textContent = String(e); el.className = 'msg err'; }
  }
}

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
export function autoSave(): void {
  clearTimeout(autoSaveTimer!);
  autoSaveTimer = setTimeout(() => { if (S.currentEnv) saveConfig(); }, 1500);
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
    try { S.cachedBranches = await invoke('list_azdo_branches', { token, project:getProject(), repository:repo, organization: getOrg() }); } catch {}
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
    await invoke('delete_azdo_branch', { token, project:getProject(), repository:repo, branchName, organization: getOrg() });
    toast('Branch "' + branchName + '" deleted', 'success');
    S.cachedBranches = S.cachedBranches.filter(b => b !== branchName);
    renderConfig();
  } catch(e) { toast('Delete failed: ' + e, 'error'); }
}
