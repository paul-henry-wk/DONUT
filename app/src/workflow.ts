// ═══════════════════════════════════════════════════════════════════
// workflow.ts — Workflow state machine & workflow bar UI
// ═══════════════════════════════════════════════════════════════════

import { S } from './state';
import { SCRIPTS, ICONS, WF_STATES, WF_TRANSITIONS, WF_RECOMMEND, WF_ICO, ICO, esc, toast } from './state';
import type { Workflow, WfStep } from './types';

function wfStateIndex(stateId: string): number {
  return WF_STATES.findIndex(s => s.id === stateId);
}

export function getWorkflow(env: string): Workflow {
  if (!env) return { state: 'idle', steps: [] };
  try {
    return JSON.parse(localStorage.getItem('donut-wf-' + env) || 'null') || { state: 'idle', steps: [] };
  } catch {
    return { state: 'idle', steps: [] };
  }
}

function saveWorkflow(env: string, wf: Workflow): void {
  localStorage.setItem('donut-wf-' + env, JSON.stringify(wf));
}

export function advanceWorkflow(env: string, scriptId: string, ok: boolean): void {
  if (!env || !ok) return;
  const tr = WF_TRANSITIONS[scriptId];
  if (!tr) return;
  const wf = getWorkflow(env);
  const newIdx = wfStateIndex(tr.to);
  const curIdx = wfStateIndex(wf.state);

  // Going backwards (e.g. pull-force after commit): reset future steps
  if (newIdx <= curIdx) {
    wf.steps = wf.steps.filter(s => {
      const sTr = WF_TRANSITIONS[s.script];
      if (!sTr) return true;
      return wfStateIndex(sTr.to) <= newIdx;
    });
  }

  wf.state = tr.to;
  wf.steps.push({ script: scriptId, date: new Date().toISOString(), ok: true });
  if (wf.steps.length > 50) wf.steps = wf.steps.slice(-50);
  saveWorkflow(env, wf);
}

// Recalculate workflow state from run history
export function recalcWorkflow(env: string): void {
  if (!env) return;
  const wf = getWorkflow(env);
  // Find the last successful script that has a transition
  const lastStep = [...wf.steps].reverse().find(s => WF_TRANSITIONS[s.script]);
  if (lastStep) {
    wf.state = WF_TRANSITIONS[lastStep.script].to;
  } else {
    wf.state = 'idle';
  }
  saveWorkflow(env, wf);
}

export function getRecommended(env: string): string[] {
  const wf = getWorkflow(env);
  return WF_RECOMMEND[wf.state] || [];
}

export function resetWorkflow(env: string): void {
  if (!env) return;
  saveWorkflow(env, { state: 'idle', steps: [] });
}

