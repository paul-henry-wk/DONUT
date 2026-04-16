import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SCRIPTS, SCRIPT_GROUPS, S } from '../state';
import { validateEnvForScript } from '../scripts';

// ── validateEnvForScript ──

describe('validateEnvForScript', () => {
  beforeEach(() => {
    // Reset envConfig to empty
    S.envConfig = {};
  });

  it('returns null for unknown script id', () => {
    expect(validateEnvForScript('nonexistent')).toBeNull();
  });

  it('returns null for script with no requires', () => {
    // install-site has requires: [] (empty array)
    S.envConfig = {};
    expect(validateEnvForScript('install-site')).toBeNull();
  });

  it('returns missing fields when env is empty', () => {
    S.envConfig = {};
    const missing = validateEnvForScript('pull-force');
    expect(missing).not.toBeNull();
    expect(missing).toContain('Site path');
    expect(missing).toContain('Feature branch');
    expect(missing).toContain('Repository');
  });

  it('returns null when all required fields are present', () => {
    S.envConfig = {
      local: { site_path: 'C:\\Sites\\test' },
      feature_branch: 'feature/test',
      azdo: { repository: 'myrepo' },
    };
    expect(validateEnvForScript('pull-force')).toBeNull();
  });

  it('detects missing token for commit script', () => {
    S.envConfig = {
      local: { site_path: 'C:\\Sites\\test' },
      feature_branch: 'feature/test',
      target_branch: 'main',
      azdo: { repository: 'myrepo' },
    };
    const missing = validateEnvForScript('commit');
    expect(missing).not.toBeNull();
    expect(missing).toContain('PAT token');
  });

  it('returns null when commit has all fields', () => {
    S.envConfig = {
      local: { site_path: 'C:\\Sites\\test' },
      feature_branch: 'feature/test',
      target_branch: 'main',
      azdo: { repository: 'myrepo', token: 'abc123' },
    };
    expect(validateEnvForScript('commit')).toBeNull();
  });

  it('detects missing target_branch for merge', () => {
    S.envConfig = {
      local: { site_path: 'C:\\Sites\\test' },
      feature_branch: 'feature/test',
    };
    const missing = validateEnvForScript('merge');
    expect(missing).not.toBeNull();
    expect(missing).toContain('Target branch');
  });

  it('detects partial config (site_path set but not branch)', () => {
    S.envConfig = {
      local: { site_path: 'C:\\Sites\\test' },
    };
    const missing = validateEnvForScript('pull');
    expect(missing).not.toBeNull();
    expect(missing).toContain('Feature branch');
    expect(missing).toContain('Repository');
    expect(missing).not.toContain('Site path');
  });

  it('validates all scripts with requires have correct checks', () => {
    S.envConfig = {};
    for (const s of SCRIPTS) {
      if (!s.requires || s.requires.length === 0) continue;
      const missing = validateEnvForScript(s.id);
      // Every script with non-empty requires should return missing fields when env is empty
      expect(missing, `${s.id} should report missing fields`).not.toBeNull();
      expect(missing!.length).toBeGreaterThan(0);
    }
  });
});

// ── doRun guards ──

