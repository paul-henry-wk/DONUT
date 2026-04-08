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

// ── Relative time helper ──
function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days}j`;
  return date.toLocaleDateString('fr', { day: '2-digit', month: 'short' });
}

// ── Workflow history popup ──
export function toggleWfHistory(): void {
  let popup = document.getElementById('wfHistoryPopup');
  if (popup) { popup.remove(); return; }
  const wf = getWorkflow(S.currentEnv);

  popup = document.createElement('div');
  popup.id = 'wfHistoryPopup';
  popup.className = 'wf-history-popup';

  // Position popup relative to the history button, appended to body to avoid overflow clipping
  const btn = document.querySelector('.wf-actions .wf-action-btn') as HTMLElement;
  if (btn) {
    const rect = btn.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.right = (window.innerWidth - rect.right) + 'px';
  }

  let content = '';
  const envLabel = S.currentEnv || 'unknown';
  const stateLabel = WF_STATES.find(s => s.id === wf.state)?.label || wf.state;

  // Header with current state
  content += `<div class="wf-h-title">Historique — ${esc(envLabel)}</div>`;
  content += `<div class="wf-h-summary">État actuel : <strong>${esc(stateLabel)}</strong> · ${wf.steps.length} étape${wf.steps.length !== 1 ? 's' : ''}</div>`;

  if (!wf.steps.length) {
    content += `<div class="wf-h-empty">Aucune action effectuée pour le moment.<br>Lancez un script pour commencer.</div>`;
  } else {
    // Build rows with enriched details
    const rows = [...wf.steps].reverse().map((s, i, arr) => {
      const name = SCRIPTS.find(x => x.id === s.script)?.name || s.script;
      const icon = ICONS[s.script] || '';
      const d = new Date(s.date);
      const timeAgo = relativeTime(d);
      const timeExact = d.toLocaleString('fr', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const tr = WF_TRANSITIONS[s.script];

      // Find matching run history entry for duration
      const runMatch = S.runHistory.find(h => h.script === s.script && h.date === d.toLocaleString('fr'));
      const durationStr = runMatch ? `<span class="wf-h-dur">${runMatch.duration}</span>` : '';

      // State transition: from → to
      let transitionHtml = '';
      if (tr) {
        const toLabel = WF_STATES.find(x => x.id === tr.to)?.label || tr.to;
        // Find the previous step's resulting state (or 'Start' if first)
        const prevStep = arr[i + 1]; // reversed, so i+1 is the previous chronologically
        let fromState = 'Start';
        if (prevStep) {
          const prevTr = WF_TRANSITIONS[prevStep.script];
          if (prevTr) fromState = WF_STATES.find(x => x.id === prevTr.to)?.label || prevTr.to;
        }
        transitionHtml = `<span class="wf-h-transition"><span class="wf-h-from">${esc(fromState)}</span> <span class="wf-h-arrow">\u2192</span> <span class="wf-h-state">${esc(toLabel)}</span></span>`;
      }

      const statusCls = s.ok ? 'wf-h-ok' : 'wf-h-fail';
      const statusDot = s.ok ? '\u25CF' : '\u25CF';

      return `<div class="wf-h-row">
        <span class="wf-h-status ${statusCls}">${statusDot}</span>
        <span class="wf-h-icon">${icon}</span>
        <div class="wf-h-details">
          <div class="wf-h-main"><span class="wf-h-name">${esc(name)}</span>${durationStr}</div>
          ${transitionHtml}
        </div>
        <span class="wf-h-time" title="${esc(timeExact)}">${timeAgo}</span>
      </div>`;
    }).join('');

    content += rows;
  }

  popup.innerHTML = content;
  document.body.appendChild(popup);

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closeWfH(e: MouseEvent) {
      if (!popup!.contains(e.target as Node) && !(e.target as HTMLElement).closest('.wf-action-btn')) {
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

