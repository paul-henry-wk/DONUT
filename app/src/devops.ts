// =====================================================================
// devops.ts -- DevOps tab (PRs, builds, branches, merge, work items)
// =====================================================================

import type { PullRequest, BuildStatus, WorkItem, ModalOptions } from './types';
import { esc, toast, invoke, azdoInvoke, ICO, S, getOrg } from './state';
import { getToken, getRepo } from './config';
import { getProject } from './state';

// Re-export diff viewer
export { viewPrDiff } from './devops/diff-viewer';

// ── Local cache ──
interface DevopsCache {
  prs: PullRequest[];
  builds: BuildStatus[];
  diff: { ahead: number; behind: number; changes: Array<{ change_type: string; path: string }> } | null;
  conflicts: { can_merge: boolean; conflicts: Array<unknown> } | null;
  workItems: WorkItem[];
  loading: boolean;
}

let devopsCache: DevopsCache = {
  prs: [],
  builds: [],
  diff: null,
  conflicts: null,
  workItems: [],
  loading: false,
};

// ── Lucide icons for DevOps ──
const DV_ICO: Record<string, string> = {
  pr:      ICO('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/>'),
  build:   ICO('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  branch:  ICO('<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'),
  merge:   ICO('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>'),
  wi:      ICO('<path d="M15.5 2H8.6c-.4 0-.8.2-1.1.5-.3.3-.5.7-.5 1.1v12.8c0 .4.2.8.5 1.1.3.3.7.5 1.1.5h9.8c.4 0 .8-.2 1.1-.5.3-.3.5-.7.5-1.1V6.5L15.5 2z"/><polyline points="14 2 14 8 20 8"/>'),
  check:   ICO('<polyline points="20 6 9 17 4 12"/>'),
  x:       ICO('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  refresh: ICO('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>'),
  key:     ICO('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
};

export async function renderDevops(): Promise<void> {
  const el = document.getElementById('devopsContent');
  if (!el) return;
  const token = getToken();
  const repo = getRepo();
  const fb = S.envConfig.feature_branch || '';
  const tb = S.envConfig.target_branch || '';

  if (!token || !repo) {
    el.innerHTML = '<div class="dv-empty">Configure PAT & repository in [ config ] first.</div>';
    return;
  }

  el.innerHTML = '<div class="dv-loading"><div class="dv-loading-donut">&#127849;</div><div class="dv-loading-text">Loading DevOps data...</div></div>';

  // Load all data in parallel
  const results = await Promise.allSettled([
    azdoInvoke<PullRequest[]>('list_azdo_prs', { token, project: getProject(), repository: repo }),
    azdoInvoke<BuildStatus[]>('list_azdo_builds', { token, project: getProject(), repository: repo, branch: fb || null }),
    fb && tb ? azdoInvoke<DevopsCache['diff']>('compare_branches', { token, project: getProject(), repository: repo, sourceBranch: fb, targetBranch: tb }) : Promise.resolve(null),
    fb && tb ? azdoInvoke<DevopsCache['conflicts']>('check_merge_conflicts', { token, project: getProject(), repository: repo, sourceBranch: fb, targetBranch: tb }) : Promise.resolve(null),
    fb ? azdoInvoke<WorkItem[]>('list_branch_work_items', { token, project: getProject(), repository: repo, branch: fb }) : Promise.resolve([]),
  ]);

  devopsCache.prs = results[0].status === 'fulfilled' ? (results[0].value as PullRequest[]) : [];
  devopsCache.builds = results[1].status === 'fulfilled' ? (results[1].value as BuildStatus[]) : [];
  devopsCache.diff = results[2].status === 'fulfilled' ? (results[2].value as DevopsCache['diff']) : null;
  devopsCache.conflicts = results[3].status === 'fulfilled' ? (results[3].value as DevopsCache['conflicts']) : null;
  devopsCache.workItems = results[4].status === 'fulfilled' ? (results[4].value as WorkItem[]) : [];

  renderDevopsContent();
}

function renderDevopsContent(): void {
  const el = document.getElementById('devopsContent');
  if (!el) return;
  const { prs, builds, diff, conflicts, workItems } = devopsCache;
  const fb = S.envConfig.feature_branch || '';
  const tb = S.envConfig.target_branch || '';
  const org = getOrg();
  const project = getProject();
  const repo = getRepo();

  // -- Dashboard cards --
  const lastBuild = builds[0];
  const buildOk = lastBuild?.result === 'succeeded';
  const buildFail = lastBuild?.result === 'failed';
  const buildPending = lastBuild && !buildOk && !buildFail;
  const canMerge = conflicts?.can_merge;
  const buildTime = lastBuild?.finish_time ? new Date(lastBuild.finish_time).toLocaleString('fr', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';

  let html = `<div class="dv-dashboard">
    <div class="dv-dash-card ${buildOk ? 'ok' : buildFail ? 'fail' : 'neutral'}"${lastBuild?.url ? ` onclick="openUrl('${esc(lastBuild.url)}')" style="cursor:pointer"` : ''}>
      <div class="dv-dash-icon">${DV_ICO.build}</div>
      <div class="dv-dash-value">${buildOk ? 'Passed' : buildFail ? 'Failed' : buildPending ? 'Running' : '\u2014'}</div>
      <div class="dv-dash-label">Build${buildTime ? ` \u00B7 ${buildTime}` : ''}</div>
    </div>
    <div class="dv-dash-card ${prs.length > 0 ? 'ok' : 'neutral'}">
      <div class="dv-dash-icon">${DV_ICO.pr}</div>
      <div class="dv-dash-value">${prs.length}</div>
      <div class="dv-dash-label">Pull Request${prs.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="dv-dash-card ${diff ? (diff.ahead > 0 ? 'ok' : 'neutral') : 'neutral'}">
      <div class="dv-dash-icon">${DV_ICO.branch}</div>
      <div class="dv-dash-value">${diff ? `${diff.ahead}\u2191 ${diff.behind}\u2193` : '\u2014'}</div>
      <div class="dv-dash-label">${fb || 'branch'} vs ${tb || 'target'}</div>
    </div>
    <div class="dv-dash-card ${canMerge === true ? 'ok' : canMerge === false ? 'fail' : 'neutral'}">
      <div class="dv-dash-icon">${DV_ICO.merge}</div>
      <div class="dv-dash-value">${canMerge === true ? 'Ready' : canMerge === false ? 'Conflicts' : '\u2014'}</div>
      <div class="dv-dash-label">Merge Status</div>
    </div>
    <button class="dv-refresh-btn" onclick="renderDevops()" title="Refresh">${DV_ICO.refresh}</button>
  </div>`;

  // -- Quick links --
  if (org && project) {
    const baseUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}`;
    const repoUrl = repo ? `${baseUrl}/_git/${encodeURIComponent(repo)}` : '';
    html += `<div class="dv-quicklinks">
      ${repoUrl ? `<a class="dv-qlink" onclick="openUrl('${esc(repoUrl)}')">${DV_ICO.branch} Repository</a>` : ''}
      ${repoUrl && fb ? `<a class="dv-qlink" onclick="openUrl('${esc(repoUrl)}?version=GB${encodeURIComponent(fb)}')">${DV_ICO.branch} ${esc(fb)}</a>` : ''}
      ${repoUrl ? `<a class="dv-qlink" onclick="openUrl('${esc(repoUrl)}/pullrequests')">${DV_ICO.pr} Pull Requests</a>` : ''}
      <a class="dv-qlink" onclick="openUrl('${esc(baseUrl)}/_build')">${DV_ICO.build} Pipelines</a>
      <a class="dv-qlink" onclick="openUrl('${esc(baseUrl)}/_workitems')">${DV_ICO.wi} Work Items</a>
    </div>`;
  }

  // -- Pull Requests (expandable) --
  html += `<div class="dv-panel">
    <div class="dv-panel-header" onclick="this.parentElement.classList.toggle('open')">
      <span class="dv-panel-icon">${DV_ICO.pr}</span>
      <span class="dv-panel-title">Pull Requests</span>
      <span class="dv-count">${prs.length}</span>
      <span class="dv-panel-chevron">\u25B8</span>
    </div>
    <div class="dv-panel-body">`;
  if (!prs.length) {
    html += '<div class="dv-empty-small">No active pull requests</div>';
  } else {
    prs.forEach((pr: PullRequest) => {
      html += `<div class="dv-pr">
        <span class="dv-pr-id">#${pr.id}</span>
        <span class="dv-pr-title">${esc(pr.title || '')}</span>
        <span class="dv-pr-meta">${esc(pr.source_branch || '')} \u2192 ${esc(pr.target_branch || '')}</span>
        <span class="dv-pr-actions">
          <button class="dv-pr-btn dv-pr-btn-diff" onclick="event.stopPropagation();viewPrDiff(${pr.id},'${esc(pr.title || '')}','${esc(pr.source_branch || '')}','${esc(pr.target_branch || '')}')" title="View file changes">${DV_ICO.branch} diff</button>
          <button class="dv-pr-btn" onclick="event.stopPropagation();openUrl('${esc(pr.url || '')}')" title="Open in browser">\u2197 open</button>
          <button class="dv-pr-btn" onclick="event.stopPropagation();navigator.clipboard.writeText('${esc(pr.url || '')}');toast('PR URL copied','success')" title="Copy URL">\u2398 copy</button>
        </span>
      </div>`;
    });
  }
  html += '</div></div>';

  // -- CI/CD Builds (expandable) --
  html += `<div class="dv-panel">
    <div class="dv-panel-header" onclick="this.parentElement.classList.toggle('open')">
      <span class="dv-panel-icon">${DV_ICO.build}</span>
      <span class="dv-panel-title">CI/CD Builds</span>
      <span class="dv-count">${builds.length}</span>
      <span class="dv-panel-chevron">\u25B8</span>
    </div>
    <div class="dv-panel-body">`;
  if (!builds.length) {
    html += '<div class="dv-empty-small">No recent builds</div>';
  } else {
    builds.slice(0, 5).forEach((b: BuildStatus) => {
      const cls = b.result === 'succeeded' ? 'ok' : b.result === 'failed' ? 'fail' : 'pending';
      const ico = b.result === 'succeeded' ? DV_ICO.check : b.result === 'failed' ? DV_ICO.x : DV_ICO.refresh;
      const time = b.finish_time ? new Date(b.finish_time).toLocaleString('fr', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'in progress';
      html += `<div class="dv-build ${cls}" onclick="openUrl('${esc(b.url || '')}')">
        <span class="dv-build-icon">${ico}</span>
        <span class="dv-build-name">${esc(b.definition_name || '')}</span>
        <span class="dv-build-time">${time}</span>
      </div>`;
    });
  }
  html += '</div></div>';

  // -- Branch & Merge (combined, expandable) --
  html += `<div class="dv-panel${(diff || conflicts) ? ' open' : ''}">
    <div class="dv-panel-header" onclick="this.parentElement.classList.toggle('open')">
      <span class="dv-panel-icon">${DV_ICO.branch}</span>
      <span class="dv-panel-title">Branch & Merge</span>
      ${diff ? `<span class="dv-count">${diff.ahead}\u2191 ${diff.behind}\u2193 \u00B7 ${diff.changes.length} files</span>` : ''}
      <span class="dv-panel-chevron">\u25B8</span>
    </div>
    <div class="dv-panel-body">`;
  if (!fb || !tb) {
    html += '<div class="dv-empty-small">Configure feature & target branches first</div>';
  } else {
    if (diff) {
      html += `<div class="dv-diff-summary">
        <span class="dv-diff-stat ahead">\u2191 ${diff.ahead} ahead</span>
        <span class="dv-diff-stat behind">\u2193 ${diff.behind} behind</span>
        <span class="dv-diff-stat files">${diff.changes.length} file${diff.changes.length !== 1 ? 's' : ''}</span>
      </div>`;
      if (diff.changes.length) {
        html += '<div class="dv-diff-files">';
        diff.changes.slice(0, 20).forEach((c: { change_type: string; path: string }) => {
          const cls = c.change_type === 'add' ? 'add' : c.change_type === 'delete' ? 'del' : 'edit';
          const icon = c.change_type === 'add' ? '+' : c.change_type === 'delete' ? '\u2212' : '~';
          html += `<div class="dv-diff-file ${cls}"><span class="dv-diff-icon">${icon}</span>${esc(c.path)}</div>`;
        });
        if (diff.changes.length > 20) html += `<div class="dv-empty-small">... and ${diff.changes.length - 20} more files</div>`;
        html += '</div>';
      }
    }
    if (conflicts) {
      if (conflicts.can_merge) {
        html += `<div class="dv-merge-ok">${DV_ICO.check} Ready to merge \u2014 no conflicts</div>`;
      } else {
        html += `<div class="dv-merge-fail">${DV_ICO.x} ${conflicts.conflicts.length} conflict(s) detected</div>`;
        if (conflicts.conflicts.length > 0) {
          html += '<div class="dv-conflict-files">';
          conflicts.conflicts.slice(0, 15).forEach((c: any) => {
            const path = c?.path || c?.filePath || JSON.stringify(c);
            html += `<div class="dv-conflict-file">\u26A0 ${esc(String(path))}</div>`;
          });
          if (conflicts.conflicts.length > 15) html += `<div class="dv-empty-small">... and ${conflicts.conflicts.length - 15} more</div>`;
          html += '</div>';
        }
      }
    }
  }
  html += '</div></div>';

  // -- Work Items (expandable) --
  html += `<div class="dv-panel${workItems.length ? ' open' : ''}">
    <div class="dv-panel-header" onclick="this.parentElement.classList.toggle('open')">
      <span class="dv-panel-icon">${DV_ICO.wi}</span>
      <span class="dv-panel-title">Linked Work Items</span>
      <span class="dv-count">${workItems.length}</span>
      <span class="dv-panel-chevron">\u25B8</span>
    </div>
    <div class="dv-panel-body">`;
  if (!workItems.length) {
    html += '<div class="dv-empty-small">No work items linked in commits</div>';
  } else {
    workItems.forEach((wi: WorkItem) => {
      const stCls = wi.state === 'Closed' || wi.state === 'Done' ? 'done' : wi.state === 'Active' || wi.state === 'In Progress' ? 'active' : 'new';
      html += `<div class="dv-wi">
        <span class="dv-wi-id">#${wi.id}</span>
        <span class="dv-wi-type">${esc(wi.type || '')}</span>
        <span class="dv-wi-title">${esc(wi.title || '')}</span>
        <span class="dv-wi-state ${stCls}">${esc(wi.state || '')}</span>
      </div>`;
    });
  }
  html += '</div></div>';

  // -- Recent Activity (timeline) --
  const activity: Array<{ time: Date; icon: string; text: string; cls: string; url?: string }> = [];
  // Builds → timeline
  builds.slice(0, 5).forEach((b: BuildStatus) => {
    const t = b.finish_time ? new Date(b.finish_time) : new Date();
    const cls = b.result === 'succeeded' ? 'ok' : b.result === 'failed' ? 'fail' : 'neutral';
    activity.push({ time: t, icon: DV_ICO.build, text: `Build <b>${esc(b.definition_name || 'pipeline')}</b> ${b.result || b.status}`, cls, url: b.url });
  });
  // PRs → timeline
  prs.forEach((pr: PullRequest) => {
    activity.push({ time: new Date(), icon: DV_ICO.pr, text: `PR <b>#${pr.id}</b> ${esc(pr.title || '')}`, cls: 'ok', url: pr.url });
  });
  // Sort by time descending
  activity.sort((a, b) => b.time.getTime() - a.time.getTime());

  if (activity.length > 0) {
    html += `<div class="dv-panel open">
      <div class="dv-panel-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="dv-panel-icon">${DV_ICO.refresh}</span>
        <span class="dv-panel-title">Recent Activity</span>
        <span class="dv-count">${activity.length}</span>
        <span class="dv-panel-chevron">\u25B8</span>
      </div>
      <div class="dv-panel-body"><div class="dv-timeline">`;
    activity.slice(0, 10).forEach(a => {
      const timeStr = a.time.toLocaleString('fr', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      html += `<div class="dv-tl-item ${a.cls}"${a.url ? ` onclick="openUrl('${esc(a.url)}')" style="cursor:pointer"` : ''}>
        <div class="dv-tl-dot"></div>
        <div class="dv-tl-icon">${a.icon}</div>
        <div class="dv-tl-text">${a.text}</div>
        <div class="dv-tl-time">${timeStr}</div>
      </div>`;
    });
    html += '</div></div></div>';
  }

  // -- Tools (inline, no section) --
  html += `<div class="dv-tools">
    <button class="dv-tool-btn" onclick="resetGitCreds()" title="Clear stored git credentials">${DV_ICO.key} Reset credentials</button>
  </div>`;

  el.innerHTML = html;
}

export async function resetGitCreds(): Promise<void> {
  const ok = await (window as any).showConfirm('Reset Git Credentials', 'This will clear stored git credentials for dev.azure.com. The next git operation will ask you to re-authenticate.');
  if (!ok) return;
  try {
    const msg = await invoke<string>('reset_git_credentials');
    toast(msg, 'success');
  } catch (e) {
    toast('Reset failed: ' + e, 'error');
  }
}

export async function reassignWI(id: number): Promise<void> {
  const result = await (window as any).showModal({
    title: 'Reassign Work Item #' + id,
    message: 'Enter email or display name of the new assignee.',
    inputPlaceholder: 'firstname.lastname@company.com',
    confirmLabel: 'Assign',
  } as ModalOptions);
  if (!result) return;
  const token = getToken();
  try {
    await azdoInvoke('assign_work_item', { token, project: getProject(), workItemId: id, assignTo: (result as string).trim() });
    toast('Work item #' + id + ' reassigned', 'success');
    renderDevops();
  } catch (e) {
    toast('Assign failed: ' + e, 'error');
  }
}
