// =====================================================================
// instances.ts — Instance Manager (list sites, archive, remove)
// =====================================================================

import { esc, toast, invoke, S } from './state';

// ── Types ──

interface EnablonInstance {
  path: string;
  name: string;
  has_wiz_manager: boolean;
}

interface InstanceSite {
  name: string;
  path: string;
  size_mb: number;
  has_database: boolean;
}

interface InstanceData {
  instance: EnablonInstance;
  version: string | null;
  sites: InstanceSite[];
  expanded: boolean;
  loading: boolean;
}

// ── State ──

let instancesData: InstanceData[] = [];
let instancesLoaded = false;
let allLoaded = false;

// ── Public API ──

export function renderInstancesSection(): string {
  if (!instancesLoaded) {
    loadInstances();
    return `<div class="inst-section"><div class="inst-loading">Scanning instances...</div></div>`;
  }
  if (!instancesData.length) {
    return `<div class="inst-section"><div class="inst-empty">No Enablon instances found on this machine.</div></div>`;
  }

  // Summary bar
  const total = instancesData.length;
  const withSites = instancesData.filter(d => d.sites.length > 0).length;
  const totalSites = instancesData.reduce((n, d) => n + d.sites.length, 0);
  let html = `<div class="inst-section">
    <div class="inst-toolbar">
      <span class="inst-summary">${total} instance${total > 1 ? 's' : ''}${allLoaded ? ` \u00B7 ${totalSites} site${totalSites !== 1 ? 's' : ''}` : ''}</span>
      <button class="inst-refresh-btn" onclick="refreshAllInstances()" title="Load all instance data">${allLoaded ? '\u21BB refresh' : '\u25B6 load all'}</button>
    </div>`;

  instancesData.forEach((d, i) => {
    const siteCount = d.sites.length;
    const verLabel = d.version ? `<span class="inst-ver">${esc(d.version)}</span>` : '';
    const wizDot = d.instance.has_wiz_manager
      ? '<span class="inst-dot ok"></span>'
      : '<span class="inst-dot miss"></span>';
    const countLabel = d.loading ? '<span class="inst-count">loading...</span>'
      : siteCount > 0 ? `<span class="inst-count">${siteCount} site${siteCount !== 1 ? 's' : ''}</span>`
      : allLoaded ? '<span class="inst-count dim">empty</span>'
      : '<span class="inst-count dim">\u2014</span>';

    html += `<div class="inst-card${d.expanded ? ' open' : ''}">
      <div class="inst-header" onclick="toggleInstance(${i})">
        ${wizDot}
        <span class="inst-name">${esc(d.instance.name)}</span>
        ${verLabel}
        ${countLabel}
        <span class="inst-chevron">${d.expanded ? '\u25BE' : '\u25B8'}</span>
      </div>`;

    if (d.expanded) {
      if (d.loading) {
        html += '<div class="inst-body"><div class="inst-loading">Loading...</div></div>';
      } else if (!d.sites.length) {
        html += '<div class="inst-body"><div class="inst-empty-sites">No sites installed in this instance</div></div>';
      } else {
        html += '<div class="inst-body"><div class="inst-sites">';
        d.sites.forEach(site => {
          const sizeTxt = site.size_mb >= 1024
            ? `${(site.size_mb / 1024).toFixed(1)} GB`
            : `${Math.round(site.size_mb)} MB`;
          const disabled = S.isRunning ? ' disabled' : '';
          html += `<div class="inst-site">
            <div class="inst-site-info">
              <span class="inst-site-name">${esc(site.name)}</span>
              <span class="inst-site-meta">${site.has_database ? 'SQL \u00B7 ' : ''}${sizeTxt}</span>
            </div>
            <div class="inst-site-actions">
              <button class="inst-action archive"${disabled} onclick="event.stopPropagation();instanceArchive(${i},'${esc(site.name)}')" title="Archive site to ENA backup">\u2913 Archive</button>
              <button class="inst-action remove"${disabled} onclick="event.stopPropagation();instanceRemove(${i},'${esc(site.name)}')" title="Remove site (files + DB)">\u2715 Remove</button>
              <button class="inst-action force"${disabled} onclick="event.stopPropagation();instanceForceRemove(${i},'${esc(site.name)}')" title="Blind forced removal">\u26A0</button>
            </div>
          </div>`;
        });
        html += '</div></div>';
      }
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// ── Load instances (lazy — names only) ──

async function loadInstances(): Promise<void> {
  try {
    const instances = await invoke<EnablonInstance[]>('scan_enablon_instances');
    instancesData = instances.map(inst => ({
      instance: inst,
      version: null,
      sites: [],
      expanded: false,
      loading: false,
    }));
    instancesLoaded = true;
    refreshInstancesUI();
  } catch (e) {
    instancesLoaded = true;
    toast('Failed to scan instances: ' + e, 'error');
    refreshInstancesUI();
  }
}

// ── Load ALL instances data (sites + versions) ──

export async function refreshAllInstances(): Promise<void> {
  toast('Loading all instances...', 'info');
  const promises = instancesData.map(async (d) => {
    d.loading = true;
    try {
      const [sites, version] = await Promise.all([
        invoke<InstanceSite[]>('list_instance_sites', { instancePath: d.instance.path }),
        d.instance.has_wiz_manager ? invoke<string | null>('get_as_version', { instancePath: d.instance.path }) : Promise.resolve(null),
      ]);
      d.sites = sites;
      d.version = version;
    } catch { /* skip failed */ }
    d.loading = false;
  });
  refreshInstancesUI();
  await Promise.all(promises);
  allLoaded = true;
  toast('Instances loaded', 'success');
  refreshInstancesUI();
}

// ── Toggle expand ──

export async function toggleInstance(idx: number): Promise<void> {
  const d = instancesData[idx];
  if (!d) return;
  d.expanded = !d.expanded;
  if (d.expanded && !d.sites.length && !d.loading) {
    d.loading = true;
    refreshInstancesUI();
    try {
      const [sites, version] = await Promise.all([
        invoke<InstanceSite[]>('list_instance_sites', { instancePath: d.instance.path }),
        d.instance.has_wiz_manager ? invoke<string | null>('get_as_version', { instancePath: d.instance.path }) : Promise.resolve(null),
      ]);
      d.sites = sites;
      d.version = version;
    } catch (e) {
      toast('Failed to load sites: ' + e, 'error');
    }
    d.loading = false;
  }
  refreshInstancesUI();
}

// ── Actions ──

export async function instanceArchive(idx: number, siteName: string): Promise<void> {
  const d = instancesData[idx];
  if (!d || S.isRunning) return;

  let targetPath: string;
  try {
    targetPath = await invoke<string>('browse_folder', { defaultPath: d.instance.path });
  } catch { return; }
  if (!targetPath) return;

  const confirmed = await (window as any).showModal({
    title: 'Archive site',
    message: `Archive "${siteName}" to:\n${targetPath}\n\nThis may take several minutes.`,
    confirmLabel: 'Archive',
  });
  if (!confirmed) return;

  try {
    await invoke('run_instance_action', {
      instancePath: d.instance.path, siteId: siteName, action: 'archive', targetPath,
    });
  } catch (e) { toast('Archive failed: ' + e, 'error'); }
}

export async function instanceRemove(idx: number, siteName: string): Promise<void> {
  const d = instancesData[idx];
  if (!d || S.isRunning) return;

  const confirmed = await (window as any).showModal({
    title: 'Remove site',
    message: `Remove "${siteName}" from ${d.instance.name}?\n\nThis will delete the site files and database. This cannot be undone.`,
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await invoke('run_instance_action', {
      instancePath: d.instance.path, siteId: siteName, action: 'remove',
    });
    d.sites = [];
  } catch (e) { toast('Remove failed: ' + e, 'error'); }
}

export async function instanceForceRemove(idx: number, siteName: string): Promise<void> {
  const d = instancesData[idx];
  if (!d || S.isRunning) return;

  const result = await (window as any).showModal({
    title: 'Force remove site',
    message: `BLIND removal of "${siteName}" — even if not properly installed.\n\nType the site name to confirm:`,
    inputPlaceholder: siteName,
    confirmLabel: 'Force Remove',
    danger: true,
  });
  if (!result || result !== siteName) {
    if (result !== null && result !== false) toast('Site name does not match', 'warn');
    return;
  }

  try {
    await invoke('run_instance_action', {
      instancePath: d.instance.path, siteId: siteName, action: 'force-remove',
    });
    d.sites = [];
  } catch (e) { toast('Force remove failed: ' + e, 'error'); }
}

// ── Refresh after instance action completes ──

export function onInstanceActionEnd(): void {
  instancesData.forEach(d => {
    if (d.expanded) { d.sites = []; d.loading = true; }
  });
  refreshInstancesUI();
  instancesData.forEach(async (d) => {
    if (d.loading) {
      try {
        d.sites = await invoke<InstanceSite[]>('list_instance_sites', { instancePath: d.instance.path });
      } catch { /* ignore */ }
      d.loading = false;
      refreshInstancesUI();
    }
  });
}

// ── UI refresh helper ──

function refreshInstancesUI(): void {
  const el = document.getElementById('instancesContainer');
  if (el) el.innerHTML = renderInstancesSection();
}