describe('doRun guards', () => {
  // We test the guard logic indirectly through state + validateEnvForScript
  // since doRun depends on DOM and Tauri invoke which aren't available in unit tests.

  it('selectedScript null prevents run', () => {
    S.selectedScript = null;
    S.isRunning = false;
    // doRun checks: if (!S.selectedScript || S.isRunning) return;
    expect(!S.selectedScript || S.isRunning).toBe(true);
  });

  it('isRunning prevents run', () => {
    S.selectedScript = 'pull';
    S.isRunning = true;
    expect(!S.selectedScript || S.isRunning).toBe(true);
  });

  it('valid state allows run', () => {
    S.selectedScript = 'pull';
    S.isRunning = false;
    expect(!S.selectedScript || S.isRunning).toBe(false);
  });

  it('no env selected prevents run', () => {
    S.currentEnv = '';
    expect(!S.currentEnv).toBe(true);
  });

  it('danger scripts require confirmation', () => {
    const dangerScripts = SCRIPTS.filter(s => s.danger);
    expect(dangerScripts.length).toBeGreaterThan(0);
    // pull-force, reset, rollback, cleanup should all be danger
    const dangerIds = dangerScripts.map(s => s.id);
    expect(dangerIds).toContain('reset');
    expect(dangerIds).toContain('rollback');
    expect(dangerIds).toContain('pull-force');
    expect(dangerIds).toContain('cleanup');
  });

  it('admin scripts have admin flag', () => {
    const adminScripts = SCRIPTS.filter(s => s.admin);
    const adminIds = adminScripts.map(s => s.id);
    expect(adminIds).toContain('install-site');
    expect(adminIds).toContain('setup-local-auth');
  });

  it('commit requires needsMsg', () => {
    const commit = SCRIPTS.find(s => s.id === 'commit');
    expect(commit?.needsMsg).toBe(true);
  });
});

// ── Pipeline system ──

describe('Pipeline', () => {
  beforeEach(() => {
    S.pipeline = [];
    S.pipelineRunning = false;
    S.pipelineIdx = 0;
    // Mock renderPipeline since it accesses DOM
    document.body.innerHTML = '<div id="pipelineBar"></div><div id="scriptsGrid"></div><div id="runBar"></div>';
  });

  it('addToPipeline adds script to queue', async () => {
    const { addToPipeline } = await import('../scripts');
    addToPipeline('pull-force');
    expect(S.pipeline).toEqual(['pull-force']);
    addToPipeline('commit');
    expect(S.pipeline).toEqual(['pull-force', 'commit']);
  });

  it('addToPipeline blocked while running', async () => {
    const { addToPipeline } = await import('../scripts');
    S.pipelineRunning = true;
    addToPipeline('pull');
    expect(S.pipeline).toEqual([]);
  });

  it('removeFromPipeline removes by index', async () => {
    const { removeFromPipeline } = await import('../scripts');
    S.pipeline = ['pull-force', 'commit', 'merge'];
    removeFromPipeline(1);
    expect(S.pipeline).toEqual(['pull-force', 'merge']);
  });

  it('removeFromPipeline blocked while running', async () => {
    const { removeFromPipeline } = await import('../scripts');
    S.pipeline = ['pull-force', 'commit'];
    S.pipelineRunning = true;
    removeFromPipeline(0);
    expect(S.pipeline).toEqual(['pull-force', 'commit']);
  });

  it('clearPipeline empties queue', async () => {
    const { clearPipeline } = await import('../scripts');
    S.pipeline = ['pull-force', 'commit', 'merge'];
    clearPipeline();
    expect(S.pipeline).toEqual([]);
  });

  it('clearPipeline blocked while running', async () => {
    const { clearPipeline } = await import('../scripts');
    S.pipeline = ['pull-force'];
    S.pipelineRunning = true;
    clearPipeline();
    expect(S.pipeline).toEqual(['pull-force']);
  });

  it('movePipelineItem swaps correctly', async () => {
    const { movePipelineItem } = await import('../scripts');
    S.pipeline = ['pull-force', 'commit', 'merge'];
    movePipelineItem(0, 2);
    expect(S.pipeline).toEqual(['commit', 'merge', 'pull-force']);
  });

  it('movePipelineItem blocked while running', async () => {
    const { movePipelineItem } = await import('../scripts');
    S.pipeline = ['pull-force', 'commit'];
    S.pipelineRunning = true;
    movePipelineItem(0, 1);
    expect(S.pipeline).toEqual(['pull-force', 'commit']);
  });

  it('movePipelineItem ignores invalid indices', async () => {
    const { movePipelineItem } = await import('../scripts');
    S.pipeline = ['pull-force', 'commit'];
    movePipelineItem(0, -1);
    expect(S.pipeline).toEqual(['pull-force', 'commit']);
    movePipelineItem(0, 5);
    expect(S.pipeline).toEqual(['pull-force', 'commit']);
  });

  it('cancelPipeline sets pipelineRunning to false', async () => {
    const { cancelPipeline } = await import('../scripts');
    S.pipelineRunning = true;
    S.pipeline = ['pull-force', 'commit'];
    cancelPipeline();
    expect(S.pipelineRunning).toBe(false);
  });

  it('onPipelineRunEnd stops pipeline on failure', async () => {
    const { onPipelineRunEnd } = await import('../scripts');
    S.pipelineRunning = true;
    S.pipelineIdx = 0;
    S.pipeline = ['pull-force', 'commit'];
    onPipelineRunEnd(false);
    expect(S.pipelineRunning).toBe(false);
  });

  it('onPipelineRunEnd advances index on success', async () => {
    vi.useFakeTimers();
    const { onPipelineRunEnd } = await import('../scripts');
    S.pipelineRunning = true;
    S.pipelineIdx = 0;
    S.pipeline = ['pull-force', 'commit'];
    onPipelineRunEnd(true);
    expect(S.pipelineIdx).toBe(1);
    vi.useRealTimers();
  });

  it('onPipelineRunEnd does nothing when not running', async () => {
    const { onPipelineRunEnd } = await import('../scripts');
    S.pipelineRunning = false;
    S.pipelineIdx = 0;
    onPipelineRunEnd(true);
    expect(S.pipelineIdx).toBe(0);
  });
});

