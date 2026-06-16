// =====================================================================
// config/form-fields.ts -- Pure HTML-generating helpers for config form
// =====================================================================

import { esc, getOrg } from '../state';

// ── SVG icon helpers (16x16, stroke-based) ──
const _i = (d: string) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const CFG_ICO = {
  folder:   _i('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  plus:     _i('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  refresh:  _i('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  eye:      _i('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  search:   _i('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  user:     _i('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  download: _i('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  check:    _i('<polyline points="20 6 9 17 4 12"/>'),
  x:        _i('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  trash:    _i('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  db:       _i('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'),
  link:     _i('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
};

// ── Wizard state ──
export let wizClosed: Record<number, boolean> = { 0: true };

// ── Wizard step rendering ──
export function wizStep(num: number, title: string, unlocked: boolean, isOk: boolean, summary: string, content: string): string {
  if (!unlocked) return `<div class="wiz-step locked"><div class="wiz-step-header"><span class="wiz-num">${num}</span><span class="wiz-title">${esc(title)}</span><span class="wiz-lock">complete previous steps</span></div></div>`;
  const isOpen = !wizClosed[num];
  const cls = (isOpen ? 'active' : '') + (isOk ? ' done' : '');
  return `<div class="wiz-step ${cls}" data-step="${num}">
    <div class="wiz-step-header" onclick="toggleWizStep(${num})">
      <span class="wiz-num">${isOk ? '\u2713' : num}</span>
      <span class="wiz-title">${esc(title)}</span>
      ${!isOpen && summary ? `<span class="wiz-summary">${esc(summary)}</span>` : ''}
      <span class="wiz-chevron">${isOpen ? '\u25BE' : '\u25B8'}</span>
    </div>
    <div class="wiz-body">${content}</div>
  </div>`;
}

// ── Tooltip helper ──
function tip(tooltip?: string): string {
  return tooltip ? `<span class="cfg-tip" title="${esc(tooltip)}">?</span>` : '';
}

// ── Form field helpers ──
export function field(id: string, label: string, value: string, cls?: string, type?: string, tooltip?: string, oninput?: string): string {
  const isPassword = type === 'password';
  const eye = isPassword ? `<button class="cfg-action-btn" onclick="togglePwd('${id}')" title="Show/hide" type="button">${CFG_ICO.eye}</button>` : '';
  const oninputAttr = oninput ? ` oninput="${oninput}"` : '';
  return `<div class="cfg-field ${cls||''}"><label>${label}${tip(tooltip)}</label><div class="cfg-input-row"><input id="${id}" type="${type||'text'}" value="${esc(value||'')}" autocomplete="off"${oninputAttr} onblur="autoSave()">${eye}</div></div>`;
}

export function fieldVersion(id: string, label: string, value: string, tooltip?: string): string {
  return `<div class="cfg-field"><label>${label}${tip(tooltip)}</label><input id="${id}" type="text" value="${esc(value||'')}" placeholder="ex: 10.7" oninput="onVersionChange(this.value)" autocomplete="off"></div>`;
}

export function fieldBrowse(id: string, label: string, value: string | undefined, cls?: string, tooltip?: string, extraBtn?: string): string {
  return `<div class="cfg-field ${cls||''} drop-zone" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDrop(event,'${id}')"><label>${label}${tip(tooltip)}<span class="drop-hint">drop here</span></label><div class="cfg-input-row"><input id="${id}" type="text" value="${esc(value||'')}" autocomplete="off" onblur="autoSave();validatePath('${id}')"><button class="cfg-action-btn" onclick="doBrowse('${id}')" title="Browse folder">${CFG_ICO.folder}</button>${extraBtn||''}<span class="cfg-valid" id="${id}-valid"></span></div></div>`;
}

export function fieldBrowseFile(id: string, label: string, value: string | undefined, cls?: string, tooltip?: string, filter?: string): string {
  const f = filter ? esc(filter) : '';
  return `<div class="cfg-field ${cls||''} drop-zone" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDrop(event,'${id}')"><label>${label}${tip(tooltip)}<span class="drop-hint">drop here</span></label><div class="cfg-input-row"><input id="${id}" type="text" value="${esc(value||'')}" autocomplete="off" onblur="autoSave()"><button class="cfg-action-btn" onclick="doBrowseFile('${id}','${f}')" title="Browse file">${CFG_ICO.folder}</button></div></div>`;
}

export function fieldWorkItem(id: string, label: string, value: string | undefined, tooltip?: string): string {
  return `<div class="cfg-field full wi-search">
    <label>${label}${tip(tooltip)}</label>
    <div class="cfg-input-row">
      <input id="${id}" type="text" value="${esc(value||'')}" placeholder="search by ID or title..." oninput="searchWI(this.value)" onfocus="showWIResultsCached()" autocomplete="off">
      <button class="cfg-action-btn" onclick="loadWorkItems()" title="Load recent work items">${CFG_ICO.download} load</button>
      <button class="cfg-action-btn" onclick="loadMyWorkItems()" title="Load my assigned items">${CFG_ICO.user} @me</button>
    </div>
    <div class="wi-results" id="wiResults"></div>
  </div>`;
}

// ── Native select (for small lists like projects) ──
export function nativeSelectInline(id: string, value: string, options: string[], onChange?: string): string {
  const opts = (options||[]).map(o => `<option value="${esc(o)}" ${o===value?'selected':''}>${esc(o)}</option>`).join('');
  const onCh = onChange ? `onchange="if(window['${onChange}'])window['${onChange}'](this.value)"` : '';
  return `<select id="${id}" class="cfg-select" ${onCh}>${value && !options.includes(value) ? `<option value="${esc(value)}" selected>${esc(value)}</option>` : ''}${opts}</select>`;
}

// ── Searchable select input (inline, no label wrapper) ──
export function ssInputInline(id: string, value: string, options: string[], onChange?: string): string {
  const items = (options||[]).map(o => `<div class="ss-item${o===value?' selected':''}" onclick="ssSelect('${id}','${esc(o)}'${onChange?`,'${onChange}'`:''})">` + esc(o) + '</div>').join('');
  return `<input id="${id}" type="text" class="ss-input" value="${esc(value||'')}" placeholder="type to filter..." oninput="ssFilter('${id}')" onfocus="ssOpen('${id}')" autocomplete="off"><div class="ss-results" id="${id}-list">${items || '<div class="ss-empty">no data</div>'}</div>`;
}

// ── Searchable select (custom dropdown with label) ──
export function ssField(id: string, label: string, value: string | undefined, options: string[], onChange?: string, tooltip?: string): string {
  const items = (options||[]).map(o => `<div class="ss-item${o===value?' selected':''}" onclick="ssSelect('${id}','${esc(o)}'${onChange?`,'${onChange}'`:''})">` + esc(o) + '</div>').join('');
  return `<div class="cfg-field ss-wrap"><label>${esc(label)}${tip(tooltip)}</label><input id="${id}" type="text" class="ss-input" value="${esc(value||'')}" placeholder="type to filter..." oninput="ssFilter('${id}')" onfocus="ssOpen('${id}')" autocomplete="off"><div class="ss-results" id="${id}-list">${items || '<div class="ss-empty">no data \u2014 load first</div>'}</div></div>`;
}

// ── Searchable select with create button ──
export function ssFieldWithCreate(id: string, label: string, value: string | undefined, options: string[], tooltip?: string): string {
  const items = (options||[]).map(o => `<div class="ss-item${o===value?' selected':''}" onclick="ssSelect('${id}','${esc(o)}')">` + esc(o) + '</div>').join('');
  return `<div class="cfg-field ss-wrap"><label>${esc(label)}${tip(tooltip)}</label><div class="cfg-input-row"><input id="${id}" type="text" class="ss-input" value="${esc(value||'')}" placeholder="type to filter..." oninput="ssFilter('${id}')" onfocus="ssOpen('${id}')" autocomplete="off"><button class="cfg-action-btn" onclick="createBranch()" title="Create new branch">${CFG_ICO.plus}</button></div><div class="ss-results" id="${id}-list">${items || '<div class="ss-empty">no data</div>'}</div></div>`;
}
