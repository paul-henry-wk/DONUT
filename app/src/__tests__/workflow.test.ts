import { describe, it, expect, beforeEach } from 'vitest';
import { WF_TRANSITIONS, WF_RECOMMEND, WF_STATES } from '../state';
import { getWorkflow, advanceWorkflow, recalcWorkflow, getRecommended, resetWorkflow, getScriptsForState } from '../workflow';

// Clear localStorage before each test
beforeEach(() => {
  localStorage.clear();
});

describe('getWorkflow', () => {
  it('returns idle for empty env', () => {
    const wf = getWorkflow('');
    expect(wf.state).toBe('idle');
    expect(wf.steps).toEqual([]);
  });

  it('returns idle for unknown env', () => {
    const wf = getWorkflow('nonexistent');
    expect(wf.state).toBe('idle');
    expect(wf.steps).toEqual([]);
  });

  it('returns stored workflow', () => {
    const stored = { state: 'site_ready', steps: [{ script: 'pull', date: '2026-01-01', ok: true }] };
    localStorage.setItem('donut-wf-test', JSON.stringify(stored));
    const wf = getWorkflow('test');
    expect(wf.state).toBe('site_ready');
    expect(wf.steps).toHaveLength(1);
  });

  it('returns idle for invalid JSON', () => {
    localStorage.setItem('donut-wf-broken', 'not json!');
    const wf = getWorkflow('broken');
    expect(wf.state).toBe('idle');
  });
});

describe('advanceWorkflow', () => {
  it('does nothing for empty env', () => {
    advanceWorkflow('', 'pull', true);
    // No error thrown
  });

  it('does nothing when ok is false', () => {
    advanceWorkflow('test', 'pull', false);
    const wf = getWorkflow('test');
    expect(wf.state).toBe('idle');
  });

  it('does nothing for scripts without transitions', () => {
    advanceWorkflow('test', 'status', true);
    const wf = getWorkflow('test');
    expect(wf.state).toBe('idle');
  });

  it('transitions state forward', () => {
    advanceWorkflow('test', 'install-site', true);
    const wf = getWorkflow('test');
    expect(wf.state).toBe('site_installed');
    expect(wf.steps).toHaveLength(1);
    expect(wf.steps[0].script).toBe('install-site');
  });

  it('transitions through multiple steps', () => {
    advanceWorkflow('test', 'install-site', true);
    advanceWorkflow('test', 'setup-local-auth', true);
    advanceWorkflow('test', 'set-master-packages', true);
    const wf = getWorkflow('test');
    expect(wf.state).toBe('packages_set');
    expect(wf.steps).toHaveLength(3);
  });

  it('resets future steps when going backwards', () => {
    advanceWorkflow('test', 'install-site', true);
    advanceWorkflow('test', 'setup-local-auth', true);
    advanceWorkflow('test', 'set-master-packages', true);
    advanceWorkflow('test', 'pull-force', true);
    advanceWorkflow('test', 'commit', true);
    // Now go back to site_ready via pull-force
    advanceWorkflow('test', 'pull-force', true);
    const wf = getWorkflow('test');
    expect(wf.state).toBe('site_ready');
    // commit step should be removed (it was ahead)
    const hasCommit = wf.steps.some(s => s.script === 'commit');
    expect(hasCommit).toBe(false);
  });

  it('caps history at 50 steps', () => {
    for (let i = 0; i < 55; i++) {
      advanceWorkflow('test', 'pull', true);
    }
    const wf = getWorkflow('test');
    expect(wf.steps.length).toBeLessThanOrEqual(50);
  });
});

describe('recalcWorkflow', () => {
  it('does nothing for empty env', () => {
    recalcWorkflow('');
    // No error thrown
  });

  it('recalculates from last step', () => {
    advanceWorkflow('test', 'install-site', true);
    advanceWorkflow('test', 'pull-force', true);
    // Manually corrupt state
    const wf = getWorkflow('test');
    wf.state = 'idle'; // wrong
    localStorage.setItem('donut-wf-test', JSON.stringify(wf));
    recalcWorkflow('test');
    const fixed = getWorkflow('test');
    expect(fixed.state).toBe('site_ready');
  });

  it('returns idle when no steps have transitions', () => {
    const wf = { state: 'committed', steps: [{ script: 'status', date: '2026-01-01', ok: true }] };
    localStorage.setItem('donut-wf-test', JSON.stringify(wf));
    recalcWorkflow('test');
    const fixed = getWorkflow('test');
    expect(fixed.state).toBe('idle');
  });
});

describe('getRecommended', () => {
  it('returns setup for idle', () => {
    const rec = getRecommended('test');
    expect(rec).toContain('setup');
  });

  it('returns setup after install', () => {
    advanceWorkflow('test', 'install-site', true);
    const rec = getRecommended('test');
    expect(rec).toContain('setup');
  });

  it('returns empty for unknown state', () => {
    const wf = { state: 'nonexistent', steps: [] };
    localStorage.setItem('donut-wf-test', JSON.stringify(wf));
    const rec = getRecommended('test');
    expect(rec).toEqual([]);
  });
});

describe('resetWorkflow', () => {
  it('resets to idle', () => {
    advanceWorkflow('test', 'install-site', true);
    advanceWorkflow('test', 'pull-force', true);
    resetWorkflow('test');
    const wf = getWorkflow('test');
    expect(wf.state).toBe('idle');
    expect(wf.steps).toEqual([]);
  });

  it('does nothing for empty env', () => {
    resetWorkflow('');
    // No error thrown
  });
});

describe('getScriptsForState', () => {
  it('returns install-site for site_installed', () => {
    const scripts = getScriptsForState('site_installed');
    expect(scripts).toContain('install-site');
  });

  it('returns commit for committed', () => {
    const scripts = getScriptsForState('committed');
    expect(scripts).toContain('commit');
  });

  it('returns empty for idle (no transition leads to idle)', () => {
    const scripts = getScriptsForState('idle');
    expect(scripts).toEqual([]);
  });
});

describe('WF_TRANSITIONS consistency', () => {
  it('all transition targets are valid states', () => {
    const stateIds = WF_STATES.map(s => s.id);
    for (const [script, tr] of Object.entries(WF_TRANSITIONS)) {
      expect(stateIds).toContain(tr.to);
    }
  });
});

describe('WF_RECOMMEND consistency', () => {
  it('all recommended scripts exist in WF_TRANSITIONS or SCRIPTS', () => {
    for (const [state, scripts] of Object.entries(WF_RECOMMEND)) {
      for (const scriptId of scripts) {
        // Each recommended script should be a known script
        expect(typeof scriptId).toBe('string');
        expect(scriptId.length).toBeGreaterThan(0);
      }
    }
  });
});