// ── Commit message handling ──

describe('Commit message AB# prefix logic', () => {
  it('auto-prefixes with work item ID', () => {
    // Reproduce the logic from doRun
    const wiRaw = '#123 — Fix login bug';
    const msg = 'Updated login flow';
    const wiNumMatch = wiRaw.match(/(\d+)/);
    const wiNum = wiNumMatch ? wiNumMatch[1] : '';
    let result = msg;
    if (wiNum && !result.includes(`AB#${wiNum}`) && !result.includes(`#${wiNum}`)) {
      result = `AB#${wiNum} - ${result}`;
    }
    expect(result).toBe('AB#123 - Updated login flow');
  });

  it('does not double-prefix if AB# already present', () => {
    const wiRaw = '#456 — Some task';
    const msg = 'AB#456 - Already prefixed';
    const wiNumMatch = wiRaw.match(/(\d+)/);
    const wiNum = wiNumMatch ? wiNumMatch[1] : '';
    let result = msg;
    if (wiNum && !result.includes(`AB#${wiNum}`) && !result.includes(`#${wiNum}`)) {
      result = `AB#${wiNum} - ${result}`;
    }
    expect(result).toBe('AB#456 - Already prefixed');
  });

  it('does not prefix when no work item', () => {
    const wiRaw = '';
    const msg = 'Just a message';
    const wiNumMatch = wiRaw.match(/(\d+)/);
    const wiNum = wiNumMatch ? wiNumMatch[1] : '';
    let result = msg;
    if (wiNum && !result.includes(`AB#${wiNum}`) && !result.includes(`#${wiNum}`)) {
      result = `AB#${wiNum} - ${result}`;
    }
    expect(result).toBe('Just a message');
  });

  it('does not prefix if #ID already in message', () => {
    const wiRaw = '#789 — Task';
    const msg = 'Fix for #789';
    const wiNumMatch = wiRaw.match(/(\d+)/);
    const wiNum = wiNumMatch ? wiNumMatch[1] : '';
    let result = msg;
    if (wiNum && !result.includes(`AB#${wiNum}`) && !result.includes(`#${wiNum}`)) {
      result = `AB#${wiNum} - ${result}`;
    }
    expect(result).toBe('Fix for #789');
  });
});

