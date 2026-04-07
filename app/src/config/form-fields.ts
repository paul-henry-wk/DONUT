// =====================================================================
// config/form-fields.ts -- Pure HTML-generating helpers for config form
// =====================================================================

import { esc, getOrg } from '../state';

// ── Wizard state ──
export let wizClosed: Record<number, boolean> = {};

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
export function field(id: string, label: string, value: string, cls?: string, type?: string, tooltip?: string): string {
  const isPassword = type === 'password';
  const eye = isPassword ? `<button class="cfg-action-btn" onclick="togglePwd('${id}')" title="Show/hide" type="button">\uD83D\uDC41</button>` : '';
  return `<div class="cfg-field ${cls||''}"><label>${label}${tip(tooltip)}</label><div class="cfg-input-row"><input id="${id}" type="${type||'text'}" value="${esc(value||'')}" autocomplete="off" onblur="autoSave()">${eye}</div></div>`;
}

export function fieldVersion(id: string, label: string, value: string, tooltip?: string): string {
  return `<div class="cfg-field"><label>${label}${tip(tooltip)}</label><input id="${id}" type="text" value="${esc(value||'')}" placeholder="ex: 10.7" oninput="onVersionChange(this.value)" autocomplete="off"></div>`;
}

export function fieldBrowse(id: string, label: string, value: string | undefined, cls?: string, tooltip?: string): string {
  return `<div class="cfg-field ${cls||''} drop-zone" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDrop(event,'${id}')"><label>${label}${tip(tooltip)}<span class="drop-hint">drop here</span></label><div class="cfg-input-row"><input id="${id}" type="text" value="${esc(value||'')}" autocomplete="off" onblur="autoSave();validatePath('${id}')"><button class="cfg-action-btn" onclick="doBrowse('${id}')" title="Browse folder">...</button><span class="cfg-valid" id="${id}-valid"></span></div></div>`;
}

export function fieldBrowseFile(id: string, label: string, value: string | undefined, cls?: string, tooltip?: string, filter?: string): string {
  const f = filter ? esc(filter) : '';
  return `<div class="cfg-field ${cls||''} drop-zone" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDrop(event,'${id}')"><label>${label}${tip(tooltip)}<span class="drop-hint">drop here</span></label><div class="cfg-input-row"><input id="${id}" type="text" value="${esc(value||'')}" autocomplete="off" onblur="autoSave()"><button class="cfg-action-btn" onclick="doBrowseFile('${id}','${f}')" title="Browse file">...</button></div></div>`;
}

export function fieldWorkItem(id: string, label: string, value: string | undefined, tooltip?: string): string {
  return `<div class="cfg-field full wi-search">
    <label>${label}${tip(tooltip)}</label>
    <div class="cfg-input-row">
      <input id="${id}" type="text" value="${esc(value||'')}" placeholder="search by ID or title..." oninput="searchWI(this.value)" onfocus="showWIResultsCached()" autocomplete="off">
      <button class="cfg-action-btn" onclick="loadWorkItems()" title="Load recent work items">load</button>
      <button class="cfg-action-btn" onclick="loadMyWorkItems()" title="Load my assigned items">@me</button>
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
  return `<div class="cfg-field ss-wrap"><label>${esc(label)}${tip(tooltip)}</label><div class="cfg-input-row"><input id="${id}" type="text" class="ss-input" value="${esc(value||'')}" placeholder="type to filter..." oninput="ssFilter('${id}')" onfocus="ssOpen('${id}')" autocomplete="off"><button class="cfg-action-btn" onclick="createBranch()" title="Create new branch">+</button></div><div class="ss-results" id="${id}-list">${items || '<div class="ss-empty">no data</div>'}</div></div>`;
}