// ── Workflow bar ──
export function renderWorkflowBar(): void {
  const el = document.getElementById('workflowBar');
  if (!el || !S.currentEnv) { if (el) el.innerHTML = ''; return; }
  const wf = getWorkflow(S.currentEnv);
  const curIdx = wfStateIndex(wf.state);
  const recommended = getRecommended(S.currentEnv);
  const nextNames = recommended.map(id => SCRIPTS.find(x => x.id === id)?.name || id);

  // Build step tooltips from history
  const stepTooltips: Record<string, string> = {};
  wf.steps.forEach(s => {
    const tr = WF_TRANSITIONS[s.script];
    if (tr) {
      const name = SCRIPTS.find(x => x.id === s.script)?.name || s.script;
      const d = new Date(s.date);
      const timeStr = d.toLocaleString('fr', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      stepTooltips[tr.to] = `${name} (${timeStr})`;
    }
  });

  let html = '';
  WF_STATES.forEach((st, i) => {
    const cls = i < curIdx ? 'done' : i === curIdx ? 'current' : 'upcoming';
    if (i > 0) {
      const connCls = i <= curIdx ? 'done' : i === curIdx ? 'active' : '';
      html += `<div class="wf-connector ${connCls}"></div>`;
    }
    const ico = WF_ICO[st.id] || '';
    const check = i < curIdx ? '<span class="wf-check">\u2714</span>' : '';
    const tooltip = stepTooltips[st.id] || st.label;
    // Click on step: highlight scripts for that state
    html += `<div class="wf-step ${cls}" title="${esc(tooltip)}" onclick="highlightWfStep('${st.id}')">
      <div class="wf-step-icon">${check || ico}</div>
      <div class="wf-step-label">${esc(st.label)}</div>
    </div>`;
  });

  // Right side: history + reset
  const stepCount = wf.steps.length;
  html += `<div class="wf-actions">`;
  html += `<button class="wf-action-btn" onclick="toggleWfHistory()" title="Show workflow history (${stepCount} steps)">${ICO('<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/>')} history${stepCount ? ' (' + stepCount + ')' : ''}</button>`;
  html += `<button class="wf-action-btn" onclick="confirmResetWorkflow()" title="Reset workflow">${ICO('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>')} reset</button>`;
  html += `</div>`;
  el.innerHTML = html;
}

// ── Highlight scripts for a workflow step ──
export let _wfHighlight: string | null = null;

export function highlightWfStep(stateId: string): void {
  // Toggle: click again to clear
  if (_wfHighlight === stateId) { _wfHighlight = null; }
  else { _wfHighlight = stateId; }
  // Re-render scripts with highlight
  (window as any).renderScripts();
  // Update active step visual
  document.querySelectorAll('.wf-step').forEach(el => el.classList.remove('selected'));
  if (_wfHighlight) {
    const idx = wfStateIndex(_wfHighlight);
    document.querySelectorAll('.wf-step')[idx]?.classList.add('selected');
  }
}

// Get scripts that lead to a given state
export function getScriptsForState(stateId: string): string[] {
  return Object.entries(WF_TRANSITIONS).filter(([, v]) => v.to === stateId).map(([k]) => k);
}

// ── Workflow history popup ──
export function toggleWfHistory(): void {
  let popup = document.getElementById('wfHistoryPopup');
  if (popup) { popup.remove(); return; }
  const wf = getWorkflow(S.currentEnv);
  if (!wf.steps.length) return;

  popup = document.createElement('div');
  popup.id = 'wfHistoryPopup';
  popup.className = 'wf-history-popup';

  const rows = [...wf.steps].reverse().map(s => {
    const name = SCRIPTS.find(x => x.id === s.script)?.name || s.script;
    const icon = ICONS[s.script] || '';
    const d = new Date(s.date);
    const timeStr = d.toLocaleString('fr', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const tr = WF_TRANSITIONS[s.script];
    const arrow = tr ? ` <span class="wf-h-arrow">&#8594;</span> <span class="wf-h-state">${WF_STATES.find(x => x.id === tr.to)?.label || tr.to}</span>` : '';
    return `<div class="wf-h-row"><span class="wf-h-icon">${icon}</span><span class="wf-h-name">${esc(name)}</span>${arrow}<span class="wf-h-time">${timeStr}</span></div>`;
  }).join('');

  popup.innerHTML = `<div class="wf-h-title">Workflow History</div>${rows}`;
  document.getElementById('workflowBar')!.appendChild(popup);

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closeWfH(e: MouseEvent) {
      if (!popup!.contains(e.target as Node) && !(e.target as HTMLElement).classList.contains('wf-history-btn')) {
        popup!.remove();
        document.removeEventListener('click', closeWfH);
      }
    });
  }, 0);
}

// ── Confirm reset workflow ──
export async function confirmResetWorkflow(): Promise<void> {
  const ok = await (window as any).showModal({ title: 'Reset Workflow', message: 'Reset the workflow to the beginning? History will be cleared.', confirmLabel: 'Reset', cancelLabel: 'Cancel', danger: true });
  if (ok) {
    resetWorkflow(S.currentEnv);
    renderWorkflowBar();
    (window as any).renderScripts();
    (window as any).renderRunBar();
    toast('Workflow reset', 'info');
  }
}