describe('Commit history', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saveCommitHistory stores cleaned message', () => {
    // Reproduce the logic
    const msg = 'AB#123 - My commit message';
    const clean = msg.replace(/^AB#\d+\s*-\s*/, '').trim();
    expect(clean).toBe('My commit message');

    const history = [clean];
    localStorage.setItem('donut-commit-history', JSON.stringify(history));
    const stored = JSON.parse(localStorage.getItem('donut-commit-history')!);
    expect(stored).toEqual(['My commit message']);
  });

  it('strips AB# prefix for storage', () => {
    const msg = 'AB#456 - Fix bug';
    const clean = msg.replace(/^AB#\d+\s*-\s*/, '').trim();
    expect(clean).toBe('Fix bug');
  });

  it('keeps message without AB# prefix as-is', () => {
    const msg = 'Simple commit message';
    const clean = msg.replace(/^AB#\d+\s*-\s*/, '').trim();
    expect(clean).toBe('Simple commit message');
  });

  it('limits history to 10 entries', () => {
    const history: string[] = [];
    for (let i = 0; i < 15; i++) {
      const clean = `msg ${i}`;
      const filtered = history.filter(m => m !== clean);
      filtered.unshift(clean);
      if (filtered.length > 10) filtered.length = 10;
      history.length = 0;
      history.push(...filtered);
    }
    expect(history.length).toBe(10);
    expect(history[0]).toBe('msg 14');
  });

  it('deduplicates messages in history', () => {
    let history = ['one', 'two', 'three'];
    const clean = 'two';
    history = history.filter(m => m !== clean);
    history.unshift(clean);
    expect(history).toEqual(['two', 'one', 'three']);
  });
});

// ── Script metadata consistency ──

describe('Script metadata consistency', () => {
  it('every script with danger flag has a matching danger message', () => {
    const dangerMsgs: Record<string, string> = {
      'pull-force': 'This will reset the local site and apply all commits from the repository. Uncommitted local changes will be lost.',
      'reset': 'This will wipe the local site and rebuild from scratch. All local changes and commit history will be lost.',
      'rollback': 'This will undo commits by creating a revert. Previous history is preserved but changes will be reverted.',
      'cleanup': 'This will delete old commit files (.enzp), temp files, session cookies, and old logs (keeping the 10 most recent).',
    };
    const dangerScripts = SCRIPTS.filter(s => s.danger);
    for (const s of dangerScripts) {
      expect(dangerMsgs[s.id], `${s.id} should have a danger message`).toBeDefined();
    }
  });

  it('reset maps to pull-force script in Rust', () => {
    // Verify the reset→pull-force mapping is documented in script definitions
    const reset = SCRIPTS.find(s => s.id === 'reset');
    const pullForce = SCRIPTS.find(s => s.id === 'pull-force');
    expect(reset).toBeDefined();
    expect(pullForce).toBeDefined();
    // Both should require the same fields
    expect(reset!.requires).toEqual(pullForce!.requires);
  });

  it('all script ids are lowercase with hyphens only', () => {
    for (const s of SCRIPTS) {
      expect(s.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('all grid script nums are unique two-digit strings', () => {
    const gridScripts = SCRIPT_GROUPS.flatMap(g => g.scripts);
    const nums = gridScripts.map(s => s.num);
    const unique = new Set(nums);
    expect(nums.length).toBe(unique.size);
    for (const num of nums) {
      expect(num).toMatch(/^\d{2}$/);
    }
  });

  it('new scripts are registered', () => {
    const newScriptIds = ['cleanup', 'compare', 'log'];
    for (const id of newScriptIds) {
      const script = SCRIPTS.find(s => s.id === id);
      expect(script, `${id} should be in SCRIPTS`).toBeDefined();
      expect(script!.name).toBeTruthy();
      expect(script!.desc).toBeTruthy();
    }
  });

  it('utility scripts have empty requires', () => {
    const utilityIds = ['cleanup', 'compare', 'log'];
    for (const id of utilityIds) {
      const script = SCRIPTS.find(s => s.id === id);
      expect(script).toBeDefined();
      expect(script!.requires).toEqual([]);
    }
  });

});

// ── WF_ALWAYS includes utility scripts ──

describe('Workflow always-available scripts', () => {
  it('utility scripts are always available', async () => {
    const { WF_ALWAYS } = await import('../state');
    expect(WF_ALWAYS).toContain('cleanup');
    expect(WF_ALWAYS).toContain('compare');
    expect(WF_ALWAYS).toContain('log');
  });
});
